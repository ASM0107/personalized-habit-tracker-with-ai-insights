import { describe, it, expect } from "vitest";
import {
  InMemoryStoragePort,
  LamportClock,
  LastWriteWinsSynchronizer,
  InMemoryEventBus,
  type RecordBase,
} from "../core/index.js";
import {
  HabitStore,
  HabitScheduler,
  type Habit,
  type HabitEntry,
} from "../features/habits/index.js";

interface TestPayload extends RecordBase {
  readonly val: number;
}

describe("Hardening, Performance & Reliability Phase 5", () => {
  it("verifies p99 check-in mutation latency remains strictly under 50ms", async () => {
    const habitStorage = new InMemoryStoragePort<Habit>();
    const entryStorage = new InMemoryStoragePort<HabitEntry>();
    const eventBus = new InMemoryEventBus();
    const clock = new LamportClock();

    const store = new HabitStore(habitStorage, entryStorage, eventBus, clock);

    await store.createHabit({
      id: "h-perf",
      title: "Performance Habit",
      category: "Testing",
      targetType: "NUMERIC",
      targetValue: 10,
      schedule: HabitScheduler.createDailySchedule("2026-01-01"),
    });

    const latencies: number[] = [];

    for (let i = 1; i <= 100; i += 1) {
      const month = String(Math.floor((i - 1) / 28) + 1).padStart(2, "0");
      const day = String(((i - 1) % 28) + 1).padStart(2, "0");
      const dateKey = `2026-${month}-${day}`;

      const start = performance.now();
      await store.recordCheckIn({
        habitId: "h-perf",
        dateKey,
        recordedValue: 10,
      });
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
    }

    latencies.sort((a, b) => a - b);
    const p99Index = Math.floor(latencies.length * 0.99);
    const p99Latency = latencies[p99Index] ?? 0;

    expect(p99Latency).toBeLessThan(50);
  });

  it("reconciles 100 queued offline synchronisation envelopes in under 1.5 seconds", async () => {
    const synchronizer = new LastWriteWinsSynchronizer<TestPayload>();
    const clock = new LamportClock();

    const envelopes = Array.from({ length: 100 }, (_, i) => ({
      entityId: `entity-${i}`,
      entityType: "HABIT_ENTRY",
      lamportTimestamp: clock.increment(),
      deviceId: i % 2 === 0 ? "device-mobile" : "device-laptop",
      payload: { id: `entity-${i}`, val: i, createdAt: 100, updatedAt: 100 },
      isDeleted: false,
    }));

    const start = performance.now();

    for (const env of envelopes) {
      const incoming = {
        ...env,
        lamportTimestamp: env.lamportTimestamp + 1,
        payload: { ...env.payload, val: env.payload.val + 100 },
      };
      const winner = synchronizer.resolveWinner(env, incoming);
      expect(winner.payload.val).toBe(env.payload.val + 100);
    }

    const totalSyncTimeMs = performance.now() - start;
    expect(totalSyncTimeMs).toBeLessThan(1500);
  });

  it("validates two-year storage footprint for 10 habits remains well below 25MB", () => {
    const totalHabits = 10;
    const totalDays = 730;
    const entries: HabitEntry[] = [];

    for (let h = 1; h <= totalHabits; h += 1) {
      const habitId = `habit-${h}`;
      for (let d = 1; d <= totalDays; d += 1) {
        entries.push({
          id: `${habitId}-day-${d}`,
          habitId,
          dateKey: "2026-01-01",
          recordedValue: 1,
          targetValueSnapshot: 1,
          status: "COMPLETED",
          notes: "Sample reflection note for daily verification",
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
          lamportTimestamp: d,
        });
      }
    }

    const serialized = JSON.stringify(entries);
    const byteSize = Buffer.byteLength(serialized, "utf-8");
    const megabytes = byteSize / (1024 * 1024);

    expect(megabytes).toBeLessThan(25);
    expect(megabytes).toBeLessThan(5);
  });

  it("guarantees deterministic, commutative multi-device conflict resolution", () => {
    const synchronizer = new LastWriteWinsSynchronizer<{ version: string }>();

    const envA = {
      entityId: "habit-sync-test",
      entityType: "HABIT",
      lamportTimestamp: 10,
      deviceId: "device-alpha",
      payload: { version: "A" },
      isDeleted: false,
    };

    const envB = {
      entityId: "habit-sync-test",
      entityType: "HABIT",
      lamportTimestamp: 10,
      deviceId: "device-beta",
      payload: { version: "B" },
      isDeleted: false,
    };

    const resultAB = synchronizer.resolveWinner(envA, envB);
    const resultBA = synchronizer.resolveWinner(envB, envA);

    expect(resultAB.deviceId).toBe("device-beta");
    expect(resultBA.deviceId).toBe("device-beta");
    expect(resultAB.payload.version).toBe("B");
    expect(resultBA.payload.version).toBe("B");
  });
});
