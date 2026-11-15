import { describe, it, expect, beforeEach } from "vitest";
import {
  BrowserLocalStoragePort,
  InMemoryEventBus,
  LamportClock,
  MockAiInferenceClient,
  type RecordBase,
} from "../core/index.js";
import { HabitStore, HabitScheduler, type Habit, type HabitEntry } from "../features/habits/index.js";
import { MomentumCalculator } from "../features/streaks/index.js";
import { InsightStore, type StoredInsight } from "../features/insights/index.js";
import {
  ConsistencyAggregator,
  AnalyticsViewPresenter,
  type HabitMeta,
  type LoggedDayRecord,
} from "../features/analytics/index.js";

interface TestItem extends RecordBase {
  readonly name: string;
}

describe("Frontend Engine & Persistence Layer Integration", () => {
  beforeEach(() => {
    const storeMap = new Map<string, string>();
    const fakeLocalStorage = {
      getItem: (key: string) => storeMap.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storeMap.set(key, value);
      },
      removeItem: (key: string) => {
        storeMap.delete(key);
      },
      clear: () => {
        storeMap.clear();
      },
    };

    Object.defineProperty(globalThis, "window", {
      value: { localStorage: fakeLocalStorage },
      writable: true,
      configurable: true,
    });
  });

  it("verifies BrowserLocalStoragePort hydrates persisted state after reload simulation", async () => {
    const collectionName = "habits_reload_test";
    const initialPort = new BrowserLocalStoragePort<TestItem>(collectionName);

    await initialPort.insert({
      id: "item-1",
      createdAt: 1000,
      updatedAt: 1000,
      name: "Hydrate Test Habit",
    });

    const retrievedInitial = await initialPort.getById("item-1");
    expect(retrievedInitial).not.toBeNull();
    expect(retrievedInitial?.name).toBe("Hydrate Test Habit");

    const reloadedPort = new BrowserLocalStoragePort<TestItem>(collectionName);
    const hydratedRecord = await reloadedPort.getById("item-1");

    expect(hydratedRecord).not.toBeNull();
    expect(hydratedRecord?.name).toBe("Hydrate Test Habit");

    await reloadedPort.clear();
    const emptyPort = new BrowserLocalStoragePort<TestItem>(collectionName);
    const afterClear = await emptyPort.getById("item-1");
    expect(afterClear).toBeNull();
  });

  it("verifies interactive micro-logging reflects check-in changes immediately and emits events", async () => {
    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();
    const habitStorage = new BrowserLocalStoragePort<Habit>("habits_interactive_test");
    const entryStorage = new BrowserLocalStoragePort<HabitEntry>("entries_interactive_test");
    const habitStore = new HabitStore(habitStorage, entryStorage, eventBus, clock);

    let lastEventPayload: any = null;
    eventBus.subscribe("HABIT_COMPLETED", (event) => {
      lastEventPayload = event.payload;
    });

    const habit = await habitStore.createHabit({
      id: "h-hydration",
      title: "Daily Hydration",
      description: "Drink 2000ml water",
      category: "Health",
      targetType: "NUMERIC",
      targetValue: 2000,
      unit: "ml",
      schedule: HabitScheduler.createDailySchedule("2026-11-01"),
    });

    const checkInDate = "2026-11-15";
    const firstCheckIn = await habitStore.recordCheckIn({
      habitId: habit.id,
      dateKey: checkInDate,
      recordedValue: 1000,
      isIncremental: true,
    });

    expect(firstCheckIn.recordedValue).toBe(1000);
    expect(firstCheckIn.status).toBe("PARTIAL");
    expect(lastEventPayload?.isFullCompletion).toBe(false);

    const secondCheckIn = await habitStore.recordCheckIn({
      habitId: habit.id,
      dateKey: checkInDate,
      recordedValue: 1000,
      isIncremental: true,
    });

    expect(secondCheckIn.recordedValue).toBe(2000);
    expect(secondCheckIn.status).toBe("COMPLETED");
    expect(lastEventPayload?.isFullCompletion).toBe(true);

    const entries = await habitStore.getEntriesForHabit(habit.id);
    expect(entries.length).toBe(1);
    expect(entries[0]?.recordedValue).toBe(2000);
    expect(entries[0]?.status).toBe("COMPLETED");
  });

  it("verifies momentum decay computation and health tier categorisation for the dashboard view", () => {
    const exemplaryScore = 95.0;
    const consistentScore = 75.0;
    const atRiskScore = 55.0;
    const criticalScore = 15.0;

    expect(MomentumCalculator.determineHealthTier(exemplaryScore)).toBe("EXEMPLARY");
    expect(MomentumCalculator.determineHealthTier(consistentScore)).toBe("CONSISTENT");
    expect(MomentumCalculator.determineHealthTier(atRiskScore)).toBe("AT_RISK");
    expect(MomentumCalculator.determineHealthTier(criticalScore)).toBe("CRITICAL");

    const startScore = 80.0;
    const day1Miss = MomentumCalculator.calculateNextScore(startScore, 0.0);
    const day2Miss = MomentumCalculator.calculateNextScore(day1Miss, 0.0);
    const day3Miss = MomentumCalculator.calculateNextScore(day2Miss, 0.0);

    expect(day1Miss).toBe(68.0);
    expect(day2Miss).toBe(57.8);
    expect(day3Miss).toBe(49.13);
  });

  it("verifies intelligence cooldown and fallback handling for UI states", async () => {
    const eventBus = new InMemoryEventBus();
    const insightStorage = new BrowserLocalStoragePort<StoredInsight>("insights_ui_test");
    const mockAi = new MockAiInferenceClient({
      habitId: "h-test",
      patternDetected: "Late night dropoff",
      rootCauseHypothesis: "Fatigue sets in after 10 PM",
      severityLevel: "high",
      suggestedAdjustment: {
        category: "shift_time",
        proposedTimeMinutes: 480,
        justification: "Complete early morning",
      },
      encouragementMicroCopy: "One step at a time.",
    });

    const insightStore = new InsightStore(insightStorage, mockAi, eventBus);

    const context = {
      habitId: "h-test",
      habitTitle: "Meditation",
      category: "Mindfulness",
      currentTarget: 15,
      observations: [
        { dateKey: "2026-11-10", targetValue: 15, recordedValue: 0, status: "MISSED" as const },
        { dateKey: "2026-11-11", targetValue: 15, recordedValue: 0, status: "MISSED" as const },
        { dateKey: "2026-11-12", targetValue: 15, recordedValue: 0, status: "MISSED" as const },
        { dateKey: "2026-11-13", targetValue: 15, recordedValue: 0, status: "MISSED" as const },
      ],
    };

    const firstInsight = await insightStore.evaluateHabit(context);

    expect(firstInsight).not.toBeNull();
    expect(firstInsight?.patternType).toBe("CONSECUTIVE_LAPSE");
    expect(firstInsight?.patternDetected).toBe("Late night dropoff");
    expect(firstInsight?.actionStatus).toBe("PENDING");

    const secondInsight = await insightStore.evaluateHabit(context);
    expect(secondInsight).toBeNull();

    const forcedInsight = await insightStore.evaluateHabit(context, true);
    expect(forcedInsight?.id).toBe(firstInsight?.id);
  });

  it("verifies analytics heatmap and distribution calculations generate valid visual structures", async () => {
    const habits: HabitMeta[] = [
      { id: "h-read", title: "Reading" },
      { id: "h-write", title: "Writing" },
    ];

    const recordsA: LoggedDayRecord[] = [
      { dateKey: "2026-11-01", isCompleted: true, recordedValue: 1, targetValue: 1 },
      { dateKey: "2026-11-02", isCompleted: true, recordedValue: 1, targetValue: 1 },
      { dateKey: "2026-11-03", isCompleted: true, recordedValue: 1, targetValue: 1 },
      { dateKey: "2026-11-04", isCompleted: false, recordedValue: 0, targetValue: 1 },
      { dateKey: "2026-11-05", isCompleted: true, recordedValue: 1, targetValue: 1 },
      { dateKey: "2026-11-06", isCompleted: false, recordedValue: 0, targetValue: 1 },
    ];

    const recordsB: LoggedDayRecord[] = [
      { dateKey: "2026-11-01", isCompleted: true, recordedValue: 1, targetValue: 1 },
      { dateKey: "2026-11-02", isCompleted: true, recordedValue: 1, targetValue: 1 },
      { dateKey: "2026-11-03", isCompleted: true, recordedValue: 1, targetValue: 1 },
      { dateKey: "2026-11-04", isCompleted: false, recordedValue: 0, targetValue: 1 },
      { dateKey: "2026-11-05", isCompleted: true, recordedValue: 1, targetValue: 1 },
      { dateKey: "2026-11-06", isCompleted: false, recordedValue: 0, targetValue: 1 },
    ];

    const recordsMap = new Map<string, readonly LoggedDayRecord[]>([
      ["h-read", recordsA],
      ["h-write", recordsB],
    ]);

    const overview = ConsistencyAggregator.generateSystemOverview(habits, recordsMap);
    expect(overview.totalTrackedHabits).toBe(2);
    expect(overview.overallCompletionRate).toBe(0.67);
    expect(overview.correlations.length).toBe(1);
    expect(overview.correlations[0]?.correlationCoefficient).toBe(1.0);

    const presentedOverview = AnalyticsViewPresenter.presentExecutiveDashboard(overview);
    expect(presentedOverview.systemCompletionRateDisplay).toBe("67%");
    expect(presentedOverview.totalHabitsText).toBe("2 Tracked Habits");

    const summaryA = ConsistencyAggregator.aggregateConsistency("h-read", recordsA);
    const presentedCard = AnalyticsViewPresenter.presentHabitAnalytics(summaryA);
    expect(presentedCard.completionRateDisplay).toBe("67%");
    expect(presentedCard.dayBars.length).toBe(7);
  });
});
