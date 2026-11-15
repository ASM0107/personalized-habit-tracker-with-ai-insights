import type { HabitSchedule, HabitTargetType } from "../types/index.js";

export class HabitValidator {
  public static validateTitle(title: string): void {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      throw new Error("Habit title cannot be empty");
    }
    if (trimmed.length > 100) {
      throw new Error("Habit title exceeds maximum length of 100 characters");
    }
  }

  public static validateTarget(targetType: HabitTargetType, targetValue: number): void {
    if (targetValue <= 0) {
      throw new Error("Target value must be strictly positive");
    }
    if (targetType === "BOOLEAN" && targetValue !== 1) {
      throw new Error("Boolean habit targets must strictly equal 1");
    }
  }

  public static validateDateKey(dateKey: string): void {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateKey)) {
      throw new Error(`Invalid dateKey format '${dateKey}', expected YYYY-MM-DD`);
    }
  }

  public static validateSchedule(schedule: HabitSchedule): void {
    this.validateDateKey(schedule.startDateKey);
    if (schedule.endDateKey) {
      this.validateDateKey(schedule.endDateKey);
      if (schedule.endDateKey < schedule.startDateKey) {
        throw new Error("endDateKey cannot precede startDateKey");
      }
    }
    if (schedule.recurrenceType === "INTERVAL_DAYS" && schedule.intervalDays <= 0) {
      throw new Error("intervalDays must be greater than zero");
    }
    if (
      schedule.recurrenceType === "X_TIMES_PER_WEEK" &&
      (schedule.frequencyPerWeek <= 0 || schedule.frequencyPerWeek > 7)
    ) {
      throw new Error("frequencyPerWeek must be between 1 and 7");
    }
  }
}
