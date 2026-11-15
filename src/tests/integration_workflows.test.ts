import { describe, it, expect } from "vitest";
import {
  InMemoryEventBus,
  InMemoryStoragePort,
  LamportClock,
  MockAiInferenceClient,
} from "../core/index.js";
import {
  HabitStore,
  HabitScheduler,
  type Habit,
  type HabitEntry,
} from "../features/habits/index.js";
import {
  StreakStore,
  type StreakShield,
} from "../features/streaks/index.js";
import {
  InsightStore,
  type StoredInsight,
  type HabitInsightResponse,
  type BehaviorObservation,
} from "../features/insights/index.js";
import {
  ConsistencyAggregator,
  type LoggedDayRecord,
} from "../features/analytics/index.js";

describe("Integrated Testing: End-to-End Multi-Feature Workflows", () => {
  it("orchestrates habit tracking, streak shields, AI insight, and analytics aggregation", async () => {
    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();

    const habitStorage = new InMemoryStoragePort<Habit>();
    const entryStorage = new InMemoryStoragePort<HabitEntry>();
    const shieldStorage = new InMemoryStoragePort<StreakShield>();
    const insightStorage = new InMemoryStoragePort<StoredInsight>();

    const habitStore = new HabitStore(habitStorage, entryStorage, eventBus, clock);
    const streakStore = new StreakStore(shieldStorage, eventBus);

    const mockAiResponse: HabitInsightResponse = {
      habitId: "h-running",
      patternDetected: "Three consecutive lapse days after strenuous runs",
      rootCauseHypothesis: "Target of 10km is exceeding current recovery capacity",
      severityLevel: "high",
      suggestedAdjustment: {
        category: "downscale_target",
        proposedNewTarget: 5,
        justification: "Downscale to 5km to consolidate consistency before ramping up",
      },
      encouragementMicroCopy: "Consistency over perfection. Rebuild the momentum!",
    };
    const mockAiClient = new MockAiInferenceClient(mockAiResponse);
    const insightStore = new InsightStore(insightStorage, mockAiClient, eventBus);

    const habit = await habitStore.createHabit({
      id: "h-running",
      title: "Daily Run",
      category: "Fitness",
      targetType: "NUMERIC",
      targetValue: 10,
      unit: "km",
      schedule: HabitScheduler.createDailySchedule("2026-11-01"),
    });
    expect(habit.id).toBe("h-running");

    for (let day = 1; day <= 7; day += 1) {
      const dateKey = `2026-11-0${day}`;
      await habitStore.recordCheckIn({
        habitId: "h-running",
        dateKey,
        recordedValue: 10,
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const metricsAfter7Days = await streakStore.getResilienceMetrics("h-running");
    expect(metricsAfter7Days.traditionalCurrentStreak).toBe(7);
    expect(metricsAfter7Days.activeShieldsCount).toBe(1);
    expect(metricsAfter7Days.currentScore).toBe(100.0);

    await habitStore.skipHabit("h-running", "2026-11-08", "Mild ankle sprain");
    await new Promise((resolve) => setTimeout(resolve, 10));

    const metricsAfterShieldedSkip = await streakStore.getResilienceMetrics("h-running");
    expect(metricsAfterShieldedSkip.activeShieldsCount).toBe(0);
    expect(metricsAfterShieldedSkip.totalShieldsConsumed).toBe(1);
    expect(metricsAfterShieldedSkip.currentScore).toBe(92.5);

    await habitStore.skipHabit("h-running", "2026-11-09", "Persistent soreness");
    await habitStore.skipHabit("h-running", "2026-11-10", "Resting");
    await new Promise((resolve) => setTimeout(resolve, 10));

    const entries = await habitStore.getEntriesForHabit("h-running");
    const observations: BehaviorObservation[] = entries.map((e) => ({
      dateKey: e.dateKey,
      recordedValue: e.recordedValue,
      targetValue: e.targetValueSnapshot,
      status: e.status,
    }));

    const generatedInsight = await insightStore.evaluateHabit({
      habitId: "h-running",
      habitTitle: habit.title,
      category: habit.category,
      currentTarget: habit.targetValue,
      ...(habit.unit ? { unit: habit.unit } : {}),
      observations,
    });

    expect(generatedInsight).not.toBeNull();
    expect(generatedInsight?.category).toBe("downscale_target");
    expect(generatedInsight?.proposedNewTarget).toBe(5);

    await insightStore.applyInsight(generatedInsight!.id);

    const proposedTarget = generatedInsight?.proposedNewTarget ?? 5;
    const updatedHabit = await habitStore.updateHabit("h-running", {
      targetValue: proposedTarget,
    });
    expect(updatedHabit.targetValue).toBe(5);

    await habitStore.recordCheckIn({
      habitId: "h-running",
      dateKey: "2026-11-11",
      recordedValue: 5,
    });

    const recordsForAnalytics: LoggedDayRecord[] = (await habitStore.getEntriesForHabit("h-running")).map(
      (e) => ({
        dateKey: e.dateKey,
        isCompleted: e.status === "COMPLETED",
        recordedValue: e.recordedValue,
        targetValue: e.targetValueSnapshot,
      })
    );

    const summary = ConsistencyAggregator.aggregateConsistency("h-running", recordsForAnalytics);
    expect(summary.totalDaysTracked).toBe(11);
    expect(summary.totalCompletedDays).toBe(8);
    expect(summary.heatmap.cells.length).toBe(11);
  });
});
