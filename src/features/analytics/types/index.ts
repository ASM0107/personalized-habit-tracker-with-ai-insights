export interface DayOfWeekMetric {
  readonly dayIndex: number;
  readonly dayName: string;
  readonly totalScheduled: number;
  readonly totalCompleted: number;
  readonly completionRatio: number;
}

export type HeatmapIntensity = 0 | 1 | 2 | 3 | 4;

export interface HeatmapCell {
  readonly dateKey: string;
  readonly dayOfWeek: number;
  readonly weekIndex: number;
  readonly intensityLevel: HeatmapIntensity;
  readonly completionRatio: number;
}

export interface HeatmapGrid {
  readonly startDateKey: string;
  readonly endDateKey: string;
  readonly cells: readonly HeatmapCell[];
}

export type CorrelationStrength =
  | "STRONG_POSITIVE"
  | "MODERATE_POSITIVE"
  | "NEUTRAL"
  | "NEGATIVE";

export interface HabitCorrelation {
  readonly habitIdA: string;
  readonly habitTitleA: string;
  readonly habitIdB: string;
  readonly habitTitleB: string;
  readonly coOccurrenceCount: number;
  readonly correlationCoefficient: number;
  readonly strength: CorrelationStrength;
}

export interface HabitConsistencySummary {
  readonly habitId: string;
  readonly totalDaysTracked: number;
  readonly totalCompletedDays: number;
  readonly overallCompletionRate: number;
  readonly dayOfWeekBreakdown: readonly DayOfWeekMetric[];
  readonly heatmap: HeatmapGrid;
  readonly bestDayOfWeek: string;
  readonly lowestDayOfWeek: string;
}

export interface SystemAnalyticsOverview {
  readonly overallCompletionRate: number;
  readonly totalTrackedHabits: number;
  readonly bestDayOfWeekOverall: string;
  readonly habitSummaries: readonly HabitConsistencySummary[];
  readonly correlations: readonly HabitCorrelation[];
  readonly generatedAt: number;
}
