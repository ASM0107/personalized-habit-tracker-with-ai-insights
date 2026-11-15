import { describe, it, expect } from "vitest";
import {
  InMemoryEventBus,
  InMemoryStoragePort,
  LamportClock,
  LastWriteWinsSynchronizer,
  StackNavigationRouter,
  type RecordBase,
} from "../core/index.js";

interface SampleEntity extends RecordBase {
  readonly name: string;
}

describe("Core Framework Primitives", () => {
  it("delivers events reactively through event bus and handles unsubscriptions", () => {
    const bus = new InMemoryEventBus();
    const received: string[] = [];

    const unsubscribe = bus.subscribe("HABIT_CREATED", (event) => {
      received.push(event.payload.habitId);
    });

    bus.publish({
      id: "evt-1",
      type: "HABIT_CREATED",
      timestamp: Date.now(),
      payload: { habitId: "h-1", title: "Read", targetValue: 1 },
    });

    expect(received).toEqual(["h-1"]);

    unsubscribe();

    bus.publish({
      id: "evt-2",
      type: "HABIT_CREATED",
      timestamp: Date.now(),
      payload: { habitId: "h-2", title: "Write", targetValue: 1 },
    });

    expect(received).toEqual(["h-1"]);
  });

  it("performs atomic CRUD operations in local storage port", async () => {
    const storage = new InMemoryStoragePort<SampleEntity>();

    await storage.insert({
      id: "1",
      name: "Alpha",
      createdAt: 100,
      updatedAt: 100,
    });

    const item = await storage.getById("1");
    expect(item?.name).toBe("Alpha");

    await storage.update("1", (curr) => ({ ...curr, name: "AlphaUpdated" }));
    const updated = await storage.getById("1");
    expect(updated?.name).toBe("AlphaUpdated");

    const deleted = await storage.delete("1");
    expect(deleted).toBe(true);

    const missing = await storage.getById("1");
    expect(missing).toBeNull();
  });

  it("increments lamport clocks and resolves LWW synchronization conflicts deterministically", () => {
    const clock = new LamportClock(5);
    expect(clock.getTimestamp()).toBe(5);
    expect(clock.increment()).toBe(6);
    expect(clock.observe(10)).toBe(11);

    const synchronizer = new LastWriteWinsSynchronizer<{ value: string }>();

    const localEnvelope = {
      entityId: "e-1",
      entityType: "HABIT",
      lamportTimestamp: 10,
      deviceId: "device-a",
      payload: { value: "local" },
      isDeleted: false,
    };

    const incomingEnvelope = {
      entityId: "e-1",
      entityType: "HABIT",
      lamportTimestamp: 15,
      deviceId: "device-b",
      payload: { value: "incoming" },
      isDeleted: false,
    };

    const winner = synchronizer.resolveWinner(localEnvelope, incomingEnvelope);
    expect(winner.payload.value).toBe("incoming");
  });

  it("manages screen transitions and history via stack navigation router", () => {
    const router = new StackNavigationRouter();
    expect(router.getCurrentScreen()).toEqual({ name: "DASHBOARD" });

    router.navigate({ name: "NEW_HABIT" });
    expect(router.getCurrentScreen()).toEqual({ name: "NEW_HABIT" });

    const popped = router.goBack();
    expect(popped).toBe(true);
    expect(router.getCurrentScreen()).toEqual({ name: "DASHBOARD" });

    const bottomPopped = router.goBack();
    expect(bottomPopped).toBe(false);
  });
});
