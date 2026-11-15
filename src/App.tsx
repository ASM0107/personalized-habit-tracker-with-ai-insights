import { useState, useEffect } from "react";
import { useAppContext } from "./core/ui/AppContext.js";
import { AppSettingsModal } from "./core/ui/AppSettingsModal.js";
import {
  HabitCardView,
  HabitFormModal,
  HabitScheduler,
  type CreateHabitInput,
  type Habit,
  type HabitEntry,
} from "./features/habits/index.js";
import {
  MomentumDashboardView,
  type ResilienceMetrics,
  type StreakShield,
} from "./features/streaks/index.js";
import {
  InsightsDashboardView,
  type StoredInsight,
  type InsightStats,
  type BehaviorObservation,
} from "./features/insights/index.js";
import {
  AnalyticsDashboardView,
  ConsistencyAggregator,
  type SystemAnalyticsOverview,
  type LoggedDayRecord,
} from "./features/analytics/index.js";

type NavTab = "DASHBOARD" | "MOMENTUM" | "INSIGHTS" | "ANALYTICS";

export function App() {
  const {
    habitStore,
    streakStore,
    insightStore,
    activeDateKey,
    setActiveDateKey,
    refreshCounter,
    triggerRefresh,
    syncCoordinator,
    syncStats,
    isAiLive,
  } = useAppContext();

  const [activeTab, setActiveTab] = useState<NavTab>("DASHBOARD");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [habits, setHabits] = useState<readonly Habit[]>([]);
  const [entriesMap, setEntriesMap] = useState<ReadonlyMap<string, HabitEntry>>(new Map());
  const [metricsList, setMetricsList] = useState<readonly ResilienceMetrics[]>([]);
  const [activeShields, setActiveShields] = useState<readonly StreakShield[]>([]);
  const [consumedShields, setConsumedShields] = useState<readonly StreakShield[]>([]);
  const [insightsList, setInsightsList] = useState<readonly StoredInsight[]>([]);
  const [insightStats, setInsightStats] = useState<InsightStats>({
    totalGenerated: 0,
    totalApplied: 0,
    totalDismissed: 0,
    acceptanceRate: 0,
  });
  const [analyticsOverview, setAnalyticsOverview] = useState<SystemAnalyticsOverview>({
    overallCompletionRate: 0,
    totalTrackedHabits: 0,
    bestDayOfWeekOverall: "Monday",
    habitSummaries: [],
    correlations: [],
    generatedAt: Date.now(),
  });

  const habitTitles = new Map<string, string>();
  for (const h of habits) {
    habitTitles.set(h.id, h.title);
  }

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      const activeHabits = await habitStore.getAllActiveHabits();
      if (!isMounted) return;
      setHabits(activeHabits);

      const newEntriesMap = new Map<string, HabitEntry>();
      const recordsByHabit = new Map<string, LoggedDayRecord[]>();

      for (const habit of activeHabits) {
        const habitEntries = await habitStore.getEntriesForHabit(habit.id);
        const mappedRecords: LoggedDayRecord[] = [];

        for (const entry of habitEntries) {
          if (entry.dateKey === activeDateKey) {
            newEntriesMap.set(habit.id, entry);
          }
          mappedRecords.push({
            dateKey: entry.dateKey,
            isCompleted: entry.status === "COMPLETED",
            recordedValue: entry.recordedValue,
            targetValue: entry.targetValueSnapshot,
          });
        }
        recordsByHabit.set(habit.id, mappedRecords);
      }
      setEntriesMap(newEntriesMap);

      const metricsPromises = activeHabits.map((h) => streakStore.getResilienceMetrics(h.id));
      const resolvedMetrics = await Promise.all(metricsPromises);
      setMetricsList(resolvedMetrics);

      const allActiveShields: StreakShield[] = [];
      const allConsumedShields: StreakShield[] = [];
      for (const h of activeHabits) {
        const active = await streakStore.getActiveShields(h.id);
        const consumed = await streakStore.getConsumedShields(h.id);
        allActiveShields.push(...active);
        allConsumedShields.push(...consumed);
      }
      setActiveShields(allActiveShields);
      setConsumedShields(allConsumedShields);

      const allInsights: StoredInsight[] = [];
      for (const h of activeHabits) {
        const ins = await insightStore.getAllInsights(h.id);
        allInsights.push(...ins);
      }
      setInsightsList(allInsights);

      const stats = await insightStore.getInsightStats();
      setInsightStats(stats);

      const habitMetas = activeHabits.map((h) => ({ id: h.id, title: h.title }));
      const overview = ConsistencyAggregator.generateSystemOverview(habitMetas, recordsByHabit);
      setAnalyticsOverview(overview);
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [habitStore, streakStore, insightStore, activeDateKey, refreshCounter]);

  const handleCreateHabit = async (input: CreateHabitInput) => {
    const created = await habitStore.createHabit(input);
    syncCoordinator.enqueueLocalChange(created.id, "HABIT", created);
    triggerRefresh();
  };

  const handleCheckIn = async (habitId: string, value: number, isIncremental: boolean) => {
    const entry = await habitStore.recordCheckIn({
      habitId,
      dateKey: activeDateKey,
      recordedValue: value,
      isIncremental,
    });
    syncCoordinator.enqueueLocalChange(entry.id, "HABIT_ENTRY", entry);
    triggerRefresh();
  };

  const handleSkip = async (habitId: string, reason: string) => {
    const entry = await habitStore.skipHabit(habitId, activeDateKey, reason);
    syncCoordinator.enqueueLocalChange(entry.id, "HABIT_ENTRY", entry);
    triggerRefresh();
  };

  const handleDeleteHabit = async (habitId: string) => {
    await habitStore.deleteHabit(habitId);
    syncCoordinator.enqueueLocalChange(habitId, "HABIT", null, true);
    triggerRefresh();
  };

  const handleAllocateShield = async (habitId: string, reason: string) => {
    await streakStore.allocateShield(habitId, reason);
    triggerRefresh();
  };

  const handleApplyInsight = async (insight: StoredInsight) => {
    await insightStore.applyInsight(insight.id);
    if (insight.proposedNewTarget !== undefined) {
      await habitStore.updateHabit(insight.habitId, {
        targetValue: insight.proposedNewTarget,
      });
    }
    triggerRefresh();
  };

  const handleDismissInsight = async (insightId: string) => {
    await insightStore.dismissInsight(insightId);
    triggerRefresh();
  };

  const handleTriggerEvaluation = async (habitId: string) => {
    const habit = await habitStore.getHabit(habitId);
    if (!habit) return;

    const entries = await habitStore.getEntriesForHabit(habitId);
    const observations: BehaviorObservation[] = entries.map((e) => ({
      dateKey: e.dateKey,
      recordedValue: e.recordedValue,
      targetValue: e.targetValueSnapshot,
      status: e.status,
    }));

    await insightStore.evaluateHabit({
      habitId,
      habitTitle: habit.title,
      category: habit.category,
      currentTarget: habit.targetValue,
      ...(habit.unit ? { unit: habit.unit } : {}),
      observations,
    }, true);

    triggerRefresh();
  };

  const handleSeedSampleData = async () => {
    const existingHabits = await habitStore.getAllActiveHabits();
    for (const h of existingHabits) {
      await habitStore.deleteHabit(h.id);
    }
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem("habit_tracker_insights");
      window.localStorage.removeItem("habit_tracker_shields");
    }

    const today = new Date();
    const formatDate = (offsetDays: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - offsetDays);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dt = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dt}`;
    };

    const h1 = await habitStore.createHabit({
      id: "sample-meditation",
      title: "Morning Meditation",
      category: "Mindfulness",
      targetType: "DURATION",
      targetValue: 20,
      unit: "mins",
      schedule: HabitScheduler.createDailySchedule(formatDate(14)),
    });

    const h2 = await habitStore.createHabit({
      id: "sample-workout",
      title: "Morning Workout",
      category: "Fitness",
      targetType: "DURATION",
      targetValue: 30,
      unit: "mins",
      schedule: HabitScheduler.createDailySchedule(formatDate(14)),
    });

    const h3 = await habitStore.createHabit({
      id: "sample-hydration",
      title: "Daily Hydration",
      category: "Health",
      targetType: "NUMERIC",
      targetValue: 8,
      unit: "glasses",
      schedule: HabitScheduler.createDailySchedule(formatDate(14)),
    });

    const h4 = await habitStore.createHabit({
      id: "sample-reading",
      title: "Evening Reading",
      category: "Personal Growth",
      targetType: "DURATION",
      targetValue: 30,
      unit: "mins",
      schedule: HabitScheduler.createDailySchedule(formatDate(14)),
    });

    for (let dayOffset = 14; dayOffset >= 1; dayOffset -= 1) {
      const dateKey = formatDate(dayOffset);
      const isWorkCrunch = dayOffset <= 3;
      const isWeekendRest = dayOffset === 7 || dayOffset === 6;

      if (isWorkCrunch) {
        await habitStore.skipHabit(h4.id, dateKey, "Late work meetings");
        await habitStore.skipHabit(h2.id, dateKey, "Fatigue from late night");
        await habitStore.recordCheckIn({ habitId: h3.id, dateKey, recordedValue: 4 });
        if (dayOffset <= 2) {
          await habitStore.skipHabit(h1.id, dateKey, "Rushed morning");
        } else {
          await habitStore.recordCheckIn({ habitId: h1.id, dateKey, recordedValue: 20 });
        }
      } else if (isWeekendRest) {
        await habitStore.recordCheckIn({ habitId: h1.id, dateKey, recordedValue: 20 });
        await habitStore.skipHabit(h2.id, dateKey, "Weekend recovery rest");
        await habitStore.recordCheckIn({ habitId: h3.id, dateKey, recordedValue: 8 });
        await habitStore.recordCheckIn({ habitId: h4.id, dateKey, recordedValue: 30 });
      } else {
        await habitStore.recordCheckIn({ habitId: h1.id, dateKey, recordedValue: 20 });
        await habitStore.recordCheckIn({ habitId: h2.id, dateKey, recordedValue: 30 });
        await habitStore.recordCheckIn({ habitId: h3.id, dateKey, recordedValue: 8 });
        await habitStore.recordCheckIn({ habitId: h4.id, dateKey, recordedValue: 30 });
      }
    }

    triggerRefresh();
  };

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-badge">Dune</div>
          <div>
            <h1>Personalized Habit Tracker</h1>
            <span className="brand-subtitle">AI-Powered Resilience & Consistency Engine</span>
          </div>
        </div>

        <div className="header-controls">
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="btn btn-outline status-pill-btn"
            title="Configure Cloud Sync & Gemini AI Engine"
          >
            <span className={`status-indicator ${isAiLive ? "indicator-live" : "indicator-fallback"}`} />
            <span>AI: {isAiLive ? "Gemini Live" : "Local Rules"}</span>
            <span className="pill-separator">•</span>
            <span>Sync: {syncStats.state === "IDLE" ? "Synced" : syncStats.state}</span>
          </button>

          <div className="date-picker-group">
            <span className="control-label">Tracking Date:</span>
            <input
              type="date"
              value={activeDateKey}
              onChange={(e) => setActiveDateKey(e.target.value)}
              className="ui-input date-input"
            />
          </div>

          <button
            type="button"
            onClick={() => setIsFormOpen(true)}
            className="btn btn-primary"
          >
            + New Habit
          </button>
        </div>
      </header>

      <nav className="tab-navigation">
        <button
          type="button"
          onClick={() => setActiveTab("DASHBOARD")}
          className={`tab-btn ${activeTab === "DASHBOARD" ? "tab-active" : ""}`}
        >
          Daily Habits ({habits.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("MOMENTUM")}
          className={`tab-btn ${activeTab === "MOMENTUM" ? "tab-active" : ""}`}
        >
          Momentum & Shields ({metricsList.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("INSIGHTS")}
          className={`tab-btn ${activeTab === "INSIGHTS" ? "tab-active" : ""}`}
        >
          AI Coaching ({insightsList.filter((i) => i.actionStatus === "PENDING").length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("ANALYTICS")}
          className={`tab-btn ${activeTab === "ANALYTICS" ? "tab-active" : ""}`}
        >
          Analytics & Heatmap
        </button>
      </nav>

      <main className="app-main-content">
        {activeTab === "DASHBOARD" && (
          <div className="dashboard-view">
            {habits.length === 0 ? (
              <div className="empty-state-welcome">
                <h2>Welcome to Your Habit Resilience System</h2>
                <p>
                  Built on the Dune Framework for Agents, measuring long-term trajectory rather
                  than binary streak perfection.
                </p>
                <div className="button-group">
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(true)}
                    className="btn btn-primary"
                  >
                    Create First Habit
                  </button>
                  <button
                    type="button"
                    onClick={handleSeedSampleData}
                    className="btn btn-outline"
                  >
                    Load 14-Day Sample Demo Data
                  </button>
                </div>
              </div>
            ) : (
              <div className="habits-cards-grid">
                {habits.map((habit) => (
                  <HabitCardView
                    key={habit.id}
                    habit={habit}
                    entry={entriesMap.get(habit.id) || null}
                    onCheckIn={handleCheckIn}
                    onSkip={handleSkip}
                    onDelete={handleDeleteHabit}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "MOMENTUM" && (
          <MomentumDashboardView
            metrics={metricsList}
            habitTitles={habitTitles}
            activeShields={activeShields}
            consumedShields={consumedShields}
            onAllocateShield={handleAllocateShield}
          />
        )}

        {activeTab === "INSIGHTS" && (
          <InsightsDashboardView
            insights={insightsList}
            stats={insightStats}
            habitTitles={habitTitles}
            onApplyInsight={handleApplyInsight}
            onDismissInsight={handleDismissInsight}
            onTriggerEvaluation={handleTriggerEvaluation}
          />
        )}

        {activeTab === "ANALYTICS" && (
          <AnalyticsDashboardView
            overview={analyticsOverview}
            habitTitles={habitTitles}
          />
        )}
      </main>

      <HabitFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={handleCreateHabit}
        defaultStartDateKey={activeDateKey}
      />

      <AppSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
