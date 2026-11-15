import type { StoragePort } from "../../../core/database/index.js";
import type { EventBusPort } from "../../../core/event-bus/index.js";
import type { StreakShield, ResilienceMetrics } from "../types/index.js";
import { MomentumCalculator } from "../logic/momentum.js";

interface InternalStreakState {
  currentScore: number;
  previousScore: number;
  consecutiveCompletions: number;
  currentStreak: number;
  bestStreak: number;
  totalShieldsEarned: number;
}

export class StreakStore {
  public static readonly MAX_ACTIVE_SHIELDS = 3;
  public static readonly COMPLETIONS_PER_EARNED_SHIELD = 7;

  private readonly shieldStorage: StoragePort<StreakShield>;
  private readonly streakStates = new Map<string, InternalStreakState>();
  private readonly eventBus: EventBusPort;
  private shieldSequence = 0;

  public constructor(
    shieldStorage: StoragePort<StreakShield>,
    eventBus: EventBusPort
  ) {
    this.shieldStorage = shieldStorage;
    this.eventBus = eventBus;
    this.setupSubscriptions();
  }

  private setupSubscriptions(): void {
    this.eventBus.subscribe("HABIT_COMPLETED", (event) => {
      this.handleHabitCompleted(event.payload.habitId, event.payload.isFullCompletion);
    });

    this.eventBus.subscribe("HABIT_SKIPPED", (event) => {
      this.handleHabitSkipped(event.payload.habitId, event.payload.dateKey, event.payload.reason);
    });
  }

  private getOrCreateState(habitId: string): InternalStreakState {
    let state = this.streakStates.get(habitId);
    if (!state) {
      state = {
        currentScore: MomentumCalculator.INITIAL_MOMENTUM,
        previousScore: MomentumCalculator.INITIAL_MOMENTUM,
        consecutiveCompletions: 0,
        currentStreak: 0,
        bestStreak: 0,
        totalShieldsEarned: 0,
      };
      this.streakStates.set(habitId, state);
    }
    return state;
  }

  private async handleHabitCompleted(habitId: string, isFullCompletion: boolean): Promise<void> {
    const state = this.getOrCreateState(habitId);
    state.previousScore = state.currentScore;

    const factor = isFullCompletion ? 1.0 : 0.5;
    state.currentScore = MomentumCalculator.calculateNextScore(state.currentScore, factor);

    if (isFullCompletion) {
      state.consecutiveCompletions += 1;
      state.currentStreak += 1;
      if (state.currentStreak > state.bestStreak) {
        state.bestStreak = state.currentStreak;
      }

      if (state.consecutiveCompletions >= StreakStore.COMPLETIONS_PER_EARNED_SHIELD) {
        state.consecutiveCompletions = 0;
        await this.tryEarnShield(habitId);
      }
    } else {
      state.consecutiveCompletions = 0;
    }
  }

  private async tryEarnShield(habitId: string): Promise<void> {
    const activeShields = await this.shieldStorage.query(
      (s) => s.habitId === habitId && !s.isConsumed
    );

    if (activeShields.length < StreakStore.MAX_ACTIVE_SHIELDS) {
      const state = this.getOrCreateState(habitId);
      state.totalShieldsEarned += 1;
      await this.allocateShield(habitId, "Earned via 7-day consistency");
    }
  }

  private async handleHabitSkipped(habitId: string, dateKey: string, reason: string): Promise<void> {
    const state = this.getOrCreateState(habitId);
    state.previousScore = state.currentScore;
    state.consecutiveCompletions = 0;
    state.currentStreak = 0;

    const shields = await this.shieldStorage.query(
      (s) => s.habitId === habitId && !s.isConsumed
    );

    const firstShield = shields[0];

    if (firstShield) {
      const now = Date.now();
      await this.shieldStorage.update(firstShield.id, (s) => ({
        ...s,
        isConsumed: true,
        dateKey,
        consumedAt: now,
        updatedAt: now,
      }));

      this.eventBus.publish({
        id: `evt-shield-${firstShield.id}-${now}`,
        type: "STREAK_SHIELD_APPLIED",
        timestamp: now,
        payload: {
          habitId,
          dateKey,
          reason: reason || "Automated streak shield protection",
        },
      });

      state.currentScore = MomentumCalculator.calculateNextScore(state.currentScore, 0.5);
    } else {
      state.currentScore = MomentumCalculator.calculateNextScore(state.currentScore, 0.0);
    }
  }

  public async allocateShield(habitId: string, reason: string): Promise<StreakShield> {
    const now = Date.now();
    this.shieldSequence += 1;
    const shield: StreakShield = {
      id: `shield-${habitId}-${now}-${this.shieldSequence}`,
      habitId,
      dateKey: "",
      reason,
      isConsumed: false,
      allocatedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.shieldStorage.insert(shield);
    return shield;
  }

  public async getActiveShields(habitId: string): Promise<readonly StreakShield[]> {
    return this.shieldStorage.query((s) => s.habitId === habitId && !s.isConsumed);
  }

  public async getConsumedShields(habitId: string): Promise<readonly StreakShield[]> {
    return this.shieldStorage.query((s) => s.habitId === habitId && s.isConsumed);
  }

  public async getResilienceMetrics(habitId: string): Promise<ResilienceMetrics> {
    const state = this.getOrCreateState(habitId);
    const activeShields = await this.getActiveShields(habitId);
    const consumedShields = await this.getConsumedShields(habitId);

    const velocity = Math.round((state.currentScore - state.previousScore) * 10) / 10;
    const trend = MomentumCalculator.determineTrend(state.currentScore, state.previousScore);
    const healthTier = MomentumCalculator.determineHealthTier(state.currentScore);
    const estimatedDaysToRecover = MomentumCalculator.estimateDaysToRecover(state.currentScore);

    return {
      habitId,
      currentScore: state.currentScore,
      previousScore: state.previousScore,
      velocity,
      trend,
      healthTier,
      activeShieldsCount: activeShields.length,
      totalShieldsEarned: state.totalShieldsEarned,
      totalShieldsConsumed: consumedShields.length,
      traditionalCurrentStreak: state.currentStreak,
      traditionalBestStreak: state.bestStreak,
      estimatedDaysToRecover,
      calculatedAt: Date.now(),
    };
  }
}
