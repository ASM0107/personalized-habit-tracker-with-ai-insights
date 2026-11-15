import { describe, it, expect } from "vitest";
import {
  InMemoryEventBus,
  InMemoryStoragePort,
  LamportClock,
} from "../core/index.js";
import {
  HabitScheduler,
  HabitValidator,
  HabitStore,
  HabitViewPresenter,
  type Habit,
  type HabitEntry,
} from "../features/habits/index.js";

describe("Habit Engine Phase 2", () => {
  it("validates habit parameters, targets, and recurrence schedules strictly", () => {
    expect(() => HabitValidator.validateTitle("")).toThrow("empty");
    expect(() => HabitValidator.validateTarget("BOOLEAN", 2)).toThrow("strictly equal 1");
    expect(() => HabitValidator.validateDateKey("invalid-date")).toThrow("format");

    const invalidSchedule = {
      recurrenceType: "INTERVAL_DAYS" as const,
      daysOfWeekMask: 0b1111111,
      frequencyPerWeek: 7,
      intervalDays: 0,
      startDateKey: "2026-11-01",
      timeOfDay: "ANYTIME" as const,
      preferredTimeMinutes: 540,
    };
    expect(() => HabitValidator.validateSchedule(invalidSchedule)).toThrow("intervalDays");
  });

  it("evaluates interval and date-bounded recurrence schedules accurately", () => {
    const intervalSchedule = HabitScheduler.createIntervalSchedule("2026-11-01", 3);
    const intervalHabit: Habit = {
      id: "h-interval",
      title: "Water Plants",
      category: "Home",
      targetType: "BOOLEAN",
      targetValue: 1,
      schedule: intervalSchedule,
      status: "ACTIVE",
      createdAt: 100,
      updatedAt: 100,
    };

    expect(HabitScheduler.isHabitDue(intervalHabit, "2026-11-01")).toBe(true);
    expect(HabitScheduler.isHabitDue(intervalHabit, "2026-11-02")).toBe(false);
    expect(HabitScheduler.isHabitDue(intervalHabit, "2026-11-04")).toBe(true);
    expect(HabitScheduler.isHabitDue(intervalHabit, "2026-10-31")).toBe(false);
  });

  it("handles complete lifecycle: creation, update, archive, and deletion", async () => {
    const habitStorage = new InMemoryStoragePort<Habit>();
    const entryStorage = new InMemoryStoragePort<HabitEntry>();
    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();

    const store = new HabitStore(habitStorage, entryStorage, eventBus, clock);

    const habit = await store.createHabit({
      id: "h-running",
      title: "Morning Run",
      category: "Fitness",
      targetType: "NUMERIC",
      targetValue: 5,
      unit: "km",
      schedule: HabitScheduler.createDailySchedule("2026-11-01"),
    });

    expect(habit.title).toBe("Morning Run");
    expect(habit.unit).toBe("km");

    const updated = await store.updateHabit("h-running", {
      title: "Morning 10k Run",
      targetValue: 10,
    });
    expect(updated.title).toBe("Morning 10k Run");
    expect(updated.targetValue).toBe(10);

    const archived = await store.archiveHabit("h-running");
    expect(archived.status).toBe("ARCHIVED");

    const activeList = await store.getAllActiveHabits();
    expect(activeList.length).toBe(0);

    const unarchived = await store.unarchiveHabit("h-running");
    expect(unarchived.status).toBe("ACTIVE");

    const deleted = await store.deleteHabit("h-running");
    expect(deleted).toBe(true);

    const missing = await store.getHabit("h-running");
    expect(missing).toBeNull();
  });

  it("processes incremental micro-logging and calculates completion status", async () => {
    const habitStorage = new InMemoryStoragePort<Habit>();
    const entryStorage = new InMemoryStoragePort<HabitEntry>();
    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();

    const store = new HabitStore(habitStorage, entryStorage, eventBus, clock);

    await store.createHabit({
      id: "h-hydration",
      title: "Drink Water",
      category: "Health",
      targetType: "NUMERIC",
      targetValue: 8,
      unit: "glasses",
      schedule: HabitScheduler.createDailySchedule("2026-11-01"),
    });

    const step1 = await store.recordCheckIn({
      habitId: "h-hydration",
      dateKey: "2026-11-15",
      recordedValue: 3,
      isIncremental: true,
      notes: "Drank 3 glasses before lunch",
    });

    expect(step1.status).toBe("PARTIAL");
    expect(step1.recordedValue).toBe(3);
    expect(step1.notes).toBe("Drank 3 glasses before lunch");

    const step2 = await store.recordCheckIn({
      habitId: "h-hydration",
      dateKey: "2026-11-15",
      recordedValue: 5,
      isIncremental: true,
      notes: "Reached 8 glasses in evening",
    });

    expect(step2.status).toBe("COMPLETED");
    expect(step2.recordedValue).toBe(8);

    const reverted = await store.revertCheckIn("h-hydration", "2026-11-15");
    expect(reverted).toBe(true);

    const checkReverted = await entryStorage.getById("h-hydration-2026-11-15");
    expect(checkReverted).toBeNull();
  });

  it("queries due vs pending habits and calculates historical summary statistics", async () => {
    const habitStorage = new InMemoryStoragePort<Habit>();
    const entryStorage = new InMemoryStoragePort<HabitEntry>();
    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();

    const store = new HabitStore(habitStorage, entryStorage, eventBus, clock);

    await store.createHabit({
      id: "h-read",
      title: "Read Book",
      category: "Personal Growth",
      targetType: "DURATION",
      targetValue: 30,
      unit: "minutes",
      schedule: HabitScheduler.createDailySchedule("2026-11-01"),
    });

    await store.createHabit({
      id: "h-code",
      title: "Side Project Coding",
      category: "Engineering",
      targetType: "DURATION",
      targetValue: 60,
      unit: "minutes",
      schedule: HabitScheduler.createDailySchedule("2026-11-01"),
    });

    const pendingInitial = await store.getPendingHabits("2026-11-15");
    expect(pendingInitial.length).toBe(2);

    await store.recordCheckIn({
      habitId: "h-read",
      dateKey: "2026-11-15",
      recordedValue: 30,
    });

    const pendingAfterOne = await store.getPendingHabits("2026-11-15");
    expect(pendingAfterOne.length).toBe(1);
    expect(pendingAfterOne[0]?.id).toBe("h-code");

    await store.recordCheckIn({
      habitId: "h-read",
      dateKey: "2026-11-16",
      recordedValue: 15,
    });

    await store.skipHabit("h-read", "2026-11-17", "Late meeting");

    const history = await store.getHabitHistory("h-read", "2026-11-15", "2026-11-17");
    expect(history.totalDaysTracked).toBe(3);
    expect(history.totalCompleted).toBe(1);
    expect(history.totalPartial).toBe(1);
    expect(history.totalSkipped).toBe(1);
    expect(history.completionRate).toBe(0.33);
  });

  it("transforms habit domain models into UI card presentation models", async () => {
    const habit: Habit = {
      id: "h-guitar",
      title: "Practice Guitar",
      category: "Hobby",
      targetType: "DURATION",
      targetValue: 20,
      unit: "mins",
      schedule: HabitScheduler.createWeekdaySchedule("2026-11-01"),
      status: "ACTIVE",
      createdAt: 100,
      updatedAt: 100,
    };

    const pendingCard = HabitViewPresenter.presentHabitCard(habit, null);
    expect(pendingCard.statusBadge).toBe("PENDING");
    expect(pendingCard.progressPercentage).toBe(0);
    expect(pendingCard.cadenceLabel).toBe("Weekdays");
    expect(pendingCard.progressLabel).toBe("0 / 20 mins");

    const partialEntry: HabitEntry = {
      id: "e-guitar",
      habitId: "h-guitar",
      dateKey: "2026-11-15",
      recordedValue: 10,
      targetValueSnapshot: 20,
      status: "PARTIAL",
      createdAt: 100,
      updatedAt: 100,
      lamportTimestamp: 1,
    };

    const partialCard = HabitViewPresenter.presentHabitCard(habit, partialEntry);
    expect(partialCard.statusBadge).toBe("PARTIAL");
    expect(partialCard.progressPercentage).toBe(50);
  });
});
