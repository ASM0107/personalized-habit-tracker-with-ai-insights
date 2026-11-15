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

describe("Alpha Cohort Simulation: 30-Day Multi-Persona Verification", () => {
  it("simulates Persona 1 (The Consistent High-Performer) maintaining exemplary momentum", async () => {
    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();

    const habitStore = new HabitStore(
      new InMemoryStoragePort<Habit>(),
      new InMemoryStoragePort<HabitEntry>(),
      eventBus,
      clock
    );
    const streakStore = new StreakStore(new InMemoryStoragePort<StreakShield>(), eventBus);

    await habitStore.createHabit({
      id: "h-alex-meditation",
      title: "Morning Meditation",
      category: "Mindfulness",
      targetType: "DURATION",
      targetValue: 15,
      schedule: HabitScheduler.createDailySchedule("2026-11-01"),
    });

    for (let day = 1; day <= 30; day += 1) {
      const dayStr = String(day).padStart(2, "0");
      await habitStore.recordCheckIn({
        habitId: "h-alex-meditation",
        dateKey: `2026-11-${dayStr}`,
        recordedValue: 15,
      });
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const metrics = await streakStore.getResilienceMetrics("h-alex-meditation");
    expect(metrics.currentScore).toBe(100.0);
    expect(metrics.traditionalCurrentStreak).toBe(30);
    expect(metrics.healthTier).toBe("EXEMPLARY");
    expect(metrics.activeShieldsCount).toBe(StreakStore.MAX_ACTIVE_SHIELDS);
  });

  it("simulates Persona 2 (The Recovery / Burnout Risk) detecting lapse and rebuilding momentum", async () => {
    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();

    const habitStorage = new InMemoryStoragePort<Habit>();
    const entryStorage = new InMemoryStoragePort<HabitEntry>();
    const shieldStorage = new InMemoryStoragePort<StreakShield>();
    const insightStorage = new InMemoryStoragePort<StoredInsight>();

    const habitStore = new HabitStore(habitStorage, entryStorage, eventBus, clock);
    const streakStore = new StreakStore(shieldStorage, eventBus);

    const mockAiResponse: HabitInsightResponse = {
      habitId: "h-jordan-work",
      patternDetected: "Consecutive 3-day drop off detected",
      rootCauseHypothesis: "Late night exhaustion after 90m deep work sessions",
      severityLevel: "high",
      suggestedAdjustment: {
        category: "downscale_target",
        proposedNewTarget: 45,
        justification: "Downscale target to 45m to relieve cognitive overload",
      },
      encouragementMicroCopy: "Small steps rebuild great habits.",
    };
    const mockAiClient = new MockAiInferenceClient(mockAiResponse);
    const insightStore = new InsightStore(insightStorage, mockAiClient, eventBus);

    await habitStore.createHabit({
      id: "h-jordan-work",
      title: "Deep Work Session",
      category: "Productivity",
      targetType: "DURATION",
      targetValue: 90,
      unit: "mins",
      schedule: HabitScheduler.createDailySchedule("2026-11-01"),
    });

    for (let day = 1; day <= 10; day += 1) {
      const dayStr = String(day).padStart(2, "0");
      await habitStore.recordCheckIn({
        habitId: "h-jordan-work",
        dateKey: `2026-11-${dayStr}`,
        recordedValue: 90,
      });
    }

    await habitStore.skipHabit("h-jordan-work", "2026-11-11", "Exhaustion");
    await habitStore.skipHabit("h-jordan-work", "2026-11-12", "Headache");
    await habitStore.skipHabit("h-jordan-work", "2026-11-13", "Family emergency");

    const entriesUntilDay13 = await habitStore.getEntriesForHabit("h-jordan-work");
    const obs: BehaviorObservation[] = entriesUntilDay13.map((e) => ({
      dateKey: e.dateKey,
      recordedValue: e.recordedValue,
      targetValue: e.targetValueSnapshot,
      status: e.status,
    }));

    const insight = await insightStore.evaluateHabit({
      habitId: "h-jordan-work",
      habitTitle: "Deep Work Session",
      category: "Productivity",
      currentTarget: 90,
      unit: "mins",
      observations: obs,
    });

    expect(insight).not.toBeNull();
    expect(insight?.category).toBe("downscale_target");
    expect(insight?.proposedNewTarget).toBe(45);

    await insightStore.applyInsight(insight!.id);
    const newTarget = insight?.proposedNewTarget ?? 45;
    await habitStore.updateHabit("h-jordan-work", {
      targetValue: newTarget,
    });

    for (let day = 14; day <= 30; day += 1) {
      const dayStr = String(day).padStart(2, "0");
      await habitStore.recordCheckIn({
        habitId: "h-jordan-work",
        dateKey: `2026-11-${dayStr}`,
        recordedValue: 45,
      });
    }

    const finalMetrics = await streakStore.getResilienceMetrics("h-jordan-work");
    expect(finalMetrics.currentScore).toBeGreaterThanOrEqual(95.0);
    expect(finalMetrics.healthTier).toBe("EXEMPLARY");
  });

  it("simulates Persona 3 (The Weekend Dropper) diagnosing recurring weekend friction", async () => {
    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();

    const habitStorage = new InMemoryStoragePort<Habit>();
    const entryStorage = new InMemoryStoragePort<HabitEntry>();
    const insightStorage = new InMemoryStoragePort<StoredInsight>();

    const habitStore = new HabitStore(habitStorage, entryStorage, eventBus, clock);

    const mockAiResponse: HabitInsightResponse = {
      habitId: "h-taylor-guitar",
      patternDetected: "Weekend Drop-off Pattern",
      rootCauseHypothesis: "Weekend routines conflict with morning guitar practice",
      severityLevel: "medium",
      suggestedAdjustment: {
        category: "shift_time",
        proposedTimeMinutes: 720,
        justification: "Shift weekend guitar practice to midday",
      },
      encouragementMicroCopy: "Adapt the routine to fit your life.",
    };
    const mockAiClient = new MockAiInferenceClient(mockAiResponse);
    const insightStore = new InsightStore(insightStorage, mockAiClient, eventBus);

    await habitStore.createHabit({
      id: "h-taylor-guitar",
      title: "Guitar Practice",
      category: "Music",
      targetType: "DURATION",
      targetValue: 30,
      schedule: HabitScheduler.createDailySchedule("2026-11-01"),
    });

    await habitStore.recordCheckIn({ habitId: "h-taylor-guitar", dateKey: "2026-11-06", recordedValue: 30 });
    await habitStore.skipHabit("h-taylor-guitar", "2026-11-07", "Weekend out");
    await habitStore.skipHabit("h-taylor-guitar", "2026-11-08", "Weekend out");
    await habitStore.recordCheckIn({ habitId: "h-taylor-guitar", dateKey: "2026-11-09", recordedValue: 30 });

    const entries = await habitStore.getEntriesForHabit("h-taylor-guitar");
    const obs: BehaviorObservation[] = entries.map((e) => ({
      dateKey: e.dateKey,
      recordedValue: e.recordedValue,
      targetValue: e.targetValueSnapshot,
      status: e.status,
    }));

    const insight = await insightStore.evaluateHabit({
      habitId: "h-taylor-guitar",
      habitTitle: "Guitar Practice",
      category: "Music",
      currentTarget: 30,
      observations: obs,
    });

    expect(insight).not.toBeNull();
    expect(insight?.patternType).toBe("WEEKEND_DROPOFF");
    expect(insight?.category).toBe("shift_time");
  });

  it("simulates Persona 4 (The Offline Batch Synchronizer) batch committing 14 days without errors", async () => {
    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();

    const habitStore = new HabitStore(
      new InMemoryStoragePort<Habit>(),
      new InMemoryStoragePort<HabitEntry>(),
      eventBus,
      clock
    );

    await habitStore.createHabit({
      id: "h-offline",
      title: "Hydration",
      category: "Health",
      targetType: "NUMERIC",
      targetValue: 8,
      schedule: HabitScheduler.createDailySchedule("2026-11-01"),
    });

    for (let day = 1; day <= 14; day += 1) {
      const dayStr = String(day).padStart(2, "0");
      await habitStore.recordCheckIn({
        habitId: "h-offline",
        dateKey: `2026-11-${dayStr}`,
        recordedValue: 8,
      });
    }

    const history = await habitStore.getHabitHistory("h-offline", "2026-11-01", "2026-11-14");
    expect(history.totalDaysTracked).toBe(14);
    expect(history.totalCompleted).toBe(14);
    expect(history.completionRate).toBe(1.0);
  });

  it("simulates Persona 5 (The Chaos / Edge Case Explorer) exercising rapid mutations and archiving", async () => {
    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();

    const habitStore = new HabitStore(
      new InMemoryStoragePort<Habit>(),
      new InMemoryStoragePort<HabitEntry>(),
      eventBus,
      clock
    );

    await habitStore.createHabit({
      id: "h-chaos",
      title: "Chaos Testing",
      category: "QA",
      targetType: "NUMERIC",
      targetValue: 10,
      schedule: HabitScheduler.createDailySchedule("2026-11-01"),
    });

    await habitStore.recordCheckIn({ habitId: "h-chaos", dateKey: "2026-11-15", recordedValue: 3, isIncremental: true });
    await habitStore.recordCheckIn({ habitId: "h-chaos", dateKey: "2026-11-15", recordedValue: 4, isIncremental: true });
    await habitStore.recordCheckIn({ habitId: "h-chaos", dateKey: "2026-11-15", recordedValue: 3, isIncremental: true });

    const entry = (await habitStore.getEntriesForHabit("h-chaos"))[0];
    expect(entry?.recordedValue).toBe(10);
    expect(entry?.status).toBe("COMPLETED");

    await habitStore.archiveHabit("h-chaos");
    const dueActive = await habitStore.getDueHabits("2026-11-15");
    expect(dueActive.some((h) => h.id === "h-chaos")).toBe(false);

    await habitStore.unarchiveHabit("h-chaos");
    const dueRestored = await habitStore.getDueHabits("2026-11-15");
    expect(dueRestored.some((h) => h.id === "h-chaos")).toBe(true);

    const historyAfterRestore = await habitStore.getHabitHistory("h-chaos", "2026-11-15", "2026-11-15");
    expect(historyAfterRestore.totalCompleted).toBe(1);
  });
});
