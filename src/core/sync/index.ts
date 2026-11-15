import { isIncomingWinner } from "./comparator.js";

export interface SyncEnvelope<TPayload> {
  readonly operationId?: string;
  readonly entityId: string;
  readonly entityType: string;
  readonly lamportTimestamp: number;
  readonly deviceId: string;
  readonly payload: TPayload;
  readonly isDeleted: boolean;
  readonly tombstone?: boolean;
  readonly wallClock?: number;
}

export interface ClockPort {
  getTimestamp(): number;
  increment(): number;
  observe(externalTimestamp: number): number;
}

export class LamportClock implements ClockPort {
  private counter: number;

  public constructor(initialCounter = 0) {
    this.counter = initialCounter;
  }

  public getTimestamp(): number {
    return this.counter;
  }

  public increment(): number {
    this.counter += 1;
    return this.counter;
  }

  public observe(externalTimestamp: number): number {
    this.counter = Math.max(this.counter, externalTimestamp) + 1;
    return this.counter;
  }
}

export class LastWriteWinsSynchronizer<T> {
  public resolveWinner(
    localEnvelope: SyncEnvelope<T>,
    incomingEnvelope: SyncEnvelope<T>
  ): SyncEnvelope<T> {
    return isIncomingWinner(localEnvelope, incomingEnvelope)
      ? incomingEnvelope
      : localEnvelope;
  }
}

export * from "./comparator.js";
export * from "./tombstones.js";
export * from "./remote-sync.js";
export * from "./coordinator.js";
export * from "./store-bridge.js";
