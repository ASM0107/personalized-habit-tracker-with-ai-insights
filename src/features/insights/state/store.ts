import type { StoragePort } from "../../../core/database/index.js";
import type { EventBusPort } from "../../../core/event-bus/index.js";
import type { AiInferencePort } from "../../../core/ai-client/index.js";
import type {
  HabitInsightResponse,
  InsightEvaluationContext,
  InsightStats,
  StoredInsight,
} from "../types/index.js";
import { BehavioralPatternDetector } from "../logic/detector.js";
import {
  INSIGHT_RESPONSE_SCHEMA_JSON,
  INSIGHT_SYSTEM_INSTRUCTION,
  PromptBuilder,
} from "../prompts/schema.js";

export interface InsightStoreConfig {
  readonly cooldownPeriodMs?: number;
}

export class InsightStore {
  public static readonly DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

  private readonly insightStorage: StoragePort<StoredInsight>;
  private readonly aiClient: AiInferencePort;
  private readonly eventBus: EventBusPort;
  private readonly cooldownPeriodMs: number;
  private readonly lastEvaluationTimes = new Map<string, number>();

  public constructor(
    insightStorage: StoragePort<StoredInsight>,
    aiClient: AiInferencePort,
    eventBus: EventBusPort,
    config: InsightStoreConfig = {}
  ) {
    this.insightStorage = insightStorage;
    this.aiClient = aiClient;
    this.eventBus = eventBus;
    this.cooldownPeriodMs = config.cooldownPeriodMs ?? InsightStore.DEFAULT_COOLDOWN_MS;
  }

  public async evaluateHabit(
    context: InsightEvaluationContext,
    forceBypassCooldown = false
  ): Promise<StoredInsight | null> {
    const pattern = BehavioralPatternDetector.detectPrimaryPattern(context.observations);
    if (!pattern.isTriggerWorthy) {
      return null;
    }

    const now = Date.now();
    const lastTime = this.lastEvaluationTimes.get(context.habitId) ?? 0;
    if (!forceBypassCooldown && now - lastTime < this.cooldownPeriodMs) {
      return null;
    }

    const signature = BehavioralPatternDetector.computeSignature(
      context.habitId,
      pattern.patternType,
      pattern.contextDays
    );

    const existingCached = await this.insightStorage.query(
      (i) => i.habitId === context.habitId && i.contentSignature === signature
    );

    if (existingCached.length > 0 && existingCached[0]) {
      return existingCached[0];
    }

    this.eventBus.publish({
      id: `evt-alert-${context.habitId}-${now}`,
      type: "PATTERN_ALERT",
      timestamp: now,
      payload: {
        habitId: context.habitId,
        patternType: pattern.patternType,
        occurrenceCount: pattern.contextDays.length,
        contextDays: pattern.contextDays,
      },
    });

    let insightResponse: HabitInsightResponse;

    try {
      const prompt = PromptBuilder.buildPrompt(context, pattern);
      insightResponse = await this.aiClient.generateStructured<HabitInsightResponse>({
        systemInstruction: INSIGHT_SYSTEM_INSTRUCTION,
        prompt,
        responseSchemaJson: INSIGHT_RESPONSE_SCHEMA_JSON,
      });
    } catch {
      insightResponse = PromptBuilder.generateFallbackInsight(context, pattern);
    }

    const insightId = `insight-${context.habitId}-${now}`;
    const storedInsight: StoredInsight = {
      id: insightId,
      habitId: context.habitId,
      patternType: pattern.patternType,
      patternDetected: insightResponse.patternDetected,
      rootCauseHypothesis: insightResponse.rootCauseHypothesis,
      severityLevel: insightResponse.severityLevel,
      category: insightResponse.suggestedAdjustment.category,
      justification: insightResponse.suggestedAdjustment.justification,
      ...(insightResponse.suggestedAdjustment.proposedNewTarget !== undefined
        ? { proposedNewTarget: insightResponse.suggestedAdjustment.proposedNewTarget }
        : {}),
      ...(insightResponse.suggestedAdjustment.proposedTimeMinutes !== undefined
        ? { proposedTimeMinutes: insightResponse.suggestedAdjustment.proposedTimeMinutes }
        : {}),
      encouragementMicroCopy: insightResponse.encouragementMicroCopy,
      actionStatus: "PENDING",
      contentSignature: signature,
      createdAt: now,
      updatedAt: now,
    };

    await this.insightStorage.insert(storedInsight);
    this.lastEvaluationTimes.set(context.habitId, now);

    this.eventBus.publish({
      id: `evt-ins-${insightId}`,
      type: "INSIGHT_GENERATED",
      timestamp: now,
      payload: {
        habitId: context.habitId,
        insightId,
        recommendationType: storedInsight.category,
      },
    });

    return storedInsight;
  }

  public async applyInsight(insightId: string): Promise<StoredInsight> {
    return this.insightStorage.update(insightId, (i) => ({
      ...i,
      actionStatus: "APPLIED",
      updatedAt: Date.now(),
    }));
  }

  public async dismissInsight(insightId: string): Promise<StoredInsight> {
    return this.insightStorage.update(insightId, (i) => ({
      ...i,
      actionStatus: "DISMISSED",
      updatedAt: Date.now(),
    }));
  }

  public async getPendingInsights(habitId: string): Promise<readonly StoredInsight[]> {
    return this.insightStorage.query(
      (i) => i.habitId === habitId && i.actionStatus === "PENDING"
    );
  }

  public async getAllInsights(habitId: string): Promise<readonly StoredInsight[]> {
    return this.insightStorage.query((i) => i.habitId === habitId);
  }

  public async getInsightStats(): Promise<InsightStats> {
    const all = await this.insightStorage.query();
    let applied = 0;
    let dismissed = 0;

    for (const item of all) {
      if (item.actionStatus === "APPLIED") {
        applied += 1;
      } else if (item.actionStatus === "DISMISSED") {
        dismissed += 1;
      }
    }

    const totalDecided = applied + dismissed;
    const acceptanceRate = totalDecided > 0 ? Math.round((applied / totalDecided) * 100) / 100 : 0;

    return {
      totalGenerated: all.length,
      totalApplied: applied,
      totalDismissed: dismissed,
      acceptanceRate,
    };
  }
}
