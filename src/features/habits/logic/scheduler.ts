import type { Habit, HabitSchedule } from "../types/index.js";

export class HabitScheduler {
  public static parseDateKey(dateKey: string): Date {
    const [yearStr, monthStr, dayStr] = dateKey.split("-");
    if (!yearStr || !monthStr || !dayStr) {
      throw new Error(`Invalid date key: ${dateKey}`);
    }
    const year = Number.parseInt(yearStr, 10);
    const monthIndex = Number.parseInt(monthStr, 10) - 1;
    const day = Number.parseInt(dayStr, 10);
    return new Date(Date.UTC(year, monthIndex, day));
  }

  public static formatDateKey(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  public static calculateDaysBetween(startDateKey: string, targetDateKey: string): number {
    const start = this.parseDateKey(startDateKey);
    const target = this.parseDateKey(targetDateKey);
    const diffMillis = target.getTime() - start.getTime();
    return Math.floor(diffMillis / (1000 * 60 * 60 * 24));
  }

  public static isHabitDue(habit: Habit, dateKey: string): boolean {
    if (habit.status !== "ACTIVE") {
      return false;
    }

    const { schedule } = habit;
    if (dateKey < schedule.startDateKey) {
      return false;
    }

    if (schedule.endDateKey && dateKey > schedule.endDateKey) {
      return false;
    }

    if (schedule.recurrenceType === "DAILY") {
      return true;
    }

    if (schedule.recurrenceType === "WEEKDAY_MASK") {
      const targetDate = this.parseDateKey(dateKey);
      const dayOfWeek = targetDate.getUTCDay();
      const bitMask = 1 << dayOfWeek;
      return (schedule.daysOfWeekMask & bitMask) !== 0;
    }

    if (schedule.recurrenceType === "INTERVAL_DAYS") {
      if (schedule.intervalDays <= 0) {
        return false;
      }
      const daysPassed = this.calculateDaysBetween(schedule.startDateKey, dateKey);
      return daysPassed >= 0 && daysPassed % schedule.intervalDays === 0;
    }

    if (schedule.recurrenceType === "X_TIMES_PER_WEEK") {
      return true;
    }

    return false;
  }

  public static createDailySchedule(
    startDateKey: string,
    preferredTimeMinutes = 540
  ): HabitSchedule {
    return {
      recurrenceType: "DAILY",
      daysOfWeekMask: 0b1111111,
      frequencyPerWeek: 7,
      intervalDays: 1,
      startDateKey,
      timeOfDay: "MORNING",
      preferredTimeMinutes,
    };
  }

  public static createWeekdaySchedule(
    startDateKey: string,
    preferredTimeMinutes = 540
  ): HabitSchedule {
    return {
      recurrenceType: "WEEKDAY_MASK",
      daysOfWeekMask: 0b0111110,
      frequencyPerWeek: 5,
      intervalDays: 1,
      startDateKey,
      timeOfDay: "MORNING",
      preferredTimeMinutes,
    };
  }

  public static createXTimesPerWeekSchedule(
    startDateKey: string,
    frequencyPerWeek: number,
    preferredTimeMinutes = 540
  ): HabitSchedule {
    return {
      recurrenceType: "X_TIMES_PER_WEEK",
      daysOfWeekMask: 0b1111111,
      frequencyPerWeek,
      intervalDays: 1,
      startDateKey,
      timeOfDay: "ANYTIME",
      preferredTimeMinutes,
    };
  }

  public static createIntervalSchedule(
    startDateKey: string,
    intervalDays: number,
    preferredTimeMinutes = 540
  ): HabitSchedule {
    return {
      recurrenceType: "INTERVAL_DAYS",
      daysOfWeekMask: 0b1111111,
      frequencyPerWeek: 7 / intervalDays,
      intervalDays,
      startDateKey,
      timeOfDay: "ANYTIME",
      preferredTimeMinutes,
    };
  }
}
