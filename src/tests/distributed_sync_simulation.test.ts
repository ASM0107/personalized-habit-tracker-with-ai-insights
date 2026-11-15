import { describe, it, expect } from "vitest";
import {
  handleRegister,
  handleSyncPush,
  handleSyncPull,
  handleSyncGetMaterialized,
} from "../../server/auth.js";
import {
  LamportClock,
  SyncCoordinator,
  LastWriteWinsSynchronizer,
  bindStorageToSync,
  type SyncEnvelope,
  type RemoteSyncPort,
  type SyncPushResult,
  type SyncPullResult,
} from "../core/sync/index.js";
import { BrowserLocalStoragePort } from "../core/database/index.js";
import { InMemoryEventBus } from "../core/event-bus/index.js";
import { HabitStore, type Habit, type HabitEntry } from "../features/habits/index.js";

class MockDirectServerSyncAdapter implements RemoteSyncPort {
  private readonly userId: string;
  private readonly subscribers = new Set<(envelopes: readonly SyncEnvelope<unknown>[]) => void>();

  public constructor(userId: string) {
    this.userId = userId;
  }

  public async pushEnvelopes(envelopes: readonly SyncEnvelope<unknown>[]): Promise<SyncPushResult> {
    const res = handleSyncPush(this.userId, envelopes as unknown as unknown[]);
    if (res.status >= 400) {
      return {
        success: false,
        committedCount: 0,
        serverCursor: 0,
        error: res.body.error || "Push failed",
      };
    }
    return {
      success: true,
      committedCount: res.body.committedCount || 0,
      serverCursor: res.body.serverCursor || 0,
      serverLamportTimestamp: res.body.serverLamportTimestamp || 0,
    };
  }

  public async pullChanges(sinceCursor: number, limit = 100): Promise<SyncPullResult> {
    const res = handleSyncPull(this.userId, sinceCursor, limit);
    const changes = (res.body.changes || []) as readonly SyncEnvelope<unknown>[];
    return {
      changes,
      envelopes: changes,
      materialized: (res.body.materialized || []) as readonly SyncEnvelope<unknown>[],
      nextCursor: res.body.nextCursor || sinceCursor,
      hasMore: Boolean(res.body.hasMore),
      latestServerCursor: res.body.latestServerCursor || 0,
    };
  }

  public async pullEnvelopes(sinceLamportTimestamp: number): Promise<readonly SyncEnvelope<unknown>[]> {
    const res = await this.pullChanges(sinceLamportTimestamp);
    return res.changes;
  }

  public subscribeToRemote(handler: (envelopes: readonly SyncEnvelope<unknown>[]) => void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }
}

