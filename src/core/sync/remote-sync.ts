import type { SyncEnvelope } from "./index.js";

export interface SyncPushResult {
  readonly success: boolean;
  readonly committedCount: number;
  readonly serverCursor: number;
  readonly serverLamportTimestamp?: number;
  readonly error?: string;
}

export interface SyncPullResult {
  readonly changes: readonly SyncEnvelope<unknown>[];
  readonly envelopes: readonly SyncEnvelope<unknown>[];
  readonly nextCursor: number;
  readonly hasMore: boolean;
  readonly latestServerCursor: number;
}

export interface RemoteSyncConfig {
  readonly endpointUrl: string;
  readonly authToken?: string;
  readonly timeoutMs?: number;
}

export interface RemoteSyncPort {
  pushEnvelopes(envelopes: readonly SyncEnvelope<unknown>[]): Promise<SyncPushResult>;
  pullChanges?(sinceCursor: number, limit?: number): Promise<SyncPullResult>;
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
        serverCursor: 0,
        serverLamportTimestamp: 0,
      };
    }

    if (this.isOffline()) {
      return {
        success: false,
        committedCount: 0,
        serverCursor: 0,
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
          serverCursor: 0,
          serverLamportTimestamp: 0,
          error: `Remote sync push failed with HTTP status ${response.status}`,
        };
      }

      const body = (await response.json()) as {
        committedCount?: number;
        serverCursor?: number;
        serverLamportTimestamp?: number;
      };

      const serverCursor = body.serverCursor ?? body.serverLamportTimestamp ?? 0;
      return {
        success: true,
        committedCount: body.committedCount ?? envelopes.length,
        serverCursor,
        serverLamportTimestamp: serverCursor,
      };
    } catch (err) {
      return {
        success: false,
        committedCount: 0,
        serverCursor: 0,
        serverLamportTimestamp: 0,
        error: err instanceof Error ? err.message : "Unknown network error during push",
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public async pullChanges(sinceCursor: number, limit = 100): Promise<SyncPullResult> {
    if (this.isOffline()) {
      return {
        changes: [],
        envelopes: [],
        nextCursor: sinceCursor,
        hasMore: false,
        latestServerCursor: sinceCursor,
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.endpointUrl}/pull?since=${sinceCursor}&limit=${limit}`, {
        method: "GET",
        headers: this.getHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Remote sync pull failed with HTTP status ${response.status}`);
      }

      const body = (await response.json()) as {
        changes?: readonly SyncEnvelope<unknown>[];
        envelopes?: readonly SyncEnvelope<unknown>[];
        nextCursor?: number;
        hasMore?: boolean;
        latestServerCursor?: number;
        latestServerTimestamp?: number;
      };

      const changes = body.changes || body.envelopes || [];
      const nextCursor = typeof body.nextCursor === "number" ? body.nextCursor : sinceCursor;
      const hasMore = Boolean(body.hasMore);
      const latestServerCursor =
        typeof body.latestServerCursor === "number"
          ? body.latestServerCursor
          : typeof body.latestServerTimestamp === "number"
          ? body.latestServerTimestamp
          : nextCursor;

      if (changes.length > 0) {
        for (const subscriber of this.subscribers) {
          subscriber(changes);
        }
      }

      return {
        changes,
        envelopes: changes,
        nextCursor,
        hasMore,
        latestServerCursor,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public async pullEnvelopes(sinceLamportTimestamp: number): Promise<readonly SyncEnvelope<unknown>[]> {
    const res = await this.pullChanges(sinceLamportTimestamp, 100);
    return res.changes;
  }

  public subscribeToRemote(handler: (envelopes: readonly SyncEnvelope<unknown>[]) => void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  public close(): void {
    this.subscribers.clear();
  }
}

export class BroadcastChannelSyncAdapter implements RemoteSyncPort {
  private readonly channel: BroadcastChannel | null = null;
  private readonly subscribers = new Set<(envelopes: readonly SyncEnvelope<unknown>[]) => void>();
  private readonly messageHistory: SyncEnvelope<unknown>[] = [];

  public constructor(channelName = "habit_tracker_peer_sync") {
    if (typeof window !== "undefined" && typeof window.BroadcastChannel === "function") {
      this.channel = new BroadcastChannel(channelName);
      this.channel.onmessage = (event: MessageEvent<readonly SyncEnvelope<unknown>[]>) => {
        if (Array.isArray(event.data)) {
          this.messageHistory.push(...event.data);
          for (const subscriber of this.subscribers) {
            subscriber(event.data);
          }
        }
      };
    }
  }

  public async pushEnvelopes(envelopes: readonly SyncEnvelope<unknown>[]): Promise<SyncPushResult> {
    if (envelopes.length === 0) {
      return {
        success: true,
        committedCount: 0,
        serverCursor: 0,
        serverLamportTimestamp: 0,
      };
    }

    this.messageHistory.push(...envelopes);

    if (this.channel) {
      try {
        this.channel.postMessage(envelopes);
      } catch {
        return {
          success: false,
          committedCount: 0,
          serverCursor: 0,
          serverLamportTimestamp: 0,
          error: "BroadcastChannel transport failed",
        };
      }
    }

    const maxTimestamp = envelopes.reduce((max, e) => Math.max(max, e.lamportTimestamp), 0);
    return {
      success: true,
      committedCount: envelopes.length,
      serverCursor: maxTimestamp,
      serverLamportTimestamp: maxTimestamp,
    };
  }

  public async pullChanges(sinceCursor: number, _limit = 100): Promise<SyncPullResult> {
    const changes = await this.pullEnvelopes(sinceCursor);
    return {
      changes,
      envelopes: changes,
      nextCursor: sinceCursor + changes.length,
      hasMore: false,
      latestServerCursor: sinceCursor + changes.length,
    };
  }

  public async pullEnvelopes(sinceLamportTimestamp: number): Promise<readonly SyncEnvelope<unknown>[]> {
    const filtered = this.messageHistory.filter((e) => e.lamportTimestamp > sinceLamportTimestamp);
    return filtered;
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
