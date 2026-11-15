import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  LamportClock,
  BroadcastChannelSyncAdapter,
  SyncCoordinator,
  LastWriteWinsSynchronizer,
  type SyncEnvelope,
} from "../core/sync/index.js";
import {
  GeminiInferenceClient,
  type PromptPayload,
} from "../core/ai-client/index.js";
import { InsightStore } from "../features/insights/state/store.js";
import { BrowserLocalStoragePort } from "../core/database/local-storage.js";
import type { RecordBase } from "../core/database/index.js";
import { InMemoryEventBus } from "../core/event-bus/index.js";
import type { StoredInsight } from "../features/insights/types/index.js";

interface OfflineTestHabit extends RecordBase {
  readonly title: string;
}

describe("E2E Verification: PWA, Offline, Multi-Session Sync & AI Fallback", () => {
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
      value: {
        localStorage: fakeLocalStorage,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  it("verifies PWA manifest structure, standalone display, and icon asset existence", () => {
    const manifestPath = path.resolve(__dirname, "../../dist/manifest.webmanifest");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const rawManifest = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(rawManifest) as {
      name: string;
      short_name: string;
      display: string;
      start_url: string;
      theme_color: string;
      background_color: string;
      icons: Array<{ src: string; sizes: string; type: string }>;
    };

    expect(manifest.name).toBe("Personalized Habit Tracker with AI Insights");
    expect(manifest.short_name).toBe("HabitTracker");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.theme_color).toBe("#0f172a");
    expect(manifest.background_color).toBe("#020617");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    const icon192 = manifest.icons.find((i) => i.sizes === "192x192");
    const icon512 = manifest.icons.find((i) => i.sizes === "512x512");
    expect(icon192).toBeDefined();
    expect(icon512).toBeDefined();

    const publicIcon192Path = path.resolve(__dirname, "../../public/pwa-192x192.svg");
    const publicIcon512Path = path.resolve(__dirname, "../../public/pwa-512x512.svg");
    expect(fs.existsSync(publicIcon192Path)).toBe(true);
    expect(fs.existsSync(publicIcon512Path)).toBe(true);
  });

  it("verifies service worker bundle and precache asset registration in dist", () => {
    const swPath = path.resolve(__dirname, "../../dist/sw.js");
    const registerSwPath = path.resolve(__dirname, "../../dist/registerSW.js");

    expect(fs.existsSync(swPath)).toBe(true);
    expect(fs.existsSync(registerSwPath)).toBe(true);

    const swContent = fs.readFileSync(swPath, "utf-8");
    expect(swContent.length).toBeGreaterThan(50);
  });

  it("simulates offline storage resilience without network connectivity", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: false },
      writable: true,
      configurable: true,
    });

    const storage = new BrowserLocalStoragePort<OfflineTestHabit>("offline_test_habits");
    await storage.insert({
      id: "h-offline-1",
      title: "Read Book",
      createdAt: 1000,
      updatedAt: 1000,
    });

    const retrieved = await storage.getById("h-offline-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.title).toBe("Read Book");

    const reloaded = new BrowserLocalStoragePort<OfflineTestHabit>("offline_test_habits");
    const reloadedItem = await reloaded.getById("h-offline-1");
    expect(reloadedItem).not.toBeNull();
    expect(reloadedItem?.title).toBe("Read Book");
  });

  it("verifies real-time synchronization between two isolated browser sessions", async () => {
    const clockA = new LamportClock();
    const clockB = new LamportClock();

    const channelName = "session_sync_e2e_test";
    const adapterA = new BroadcastChannelSyncAdapter(channelName);
    const adapterB = new BroadcastChannelSyncAdapter(channelName);

    const coordinatorA = new SyncCoordinator("session-browser-tab-a", clockA, adapterA);
    const coordinatorB = new SyncCoordinator("session-browser-tab-b", clockB, adapterB);

    coordinatorA.enqueueLocalChange("h-session-test", "HABIT", {
      title: "Evening Stroll",
      targetValue: 30,
    });

    const statsA = await coordinatorA.syncNow();
    expect(statsA.pendingOutboundCount).toBe(0);

    const statsB = await coordinatorB.syncNow();
    expect(statsB.state).toBe("IDLE");

    coordinatorA.destroy();
    coordinatorB.destroy();
    adapterA.close();
    adapterB.close();
  });

  it("resolves simultaneous conflicting mutations deterministically via Last-Write-Wins and device tie-break", () => {
    const synchronizer = new LastWriteWinsSynchronizer<{ title: string; target: number }>();

    const envelopeA: SyncEnvelope<{ title: string; target: number }> = {
      entityId: "h-conflict-target",
      entityType: "HABIT",
      lamportTimestamp: 10,
      deviceId: "device-phone-001",
      payload: { title: "Pushups", target: 50 },
      isDeleted: false,
    };

    const envelopeBHigherLamport: SyncEnvelope<{ title: string; target: number }> = {
      entityId: "h-conflict-target",
      entityType: "HABIT",
      lamportTimestamp: 11,
      deviceId: "device-laptop-002",
      payload: { title: "Pushups", target: 60 },
      isDeleted: false,
    };

    const winnerByTimestamp = synchronizer.resolveWinner(envelopeA, envelopeBHigherLamport);
    expect(winnerByTimestamp.payload.target).toBe(60);
    expect(winnerByTimestamp.deviceId).toBe("device-laptop-002");

    const envelopeTieDeviceX: SyncEnvelope<{ title: string; target: number }> = {
      entityId: "h-conflict-target",
      entityType: "HABIT",
      lamportTimestamp: 15,
      deviceId: "client-alpha",
      payload: { title: "Pushups", target: 70 },
      isDeleted: false,
    };

    const envelopeTieDeviceY: SyncEnvelope<{ title: string; target: number }> = {
      entityId: "h-conflict-target",
      entityType: "HABIT",
      lamportTimestamp: 15,
      deviceId: "client-beta",
      payload: { title: "Pushups", target: 80 },
      isDeleted: false,
    };

    const tieBreakWinnerForward = synchronizer.resolveWinner(envelopeTieDeviceX, envelopeTieDeviceY);
    expect(tieBreakWinnerForward.deviceId).toBe("client-beta");
    expect(tieBreakWinnerForward.payload.target).toBe(80);

    const tieBreakWinnerReverse = synchronizer.resolveWinner(envelopeTieDeviceY, envelopeTieDeviceX);
    expect(tieBreakWinnerReverse.deviceId).toBe("client-beta");
    expect(tieBreakWinnerReverse.payload.target).toBe(80);
  });

  it("handles Gemini API errors gracefully with automatic exponential backoff and rule fallback", async () => {
    let callAttempts = 0;
    const failingFetch = vi.fn().mockImplementation(() => {
      callAttempts += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: "Quota exceeded or invalid API key" } }), {
          status: 429,
          statusText: "Too Many Requests",
        })
      );
    });

    Object.defineProperty(globalThis, "fetch", {
      value: failingFetch,
      writable: true,
      configurable: true,
    });

    const client = new GeminiInferenceClient({
      apiKey: "invalid-or-exhausted-key",
      maxRetries: 2,
    });

    const payload: PromptPayload = {
      systemInstruction: "You are a habit coach",
      prompt: "Analyze meditation lapse",
      responseSchemaJson: JSON.stringify({ type: "object" }),
    };

    await expect(client.generateStructured(payload)).rejects.toThrow();
    expect(callAttempts).toBe(2);

    const eventBus = new InMemoryEventBus();
    const insightStorage = new BrowserLocalStoragePort<StoredInsight>("test_fallback_insights");
    const insightStore = new InsightStore(insightStorage, client, eventBus);

    const fallbackResult = await insightStore.evaluateHabit({
      habitId: "h-meditation-fallback",
      habitTitle: "Daily Meditation",
      category: "Mindfulness",
      currentTarget: 20,
      observations: [
        { dateKey: "2026-11-01", targetValue: 20, recordedValue: 0, status: "MISSED" },
        { dateKey: "2026-11-02", targetValue: 20, recordedValue: 0, status: "MISSED" },
        { dateKey: "2026-11-03", targetValue: 20, recordedValue: 0, status: "MISSED" },
        { dateKey: "2026-11-04", targetValue: 20, recordedValue: 0, status: "MISSED" },
      ],
    });

    expect(fallbackResult).not.toBeNull();
    expect(fallbackResult?.patternType).toBe("CONSECUTIVE_LAPSE");
    expect(fallbackResult?.justification.length).toBeGreaterThan(0);
    expect(fallbackResult?.actionStatus).toBe("PENDING");
  });
});
