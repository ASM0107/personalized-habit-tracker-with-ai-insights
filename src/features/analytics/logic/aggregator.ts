import type {
  CorrelationStrength,
  DayOfWeekMetric,
  HabitConsistencySummary,
  HabitCorrelation,
  HeatmapCell,
  HeatmapGrid,
  HeatmapIntensity,
  SystemAnalyticsOverview,
} from "../types/index.js";

export interface LoggedDayRecord {
  readonly dateKey: string;
  readonly isCompleted: boolean;
  readonly recordedValue?: number;
  readonly targetValue?: number;
}

export interface HabitMeta {
  readonly id: string;
  readonly title: string;
}

export class ConsistencyAggregator {
  public static readonly DAY_NAMES: readonly string[] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  public static aggregateConsistency(
    habitId: string,
    records: readonly LoggedDayRecord[]
  ): HabitConsistencySummary {
    const dayTotals = new Array(7).fill(0);
    const dayCompletions = new Array(7).fill(0);

    let totalCompleted = 0;
    const sortedRecords = [...records].sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    for (const record of sortedRecords) {
      const date = this.parseDateKey(record.dateKey);
      const dayIndex = date.getUTCDay();
      dayTotals[dayIndex] = (dayTotals[dayIndex] ?? 0) + 1;

      if (record.isCompleted) {
        totalCompleted += 1;
        dayCompletions[dayIndex] = (dayCompletions[dayIndex] ?? 0) + 1;
      }
    }

    const dayOfWeekBreakdown: DayOfWeekMetric[] = dayTotals.map((total, index) => {
      const completed = dayCompletions[index] ?? 0;
      const ratio = total > 0 ? Math.round((completed / total) * 100) / 100 : 0;
      return {
        dayIndex: index,
        dayName: ConsistencyAggregator.DAY_NAMES[index] ?? "Unknown",
        totalScheduled: total,
        totalCompleted: completed,
        completionRatio: ratio,
      };
    });

    const totalDays = sortedRecords.length;
    const overallRate = totalDays > 0 ? Math.round((totalCompleted / totalDays) * 100) / 100 : 0;

    let bestDay: string = "Unknown";
    let lowestDay: string = "Unknown";
    let maxRatio = -1;
    let minRatio = 2;

    for (const metric of dayOfWeekBreakdown) {
      if (metric.totalScheduled > 0) {
        if (metric.completionRatio > maxRatio) {
          maxRatio = metric.completionRatio;
          bestDay = metric.dayName;
        }
        if (metric.completionRatio < minRatio) {
          minRatio = metric.completionRatio;
          lowestDay = metric.dayName;
        }
      }
    }

    const heatmap = this.buildHeatmapGrid(sortedRecords);

    return {
      habitId,
      totalDaysTracked: totalDays,
      totalCompletedDays: totalCompleted,
      overallCompletionRate: overallRate,
      dayOfWeekBreakdown: Object.freeze(dayOfWeekBreakdown),
      heatmap,
      bestDayOfWeek: bestDay,
      lowestDayOfWeek: lowestDay,
    };
  }

  public static computeCorrelations(
    habits: readonly HabitMeta[],
    recordsByHabitId: ReadonlyMap<string, readonly LoggedDayRecord[]>
  ): readonly HabitCorrelation[] {
    const correlations: HabitCorrelation[] = [];

    for (let i = 0; i < habits.length; i += 1) {
      for (let j = i + 1; j < habits.length; j += 1) {
        const habitA = habits[i]!;
        const habitB = habits[j]!;

        const recordsA = recordsByHabitId.get(habitA.id) ?? [];
        const recordsB = recordsByHabitId.get(habitB.id) ?? [];

        const correlation = this.calculatePairwiseCorrelation(habitA, habitB, recordsA, recordsB);
        if (correlation) {
          correlations.push(correlation);
        }
      }
    }

    return Object.freeze(correlations);
  }

  public static generateSystemOverview(
    habits: readonly HabitMeta[],
    recordsByHabitId: ReadonlyMap<string, readonly LoggedDayRecord[]>
  ): SystemAnalyticsOverview {
    const summaries: HabitConsistencySummary[] = [];
    let systemTotalTracked = 0;
    let systemTotalCompleted = 0;

    const dayTotals = new Array(7).fill(0);
    const dayCompletions = new Array(7).fill(0);

    for (const habit of habits) {
      const records = recordsByHabitId.get(habit.id) ?? [];
      const summary = this.aggregateConsistency(habit.id, records);
      summaries.push(summary);

      systemTotalTracked += summary.totalDaysTracked;
      systemTotalCompleted += summary.totalCompletedDays;

      for (const day of summary.dayOfWeekBreakdown) {
        dayTotals[day.dayIndex] = (dayTotals[day.dayIndex] ?? 0) + day.totalScheduled;
        dayCompletions[day.dayIndex] = (dayCompletions[day.dayIndex] ?? 0) + day.totalCompleted;
      }
    }

    const overallRate = systemTotalTracked > 0
      ? Math.round((systemTotalCompleted / systemTotalTracked) * 100) / 100
      : 0;

    let bestDayOverall: string = "Unknown";
    let maxOverallRatio = -1;

    for (let d = 0; d < 7; d += 1) {
      const scheduled = dayTotals[d] ?? 0;
      const completed = dayCompletions[d] ?? 0;
      const ratio = scheduled > 0 ? completed / scheduled : 0;
      if (ratio > maxOverallRatio && scheduled > 0) {
        maxOverallRatio = ratio;
        bestDayOverall = ConsistencyAggregator.DAY_NAMES[d] ?? "Unknown";
      }
    }

    const correlations = this.computeCorrelations(habits, recordsByHabitId);

    return {
      overallCompletionRate: overallRate,
      totalTrackedHabits: habits.length,
      bestDayOfWeekOverall: bestDayOverall,
      habitSummaries: Object.freeze(summaries),
      correlations,
      generatedAt: Date.now(),
    };
  }

