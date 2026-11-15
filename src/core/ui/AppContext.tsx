import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  InMemoryEventBus,
  LamportClock,
  StackNavigationRouter,
  BrowserLocalStoragePort,
  GeminiInferenceClient,
  MockAiInferenceClient,
  BroadcastChannelSyncAdapter,
  HttpRemoteSyncAdapter,
  SyncCoordinator,
  type AppScreen,
  type EventBusPort,
  type ClockPort,
  type NavigationPort,
  type SyncStats,
} from "../index.js";
import {
  HabitStore,
  type Habit,
  type HabitEntry,
} from "../../features/habits/index.js";
import {
  StreakStore,
  type StreakShield,
} from "../../features/streaks/index.js";
import {
  InsightStore,
  type StoredInsight,
} from "../../features/insights/index.js";

export interface AppContextValue {
  readonly habitStore: HabitStore;
  readonly streakStore: StreakStore;
  readonly insightStore: InsightStore;
  readonly eventBus: EventBusPort;
  readonly clock: ClockPort;
  readonly navigation: NavigationPort;
  readonly currentScreen: AppScreen;
  readonly activeDateKey: string;
  readonly setActiveDateKey: (dateKey: string) => void;
  readonly refreshCounter: number;
  readonly triggerRefresh: () => void;
  readonly syncCoordinator: SyncCoordinator;
  readonly syncStats: SyncStats;
  readonly syncNow: () => Promise<void>;
  readonly geminiApiKey: string;
  readonly setGeminiApiKey: (key: string) => void;
  readonly isAiLive: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

function createMockFallbackAi() {
  return new MockAiInferenceClient({
    habitId: "h-sample",
    patternDetected: "Midweek Routine Interruption",
    rootCauseHypothesis: "Work meetings are causing friction during afternoon habit time",
    severityLevel: "medium",
    suggestedAdjustment: {
      category: "shift_time",
      proposedTimeMinutes: 540,
      justification: "Shift habit to morning at 9:00 AM before meeting fatigue sets in",
    },
    encouragementMicroCopy: "Consistency is a trajectory, not a binary state.",
  });
}

function getOrCreateDeviceId(): string {
  const key = "habit_tracker_device_id";
  if (typeof window === "undefined" || !window.localStorage) {
    return "dev-node-instance";
  }
  const existing = window.localStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const created = `dev-${Math.random().toString(36).substring(2, 9)}`;
  window.localStorage.setItem(key, created);
  return created;
}

export function AppContextProvider({ children }: { readonly children: ReactNode }) {
  const [eventBus] = useState(() => new InMemoryEventBus());
  const [clock] = useState(() => new LamportClock());
  const [navigation] = useState(() => new StackNavigationRouter());
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(() => navigation.getCurrentScreen());
  const [refreshCounter, setRefreshCounter] = useState(0);

  const [geminiApiKey, setGeminiApiKeyState] = useState(() => {
    return GeminiInferenceClient.getStoredApiKey() ||
      (typeof import.meta !== "undefined" && import.meta.env?.VITE_GEMINI_API_KEY ? import.meta.env.VITE_GEMINI_API_KEY : "");
  });

  const getTodayDateKey = () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const [activeDateKey, setActiveDateKey] = useState(getTodayDateKey);

  const [habitStore] = useState(() => {
    const habitStorage = new BrowserLocalStoragePort<Habit>("habits");
    const entryStorage = new BrowserLocalStoragePort<HabitEntry>("entries");
    return new HabitStore(habitStorage, entryStorage, eventBus, clock);
  });

  const [streakStore] = useState(() => {
    const shieldStorage = new BrowserLocalStoragePort<StreakShield>("shields");
    return new StreakStore(shieldStorage, eventBus);
  });

  const [insightStore, setInsightStore] = useState(() => {
    const insightStorage = new BrowserLocalStoragePort<StoredInsight>("insights");
    const initialClient = geminiApiKey.length > 0
      ? new GeminiInferenceClient({ apiKey: geminiApiKey })
      : createMockFallbackAi();
    return new InsightStore(insightStorage, initialClient, eventBus);
  });

  const setGeminiApiKey = (key: string) => {
    GeminiInferenceClient.storeApiKeyLocally(key);
    setGeminiApiKeyState(key);
    const insightStorage = new BrowserLocalStoragePort<StoredInsight>("insights");
    const newClient = key.trim().length > 0
      ? new GeminiInferenceClient({ apiKey: key.trim() })
      : createMockFallbackAi();
    setInsightStore(new InsightStore(insightStorage, newClient, eventBus));
    triggerRefresh();
  };

  const [syncCoordinator] = useState(() => {
    const deviceId = getOrCreateDeviceId();
    const remoteUrl = typeof import.meta !== "undefined" && import.meta.env?.VITE_REMOTE_SYNC_URL
      ? import.meta.env.VITE_REMOTE_SYNC_URL
      : "";
    const adapter = remoteUrl.length > 0
      ? new HttpRemoteSyncAdapter({ endpointUrl: remoteUrl })
      : new BroadcastChannelSyncAdapter();
    return new SyncCoordinator(deviceId, clock, adapter, eventBus);
  });

  const [syncStats, setSyncStats] = useState<SyncStats>(() => syncCoordinator.getStats());

  const syncNow = async () => {
    const updated = await syncCoordinator.syncNow();
    setSyncStats(updated);
    triggerRefresh();
  };

  const triggerRefresh = () => {
    setRefreshCounter((prev) => prev + 1);
  };

  useEffect(() => {
    const unsubscribeNav = navigation.subscribe((screen) => {
      setCurrentScreen(screen);
    });

    const unsubscribeHabitCreated = eventBus.subscribe("HABIT_CREATED", () => {
      setSyncStats(syncCoordinator.getStats());
      triggerRefresh();
    });
    const unsubscribeHabitCompleted = eventBus.subscribe("HABIT_COMPLETED", () => {
      setSyncStats(syncCoordinator.getStats());
      triggerRefresh();
    });
    const unsubscribeHabitSkipped = eventBus.subscribe("HABIT_SKIPPED", () => {
      setSyncStats(syncCoordinator.getStats());
      triggerRefresh();
    });
    const unsubscribeShieldApplied = eventBus.subscribe("STREAK_SHIELD_APPLIED", () => triggerRefresh());
    const unsubscribeInsightGenerated = eventBus.subscribe("INSIGHT_GENERATED", () => triggerRefresh());
    const unsubscribeSyncApplied = eventBus.subscribe("SYNC_APPLIED", () => {
      setSyncStats(syncCoordinator.getStats());
      triggerRefresh();
    });

    return () => {
      unsubscribeNav();
      unsubscribeHabitCreated();
      unsubscribeHabitCompleted();
      unsubscribeHabitSkipped();
      unsubscribeShieldApplied();
      unsubscribeInsightGenerated();
      unsubscribeSyncApplied();
    };
  }, [eventBus, navigation, syncCoordinator]);

  const value: AppContextValue = {
    habitStore,
    streakStore,
    insightStore,
    eventBus,
    clock,
    navigation,
    currentScreen,
    activeDateKey,
    setActiveDateKey,
    refreshCounter,
    triggerRefresh,
    syncCoordinator,
    syncStats,
    syncNow,
    geminiApiKey,
    setGeminiApiKey,
    isAiLive: geminiApiKey.length > 0,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within an AppContextProvider");
  }
  return context;
}
