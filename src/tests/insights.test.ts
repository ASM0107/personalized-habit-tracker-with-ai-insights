import { describe, it, expect } from "vitest";
import {
  InMemoryEventBus,
  InMemoryStoragePort,
  MockAiInferenceClient,
} from "../core/index.js";
import {
  BehavioralPatternDetector,
  InsightStore,
  InsightViewPresenter,
  type StoredInsight,
  type HabitInsightResponse,
  type BehaviorObservation,
  type InsightEvaluationContext,
} from "../features/insights/index.js";

describe("Intelligence Engine Phase 4", () => {
  it("detects varied behavioural friction patterns deterministically", () => {
    const consecutiveLapseObs: BehaviorObservation[] = [
      { dateKey: "2026-11-10", recordedValue: 1, targetValue: 1, status: "COMPLETED" },
      { dateKey: "2026-11-11", recordedValue: 0, targetValue: 1, status: "MISSED" },
      { dateKey: "2026-11-12", recordedValue: 0, targetValue: 1, status: "SKIPPED" },
      { dateKey: "2026-11-13", recordedValue: 0, targetValue: 1, status: "MISSED" },
    ];
    const lapse = BehavioralPatternDetector.detectPrimaryPattern(consecutiveLapseObs);
    expect(lapse.patternType).toBe("CONSECUTIVE_LAPSE");
    expect(lapse.severityLevel).toBe("high");

    const overreachObs: BehaviorObservation[] = [
      { dateKey: "2026-11-10", recordedValue: 10, targetValue: 30, status: "PARTIAL" },
      { dateKey: "2026-11-11", recordedValue: 15, targetValue: 30, status: "PARTIAL" },
      { dateKey: "2026-11-12", recordedValue: 10, targetValue: 30, status: "PARTIAL" },
    ];
    const overreach = BehavioralPatternDetector.detectPrimaryPattern(overreachObs);
    expect(overreach.patternType).toBe("TARGET_OVERREACH");
    expect(overreach.severityLevel).toBe("medium");

    const weekendObs: BehaviorObservation[] = [
      { dateKey: "2026-11-07", recordedValue: 0, targetValue: 1, status: "MISSED" },
      { dateKey: "2026-11-08", recordedValue: 0, targetValue: 1, status: "SKIPPED" },
      { dateKey: "2026-11-09", recordedValue: 1, targetValue: 1, status: "COMPLETED" },
    ];
    const weekend = BehavioralPatternDetector.detectPrimaryPattern(weekendObs);
    expect(weekend.patternType).toBe("WEEKEND_DROPOFF");
  });

  it("handles AI structured generation with cooldown and signature deduplication", async () => {
    const insightStorage = new InMemoryStoragePort<StoredInsight>();
    const eventBus = new InMemoryEventBus();

    const mockAiResponse: HabitInsightResponse = {
      habitId: "h-running",
      patternDetected: "Three consecutive missed days",
      rootCauseHypothesis: "Target of 10km is causing fatigue after strenuous workdays",
      severityLevel: "high",
      suggestedAdjustment: {
        category: "downscale_target",
        proposedNewTarget: 5,
        justification: "Downscaling target to 5km will rebuild momentum safely",
      },
      encouragementMicroCopy: "Every step counts. Regain your rhythm!",
    };

    const mockAiClient = new MockAiInferenceClient(mockAiResponse);
    const store = new InsightStore(insightStorage, mockAiClient, eventBus, {
      cooldownPeriodMs: 60000,
    });

    const context: InsightEvaluationContext = {
      habitId: "h-running",
      habitTitle: "10km Run",
      category: "Fitness",
      currentTarget: 10,
      unit: "km",
      observations: [
        { dateKey: "2026-11-11", recordedValue: 0, targetValue: 10, status: "SKIPPED" },
        { dateKey: "2026-11-12", recordedValue: 0, targetValue: 10, status: "SKIPPED" },
        { dateKey: "2026-11-13", recordedValue: 0, targetValue: 10, status: "MISSED" },
      ],
    };

    const firstResult = await store.evaluateHabit(context);
    expect(firstResult).not.toBeNull();
    expect(firstResult?.category).toBe("downscale_target");
    expect(firstResult?.proposedNewTarget).toBe(5);

    const throttledResult = await store.evaluateHabit(context);
    expect(throttledResult).toBeNull();

    const forcedCachedResult = await store.evaluateHabit(context, true);
    expect(forcedCachedResult?.id).toBe(firstResult?.id);
  });

  it("degrades gracefully to rule-based fallback recommendations when AI client fails", async () => {
    const insightStorage = new InMemoryStoragePort<StoredInsight>();
    const eventBus = new InMemoryEventBus();

    const failingAiClient = {
      generateStructured: async () => {
        throw new Error("Quota exceeded 429");
      },
    };

    const store = new InsightStore(insightStorage, failingAiClient, eventBus);

    const context: InsightEvaluationContext = {
      habitId: "h-meditation",
      habitTitle: "Daily Meditation",
      category: "Wellness",
      currentTarget: 20,
      unit: "mins",
      observations: [
        { dateKey: "2026-11-11", recordedValue: 5, targetValue: 20, status: "PARTIAL" },
        { dateKey: "2026-11-12", recordedValue: 8, targetValue: 20, status: "PARTIAL" },
        { dateKey: "2026-11-13", recordedValue: 5, targetValue: 20, status: "PARTIAL" },
      ],
    };

    const fallbackResult = await store.evaluateHabit(context);
    expect(fallbackResult).not.toBeNull();
    expect(fallbackResult?.category).toBe("downscale_target");
    expect(fallbackResult?.proposedNewTarget).toBe(12);
  });

  it("tracks insight actions, acceptance rates, and generates presentation cards", async () => {
    const insightStorage = new InMemoryStoragePort<StoredInsight>();
    const eventBus = new InMemoryEventBus();

    const mockAiResponse: HabitInsightResponse = {
      habitId: "h-code",
      patternDetected: "Late night fatigue",
      rootCauseHypothesis: "Late hour coding is clashing with sleep schedule",
      severityLevel: "medium",
      suggestedAdjustment: {
        category: "shift_time",
        proposedTimeMinutes: 480,
        justification: "Shift coding session to 8:00 AM before work meetings",
      },
      encouragementMicroCopy: "Fresh mind, cleaner code.",
    };

    const mockAiClient = new MockAiInferenceClient(mockAiResponse);
    const store = new InsightStore(insightStorage, mockAiClient, eventBus);

    const context: InsightEvaluationContext = {
      habitId: "h-code",
      habitTitle: "Project Coding",
      category: "Engineering",
      currentTarget: 60,
      unit: "mins",
      observations: [
        { dateKey: "2026-11-11", recordedValue: 0, targetValue: 60, status: "SKIPPED" },
        { dateKey: "2026-11-12", recordedValue: 0, targetValue: 60, status: "SKIPPED" },
        { dateKey: "2026-11-13", recordedValue: 0, targetValue: 60, status: "MISSED" },
      ],
    };

    const insight = await store.evaluateHabit(context);
    expect(insight).not.toBeNull();

    const pending = await store.getPendingInsights("h-code");
    expect(pending.length).toBe(1);

    const card = InsightViewPresenter.presentInsightCard(pending[0]!);
    expect(card.cardTitle).toBe("Recommended Time Adjustment");
    expect(card.statusLabel).toBe("Pending Decision");
    expect(card.actionButtonText).toBe("Shift Time to 8:00");

    await store.applyInsight(pending[0]!.id);

    const stats = await store.getInsightStats();
    expect(stats.totalGenerated).toBe(1);
    expect(stats.totalApplied).toBe(1);
    expect(stats.acceptanceRate).toBe(1.0);
  });
});
