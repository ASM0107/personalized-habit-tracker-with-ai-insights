export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  readonly id: string;
  readonly type: TType;
  readonly timestamp: number;
  readonly payload: TPayload;
}

export interface HabitCreatedPayload {
  readonly habitId: string;
  readonly title: string;
  readonly targetValue: number;
}

export interface HabitCompletedPayload {
  readonly habitId: string;
  readonly dateKey: string;
  readonly recordedValue: number;
  readonly isFullCompletion: boolean;
}

export interface HabitSkippedPayload {
  readonly habitId: string;
  readonly dateKey: string;
  readonly reason: string;
}

export interface StreakShieldAppliedPayload {
  readonly habitId: string;
  readonly dateKey: string;
  readonly reason: string;
}

export interface PatternAlertPayload {
  readonly habitId: string;
  readonly patternType: string;
  readonly occurrenceCount: number;
  readonly contextDays: readonly string[];
}

export interface InsightGeneratedPayload {
  readonly habitId: string;
  readonly insightId: string;
  readonly recommendationType: string;
}

export interface SyncAppliedPayload {
  readonly entityId: string;
  readonly entityType: string;
  readonly isDeleted: boolean;
}

export type ApplicationEvents =
  | DomainEvent<"HABIT_CREATED", HabitCreatedPayload>
  | DomainEvent<"HABIT_COMPLETED", HabitCompletedPayload>
  | DomainEvent<"HABIT_SKIPPED", HabitSkippedPayload>
  | DomainEvent<"STREAK_SHIELD_APPLIED", StreakShieldAppliedPayload>
  | DomainEvent<"PATTERN_ALERT", PatternAlertPayload>
  | DomainEvent<"INSIGHT_GENERATED", InsightGeneratedPayload>
  | DomainEvent<"SYNC_APPLIED", SyncAppliedPayload>;

export type EventSubscriber<TEvent extends ApplicationEvents> = (event: TEvent) => void | Promise<void>;

export interface EventBusPort {
  publish<TEvent extends ApplicationEvents>(event: TEvent): void;
  subscribe<TType extends ApplicationEvents["type"]>(
    type: TType,
    subscriber: EventSubscriber<Extract<ApplicationEvents, { type: TType }>>
  ): () => void;
  clear(): void;
}

export class InMemoryEventBus implements EventBusPort {
  private readonly subscribers = new Map<string, Set<EventSubscriber<never>>>();

  public publish<TEvent extends ApplicationEvents>(event: TEvent): void {
    const matchedSubscribers = this.subscribers.get(event.type);
    if (!matchedSubscribers) {
      return;
    }
    for (const subscriber of matchedSubscribers) {
      try {
        const result = subscriber(event as never);
        if (result instanceof Promise) {
          result.catch(() => {});
        }
      } catch {
        continue;
      }
    }
  }

  public subscribe<TType extends ApplicationEvents["type"]>(
    type: TType,
    subscriber: EventSubscriber<Extract<ApplicationEvents, { type: TType }>>
  ): () => void {
    let existingSet = this.subscribers.get(type);
    if (!existingSet) {
      existingSet = new Set();
      this.subscribers.set(type, existingSet);
    }
    const castedSubscriber = subscriber as EventSubscriber<never>;
    existingSet.add(castedSubscriber);

    return () => {
      const activeSet = this.subscribers.get(type);
      if (activeSet) {
        activeSet.delete(castedSubscriber);
      }
    };
  }

  public clear(): void {
    this.subscribers.clear();
  }
}
