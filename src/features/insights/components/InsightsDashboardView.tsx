import { useState } from "react";
import type { InsightStats, StoredInsight } from "../types/index.js";
import { InsightViewPresenter } from "./insight-view.js";

export interface InsightsDashboardViewProps {
  readonly insights: readonly StoredInsight[];
  readonly stats: InsightStats;
  readonly habitTitles: ReadonlyMap<string, string>;
  readonly onApplyInsight: (insight: StoredInsight) => Promise<void>;
  readonly onDismissInsight: (insightId: string) => Promise<void>;
  readonly onTriggerEvaluation: (habitId: string) => Promise<void>;
}

export function InsightsDashboardView({
  insights,
  stats,
  habitTitles,
  onApplyInsight,
  onDismissInsight,
  onTriggerEvaluation,
}: InsightsDashboardViewProps) {
  const [selectedEvaluationHabitId, setSelectedEvaluationHabitId] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);

  const handleEvaluate = async () => {
    if (!selectedEvaluationHabitId) {
      return;
    }
    setIsEvaluating(true);
    try {
      await onTriggerEvaluation(selectedEvaluationHabitId);
    } finally {
      setIsEvaluating(false);
    }
  };

  const pendingInsights = insights.filter((i) => i.actionStatus === "PENDING");
  const pastInsights = insights.filter((i) => i.actionStatus !== "PENDING");

  return (
    <div className="insights-container">
      <div className="insights-metrics-banner">
        <div className="metric-box">
          <span className="metric-number">{stats.totalGenerated}</span>
          <span className="metric-label">Insights Generated</span>
        </div>
        <div className="metric-box">
          <span className="metric-number">{stats.totalApplied}</span>
          <span className="metric-label">Adjustments Applied</span>
        </div>
        <div className="metric-box">
          <span className="metric-number">{Math.round(stats.acceptanceRate * 100)}%</span>
          <span className="metric-label">Acceptance Rate</span>
        </div>
      </div>

      <div className="evaluation-control-card">
        <h3>Diagnose Habit Friction</h3>
        <p>Trigger deterministic pattern detection and Gemini contextual coaching for any habit.</p>
        <div className="evaluation-action-row">
          <select
            value={selectedEvaluationHabitId}
            onChange={(e) => setSelectedEvaluationHabitId(e.target.value)}
            className="ui-select"
          >
            <option value="">Select Habit to Evaluate...</option>
            {Array.from(habitTitles.entries()).map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleEvaluate}
            disabled={!selectedEvaluationHabitId || isEvaluating}
            className="btn btn-primary btn-sm"
          >
            {isEvaluating ? "Analyzing..." : "Run AI Diagnosis"}
          </button>
        </div>
      </div>

      <div className="insights-section">
        <h3>Active Recommendations ({pendingInsights.length})</h3>
        {pendingInsights.length === 0 ? (
          <div className="empty-state">
            <p>No active friction alerts. Your habit consistency is stable!</p>
          </div>
        ) : (
          <div className="insights-list">
            {pendingInsights.map((insight) => {
              const habitName = habitTitles.get(insight.habitId) || insight.habitId;
              const card = InsightViewPresenter.presentInsightCard(insight);

              return (
                <div key={insight.id} className="insight-card">
                  <div className="insight-card-header">
                    <div>
                      <span className="insight-habit-tag">{habitName}</span>
                      <h4>{card.cardTitle}</h4>
                    </div>
                    <span className={`severity-pill severity-${insight.severityLevel}`}>
                      {card.severityBadge}
                    </span>
                  </div>

                  <p className="insight-root-cause">
                    <strong>Hypothesis: </strong>
                    {card.rootCauseDescription}
                  </p>

                  <p className="insight-justification">
                    <strong>Adjustment: </strong>
                    {card.justificationText}
                  </p>

                  <p className="insight-encouragement">
                    <em>"{card.encouragementText}"</em>
                  </p>

                  <div className="insight-actions-row">
                    <button
                      type="button"
                      onClick={() => onApplyInsight(insight)}
                      className="btn btn-primary btn-sm"
                    >
                      ✓ {card.actionButtonText}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismissInsight(insight.id)}
                      className="btn btn-outline btn-sm"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pastInsights.length > 0 && (
        <div className="insights-history-section">
          <h3>Resolved History ({pastInsights.length})</h3>
          <div className="resolved-insights-list">
            {pastInsights.map((insight) => {
              const habitName = habitTitles.get(insight.habitId) || insight.habitId;
              return (
                <div key={insight.id} className="resolved-insight-row">
                  <div>
                    <span className="resolved-title">{habitName}: {insight.category}</span>
                    <span className="resolved-desc">{insight.justification}</span>
                  </div>
                  <span className={`status-pill status-${insight.actionStatus.toLowerCase()}`}>
                    {insight.actionStatus}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
