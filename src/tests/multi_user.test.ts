import { describe, it, expect, beforeEach } from "vitest";
import { BrowserLocalStoragePort, InMemoryEventBus, LamportClock, LastWriteWinsSynchronizer, type SyncEnvelope } from "../core/index.js";
import { HabitStore, HabitScheduler, type Habit, type HabitEntry } from "../features/habits/index.js";
import { ProfileStore } from "../features/identity/index.js";
import { handleRegister, handleLogin, verifyToken, handleSyncPush, handleSyncPull } from "../../server/auth.js";

describe("Multi-User & Multi-Profile Architecture", () => {
  beforeEach(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.clear();
    }
  });

  it("verifies local profile switching and strict database partition isolation", async () => {
    const profileStore = new ProfileStore();
    const defaultProfile = profileStore.getActiveProfile();
    expect(defaultProfile.id).toBe("default");
    expect(defaultProfile.name).toBe("Personal");

    const workProfile = profileStore.createLocalProfile("Work");
    expect(workProfile.type).toBe("LOCAL");
    expect(profileStore.getActiveProfile().id).toBe(workProfile.id);

    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();

    const personalHabitStorage = new BrowserLocalStoragePort<Habit>("habits", "default");
    const personalEntryStorage = new BrowserLocalStoragePort<HabitEntry>("entries", "default");
    const personalHabitStore = new HabitStore(personalHabitStorage, personalEntryStorage, eventBus, clock);

    const workHabitStorage = new BrowserLocalStoragePort<Habit>("habits", workProfile.id);
    const workEntryStorage = new BrowserLocalStoragePort<HabitEntry>("entries", workProfile.id);
    const workHabitStore = new HabitStore(workHabitStorage, workEntryStorage, eventBus, clock);

    await personalHabitStore.createHabit({
      id: "personal-meditation",
      title: "Morning Meditation",
      category: "Mindfulness",
      targetType: "DURATION",
      targetValue: 20,
      schedule: HabitScheduler.createDailySchedule("2026-11-15"),
    });

    await workHabitStore.createHabit({
      id: "work-inbox-zero",
      title: "Inbox Zero",
      category: "Work",
      targetType: "BOOLEAN",
      targetValue: 1,
      schedule: HabitScheduler.createDailySchedule("2026-11-15"),
    });

    const personalHabits = await personalHabitStore.getAllActiveHabits();
    const workHabits = await workHabitStore.getAllActiveHabits();

    expect(personalHabits.map((h) => h.id)).toContain("personal-meditation");
    expect(personalHabits.map((h) => h.id)).not.toContain("work-inbox-zero");

    expect(workHabits.map((h) => h.id)).toContain("work-inbox-zero");
    expect(workHabits.map((h) => h.id)).not.toContain("personal-meditation");
  });

  it("verifies profile management rules: renaming, custom deletion, and default preservation", () => {
    const store = new ProfileStore();
    expect(store.deleteProfile("default")).toBe(false);

    const fitnessProfile = store.createLocalProfile("Fitness");
    expect(store.getAllProfiles().some((p) => p.id === fitnessProfile.id)).toBe(true);

    const renameSuccess = store.renameProfile(fitnessProfile.id, "Health & Fitness");
    expect(renameSuccess).toBe(true);
    expect(store.getActiveProfile().name).toBe("Health & Fitness");

    const deleteSuccess = store.deleteProfile(fitnessProfile.id);
    expect(deleteSuccess).toBe(true);
    expect(store.getActiveProfile().id).toBe("default");
  });

  it("verifies cryptographic cloud authentication and HMAC token lifecycle", () => {
    const testEmail = `user_${Date.now()}@example.com`;
    const regResult = handleRegister({
      email: testEmail,
      password: "securePassword123",
      name: "Cloud User",
    });

    expect(regResult.status).toBe(201);
    expect(regResult.body.user?.email).toBe(testEmail);
    expect(regResult.body.token?.length).toBeGreaterThan(20);

    const duplicateReg = handleRegister({
      email: testEmail,
      password: "anotherPassword",
    });
    expect(duplicateReg.status).toBe(409);

    const validLogin = handleLogin({
      email: testEmail,
      password: "securePassword123",
    });
    expect(validLogin.status).toBe(200);
    expect(validLogin.body.token?.length).toBeGreaterThan(20);

    const invalidLogin = handleLogin({
      email: testEmail,
      password: "wrongPassword",
    });
    expect(invalidLogin.status).toBe(401);

    const verified = verifyToken(validLogin.body.token!);
    expect(verified).not.toBeNull();
    expect(verified?.email).toBe(testEmail);

    const tampered = verifyToken(`${validLogin.body.token}tampered`);
    expect(tampered).toBeNull();
  });

  it("verifies multi-device cloud synchronization with Lamport timestamps and deterministic resolution", () => {
    const userA = `userA_${Date.now()}@example.com`;
    const userB = `userB_${Date.now()}@example.com`;

    const regA = handleRegister({ email: userA, password: "password123", name: "User A" });
    const regB = handleRegister({ email: userB, password: "password123", name: "User B" });

    expect(regA.body.user?.email).toBe(userA.toLowerCase());
    expect(regB.body.user?.email).toBe(userB.toLowerCase());
    expect(regA.body.token?.length).toBeGreaterThan(10);
    expect(regB.body.token?.length).toBeGreaterThan(10);

    const device1Envelope: SyncEnvelope<{ title: string; completed: boolean }> = {
      entityId: "habit-sync-1",
      entityType: "HABIT",
      lamportTimestamp: 1,
      deviceId: "phone-device-a",
      payload: { title: "Read 20 pages", completed: false },
      isDeleted: false,
    };

    const pushResult = handleSyncPush(regA.body.user!.id, [device1Envelope]);
    expect(pushResult.status).toBe(200);
    expect(pushResult.body.committedCount).toBe(1);

    const pullResultA = handleSyncPull(regA.body.user!.id, 0);
    expect(pullResultA.status).toBe(200);
    expect(pullResultA.body.envelopes?.length).toBe(1);
    const pulledEnvelopes = pullResultA.body.envelopes as readonly SyncEnvelope<{ title: string; completed: boolean }>[];
    expect(pulledEnvelopes[0]?.entityId).toBe("habit-sync-1");

    const pullResultB = handleSyncPull(regB.body.user!.id, 0);
    expect(pullResultB.status).toBe(200);
    expect(pullResultB.body.envelopes?.length).toBe(0);

    const device2ConcurrentEnvelope: SyncEnvelope<{ title: string; completed: boolean }> = {
      entityId: "habit-sync-1",
      entityType: "HABIT",
      lamportTimestamp: 2,
      deviceId: "laptop-device-a",
      payload: { title: "Read 20 pages", completed: true },
      isDeleted: false,
    };

    const synchronizer = new LastWriteWinsSynchronizer<{ title: string; completed: boolean }>();
    const winner = synchronizer.resolveWinner(device1Envelope, device2ConcurrentEnvelope);
    expect(winner.payload.completed).toBe(true);
    expect(winner.deviceId).toBe("laptop-device-a");
  });
});
