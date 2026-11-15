import type { ClockPort, SyncEnvelope } from "./index.js";
import { LastWriteWinsSynchronizer } from "./index.js";
import type { RemoteSyncPort } from "./remote-sync.js";
import type { EventBusPort } from "../event-bus/index.js";

export type SyncState = "IDLE" | "SYNCING" | "OFFLINE" | "ERROR";

export type InboundEntityApplier = (envelope: SyncEnvelope<unknown>) => Promise<void> | void;

export interface SyncStats {
  readonly state: SyncState;
  readonly pendingOutboundCount: number;
  readonly lastSyncedLamport: number;
  readonly lastSyncedCursor: number;
  readonly lastSyncTimestamp: number;
  readonly lastError?: string;
}

export class SyncCoordinator {
  private readonly deviceId: string;
  private readonly clock: ClockPort;
  private readonly remoteSync: RemoteSyncPort;
  private readonly synchronizer: LastWriteWinsSynchronizer<unknown>;
  private readonly eventBus: EventBusPort | null;
  private readonly pendingOutbound: SyncEnvelope<unknown>[] = [];
  private readonly entityAppliers = new Map<string, InboundEntityApplier>();
  private readonly queueStorageKey: string;
  private readonly cursorStorageKey: string;
  private lastSyncedLamport = 0;
  private lastSyncedCursor = 0;
  private lastSyncTimestamp = 0;
  private state: SyncState = "IDLE";
  private lastError: string | null = null;
  private unsubscribeRemote?: () => void;

  public constructor(
    deviceId: string,
    clock: ClockPort,
    remoteSync: RemoteSyncPort,
    eventBus?: EventBusPort
  ) {
    this.deviceId = deviceId;
    this.clock = clock;
    this.remoteSync = remoteSync;
    this.synchronizer = new LastWriteWinsSynchronizer<unknown>();
    this.eventBus = eventBus ?? null;
    this.queueStorageKey = `habit_tracker_sync_pending_${deviceId}`;
    this.cursorStorageKey = `habit_tracker_sync_cursor_${deviceId}`;

    this.hydrateQueue();
    this.hydrateCursor();

    this.unsubscribeRemote = this.remoteSync.subscribeToRemote((envelopes) => {
      void this.handleIncomingEnvelopes(envelopes);
    });

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", () => {
        void this.syncNow();
      });
    }
  }

  private hydrateQueue(): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(this.queueStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            this.pendingOutbound.push(item);
          }
        }
      }
    } catch {
      this.pendingOutbound.length = 0;
    }
  }

  private persistQueue(): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    if (this.pendingOutbound.length === 0) {
      window.localStorage.removeItem(this.queueStorageKey);
    } else {
      window.localStorage.setItem(this.queueStorageKey, JSON.stringify(this.pendingOutbound));
    }
  }

  private hydrateCursor(): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(this.cursorStorageKey);
      if (raw) {
        const num = Number.parseInt(raw, 10);
        if (!Number.isNaN(num)) {
          this.lastSyncedCursor = num;
        }
      }
    } catch {
      this.lastSyncedCursor = 0;
    }
  }

  private persistCursor(): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(this.cursorStorageKey, String(this.lastSyncedCursor));
    } catch {
      return;
    }
  }

  public registerApplier(entityType: string, applier: InboundEntityApplier): void {
    this.entityAppliers.set(entityType, applier);
  }

  public getStats(): SyncStats {
    return {
      state: this.state,
      pendingOutboundCount: this.pendingOutbound.length,
      lastSyncedLamport: this.lastSyncedLamport,
      lastSyncedCursor: this.lastSyncedCursor,
      lastSyncTimestamp: this.lastSyncTimestamp,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  public enqueueLocalChange<T>(
    entityId: string,
    entityType: string,
    payload: T,
    isDeleted = false
  ): SyncEnvelope<T> {
    const lamport = this.clock.increment();
    const envelope: SyncEnvelope<T> = {
      entityId,
      entityType,
      lamportTimestamp: lamport,
      deviceId: this.deviceId,
      payload,
      isDeleted,
    };

    this.pendingOutbound.push(envelope as SyncEnvelope<unknown>);
    try {
      this.persistQueue();
    } catch (err) {
      this.pendingOutbound.pop();
      const message = err instanceof Error ? err.message : "unknown storage error";
      throw new Error(`Storage write failed: unable to persist sync queue for ${entityId}: ${message}`);
    }
    return envelope;
  }

  public async syncNow(): Promise<SyncStats> {
    this.state = "SYNCING";
    this.lastError = null;

    try {
      if (this.pendingOutbound.length > 0) {
        const batch = [...this.pendingOutbound];
        const pushResult = await this.remoteSync.pushEnvelopes(batch);

        if (pushResult.success) {
          const removed = this.pendingOutbound.splice(0, pushResult.committedCount);
          try {
            this.persistQueue();
          } catch {
            this.pendingOutbound.unshift(...removed);
          }
          this.lastSyncedLamport = Math.max(
            this.lastSyncedLamport,
            pushResult.serverLamportTimestamp || pushResult.serverCursor || 0
          );
        } else {
          this.state = pushResult.error?.includes("offline") ? "OFFLINE" : "ERROR";
          this.lastError = pushResult.error ?? "Failed to push sync batch";
          return this.getStats();
        }
      }

      if (this.remoteSync.pullChanges) {
        let hasMore = true;
        while (hasMore) {
          const pullResult = await this.remoteSync.pullChanges(this.lastSyncedCursor, 100);
          if (pullResult.changes.length > 0) {
            await this.handleIncomingEnvelopes(pullResult.changes);
            this.lastSyncedCursor = pullResult.nextCursor;
            this.persistCursor();
          }
          hasMore = pullResult.hasMore;
        }
      } else {
        const incoming = await this.remoteSync.pullEnvelopes(this.lastSyncedCursor);
        if (incoming.length > 0) {
          await this.handleIncomingEnvelopes(incoming);
          this.lastSyncedCursor = Math.max(...incoming.map((e) => e.lamportTimestamp), this.lastSyncedCursor);
          this.persistCursor();
        }
      }

      this.state = "IDLE";
      this.lastSyncTimestamp = Date.now();
      return this.getStats();
    } catch (err) {
      this.state = "ERROR";
      this.lastError = err instanceof Error ? err.message : "Sync failed unexpectedly";
      return this.getStats();
    }
  }

  private async handleIncomingEnvelopes(envelopes: readonly SyncEnvelope<unknown>[]): Promise<void> {
    for (const env of envelopes) {
      this.clock.observe(env.lamportTimestamp);
      this.lastSyncedLamport = Math.max(this.lastSyncedLamport, env.lamportTimestamp);

      const winningEnvelope = this.synchronizer.resolveWinner(env, env);

      const applier = this.entityAppliers.get(winningEnvelope.entityType);
      if (applier) {
        try {
          await applier(winningEnvelope);
        } catch {
          continue;
        }
      }

      if (this.eventBus) {
        this.eventBus.publish({
          id: `sync-rx-${winningEnvelope.entityId}-${Date.now()}`,
          type: "SYNC_APPLIED",
          timestamp: Date.now(),
          payload: {
            entityId: winningEnvelope.entityId,
            entityType: winningEnvelope.entityType,
            isDeleted: winningEnvelope.isDeleted,
          },
        });
      }
    }
  }

  public destroy(): void {
    if (this.unsubscribeRemote) {
      this.unsubscribeRemote();
    }
  }
}
