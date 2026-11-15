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
  private readonly processedOperationIds = new Set<string>();
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
            if (item && typeof item === "object" && typeof item.operationId === "string") {
              this.processedOperationIds.add(item.operationId);
            }
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown storage error";
      throw new Error(`Storage write failed: unable to persist sync cursor: ${message}`);
    }
  }

  public getSynchronizer(): LastWriteWinsSynchronizer<unknown> {
    return this.synchronizer;
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

  public hasProcessedOperation(operationId: string): boolean {
    return this.processedOperationIds.has(operationId);
  }

  public enqueueLocalChange<T>(
    entityId: string,
    entityType: string,
    payload: T,
    isDeleted = false,
    customOperationId?: string
  ): SyncEnvelope<T> {
    const lamport = this.clock.increment();
    const operationId =
      customOperationId ||
      `op_${this.deviceId}_${lamport}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const envelope: SyncEnvelope<T> = {
      operationId,
      entityId,
      entityType,
      lamportTimestamp: lamport,
      deviceId: this.deviceId,
      payload,
      isDeleted,
      tombstone: isDeleted,
      wallClock: Date.now(),
    };

    this.pendingOutbound.push(envelope as SyncEnvelope<unknown>);
    this.processedOperationIds.add(operationId);
    try {
      this.persistQueue();
    } catch (err) {
      this.pendingOutbound.pop();
      this.processedOperationIds.delete(operationId);
      const message = err instanceof Error ? err.message : "unknown storage error";
      throw new Error(`Storage write failed: unable to persist sync queue for ${entityId}: ${message}`);
    }
    return envelope;
  }

  public enqueueLocalDeletion<T>(
    entityId: string,
    entityType: string,
    lastKnownPayload: T,
    customOperationId?: string
  ): SyncEnvelope<T> {
    return this.enqueueLocalChange(entityId, entityType, lastKnownPayload, true, customOperationId);
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
          } catch (err) {
            this.pendingOutbound.unshift(...removed);
            throw err;
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
            for (const change of pullResult.changes) {
              await this.applyIncomingEnvelope(change);
              const changeCursor =
                (change as { sequence?: number; serverCursor?: number }).sequence ??
                (change as { sequence?: number; serverCursor?: number }).serverCursor;
              if (typeof changeCursor === "number") {
                this.lastSyncedCursor = changeCursor;
                this.persistCursor();
              }
            }
          }
          if (pullResult.nextCursor > this.lastSyncedCursor) {
            this.lastSyncedCursor = pullResult.nextCursor;
            this.persistCursor();
          }
          if (!pullResult.hasMore || pullResult.changes.length === 0) {
            hasMore = false;
          }
        }
      } else {
        const incoming = await this.remoteSync.pullEnvelopes(this.lastSyncedCursor);
        for (const env of incoming) {
          await this.applyIncomingEnvelope(env);
          const envCursor =
            (env as { sequence?: number; serverCursor?: number }).sequence ??
            (env as { sequence?: number; serverCursor?: number }).serverCursor ??
            env.lamportTimestamp;
          if (typeof envCursor === "number" && envCursor > this.lastSyncedCursor) {
            this.lastSyncedCursor = envCursor;
            this.persistCursor();
          }
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

  public async applyIncomingEnvelope(env: SyncEnvelope<unknown>): Promise<void> {
    if (env.operationId && this.processedOperationIds.has(env.operationId)) {
      return;
    }

    this.clock.observe(env.lamportTimestamp);
    this.lastSyncedLamport = Math.max(this.lastSyncedLamport, env.lamportTimestamp);

    const applier = this.entityAppliers.get(env.entityType);
    if (applier) {
      await applier(env);
    }

    if (env.operationId) {
      this.processedOperationIds.add(env.operationId);
    }

    if (this.eventBus) {
      this.eventBus.publish({
        id: `sync-rx-${env.entityId}-${Date.now()}`,
        type: "SYNC_APPLIED",
        timestamp: Date.now(),
        payload: {
          entityId: env.entityId,
          entityType: env.entityType,
          isDeleted: env.isDeleted,
          operationId: env.operationId,
        },
      });
    }
  }

  private async handleIncomingEnvelopes(envelopes: readonly SyncEnvelope<unknown>[]): Promise<void> {
    for (const env of envelopes) {
      await this.applyIncomingEnvelope(env);
    }
  }

  public destroy(): void {
    if (this.unsubscribeRemote) {
      this.unsubscribeRemote();
    }
  }
}
