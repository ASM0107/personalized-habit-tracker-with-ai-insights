import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  LamportClock,
  BroadcastChannelSyncAdapter,
  HttpRemoteSyncAdapter,
  SyncCoordinator,
  type SyncEnvelope,
  type RemoteSyncPort,
} from "../core/sync/index.js";
import { GeminiInferenceClient } from "../core/ai-client/index.js";

describe("Remote Cloud Sync & AI Key Configuration Verification", () => {
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

  it("verifies BroadcastChannelSyncAdapter delivers envelopes across peer clients", async () => {
    const adapterA = new BroadcastChannelSyncAdapter("peer_test_channel");

    const envelopes: SyncEnvelope<{ title: string }>[] = [
      {
        entityId: "h-meditation",
        entityType: "HABIT",
        lamportTimestamp: 10,
        deviceId: "device-alpha",
        payload: { title: "Meditation" },
        isDeleted: false,
      },
    ];

    const pushResult = await adapterA.pushEnvelopes(envelopes);
    expect(pushResult.success).toBe(true);
    expect(pushResult.committedCount).toBe(1);
    expect(pushResult.serverLamportTimestamp).toBe(10);

    const pulled = await adapterA.pullEnvelopes(5);
    expect(pulled.length).toBe(1);
    expect(pulled[0]?.entityId).toBe("h-meditation");

    const nonePulled = await adapterA.pullEnvelopes(15);
    expect(nonePulled.length).toBe(0);
  });

  it("verifies HttpRemoteSyncAdapter communicates over network protocol", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedBody = (init?.body as string) ?? "";

      if (url.includes("/push")) {
        return Promise.resolve(
          new Response(JSON.stringify({ committedCount: 1, serverLamportTimestamp: 42 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      if (url.includes("/pull")) {
        const dummyEnvelope: SyncEnvelope<{ title: string }> = {
          entityId: "pulled-h1",
          entityType: "HABIT",
          lamportTimestamp: 42,
          deviceId: "remote-server",
          payload: { title: "Remote Synced Habit" },
          isDeleted: false,
        };
        return Promise.resolve(
          new Response(JSON.stringify({ envelopes: [dummyEnvelope], latestServerTimestamp: 42 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      return Promise.reject(new Error("Unknown route"));
    });

    Object.defineProperty(globalThis, "fetch", {
      value: mockFetch,
      writable: true,
      configurable: true,
    });

    const adapter = new HttpRemoteSyncAdapter({
      endpointUrl: "https://api.example.com/sync",
      authToken: "test-auth-token-123",
    });

    const pushRes = await adapter.pushEnvelopes([
      {
        entityId: "local-h1",
        entityType: "HABIT",
        lamportTimestamp: 1,
        deviceId: "local-dev",
        payload: { title: "Local Habit" },
        isDeleted: false,
      },
    ]);

    expect(pushRes.success).toBe(true);
    expect(pushRes.serverLamportTimestamp).toBe(42);
    expect(capturedUrl).toBe("https://api.example.com/sync/push");
    expect(capturedHeaders["Authorization"]).toBe("Bearer test-auth-token-123");
    expect(capturedBody).toContain("local-h1");

    const pullRes = await adapter.pullEnvelopes(0);
    expect(pullRes.length).toBe(1);
    expect(pullRes[0]?.entityId).toBe("pulled-h1");
  });

  it("verifies SyncCoordinator manages online/offline states and transitions", async () => {
    const clock = new LamportClock();
    const mockAdapter = new BroadcastChannelSyncAdapter("sync_coordinator_test_channel");
    const coordinator = new SyncCoordinator("test-device-coord", clock, mockAdapter);

    expect(coordinator.getStats().state).toBe("IDLE");
    expect(coordinator.getStats().pendingOutboundCount).toBe(0);

    coordinator.enqueueLocalChange("habit-1", "HABIT", { title: "Coord Habit" });
    expect(coordinator.getStats().pendingOutboundCount).toBe(1);

    const statsAfterSync = await coordinator.syncNow();
    expect(statsAfterSync.state).toBe("IDLE");
    expect(statsAfterSync.pendingOutboundCount).toBe(0);

    coordinator.destroy();
  });

  it("verifies GeminiInferenceClient storage persistence and fallback logic", () => {
    expect(GeminiInferenceClient.getStoredApiKey()).toBe("");

    GeminiInferenceClient.storeApiKeyLocally("test-gemini-key-12345");
    expect(GeminiInferenceClient.getStoredApiKey()).toBe("test-gemini-key-12345");

    const clientWithStoredKey = new GeminiInferenceClient();
    expect(clientWithStoredKey.hasApiKey()).toBe(true);

    GeminiInferenceClient.storeApiKeyLocally("");
    expect(GeminiInferenceClient.getStoredApiKey()).toBe("");

    const clientWithoutKey = new GeminiInferenceClient({ apiKey: "" });
    expect(clientWithoutKey.hasApiKey()).toBe(false);
  });

  it("verifies GeminiInferenceClient delegates to server gateway without leaking credentials", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedMethod = "";

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? "GET";
      capturedBody = (init?.body as string) ?? "";
      return Promise.resolve(
        new Response(JSON.stringify({ data: { message: "Server gateway success", status: "ok" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    Object.defineProperty(globalThis, "fetch", {
      value: mockFetch,
      writable: true,
      configurable: true,
    });

    const client = new GeminiInferenceClient({ apiKey: "" });
    expect(client.isUsingServerGateway()).toBe(true);

    const payload = {
      systemInstruction: "System test instruction",
      prompt: "Test user prompt",
      responseSchemaJson: JSON.stringify({ type: "object" }),
    };

    const result = await client.generateStructured<{ message: string; status: string }>(payload);
    expect(result.status).toBe("ok");
    expect(result.message).toBe("Server gateway success");

    expect(capturedUrl).toBe("/api/ai/infer");
    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).not.toContain("key=");
    expect(capturedBody).not.toContain("apiKey");
  });

  it("persists offline sync outbound queue across coordinator reloads", async () => {
    const clock = new LamportClock();
    const dummyAdapter: RemoteSyncPort = {
      pushEnvelopes: async () => ({ success: false, committedCount: 0, serverLamportTimestamp: 0, error: "offline" }),
      pullEnvelopes: async () => [],
      subscribeToRemote: () => () => {},
    };

    const coord1 = new SyncCoordinator("persisted-device-1", clock, dummyAdapter);
    coord1.enqueueLocalChange("offline-h1", "HABIT", { title: "Offline Habit 1" });
    coord1.enqueueLocalChange("offline-h2", "HABIT", { title: "Offline Habit 2" });
    expect(coord1.getStats().pendingOutboundCount).toBe(2);

    const coord2 = new SyncCoordinator("persisted-device-1", clock, dummyAdapter);
    expect(coord2.getStats().pendingOutboundCount).toBe(2);

    coord1.destroy();
    coord2.destroy();
  });

  it("dispatches incoming remote sync envelopes to registered local entity appliers", async () => {
    const clock = new LamportClock();
    const localDatabase = new Map<string, any>();

    const dummyAdapter: RemoteSyncPort = {
      pushEnvelopes: async () => ({ success: true, committedCount: 0, serverLamportTimestamp: 10 }),
      pullEnvelopes: async () => [
        {
          entityId: "remote-applied-habit",
          entityType: "HABIT",
          lamportTimestamp: 15,
          deviceId: "remote-cloud",
          payload: { id: "remote-applied-habit", title: "Cloud Pulled Habit" },
          isDeleted: false,
        },
      ],
      subscribeToRemote: () => () => {},
    };

    const coordinator = new SyncCoordinator("inbound-test-device", clock, dummyAdapter);
    coordinator.registerApplier("HABIT", async (env) => {
      localDatabase.set(env.entityId, env.payload);
    });

    const stats = await coordinator.syncNow();
    expect(stats.state).toBe("IDLE");
    expect(localDatabase.has("remote-applied-habit")).toBe(true);
    expect(localDatabase.get("remote-applied-habit").title).toBe("Cloud Pulled Habit");

    coordinator.destroy();
  });

  it("transitions SyncCoordinator into ERROR state when pull request fails", async () => {
    const clock = new LamportClock();
    const failingAdapter: RemoteSyncPort = {
      pushEnvelopes: async () => ({ success: true, committedCount: 0, serverLamportTimestamp: 0 }),
      pullEnvelopes: async () => {
        throw new Error("500 Internal Server Error");
      },
      subscribeToRemote: () => () => {},
    };

    const coordinator = new SyncCoordinator("failing-pull-device", clock, failingAdapter);
    const stats = await coordinator.syncNow();
    expect(stats.state).toBe("ERROR");
    expect(stats.lastError).toContain("500 Internal Server Error");

    coordinator.destroy();
  });
});
