import type {
  HabitInsightResponse,
  InsightEvaluationContext,
  SuggestedAdjustment,
} from "../types/index.js";
import type { DetectedPattern } from "../logic/detector.js";

export const INSIGHT_RESPONSE_SCHEMA_JSON = JSON.stringify({
  type: "object",
  properties: {
    habitId: { type: "string" },
    patternDetected: { type: "string" },
    rootCauseHypothesis: { type: "string" },
    severityLevel: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
    suggestedAdjustment: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["downscale_target", "shift_time", "split_habit", "pause", "consolidate"],
        },
        proposedNewTarget: { type: "number" },
        proposedTimeMinutes: { type: "number" },
        justification: { type: "string" },
      },
      required: ["category", "justification"],
    },
    encouragementMicroCopy: { type: "string" },
  },
  required: [
    "habitId",
    "patternDetected",
    "rootCauseHypothesis",
    "severityLevel",
    "suggestedAdjustment",
    "encouragementMicroCopy",
  ],
});

export const INSIGHT_SYSTEM_INSTRUCTION =
  "You are an empathetic, evidence-based habit coach. Analyze the user's habit completion history, identify obstacles, and propose minimal sustainable micro-adjustments. Keep answers succinct and grounded in the data.";

export class PromptBuilder {
  public static buildPrompt(
    context: InsightEvaluationContext,
    detectedPattern: DetectedPattern
  ): string {
    const compactHistory = context.observations
      .slice(-14)
      .map((obs) => `${obs.dateKey}:${obs.recordedValue}/${obs.targetValue}(${obs.status})`)
      .join("; ");

    const unitPart = context.unit ? ` ${context.unit}` : "";

    return `Habit: "${context.habitTitle}" (ID: ${context.habitId}, Category: ${context.category}, Current Target: ${context.currentTarget}${unitPart})
Detected Pattern: ${detectedPattern.patternType} (${detectedPattern.description})
Days Involved: ${detectedPattern.contextDays.join(", ")}
Recent History (last 14 days): [${compactHistory}]

Provide a diagnostic root-cause hypothesis, severity rating, a concrete micro-adjustment (e.g. downscale_target, shift_time, split_habit, pause), and brief encouragement.`;
  }

  public static generateFallbackInsight(
    context: InsightEvaluationContext,
    detectedPattern: DetectedPattern
  ): HabitInsightResponse {
    let adjustment: SuggestedAdjustment;

    switch (detectedPattern.patternType) {
      case "CONSECUTIVE_LAPSE":
        adjustment = {
          category: "pause",
          justification: "Take a temporary 48-hour recovery pause to reset routine friction without guilt.",
        };
        break;
      case "TARGET_OVERREACH":
        adjustment = {
          category: "downscale_target",
          proposedNewTarget: Math.max(1, Math.round(context.currentTarget * 0.6)),
          justification: `Downscale target to ${Math.max(1, Math.round(context.currentTarget * 0.6))} to consolidate momentum before scaling back up.`,
        };
        break;
      case "WEEKEND_DROPOFF":
        adjustment = {
          category: "shift_time",
          proposedTimeMinutes: 660,
          justification: "Shift weekend scheduled time to late morning to accommodate flexible weekend hours.",
        };
        break;
      case "MIDWEEK_SLUMP":
        adjustment = {
          category: "split_habit",
          proposedNewTarget: Math.max(1, Math.round(context.currentTarget * 0.5)),
          justification: "Split the midweek habit into two smaller micro-sessions to reduce fatigue.",
        };
        break;
      case "RECOVERY_CONSOLIDATION":
      case "STABLE":
        adjustment = {
          category: "consolidate",
          justification: "Maintain current target. Consistency trajectory is strong.",
        };
        break;
    }

    return {
      habitId: context.habitId,
      patternDetected: detectedPattern.description,
      rootCauseHypothesis: "Detected friction pattern indicates situational or cognitive fatigue.",
      severityLevel: detectedPattern.severityLevel,
      suggestedAdjustment: adjustment,
      encouragementMicroCopy: "Consistency is a trajectory, not a binary state. Focus on the next small win.",
    };
  }
}
