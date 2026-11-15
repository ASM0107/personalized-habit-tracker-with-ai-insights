import type { ClockPort, SyncEnvelope } from "./index.js";
import { LastWriteWinsSynchronizer } from "./index.js";
import type { RemoteSyncPort } from "./remote-sync.js";
import type { EventBusPort } from "../event-bus/index.js";

export type SyncState = "IDLE" | "SYNCING" | "OFFLINE" | "ERROR";

export interface SyncStats {
  readonly state: SyncState;
  readonly pendingOutboundCount: number;
  readonly lastSyncedLamport: number;
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
  private lastSyncedLamport = 0;
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

    this.unsubscribeRemote = this.remoteSync.subscribeToRemote((envelopes) => {
      this.handleIncomingEnvelopes(envelopes);
    });

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", () => {
        void this.syncNow();
      });
    }
  }

  public getStats(): SyncStats {
    return {
      state: this.state,
      pendingOutboundCount: this.pendingOutbound.length,
      lastSyncedLamport: this.lastSyncedLamport,
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
          this.pendingOutbound.splice(0, pushResult.committedCount);
          this.lastSyncedLamport = Math.max(this.lastSyncedLamport, pushResult.serverLamportTimestamp);
        } else {
          this.state = pushResult.error?.includes("offline") ? "OFFLINE" : "ERROR";
          this.lastError = pushResult.error ?? "Failed to push sync batch";
          return this.getStats();
        }
      }

      const incoming = await this.remoteSync.pullEnvelopes(this.lastSyncedLamport);
      if (incoming.length > 0) {
        this.handleIncomingEnvelopes(incoming);
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

  private handleIncomingEnvelopes(envelopes: readonly SyncEnvelope<unknown>[]): void {
    for (const env of envelopes) {
      this.clock.observe(env.lamportTimestamp);
      this.lastSyncedLamport = Math.max(this.lastSyncedLamport, env.lamportTimestamp);

      const winningEnvelope = this.synchronizer.resolveWinner(env, env);

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
