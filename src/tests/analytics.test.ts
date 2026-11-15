import { describe, it, expect } from "vitest";
import {
  ConsistencyAggregator,
  AnalyticsViewPresenter,
  type LoggedDayRecord,
  type HabitMeta,
} from "../features/analytics/index.js";

describe("Analytics Engine Phase 5", () => {
  it("aggregates day of week metrics, peak days, and heatmap grids", () => {
    const records: LoggedDayRecord[] = [
      { dateKey: "2026-11-09", isCompleted: true, recordedValue: 30, targetValue: 30 },
      { dateKey: "2026-11-10", isCompleted: true, recordedValue: 30, targetValue: 30 },
      { dateKey: "2026-11-11", isCompleted: false, recordedValue: 0, targetValue: 30 },
      { dateKey: "2026-11-12", isCompleted: true, recordedValue: 30, targetValue: 30 },
      { dateKey: "2026-11-13", isCompleted: false, recordedValue: 0, targetValue: 30 },
      { dateKey: "2026-11-14", isCompleted: false, recordedValue: 0, targetValue: 30 },
      { dateKey: "2026-11-15", isCompleted: true, recordedValue: 30, targetValue: 30 },
    ];

    const summary = ConsistencyAggregator.aggregateConsistency("h-yoga", records);

    expect(summary.totalDaysTracked).toBe(7);
    expect(summary.totalCompletedDays).toBe(4);
    expect(summary.overallCompletionRate).toBe(0.57);
    expect(summary.dayOfWeekBreakdown.length).toBe(7);
    expect(summary.bestDayOfWeek).toBeDefined();
    expect(summary.lowestDayOfWeek).toBeDefined();

    expect(summary.heatmap.cells.length).toBe(7);
    expect(summary.heatmap.startDateKey).toBe("2026-11-09");
    expect(summary.heatmap.endDateKey).toBe("2026-11-15");
    expect(summary.heatmap.cells[0]?.intensityLevel).toBe(4);
    expect(summary.heatmap.cells[2]?.intensityLevel).toBe(0);
  });

  it("computes co-occurrence correlations between complementary habits", () => {
    const habits: HabitMeta[] = [
      { id: "h-meditation", title: "Morning Meditation" },
      { id: "h-journaling", title: "Evening Journaling" },
    ];

    const recordsMeditation: LoggedDayRecord[] = [
      { dateKey: "2026-11-01", isCompleted: true },
      { dateKey: "2026-11-02", isCompleted: true },
      { dateKey: "2026-11-03", isCompleted: true },
      { dateKey: "2026-11-04", isCompleted: false },
      { dateKey: "2026-11-05", isCompleted: true },
      { dateKey: "2026-11-06", isCompleted: false },
    ];

    const recordsJournaling: LoggedDayRecord[] = [
      { dateKey: "2026-11-01", isCompleted: true },
      { dateKey: "2026-11-02", isCompleted: true },
      { dateKey: "2026-11-03", isCompleted: true },
      { dateKey: "2026-11-04", isCompleted: false },
      { dateKey: "2026-11-05", isCompleted: true },
      { dateKey: "2026-11-06", isCompleted: false },
    ];

    const map = new Map<string, readonly LoggedDayRecord[]>();
    map.set("h-meditation", recordsMeditation);
    map.set("h-journaling", recordsJournaling);

    const correlations = ConsistencyAggregator.computeCorrelations(habits, map);
    expect(correlations.length).toBe(1);
    expect(correlations[0]?.strength).toBe("STRONG_POSITIVE");
    expect(correlations[0]?.correlationCoefficient).toBe(1.0);
  });

  it("generates system overview metrics and executive view models", () => {
    const habits: HabitMeta[] = [
      { id: "h-code", title: "Coding" },
      { id: "h-read", title: "Reading" },
    ];

    const records: LoggedDayRecord[] = [
      { dateKey: "2026-11-01", isCompleted: true },
      { dateKey: "2026-11-02", isCompleted: true },
      { dateKey: "2026-11-03", isCompleted: false },
      { dateKey: "2026-11-04", isCompleted: true },
      { dateKey: "2026-11-05", isCompleted: true },
      { dateKey: "2026-11-06", isCompleted: true },
    ];

    const map = new Map<string, readonly LoggedDayRecord[]>();
    map.set("h-code", records);
    map.set("h-read", records);

    const overview = ConsistencyAggregator.generateSystemOverview(habits, map);
    expect(overview.totalTrackedHabits).toBe(2);
    expect(overview.overallCompletionRate).toBeGreaterThan(0.8);

    const dashboard = AnalyticsViewPresenter.presentExecutiveDashboard(overview);
    expect(dashboard.totalHabitsText).toBe("2 Tracked Habits");
    expect(dashboard.systemCompletionRateDisplay).toBeDefined();

    const habitSummary = overview.habitSummaries[0]!;
    const card = AnalyticsViewPresenter.presentHabitAnalytics(habitSummary);
    expect(card.dayBars.length).toBe(7);
    expect(card.completionRateDisplay).toBeDefined();
  });
});
