import type { SyncEnvelope } from "./index.js";

export interface SyncPushResult {
  readonly success: boolean;
  readonly committedCount: number;
  readonly serverLamportTimestamp: number;
  readonly error?: string;
}

export interface SyncPullResult {
  readonly envelopes: readonly SyncEnvelope<unknown>[];
  readonly latestServerTimestamp: number;
}

export interface RemoteSyncConfig {
  readonly endpointUrl: string;
  readonly authToken?: string;
  readonly timeoutMs?: number;
}

export interface RemoteSyncPort {
  pushEnvelopes(envelopes: readonly SyncEnvelope<unknown>[]): Promise<SyncPushResult>;
  pullEnvelopes(sinceLamportTimestamp: number): Promise<readonly SyncEnvelope<unknown>[]>;
  subscribeToRemote(handler: (envelopes: readonly SyncEnvelope<unknown>[]) => void): () => void;
}

export class HttpRemoteSyncAdapter implements RemoteSyncPort {
  private readonly endpointUrl: string;
  private readonly authToken: string;
  private readonly timeoutMs: number;
  private readonly subscribers = new Set<(envelopes: readonly SyncEnvelope<unknown>[]) => void>();

  public constructor(config: RemoteSyncConfig) {
    this.endpointUrl = config.endpointUrl.replace(/\/+$/, "");
    this.authToken = config.authToken ?? "";
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  private isOffline(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" && !navigator.onLine;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.authToken.length > 0) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  public async pushEnvelopes(envelopes: readonly SyncEnvelope<unknown>[]): Promise<SyncPushResult> {
    if (envelopes.length === 0) {
      return {
        success: true,
        committedCount: 0,
        serverLamportTimestamp: 0,
      };
    }

    if (this.isOffline()) {
      return {
        success: false,
        committedCount: 0,
        serverLamportTimestamp: 0,
        error: "Network unavailable: client is offline",
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.endpointUrl}/push`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ envelopes }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          success: false,
          committedCount: 0,
          serverLamportTimestamp: 0,
          error: `Remote sync push failed with HTTP status ${response.status}`,
        };
      }

      const body = (await response.json()) as {
        committedCount?: number;
        serverLamportTimestamp?: number;
      };

      return {
        success: true,
        committedCount: body.committedCount ?? envelopes.length,
        serverLamportTimestamp: body.serverLamportTimestamp ?? 0,
      };
    } catch (err) {
      return {
        success: false,
        committedCount: 0,
        serverLamportTimestamp: 0,
        error: err instanceof Error ? err.message : "Unknown network error during push",
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public async pullEnvelopes(sinceLamportTimestamp: number): Promise<readonly SyncEnvelope<unknown>[]> {
    if (this.isOffline()) {
      return [];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.endpointUrl}/pull?since=${sinceLamportTimestamp}`, {
        method: "GET",
        headers: this.getHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Remote sync pull failed with HTTP status ${response.status}`);
      }

      const body = (await response.json()) as {
        envelopes?: readonly SyncEnvelope<unknown>[];
      };

      const received = body.envelopes ?? [];
      if (received.length > 0) {
        for (const subscriber of this.subscribers) {
          subscriber(received);
        }
      }

      return received;
    } catch {
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public subscribeToRemote(handler: (envelopes: readonly SyncEnvelope<unknown>[]) => void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }
}

export class BroadcastChannelSyncAdapter implements RemoteSyncPort {
  private readonly channelName: string;
  private readonly channel: BroadcastChannel | null = null;
  private readonly subscribers = new Set<(envelopes: readonly SyncEnvelope<unknown>[]) => void>();
  private readonly memoryStorage = new Map<string, SyncEnvelope<unknown>>();
  private maxObservedTimestamp = 0;

  public constructor(channelName = "habit_tracker_peer_sync") {
    this.channelName = channelName;
    if (typeof window !== "undefined" && typeof window.BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.onmessage = (event: MessageEvent<readonly SyncEnvelope<unknown>[]>) => {
        const envelopes = event.data;
        if (Array.isArray(envelopes) && envelopes.length > 0) {
          for (const env of envelopes) {
            this.memoryStorage.set(env.entityId, env);
            this.maxObservedTimestamp = Math.max(this.maxObservedTimestamp, env.lamportTimestamp);
          }
          for (const sub of this.subscribers) {
            sub(envelopes);
          }
        }
      };
    }
  }

  public async pushEnvelopes(envelopes: readonly SyncEnvelope<unknown>[]): Promise<SyncPushResult> {
    for (const env of envelopes) {
      this.memoryStorage.set(env.entityId, env);
      this.maxObservedTimestamp = Math.max(this.maxObservedTimestamp, env.lamportTimestamp);
    }

    if (this.channel && envelopes.length > 0) {
      try {
        this.channel.postMessage(envelopes);
      } catch {
        return {
          success: false,
          committedCount: 0,
          serverLamportTimestamp: this.maxObservedTimestamp,
          error: "Failed to broadcast to peer tabs",
        };
      }
    }

    return {
      success: true,
      committedCount: envelopes.length,
      serverLamportTimestamp: this.maxObservedTimestamp,
    };
  }

  public async pullEnvelopes(sinceLamportTimestamp: number): Promise<readonly SyncEnvelope<unknown>[]> {
    const results: SyncEnvelope<unknown>[] = [];
    for (const env of this.memoryStorage.values()) {
      if (env.lamportTimestamp > sinceLamportTimestamp) {
        results.push(env);
      }
    }
    return Object.freeze(results);
  }

  public subscribeToRemote(handler: (envelopes: readonly SyncEnvelope<unknown>[]) => void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  public close(): void {
    if (this.channel) {
      this.channel.close();
    }
    this.subscribers.clear();
  }
}