  private static buildHeatmapGrid(sortedRecords: readonly LoggedDayRecord[]): HeatmapGrid {
    if (sortedRecords.length === 0) {
      return {
        startDateKey: "",
        endDateKey: "",
        cells: [],
      };
    }

    const startDateKey = sortedRecords[0]!.dateKey;
    const endDateKey = sortedRecords[sortedRecords.length - 1]!.dateKey;
    const cells: HeatmapCell[] = [];

    const firstDate = this.parseDateKey(startDateKey);
    const firstEpoch = firstDate.getTime();

    for (const record of sortedRecords) {
      const date = this.parseDateKey(record.dateKey);
      const dayOfWeek = date.getUTCDay();
      const daysSinceStart = Math.floor((date.getTime() - firstEpoch) / (1000 * 60 * 60 * 24));
      const weekIndex = Math.floor(daysSinceStart / 7);

      let ratio = record.isCompleted ? 1.0 : 0.0;
      if (record.recordedValue !== undefined && record.targetValue !== undefined && record.targetValue > 0) {
        ratio = Math.min(1.0, record.recordedValue / record.targetValue);
      }

      let intensity: HeatmapIntensity = 0;
      if (ratio >= 0.75) {
        intensity = 4;
      } else if (ratio >= 0.5) {
        intensity = 3;
      } else if (ratio >= 0.25) {
        intensity = 2;
      } else if (ratio > 0) {
        intensity = 1;
      }

      cells.push({
        dateKey: record.dateKey,
        dayOfWeek,
        weekIndex,
        intensityLevel: intensity,
        completionRatio: Math.round(ratio * 100) / 100,
      });
    }

    return {
      startDateKey,
      endDateKey,
      cells: Object.freeze(cells),
    };
  }

  private static calculatePairwiseCorrelation(
    habitA: HabitMeta,
    habitB: HabitMeta,
    recordsA: readonly LoggedDayRecord[],
    recordsB: readonly LoggedDayRecord[]
  ): HabitCorrelation | null {
    const mapB = new Map<string, boolean>();
    for (const r of recordsB) {
      mapB.set(r.dateKey, r.isCompleted);
    }

    let n11 = 0;
    let n10 = 0;
    let n01 = 0;
    let n00 = 0;
    let commonDays = 0;

    for (const rA of recordsA) {
      const bCompleted = mapB.get(rA.dateKey);
      if (bCompleted !== undefined) {
        commonDays += 1;
        if (rA.isCompleted && bCompleted) {
          n11 += 1;
        } else if (rA.isCompleted && !bCompleted) {
          n10 += 1;
        } else if (!rA.isCompleted && bCompleted) {
          n01 += 1;
        } else {
          n00 += 1;
        }
      }
    }

    if (commonDays < 5) {
      return null;
    }

    const numerator = n11 * n00 - n10 * n01;
    const denominator = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00));

    const coefficient = denominator === 0 ? 0 : Math.round((numerator / denominator) * 100) / 100;

    let strength: CorrelationStrength = "NEUTRAL";
    if (coefficient >= 0.5) {
      strength = "STRONG_POSITIVE";
    } else if (coefficient >= 0.2) {
      strength = "MODERATE_POSITIVE";
    } else if (coefficient <= -0.2) {
      strength = "NEGATIVE";
    }

    return {
      habitIdA: habitA.id,
      habitTitleA: habitA.title,
      habitIdB: habitB.id,
      habitTitleB: habitB.title,
      coOccurrenceCount: commonDays,
      correlationCoefficient: coefficient,
      strength,
    };
  }

  private static parseDateKey(dateKey: string): Date {
    const [yearStr, monthStr, dayStr] = dateKey.split("-");
    if (!yearStr || !monthStr || !dayStr) {
      throw new Error(`Invalid date key: ${dateKey}`);
    }
    const year = Number.parseInt(yearStr, 10);
    const monthIndex = Number.parseInt(monthStr, 10) - 1;
    const day = Number.parseInt(dayStr, 10);
    return new Date(Date.UTC(year, monthIndex, day));
  }
}
