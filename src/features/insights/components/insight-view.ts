import type { StoredInsight } from "../types/index.js";

export interface InsightCardViewModel {
  readonly insightId: string;
  readonly habitId: string;
  readonly cardTitle: string;
  readonly severityBadge: string;
  readonly rootCauseDescription: string;
  readonly justificationText: string;
  readonly actionButtonText: string;
  readonly encouragementText: string;
  readonly statusLabel: string;
}

export class InsightViewPresenter {
  public static presentInsightCard(insight: StoredInsight): InsightCardViewModel {
    let cardTitle: string;
    let actionButtonText: string;

    switch (insight.category) {
      case "downscale_target":
        cardTitle = "Recommended Target Downscale";
        actionButtonText = insight.proposedNewTarget !== undefined
          ? `Downscale Target to ${insight.proposedNewTarget}`
          : "Apply Target Adjustment";
        break;
      case "shift_time":
        cardTitle = "Recommended Time Adjustment";
        actionButtonText = insight.proposedTimeMinutes !== undefined
          ? `Shift Time to ${Math.floor(insight.proposedTimeMinutes / 60)}:${String(insight.proposedTimeMinutes % 60).padStart(2, "0")}`
          : "Shift Schedule Time";
        break;
      case "split_habit":
        cardTitle = "Recommended Habit Split";
        actionButtonText = "Split into Micro-Sessions";
        break;
      case "pause":
        cardTitle = "Recommended Recovery Pause";
        actionButtonText = "Activate 48h Recovery Pause";
        break;
      case "consolidate":
        cardTitle = "Consistency Milestone";
        actionButtonText = "Consolidate Current Target";
        break;
    }

    let severityBadge: string;
    switch (insight.severityLevel) {
      case "high":
        severityBadge = "High Priority Alert";
        break;
      case "medium":
        severityBadge = "Medium Priority Suggestion";
        break;
      case "low":
        severityBadge = "Low Priority Advisory";
        break;
    }

    let statusLabel: string;
    switch (insight.actionStatus) {
      case "PENDING":
        statusLabel = "Pending Decision";
        break;
      case "APPLIED":
        statusLabel = "Adjustment Applied";
        break;
      case "DISMISSED":
        statusLabel = "Dismissed";
        break;
    }

    return {
      insightId: insight.id,
      habitId: insight.habitId,
      cardTitle,
      severityBadge,
      rootCauseDescription: insight.rootCauseHypothesis,
      justificationText: insight.justification,
      actionButtonText,
      encouragementText: insight.encouragementMicroCopy,
      statusLabel,
    };
  }
}
