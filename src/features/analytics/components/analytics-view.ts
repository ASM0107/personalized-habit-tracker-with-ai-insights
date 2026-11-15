import type { HabitConsistencySummary, SystemAnalyticsOverview } from "../types/index.js";

export interface DayBarViewModel {
  readonly dayName: string;
  readonly percentage: number;
  readonly barText: string;
}

export interface HabitAnalyticsCardViewModel {
  readonly habitId: string;
  readonly completionRateDisplay: string;
  readonly bestDayText: string;
  readonly lowestDayText: string;
  readonly dayBars: readonly DayBarViewModel[];
  readonly totalTrackedDaysText: string;
}

export interface ExecutiveDashboardViewModel {
  readonly systemCompletionRateDisplay: string;
  readonly totalHabitsText: string;
  readonly bestDayOverallText: string;
  readonly strongestSynergyText: string;
}

export class AnalyticsViewPresenter {
  public static presentHabitAnalytics(
    summary: HabitConsistencySummary
  ): HabitAnalyticsCardViewModel {
    const dayBars: DayBarViewModel[] = summary.dayOfWeekBreakdown.map((d) => {
      const percentage = Math.round(d.completionRatio * 100);
      const filledBlocks = Math.round(percentage / 10);
      const emptyBlocks = 10 - filledBlocks;
      const barText = `${"█".repeat(filledBlocks)}${"░".repeat(emptyBlocks)} ${percentage}%`;
      return {
        dayName: d.dayName,
        percentage,
        barText,
      };
    });

    return {
      habitId: summary.habitId,
      completionRateDisplay: `${Math.round(summary.overallCompletionRate * 100)}%`,
      bestDayText: `Peak consistency on ${summary.bestDayOfWeek}`,
      lowestDayText: `Highest friction on ${summary.lowestDayOfWeek}`,
      dayBars: Object.freeze(dayBars),
      totalTrackedDaysText: `${summary.totalCompletedDays} of ${summary.totalDaysTracked} days completed`,
    };
  }

  public static presentExecutiveDashboard(
    overview: SystemAnalyticsOverview
  ): ExecutiveDashboardViewModel {
    const systemCompletionRateDisplay = `${Math.round(overview.overallCompletionRate * 100)}%`;
    const totalHabitsText = `${overview.totalTrackedHabits} Tracked Habits`;
    const bestDayOverallText = `System-wide peak on ${overview.bestDayOfWeekOverall}`;

    let strongestSynergyText = "No significant habit co-dependencies detected";
    const strongCorrelations = overview.correlations.filter((c) => c.strength === "STRONG_POSITIVE");
    if (strongCorrelations.length > 0 && strongCorrelations[0]) {
      const top = strongCorrelations[0];
      strongestSynergyText = `Synergy: "${top.habitTitleA}" + "${top.habitTitleB}" (r = +${top.correlationCoefficient.toFixed(2)})`;
    }

    return {
      systemCompletionRateDisplay,
      totalHabitsText,
      bestDayOverallText,
      strongestSynergyText,
    };
  }
}
