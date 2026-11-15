import type { RecordBase } from "../../../core/database/index.js";

export type InsightCategory =
  | "downscale_target"
  | "shift_time"
  | "split_habit"
  | "pause"
  | "consolidate";

export type SeverityLevel = "low" | "medium" | "high";

export type InsightActionStatus = "PENDING" | "APPLIED" | "DISMISSED";

export type PatternType =
  | "CONSECUTIVE_LAPSE"
  | "WEEKEND_DROPOFF"
  | "TARGET_OVERREACH"
  | "MIDWEEK_SLUMP"
  | "RECOVERY_CONSOLIDATION"
  | "STABLE";

export interface SuggestedAdjustment {
  readonly category: InsightCategory;
  readonly proposedNewTarget?: number;
  readonly proposedTimeMinutes?: number;
  readonly justification: string;
}

export interface HabitInsightResponse {
  readonly habitId: string;
  readonly patternDetected: string;
  readonly rootCauseHypothesis: string;
  readonly severityLevel: SeverityLevel;
  readonly suggestedAdjustment: SuggestedAdjustment;
  readonly encouragementMicroCopy: string;
}

export interface StoredInsight extends RecordBase {
  readonly habitId: string;
  readonly patternType: PatternType;
  readonly patternDetected: string;
  readonly rootCauseHypothesis: string;
  readonly severityLevel: SeverityLevel;
  readonly category: InsightCategory;
  readonly justification: string;
  readonly proposedNewTarget?: number;
  readonly proposedTimeMinutes?: number;
  readonly encouragementMicroCopy: string;
  readonly actionStatus: InsightActionStatus;
  readonly contentSignature: string;
}

export interface BehaviorObservation {
  readonly dateKey: string;
  readonly recordedValue: number;
  readonly targetValue: number;
  readonly status: string;
}

export interface InsightEvaluationContext {
  readonly habitId: string;
  readonly habitTitle: string;
  readonly category: string;
  readonly currentTarget: number;
  readonly unit?: string;
  readonly observations: readonly BehaviorObservation[];
}

export interface InsightStats {
  readonly totalGenerated: number;
  readonly totalApplied: number;
  readonly totalDismissed: number;
  readonly acceptanceRate: number;
}