describe("Project 001.2: Distributed Synchronization Correctness & Convergence", () => {
  it("enforces idempotent mutations and eliminates duplicate delivery side-effects", async () => {
    const email = `idempotent_${Date.now()}@example.com`;
    const regRes = await handleRegister({ email, password: "password123!" });
    const userId = regRes.body.user!.id;

    const opId = `op_idempotent_fixed_${Date.now()}`;
    const envelope: SyncEnvelope<{ title: string }> = {
      operationId: opId,
      entityId: "h-idempotent-1",
      entityType: "HABIT",
      lamportTimestamp: 10,
      deviceId: "device-alpha",
      payload: { title: "Daily Meditation" },
      isDeleted: false,
    };

    const firstPush = handleSyncPush(userId, [envelope]);
    expect(firstPush.status).toBe(200);
    expect(firstPush.body.serverCursor).toBe(1);
    expect(firstPush.body.newlyCommittedCount).toBe(1);

    const duplicatePush = handleSyncPush(userId, [envelope]);
    expect(duplicatePush.status).toBe(200);
    expect(duplicatePush.body.serverCursor).toBe(1);
    expect(duplicatePush.body.newlyCommittedCount).toBe(0);

    const pullRes = handleSyncPull(userId, 0, 100);
    expect(pullRes.body.changes?.length).toBe(1);
    expect(pullRes.body.materialized?.length).toBe(1);
  });

  it("maintains deterministic materialized entity state and prevents stale regression", async () => {
    const email = `materialized_${Date.now()}@example.com`;
    const regRes = await handleRegister({ email, password: "password123!" });
    const userId = regRes.body.user!.id;

    const olderEnvelope: SyncEnvelope<{ title: string; target: number }> = {
      operationId: `op_older_${Date.now()}`,
      entityId: "h-conflict-target",
      entityType: "HABIT",
      lamportTimestamp: 5,
      deviceId: "device-old",
      payload: { title: "Reading", target: 10 },
      isDeleted: false,
    };

    const newerEnvelope: SyncEnvelope<{ title: string; target: number }> = {
      operationId: `op_newer_${Date.now()}`,
      entityId: "h-conflict-target",
      entityType: "HABIT",
      lamportTimestamp: 15,
      deviceId: "device-new",
      payload: { title: "Reading Masterclass", target: 30 },
      isDeleted: false,
    };

    handleSyncPush(userId, [newerEnvelope]);
    handleSyncPush(userId, [olderEnvelope]);

    const pullRes = handleSyncPull(userId, 0);
    expect(pullRes.body.changes?.length).toBe(2);

    const matRes = handleSyncGetMaterialized(userId);
    const winningEntity = matRes.body.entities?.find(
      (e) => (e as { entityId: string }).entityId === "h-conflict-target"
    ) as { payload: { title: string; target: number } } | undefined;

    expect(winningEntity).toBeDefined();
    expect(winningEntity?.payload.title).toBe("Reading Masterclass");
    expect(winningEntity?.payload.target).toBe(30);
  });

  it("enforces deletion tombstones and prevents stale mutations from resurrecting records", async () => {
    const email = `tombstone_${Date.now()}@example.com`;
    const regRes = await handleRegister({ email, password: "password123!" });
    const userId = regRes.body.user!.id;

    const createEnvelope: SyncEnvelope<{ title: string }> = {
      operationId: `op_create_${Date.now()}`,
      entityId: "h-tombstone-test",
      entityType: "HABIT",
      lamportTimestamp: 2,
      deviceId: "phone-1",
      payload: { title: "Running 5km" },
      isDeleted: false,
    };

    const deleteTombstone: SyncEnvelope<{ title: string }> = {
      operationId: `op_del_${Date.now()}`,
      entityId: "h-tombstone-test",
      entityType: "HABIT",
      lamportTimestamp: 10,
      deviceId: "phone-1",
      payload: { title: "Running 5km" },
      isDeleted: true,
      tombstone: true,
    };

    const staleConcurrentEdit: SyncEnvelope<{ title: string }> = {
      operationId: `op_stale_edit_${Date.now()}`,
      entityId: "h-tombstone-test",
      entityType: "HABIT",
      lamportTimestamp: 7,
      deviceId: "laptop-2",
      payload: { title: "Running 10km (Zombie)" },
      isDeleted: false,
    };

    handleSyncPush(userId, [createEnvelope]);
    handleSyncPush(userId, [deleteTombstone]);
    handleSyncPush(userId, [staleConcurrentEdit]);

    const matRes = handleSyncGetMaterialized(userId);
    const targetEntity = matRes.body.entities?.find(
      (e) => (e as { entityId: string }).entityId === "h-tombstone-test"
    ) as { isDeleted: boolean; tombstone: boolean } | undefined;

    expect(targetEntity).toBeDefined();
    expect(targetEntity?.isDeleted).toBe(true);
    expect(targetEntity?.tombstone).toBe(true);

    const validNewResurrection: SyncEnvelope<{ title: string }> = {
      operationId: `op_resurrect_${Date.now()}`,
      entityId: "h-tombstone-test",
      entityType: "HABIT",
      lamportTimestamp: 12,
      deviceId: "tablet-3",
      payload: { title: "Running Reborn" },
      isDeleted: false,
    };

    handleSyncPush(userId, [validNewResurrection]);
    const postMatRes = handleSyncGetMaterialized(userId);
    const revivedEntity = postMatRes.body.entities?.find(
      (e) => (e as { entityId: string }).entityId === "h-tombstone-test"
    ) as { isDeleted: boolean; payload: { title: string } } | undefined;

    expect(revivedEntity?.isDeleted).toBe(false);
    expect(revivedEntity?.payload.title).toBe("Running Reborn");
  });

  it("integrates SyncCoordinator directly with live HabitStore and BrowserLocalStoragePort", async () => {
    const email = `app_store_sync_${Date.now()}@example.com`;
    const regRes = await handleRegister({ email, password: "password123!" });
    const userId = regRes.body.user!.id;

    const eventBus1 = new InMemoryEventBus();
    const eventBus2 = new InMemoryEventBus();
    const clock1 = new LamportClock();
    const clock2 = new LamportClock();

    const habitStorage1 = new BrowserLocalStoragePort<Habit>("node_device_1", "habits");
    const entryStorage1 = new BrowserLocalStoragePort<HabitEntry>("node_device_1", "entries");
    const store1 = new HabitStore(habitStorage1, entryStorage1, eventBus1, clock1);

    const habitStorage2 = new BrowserLocalStoragePort<Habit>("node_device_2", "habits");
    const entryStorage2 = new BrowserLocalStoragePort<HabitEntry>("node_device_2", "entries");
    const store2 = new HabitStore(habitStorage2, entryStorage2, eventBus2, clock2);

    const adapter1 = new MockDirectServerSyncAdapter(userId);
    const adapter2 = new MockDirectServerSyncAdapter(userId);

    const coord1 = new SyncCoordinator("device_1", clock1, adapter1, eventBus1);
    const coord2 = new SyncCoordinator("device_2", clock2, adapter2, eventBus2);

    bindStorageToSync({
      entityType: "HABIT",
      storage: habitStorage2,
      coordinator: coord2,
    });

    const createdHabit = await store1.createHabit({
      id: "live-habit-sync-42",
      title: "Cold Plunge",
      category: "Health",
      targetType: "DURATION",
      targetValue: 3,
      schedule: {
        recurrenceType: "DAILY",
        daysOfWeekMask: 127,
        frequencyPerWeek: 7,
        intervalDays: 1,
        startDateKey: "2026-01-01",
        timeOfDay: "ANYTIME",
        preferredTimeMinutes: 0,
      },
    });

    coord1.enqueueLocalChange("live-habit-sync-42", "HABIT", createdHabit);

    const pushStats1 = await coord1.syncNow();
    expect(pushStats1.pendingOutboundCount).toBe(0);

    const pullStats2 = await coord2.syncNow();
    expect(pullStats2.state).toBe("IDLE");

    const replicatedHabit = await habitStorage2.getById("live-habit-sync-42");
    expect(replicatedHabit).not.toBeNull();
    expect(replicatedHabit?.title).toBe("Cold Plunge");
    expect(replicatedHabit?.targetValue).toBe(3);

    const summaryFromStore2 = await store2.getHabitHistory(
      "live-habit-sync-42",
      "2026-01-01",
      "2026-01-02"
    );
    expect(summaryFromStore2.habit.title).toBe("Cold Plunge");

    coord1.enqueueLocalDeletion("live-habit-sync-42", "HABIT", createdHabit);
    await coord1.syncNow();
    await coord2.syncNow();

    const deletedHabit = await habitStorage2.getById("live-habit-sync-42");
    expect(deletedHabit).toBeNull();

    coord1.destroy();
    coord2.destroy();
  });

  it("achieves full state convergence across a concurrent 3-device mesh simulation", async () => {
    const email = `three_device_sim_${Date.now()}@example.com`;
    const regRes = await handleRegister({ email, password: "password123!" });
    const userId = regRes.body.user!.id;

    const clockPhone = new LamportClock(10);
    const clockLaptop = new LamportClock(20);
    const clockTablet = new LamportClock(30);

    const adapterPhone = new MockDirectServerSyncAdapter(userId);
    const adapterLaptop = new MockDirectServerSyncAdapter(userId);
    const adapterTablet = new MockDirectServerSyncAdapter(userId);

    const coordPhone = new SyncCoordinator("dev_phone", clockPhone, adapterPhone);
    const coordLaptop = new SyncCoordinator("dev_laptop", clockLaptop, adapterLaptop);
    const coordTablet = new SyncCoordinator("dev_tablet", clockTablet, adapterTablet);

    interface DeviceEntityRecord {
      payload: { title: string; target?: number };
      lamport: number;
      deviceId: string;
      isDeleted: boolean;
    }

    const synchronizer = new LastWriteWinsSynchronizer<{ title: string; target?: number }>();

    const dbPhone = new Map<string, DeviceEntityRecord>();
    const dbLaptop = new Map<string, DeviceEntityRecord>();
    const dbTablet = new Map<string, DeviceEntityRecord>();

    const applyMutation = (
      db: Map<string, DeviceEntityRecord>,
      env: SyncEnvelope<{ title: string; target?: number }>
    ) => {
      const existing = db.get(env.entityId);
      if (!existing) {
        if (!env.isDeleted) {
          db.set(env.entityId, {
            payload: env.payload,
            lamport: env.lamportTimestamp,
            deviceId: env.deviceId,
            isDeleted: false,
          });
        }
        return;
      }

      const localEnvelope: SyncEnvelope<{ title: string; target?: number }> = {
        entityId: env.entityId,
        entityType: env.entityType,
        lamportTimestamp: existing.lamport,
        deviceId: existing.deviceId,
        payload: existing.payload,
        isDeleted: existing.isDeleted,
      };

      const winner = synchronizer.resolveWinner(localEnvelope, env);
      if (winner === env) {
        if (env.isDeleted) {
          db.delete(env.entityId);
        } else {
          db.set(env.entityId, {
            payload: env.payload,
            lamport: env.lamportTimestamp,
            deviceId: env.deviceId,
            isDeleted: false,
          });
        }
      }
    };

    coordPhone.registerApplier("HABIT", (env) => {
      applyMutation(dbPhone, env as SyncEnvelope<{ title: string; target?: number }>);
    });

    coordLaptop.registerApplier("HABIT", (env) => {
      applyMutation(dbLaptop, env as SyncEnvelope<{ title: string; target?: number }>);
    });

    coordTablet.registerApplier("HABIT", (env) => {
      applyMutation(dbTablet, env as SyncEnvelope<{ title: string; target?: number }>);
    });

    const recordPhone = (id: string, payload: { title: string; target?: number }) => {
      const env = coordPhone.enqueueLocalChange(id, "HABIT", payload);
      applyMutation(dbPhone, env);
    };

    const recordLaptop = (id: string, payload: { title: string; target?: number }) => {
      const env = coordLaptop.enqueueLocalChange(id, "HABIT", payload);
      applyMutation(dbLaptop, env);
    };

    const recordTablet = (id: string, payload: { title: string; target?: number }) => {
      const env = coordTablet.enqueueLocalChange(id, "HABIT", payload);
      applyMutation(dbTablet, env);
    };

    recordPhone("shared-h1", { title: "Hydrate", target: 2000 });
    recordLaptop("shared-h1", { title: "Hydrate More", target: 3000 });
    recordTablet("shared-h1", { title: "Hydrate Optimum", target: 3500 });

    recordPhone("phone-only", { title: "Phone Note" });
    recordLaptop("laptop-only", { title: "Laptop Code" });

    await coordPhone.syncNow();
    await coordLaptop.syncNow();
    await coordTablet.syncNow();

    await coordPhone.syncNow();
    await coordLaptop.syncNow();
    await coordTablet.syncNow();

    expect(dbPhone.size).toBe(3);
    expect(dbLaptop.size).toBe(3);
    expect(dbTablet.size).toBe(3);

    const phoneH1 = dbPhone.get("shared-h1")?.payload;
    const laptopH1 = dbLaptop.get("shared-h1")?.payload;
    const tabletH1 = dbTablet.get("shared-h1")?.payload;

    expect(phoneH1).toEqual(laptopH1);
    expect(laptopH1).toEqual(tabletH1);
    expect(tabletH1?.title).toBe("Hydrate Optimum");

    coordPhone.destroy();
    coordLaptop.destroy();
    coordTablet.destroy();
  });
});
