import type { RecordBase } from "../../../core/database/index.js";

export type HabitTargetType = "BOOLEAN" | "NUMERIC" | "DURATION";

export type HabitStatus = "ACTIVE" | "ARCHIVED";

export type RecurrenceType =
  | "DAILY"
  | "WEEKDAY_MASK"
  | "X_TIMES_PER_WEEK"
  | "INTERVAL_DAYS";

export type TimeOfDay = "MORNING" | "AFTERNOON" | "EVENING" | "ANYTIME";

export interface HabitSchedule {
  readonly recurrenceType: RecurrenceType;
  readonly daysOfWeekMask: number;
  readonly frequencyPerWeek: number;
  readonly intervalDays: number;
  readonly startDateKey: string;
  readonly endDateKey?: string;
  readonly timeOfDay: TimeOfDay;
  readonly preferredTimeMinutes: number;
}

export interface Habit extends RecordBase {
  readonly title: string;
  readonly description?: string;
  readonly category: string;
  readonly targetType: HabitTargetType;
  readonly targetValue: number;
  readonly unit?: string;
  readonly schedule: HabitSchedule;
  readonly status: HabitStatus;
}

export type HabitEntryStatus =
  | "COMPLETED"
  | "PARTIAL"
  | "SKIPPED"
  | "SHIELDED"
  | "MISSED";

export interface HabitEntry extends RecordBase {
  readonly habitId: string;
  readonly dateKey: string;
  readonly recordedValue: number;
  readonly targetValueSnapshot: number;
  readonly status: HabitEntryStatus;
  readonly notes?: string;
  readonly skipReason?: string;
  readonly lamportTimestamp: number;
}

export interface HabitHistorySummary {
  readonly habit: Habit;
  readonly entries: readonly HabitEntry[];
  readonly totalDaysTracked: number;
  readonly totalCompleted: number;
  readonly totalPartial: number;
  readonly totalSkipped: number;
  readonly completionRate: number;
}
