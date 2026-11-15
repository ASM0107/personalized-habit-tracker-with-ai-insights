export interface SyncEnvelope<TPayload> {
  readonly entityId: string;
  readonly entityType: string;
  readonly lamportTimestamp: number;
  readonly deviceId: string;
  readonly payload: TPayload;
  readonly isDeleted: boolean;
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
    if (incomingEnvelope.lamportTimestamp > localEnvelope.lamportTimestamp) {
      return incomingEnvelope;
    }
    if (incomingEnvelope.lamportTimestamp < localEnvelope.lamportTimestamp) {
      return localEnvelope;
    }
    return incomingEnvelope.deviceId > localEnvelope.deviceId
      ? incomingEnvelope
      : localEnvelope;
  }
}

export * from "./remote-sync.js";
export * from "./coordinator.js";

