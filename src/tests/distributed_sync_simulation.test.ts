import { describe, it, expect, beforeEach } from "vitest";
import * as os from "node:os";
import {
  handleRegister,
  handleSyncPush,
  handleSyncPull,
  handleSyncGetMaterialized,
  getStorageFile,
  setStorageFileForTesting,
} from "../../server/auth.js";
import {
  LamportClock,
  SyncCoordinator,
  LastWriteWinsSynchronizer,
  bindStorageToSync,
  isIncomingWinner,
  LocalTombstoneStore,
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

describe("Project 001.3: Distributed Synchronization Correctness, Convergence & Protocol Durability", () => {
  beforeEach(() => {
    const storeMap = new Map<string, string>();
    const fakeLocalStorage = {
      getItem: (key: string) => storeMap.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storeMap.set(key, String(value));
      },
      removeItem: (key: string) => {
        storeMap.delete(key);
      },
      clear: () => {
        storeMap.clear();
      },
    };

    Object.defineProperty(globalThis, "window", {
      value: { localStorage: fakeLocalStorage },
      writable: true,
      configurable: true,
    });
  });

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

  it("enforces identical canonical comparison logic across client comparator, LWW synchronizer, and server", async () => {
    const lww = new LastWriteWinsSynchronizer<{ val: string }>();

    const envA: SyncEnvelope<{ val: string }> = {
      entityId: "e1",
      entityType: "TEST",
      lamportTimestamp: 10,
      deviceId: "device-a",
      operationId: "op-1-a",
      payload: { val: "A" },
      isDeleted: false,
    };

    const envBHigherLamport: SyncEnvelope<{ val: string }> = {
      entityId: "e1",
      entityType: "TEST",
      lamportTimestamp: 11,
      deviceId: "device-a",
      operationId: "op-0-b",
      payload: { val: "B" },
      isDeleted: false,
    };
    expect(isIncomingWinner(envA, envBHigherLamport)).toBe(true);
    expect(isIncomingWinner(envBHigherLamport, envA)).toBe(false);
    expect(lww.resolveWinner(envA, envBHigherLamport)).toBe(envBHigherLamport);
    expect(lww.resolveWinner(envBHigherLamport, envA)).toBe(envBHigherLamport);

    const envCHigherDevice: SyncEnvelope<{ val: string }> = {
      entityId: "e1",
      entityType: "TEST",
      lamportTimestamp: 10,
      deviceId: "device-b",
      operationId: "op-1-c",
      payload: { val: "C" },
      isDeleted: false,
    };
    expect(isIncomingWinner(envA, envCHigherDevice)).toBe(true);
    expect(isIncomingWinner(envCHigherDevice, envA)).toBe(false);
    expect(lww.resolveWinner(envA, envCHigherDevice)).toBe(envCHigherDevice);
    expect(lww.resolveWinner(envCHigherDevice, envA)).toBe(envCHigherDevice);

    const envDHigherOp: SyncEnvelope<{ val: string }> = {
      entityId: "e1",
      entityType: "TEST",
      lamportTimestamp: 10,
      deviceId: "device-a",
      operationId: "op-2-d",
      payload: { val: "D" },
      isDeleted: false,
    };
    expect(isIncomingWinner(envA, envDHigherOp)).toBe(true);
    expect(isIncomingWinner(envDHigherOp, envA)).toBe(false);
    expect(lww.resolveWinner(envA, envDHigherOp)).toBe(envDHigherOp);
    expect(lww.resolveWinner(envDHigherOp, envA)).toBe(envDHigherOp);

    const email = `canonical_compare_${Date.now()}@example.com`;
    const regRes = await handleRegister({ email, password: "password123!" });
    const userId = regRes.body.user!.id;

    handleSyncPush(userId, [envA]);
    handleSyncPush(userId, [envCHigherDevice]);
    const matRes1 = handleSyncGetMaterialized(userId);
    const winner1 = matRes1.body.entities?.find((e) => (e as { entityId: string }).entityId === "e1") as
      | { payload: { val: string } }
      | undefined;
    expect(winner1?.payload.val).toBe("C");
  });

  it("guarantees durable client tombstones survive simulated reload and prevent resurrection", async () => {
    const partition = `test_partition_${Date.now()}`;
    const initialTombstoneStore = new LocalTombstoneStore(partition);
    const initialStorage = new BrowserLocalStoragePort<Habit>("habits", partition);
    const clock = new LamportClock(10);
    const adapter = new MockDirectServerSyncAdapter("dummy");
    const coordinator = new SyncCoordinator("dev_reloader", clock, adapter);

    bindStorageToSync({
      entityType: "HABIT",
      storage: initialStorage,
      coordinator,
      tombstoneStore: initialTombstoneStore,
    });

    const activeHabit: Habit = {
      id: "habit-to-be-deleted",
      title: "Meditation",
      category: "Mind",
      targetType: "BOOLEAN",
      targetValue: 1,
      schedule: {
        recurrenceType: "DAILY",
        daysOfWeekMask: 127,
        frequencyPerWeek: 7,
        intervalDays: 1,
        startDateKey: "2026-01-01",
        timeOfDay: "ANYTIME",
        preferredTimeMinutes: 0,
      },
      status: "ACTIVE",
      createdAt: 1000,
      updatedAt: 1000,
    };

    await initialStorage.insert(activeHabit);
    expect(await initialStorage.getById("habit-to-be-deleted")).not.toBeNull();

    const deleteEnvelope: SyncEnvelope<Habit> = {
      entityId: "habit-to-be-deleted",
      entityType: "HABIT",
      lamportTimestamp: 15,
      deviceId: "dev_reloader",
      operationId: "op-del-15",
      payload: activeHabit,
      isDeleted: true,
      tombstone: true,
    };

    await coordinator.applyIncomingEnvelope(deleteEnvelope);
    expect(await initialStorage.getById("habit-to-be-deleted")).toBeNull();

    const reloadedTombstoneStore = new LocalTombstoneStore(partition);
    const reloadedStorage = new BrowserLocalStoragePort<Habit>("habits", partition);
    const clock2 = new LamportClock(20);
    const coordinator2 = new SyncCoordinator("dev_reloader_fresh", clock2, adapter);

    bindStorageToSync({
      entityType: "HABIT",
      storage: reloadedStorage,
      coordinator: coordinator2,
      tombstoneStore: reloadedTombstoneStore,
    });

    const staleResurrectEnvelope: SyncEnvelope<Habit> = {
      entityId: "habit-to-be-deleted",
      entityType: "HABIT",
      lamportTimestamp: 12,
      deviceId: "dev_stale_peer",
      operationId: "op-stale-12",
      payload: { ...activeHabit, title: "Meditation Zombie" },
      isDeleted: false,
    };

    await coordinator2.applyIncomingEnvelope(staleResurrectEnvelope);
    expect(await reloadedStorage.getById("habit-to-be-deleted")).toBeNull();

    coordinator.destroy();
    coordinator2.destroy();
  });

  it("halts cursor progression on inbound applier failure and retries safely", async () => {
    let shouldFail = true;

    class FlakyPullAdapter implements RemoteSyncPort {
      public async pushEnvelopes(): Promise<SyncPushResult> {
        return { success: true, committedCount: 0, serverCursor: 0 };
      }
      public async pullChanges(sinceCursor: number): Promise<SyncPullResult> {
        const changes: SyncEnvelope<unknown>[] = [
          {
            sequence: 1,
            serverCursor: 1,
            entityId: "item-1",
            entityType: "TEST",
            lamportTimestamp: 1,
            deviceId: "srv",
            operationId: "op-seq-1",
            payload: { name: "First" },
            isDeleted: false,
          } as unknown as SyncEnvelope<unknown>,
          {
            sequence: 2,
            serverCursor: 2,
            entityId: "item-2",
            entityType: "TEST",
            lamportTimestamp: 2,
            deviceId: "srv",
            operationId: "op-seq-2",
            payload: { name: "Second" },
            isDeleted: false,
          } as unknown as SyncEnvelope<unknown>,
          {
            sequence: 3,
            serverCursor: 3,
            entityId: "item-3",
            entityType: "TEST",
            lamportTimestamp: 3,
            deviceId: "srv",
            operationId: "op-seq-3",
            payload: { name: "Third" },
            isDeleted: false,
          } as unknown as SyncEnvelope<unknown>,
        ];
        const filtered = changes.filter(
          (c) => (c as unknown as { sequence: number }).sequence > sinceCursor
        );
        return {
          changes: filtered,
          envelopes: filtered,
          materialized: [],
          nextCursor: filtered.length > 0 ? (filtered[filtered.length - 1] as unknown as { sequence: number }).sequence : sinceCursor,
          hasMore: false,
          latestServerCursor: 3,
        };
      }
      public async pullEnvelopes(): Promise<readonly SyncEnvelope<unknown>[]> {
        return [];
      }
      public subscribeToRemote(): () => void {
        return () => {};
      }
    }

    const clock = new LamportClock();
    const adapter = new FlakyPullAdapter();
    const coordinator = new SyncCoordinator(`flaky_client_${Date.now()}`, clock, adapter);

    const appliedItems: string[] = [];
    coordinator.registerApplier("TEST", async (env) => {
      if (env.entityId === "item-2" && shouldFail) {
        throw new Error("Disk full: failed to apply item-2");
      }
      appliedItems.push(env.entityId);
    });

    const firstStats = await coordinator.syncNow();
    expect(firstStats.state).toBe("ERROR");
    expect(firstStats.lastError).toContain("Disk full: failed to apply item-2");
    expect(firstStats.lastSyncedCursor).toBe(1);
    expect(appliedItems).toEqual(["item-1"]);

    shouldFail = false;
    const retryStats = await coordinator.syncNow();
    expect(retryStats.state).toBe("IDLE");
    expect(retryStats.lastSyncedCursor).toBe(3);
    expect(appliedItems).toEqual(["item-1", "item-2", "item-3"]);

    coordinator.destroy();
  });

  it("terminates pull loops gracefully when server returns empty changes even with hasMore true", async () => {
    class EmptyHasMoreAdapter implements RemoteSyncPort {
      public async pushEnvelopes(): Promise<SyncPushResult> {
        return { success: true, committedCount: 0, serverCursor: 0 };
      }
      public async pullChanges(): Promise<SyncPullResult> {
        return {
          changes: [],
          envelopes: [],
          materialized: [],
          nextCursor: 5,
          hasMore: true,
          latestServerCursor: 5,
        };
      }
      public async pullEnvelopes(): Promise<readonly SyncEnvelope<unknown>[]> {
        return [];
      }
      public subscribeToRemote(): () => void {
        return () => {};
      }
    }

    const clock = new LamportClock();
    const adapter = new EmptyHasMoreAdapter();
    const coordinator = new SyncCoordinator(`loop_guard_${Date.now()}`, clock, adapter);

    const stats = await coordinator.syncNow();
    expect(stats.state).toBe("IDLE");
    expect(stats.lastSyncedCursor).toBe(5);

    coordinator.destroy();
  });

  it("propagates cursor persistence errors as observable exceptions", async () => {
    class DummyAdapter implements RemoteSyncPort {
      public async pushEnvelopes(): Promise<SyncPushResult> {
        return { success: true, committedCount: 0, serverCursor: 0 };
      }
      public async pullChanges(): Promise<SyncPullResult> {
        const item = {
          sequence: 1,
          serverCursor: 1,
          entityId: "item-1",
          entityType: "TEST",
          lamportTimestamp: 1,
          deviceId: "srv",
          operationId: "op-1",
          payload: { foo: "bar" },
          isDeleted: false,
        } as unknown as SyncEnvelope<unknown>;
        return {
          changes: [item],
          envelopes: [item],
          materialized: [],
          nextCursor: 1,
          hasMore: false,
          latestServerCursor: 1,
        };
      }
      public async pullEnvelopes(): Promise<readonly SyncEnvelope<unknown>[]> {
        return [];
      }
      public subscribeToRemote(): () => void {
        return () => {};
      }
    }

    const clock = new LamportClock();
    const adapter = new DummyAdapter();
    const devId = `storage_fail_${Date.now()}`;
    const coordinator = new SyncCoordinator(devId, clock, adapter);

    const originalSetItem = window.localStorage.setItem;
    window.localStorage.setItem = (key: string, value: string) => {
      if (key.includes("sync_cursor")) {
        throw new Error("QuotaExceededError: LocalStorage quota exceeded");
      }
      originalSetItem.call(window.localStorage, key, value);
    };

    try {
      const stats = await coordinator.syncNow();
      expect(stats.state).toBe("ERROR");
      expect(stats.lastError).toContain("Storage write failed: unable to persist sync cursor");
    } finally {
      window.localStorage.setItem = originalSetItem;
      coordinator.destroy();
    }
  });

  it("proves mathematical convergence across arbitrary operation permutations", async () => {
    const baseHabit: Habit = {
      id: "habit-alpha",
      title: "Running v1",
      category: "Fitness",
      targetType: "DURATION",
      targetValue: 30,
      schedule: {
        recurrenceType: "DAILY",
        daysOfWeekMask: 127,
        frequencyPerWeek: 7,
        intervalDays: 1,
        startDateKey: "2026-01-01",
        timeOfDay: "ANYTIME",
        preferredTimeMinutes: 0,
      },
      status: "ACTIVE",
      createdAt: 1000,
      updatedAt: 1000,
    };

    const op1: SyncEnvelope<Habit> = {
      entityId: "habit-alpha",
      entityType: "HABIT",
      lamportTimestamp: 10,
      deviceId: "phone",
      operationId: "op-1",
      payload: { ...baseHabit, title: "Running v1" },
      isDeleted: false,
    };

    const op2: SyncEnvelope<Habit> = {
      entityId: "habit-alpha",
      entityType: "HABIT",
      lamportTimestamp: 20,
      deviceId: "laptop",
      operationId: "op-2",
      payload: { ...baseHabit, title: "Running v2" },
      isDeleted: false,
    };

    const op3: SyncEnvelope<Habit> = {
      entityId: "habit-alpha",
      entityType: "HABIT",
      lamportTimestamp: 30,
      deviceId: "tablet",
      operationId: "op-3",
      payload: { ...baseHabit, title: "Running v2" },
      isDeleted: true,
      tombstone: true,
    };

    const op4: SyncEnvelope<Habit> = {
      entityId: "habit-alpha",
      entityType: "HABIT",
      lamportTimestamp: 40,
      deviceId: "phone",
      operationId: "op-4",
      payload: { ...baseHabit, title: "Running v3 Reborn" },
      isDeleted: false,
    };

    const baseBeta: Habit = {
      id: "habit-beta",
      title: "Meditate Base",
      category: "Mind",
      targetType: "BOOLEAN",
      targetValue: 1,
      schedule: {
        recurrenceType: "DAILY",
        daysOfWeekMask: 127,
        frequencyPerWeek: 7,
        intervalDays: 1,
        startDateKey: "2026-01-01",
        timeOfDay: "ANYTIME",
        preferredTimeMinutes: 0,
      },
      status: "ACTIVE",
      createdAt: 1000,
      updatedAt: 1000,
    };

    const op5: SyncEnvelope<Habit> = {
      entityId: "habit-beta",
      entityType: "HABIT",
      lamportTimestamp: 25,
      deviceId: "phone",
      operationId: "op-5",
      payload: { ...baseBeta, title: "Meditate Phone" },
      isDeleted: false,
    };

    const op6: SyncEnvelope<Habit> = {
      entityId: "habit-beta",
      entityType: "HABIT",
      lamportTimestamp: 25,
      deviceId: "laptop",
      operationId: "op-6",
      payload: { ...baseBeta, title: "Meditate Laptop" },
      isDeleted: false,
    };

    const op2Duplicate: SyncEnvelope<Habit> = { ...op2 };

    const permutations: SyncEnvelope<Habit>[][] = [
      [op1, op2, op3, op4, op5, op6, op2Duplicate],
      [op2Duplicate, op6, op5, op4, op3, op2, op1],
      [op3, op1, op4, op2, op6, op5, op2Duplicate],
      [op4, op3, op2, op1, op5, op6],
      [op5, op2, op6, op3, op1, op4],
      [op6, op4, op2Duplicate, op5, op3, op2, op1],
    ];

    let i = 0;
    for (const perm of permutations) {
      i += 1;
      const partitionKey = `perm_node_${i}_${Date.now()}`;
      const tombstoneStore = new LocalTombstoneStore(partitionKey);
      const storage = new BrowserLocalStoragePort<Habit>("habits", partitionKey);
      const clock = new LamportClock();
      const adapter = new MockDirectServerSyncAdapter("dummy");
      const coordinator = new SyncCoordinator(`dev_perm_${i}`, clock, adapter);

      bindStorageToSync({
        entityType: "HABIT",
        storage,
        coordinator,
        tombstoneStore,
      });

      for (const env of perm) {
        await coordinator.applyIncomingEnvelope(env as SyncEnvelope<unknown>);
      }

      const alpha = await storage.getById("habit-alpha");
      const beta = await storage.getById("habit-beta");
      const all = await storage.query();

      expect(alpha).not.toBeNull();
      expect(alpha?.title).toBe("Running v3 Reborn");
      expect((alpha as unknown as { lamportTimestamp: number }).lamportTimestamp).toBe(40);

      expect(beta).not.toBeNull();
      expect(beta?.title).toBe("Meditate Phone");
      expect((beta as unknown as { lamportTimestamp: number }).lamportTimestamp).toBe(25);

      expect(all.length).toBe(2);

      coordinator.destroy();
    }
  });

  it("enforces server durability failure response when state cannot be persisted to disk", async () => {
    const email = `disk_fail_${Date.now()}@example.com`;
    const regRes = await handleRegister({ email, password: "password123!" });
    const userId = regRes.body.user!.id;

    const originalFile = getStorageFile();
    setStorageFileForTesting(os.tmpdir());

    try {
      const envelope: SyncEnvelope<{ title: string }> = {
        operationId: `op_disk_fail_${Date.now()}`,
        entityId: "h-disk-fail",
        entityType: "HABIT",
        lamportTimestamp: 10,
        deviceId: "dev_fail",
        payload: { title: "Never Persisted" },
        isDeleted: false,
      };

      const pushRes = handleSyncPush(userId, [envelope]);
      expect(pushRes.status).toBe(500);
      expect(pushRes.body.error).toContain("Failed to persist");
    } finally {
      setStorageFileForTesting(originalFile);
    }
  });
});
