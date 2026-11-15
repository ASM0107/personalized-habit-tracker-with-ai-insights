import type { Habit, HabitEntry } from "../types/index.js";

export interface HabitCardViewModel {
  readonly habitId: string;
  readonly title: string;
  readonly category: string;
  readonly cadenceLabel: string;
  readonly progressPercentage: number;
  readonly statusBadge: "COMPLETED" | "PARTIAL" | "SKIPPED" | "PENDING";
  readonly progressLabel: string;
}

export class HabitViewPresenter {
  public static presentHabitCard(
    habit: Habit,
    entry: HabitEntry | null
  ): HabitCardViewModel {
    const recorded = entry?.recordedValue ?? 0;
    const target = habit.targetValue;
    const progressPercentage = Math.min(100, Math.round((recorded / target) * 100));

    let statusBadge: HabitCardViewModel["statusBadge"] = "PENDING";
    if (entry) {
      if (entry.status === "COMPLETED") {
        statusBadge = "COMPLETED";
      } else if (entry.status === "PARTIAL") {
        statusBadge = "PARTIAL";
      } else if (entry.status === "SKIPPED") {
        statusBadge = "SKIPPED";
      }
    }

    const unitSuffix = habit.unit ? ` ${habit.unit}` : "";
    const progressLabel = `${recorded} / ${target}${unitSuffix}`;

    let cadenceLabel = "Daily";
    if (habit.schedule.recurrenceType === "WEEKDAY_MASK") {
      cadenceLabel = habit.schedule.daysOfWeekMask === 0b0111110 ? "Weekdays" : "Custom Days";
    } else if (habit.schedule.recurrenceType === "X_TIMES_PER_WEEK") {
      cadenceLabel = `${habit.schedule.frequencyPerWeek}x per week`;
    } else if (habit.schedule.recurrenceType === "INTERVAL_DAYS") {
      cadenceLabel = `Every ${habit.schedule.intervalDays} days`;
    }

    return {
      habitId: habit.id,
      title: habit.title,
      category: habit.category,
      cadenceLabel,
      progressPercentage,
      statusBadge,
      progressLabel,
    };
  }
}
