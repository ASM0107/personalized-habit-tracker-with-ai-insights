import { describe, it, expect, beforeEach } from "vitest";
import { BrowserLocalStoragePort, InMemoryEventBus, LamportClock } from "../core/index.js";
import { HabitStore, HabitScheduler, type Habit, type HabitEntry } from "../features/habits/index.js";
import { ProfileStore } from "../features/identity/index.js";

describe("Local Profile Lifecycle & Resilient Partitioning", () => {
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

  it("safely recovers from malformed JSON in local storage without crashing", async () => {
    window.localStorage.setItem("habit_tracker_user_profiles", "{ malformed json: not valid ]");
    const profileStore = new ProfileStore();
    expect(profileStore.getActiveProfile().id).toBe("default");
    expect(profileStore.getAllProfiles().length).toBe(1);

    window.localStorage.setItem("habit_tracker_habits", "not an array at all");
    const habitStorage = new BrowserLocalStoragePort<Habit>("habits", "default");
    const queried = await habitStorage.query();
    expect(queried).toEqual([]);

    window.localStorage.setItem("habit_tracker_habits", JSON.stringify({ someObject: "not array" }));
    const habitStorageObj = new BrowserLocalStoragePort<Habit>("habits", "default");
    const queriedObj = await habitStorageObj.query();
    expect(queriedObj).toEqual([]);
  });

  it("maintains strict data partition isolation across custom profiles", async () => {
    const profileStore = new ProfileStore();
    const fitnessProfile = profileStore.createLocalProfile("Fitness");
    const studyProfile = profileStore.createLocalProfile("Study");

    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();

    const fitnessHabitPort = new BrowserLocalStoragePort<Habit>("habits", fitnessProfile.id);
    const fitnessEntryPort = new BrowserLocalStoragePort<HabitEntry>("entries", fitnessProfile.id);
    const fitnessStore = new HabitStore(fitnessHabitPort, fitnessEntryPort, eventBus, clock);

    const studyHabitPort = new BrowserLocalStoragePort<Habit>("habits", studyProfile.id);
    const studyEntryPort = new BrowserLocalStoragePort<HabitEntry>("entries", studyProfile.id);
    const studyStore = new HabitStore(studyHabitPort, studyEntryPort, eventBus, clock);

    await fitnessStore.createHabit({
      id: "run-5k",
      title: "Morning 5k Run",
      category: "Health",
      targetType: "DURATION",
      targetValue: 30,
      schedule: HabitScheduler.createDailySchedule("2026-11-15"),
    });

    await studyStore.createHabit({
      id: "read-algorithms",
      title: "Read CLRS",
      category: "Education",
      targetType: "NUMERIC",
      targetValue: 15,
      schedule: HabitScheduler.createDailySchedule("2026-11-15"),
    });

    const fitnessHabits = await fitnessStore.getAllActiveHabits();
    const studyHabits = await studyStore.getAllActiveHabits();

    expect(fitnessHabits.length).toBe(1);
    expect(fitnessHabits[0]?.id).toBe("run-5k");

    expect(studyHabits.length).toBe(1);
    expect(studyHabits[0]?.id).toBe("read-algorithms");

    expect(fitnessHabits.some((h) => h.id === "read-algorithms")).toBe(false);
    expect(studyHabits.some((h) => h.id === "run-5k")).toBe(false);
  });

  it("preserves habit data when renaming a profile", async () => {
    const profileStore = new ProfileStore();
    const profile = profileStore.createLocalProfile("Initial Name");
    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();

    const habitPort = new BrowserLocalStoragePort<Habit>("habits", profile.id);
    const entryPort = new BrowserLocalStoragePort<HabitEntry>("entries", profile.id);
    const habitStore = new HabitStore(habitPort, entryPort, eventBus, clock);

    await habitStore.createHabit({
      id: "hydrate-goal",
      title: "Drink Water",
      category: "Health",
      targetType: "NUMERIC",
      targetValue: 8,
      schedule: HabitScheduler.createDailySchedule("2026-11-15"),
    });

    const renamed = profileStore.renameProfile(profile.id, "Renamed Name");
    expect(renamed).toBe(true);
    expect(profileStore.getActiveProfile().name).toBe("Renamed Name");

    const reloadedStore = new HabitStore(habitPort, entryPort, eventBus, clock);
    const preservedHabits = await reloadedStore.getAllActiveHabits();
    expect(preservedHabits.length).toBe(1);
    expect(preservedHabits[0]?.id).toBe("hydrate-goal");
  });

  it("rejects deletion of default profile and handles custom profile partition cleanup", async () => {
    const profileStore = new ProfileStore();
    const deleteDefaultResult = profileStore.deleteProfile("default");
    expect(deleteDefaultResult).toBe(false);
    expect(profileStore.getActiveProfile().id).toBe("default");

    const temporaryProfile = profileStore.createLocalProfile("Temporary");
    expect(profileStore.getActiveProfile().id).toBe(temporaryProfile.id);

    window.localStorage.setItem(`habit_tracker_${temporaryProfile.id}_habits`, JSON.stringify([{ id: "temp-habit" }]));
    expect(window.localStorage.getItem(`habit_tracker_${temporaryProfile.id}_habits`)).not.toBeNull();

    const deleteTempResult = profileStore.deleteProfile(temporaryProfile.id);
    expect(deleteTempResult).toBe(true);
    expect(profileStore.getActiveProfile().id).toBe("default");
    expect(profileStore.getAllProfiles().some((p) => p.id === temporaryProfile.id)).toBe(false);
    expect(window.localStorage.getItem(`habit_tracker_${temporaryProfile.id}_habits`)).toBeNull();
  });

  it("rolls back in-memory mutation and throws error when local storage write fails", async () => {
    const brokenStorage = new BrowserLocalStoragePort<Habit>("broken_test", "default");
    const failingItem: Habit = {
      id: "failing-habit",
      title: "Failing Habit",
      category: "Test",
      targetType: "BOOLEAN",
      targetValue: 1,
      schedule: HabitScheduler.createDailySchedule("2026-11-15"),
      status: "ACTIVE",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const originalSetItem = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    await expect(brokenStorage.insert(failingItem)).rejects.toThrow("Storage write failed");
    const inMemoryItem = await brokenStorage.getById("failing-habit");
    expect(inMemoryItem).toBeNull();

    window.localStorage.setItem = originalSetItem;
  });

  it("handles rapid successive habit entries deterministically without race conditions", async () => {
    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();
    const habitPort = new BrowserLocalStoragePort<Habit>("habits", "rapid-test");
    const entryPort = new BrowserLocalStoragePort<HabitEntry>("entries", "rapid-test");
    const habitStore = new HabitStore(habitPort, entryPort, eventBus, clock);

    await habitStore.createHabit({
      id: "rapid-habit",
      title: "Pushups",
      category: "Fitness",
      targetType: "NUMERIC",
      targetValue: 100,
      schedule: HabitScheduler.createDailySchedule("2026-11-15"),
    });

    for (let i = 0; i < 15; i++) {
      await habitStore.recordCheckIn({
        habitId: "rapid-habit",
        dateKey: `2026-11-${String(i + 1).padStart(2, "0")}`,
        recordedValue: 10,
        notes: `Batch item ${i}`,
      });
    }

    const entries = await entryPort.query((e) => e.habitId === "rapid-habit");
    expect(entries.length).toBe(15);
    const totalRecorded = entries.reduce((acc, curr) => acc + curr.recordedValue, 0);
    expect(totalRecorded).toBe(150);
  });
});
