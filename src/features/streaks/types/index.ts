import type { RecordBase } from "../../../core/database/index.js";

export type MomentumTrend = "RISING" | "STABLE" | "FALLING";

export type HabitHealthTier = "EXEMPLARY" | "CONSISTENT" | "AT_RISK" | "CRITICAL";

export interface StreakShield extends RecordBase {
  readonly habitId: string;
  readonly dateKey: string;
  readonly reason: string;
  readonly isConsumed: boolean;
  readonly allocatedAt: number;
  readonly consumedAt?: number;
}

export interface ResilienceMetrics {
  readonly habitId: string;
  readonly currentScore: number;
  readonly previousScore: number;
  readonly velocity: number;
  readonly trend: MomentumTrend;
  readonly healthTier: HabitHealthTier;
  readonly activeShieldsCount: number;
  readonly totalShieldsEarned: number;
  readonly totalShieldsConsumed: number;
  readonly traditionalCurrentStreak: number;
  readonly traditionalBestStreak: number;
  readonly estimatedDaysToRecover: number;
  readonly calculatedAt: number;
}
