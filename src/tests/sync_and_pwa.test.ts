import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  LamportClock,
  BroadcastChannelSyncAdapter,
  HttpRemoteSyncAdapter,
  SyncCoordinator,
  type SyncEnvelope,
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
    const adapterB = new BroadcastChannelSyncAdapter("peer_test_channel");

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

    adapterA.close();
    adapterB.close();
  });

  it("verifies HttpRemoteSyncAdapter pushes and pulls envelopes with mock HTTP endpoint", async () => {
    const mockEnvelopes: SyncEnvelope<unknown>[] = [
      {
        entityId: "h-journaling",
        entityType: "HABIT",
        lamportTimestamp: 42,
        deviceId: "dev-phone",
        payload: { title: "Journaling" },
        isDeleted: false,
      },
    ];

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/push") && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              committedCount: 1,
              serverLamportTimestamp: 42,
            }),
            { status: 200 }
          )
        );
      }
      if (url.includes("/pull") && (!init || init.method === "GET")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              envelopes: mockEnvelopes,
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    });

    Object.defineProperty(globalThis, "fetch", {
      value: fetchMock,
      writable: true,
      configurable: true,
    });

    const httpAdapter = new HttpRemoteSyncAdapter({
      endpointUrl: "https://sync.test.local/v1",
      authToken: "test-secret-token",
    });

    const pushResult = await httpAdapter.pushEnvelopes(mockEnvelopes);
    expect(pushResult.success).toBe(true);
    expect(pushResult.committedCount).toBe(1);
    expect(pushResult.serverLamportTimestamp).toBe(42);

    const pulled = await httpAdapter.pullEnvelopes(10);
    expect(pulled.length).toBe(1);
    expect(pulled[0]?.entityId).toBe("h-journaling");
  });

  it("verifies SyncCoordinator manages outbound queues and tracks sync statistics", async () => {
    const clock = new LamportClock();
    const adapter = new BroadcastChannelSyncAdapter("coord_test_channel");
    const coordinator = new SyncCoordinator("device-test-node", clock, adapter);

    const initialStats = coordinator.getStats();
    expect(initialStats.state).toBe("IDLE");
    expect(initialStats.pendingOutboundCount).toBe(0);

    coordinator.enqueueLocalChange("h-stretch", "HABIT", { title: "Stretching" });
    coordinator.enqueueLocalChange("h-hydrate", "HABIT", { title: "Hydration" });

    const queuedStats = coordinator.getStats();
    expect(queuedStats.pendingOutboundCount).toBe(2);

    const syncStats = await coordinator.syncNow();
    expect(syncStats.state).toBe("IDLE");
    expect(syncStats.pendingOutboundCount).toBe(0);
    expect(syncStats.lastSyncedLamport).toBeGreaterThan(0);

    coordinator.destroy();
  });

  it("verifies GeminiInferenceClient dynamic key configuration and localStorage persistence", () => {
    GeminiInferenceClient.storeApiKeyLocally("AIzaSyTestKey123");
    expect(GeminiInferenceClient.getStoredApiKey()).toBe("AIzaSyTestKey123");

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
});
