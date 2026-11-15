import type { SystemAnalyticsOverview } from "../types/index.js";
import { AnalyticsViewPresenter } from "./analytics-view.js";

export interface AnalyticsDashboardViewProps {
  readonly overview: SystemAnalyticsOverview;
  readonly habitTitles: ReadonlyMap<string, string>;
}

export function AnalyticsDashboardView({
  overview,
  habitTitles,
}: AnalyticsDashboardViewProps) {
  const executive = AnalyticsViewPresenter.presentExecutiveDashboard(overview);

  if (overview.totalTrackedHabits === 0) {
    return (
      <div className="empty-state">
        <p>No habit records available for analytics. Complete habits to generate heatmaps and correlations.</p>
      </div>
    );
  }

  return (
    <div className="analytics-container">
      <div className="executive-banner">
        <div className="executive-metric">
          <span className="executive-val">{executive.systemCompletionRateDisplay}</span>
          <span className="executive-lbl">Overall Consistency</span>
        </div>
        <div className="executive-metric">
          <span className="executive-val">{executive.totalHabitsText}</span>
          <span className="executive-lbl">Active Cohort</span>
        </div>
        <div className="executive-metric">
          <span className="executive-val">{overview.bestDayOfWeekOverall}</span>
          <span className="executive-lbl">Peak Performance Day</span>
        </div>
      </div>

      <div className="synergy-highlight-box">
        <strong>Cross-Habit Synergy: </strong>
        <span>{executive.strongestSynergyText}</span>
      </div>

      <div className="analytics-habits-section">
        <h3>Habit Consistency & Heatmaps</h3>
        <div className="analytics-cards-list">
          {overview.habitSummaries.map((summary) => {
            const title = habitTitles.get(summary.habitId) || summary.habitId;
            const cardView = AnalyticsViewPresenter.presentHabitAnalytics(summary);

            return (
              <div key={summary.habitId} className="analytics-habit-card">
                <div className="analytics-habit-header">
                  <div>
                    <h4>{title}</h4>
                    <span className="analytics-ratio-tag">{cardView.completionRateDisplay} consistency</span>
                  </div>
                  <span className="analytics-tracked-text">{cardView.totalTrackedDaysText}</span>
                </div>

                <div className="analytics-advisories-row">
                  <span className="advisory-peak">{cardView.bestDayText}</span>
                  <span className="advisory-friction">{cardView.lowestDayText}</span>
                </div>

                <div className="heatmap-section">
                  <span className="subsection-label">Recent Activity Heatmap</span>
                  <div className="heatmap-cells-grid">
                    {summary.heatmap.cells.slice(-28).map((cell) => (
                      <div
                        key={cell.dateKey}
                        className={`heatmap-cell intensity-${cell.intensityLevel}`}
                        title={`${cell.dateKey}: ${Math.round(cell.completionRatio * 100)}%`}
                      />
                    ))}
                  </div>
                </div>

                <div className="day-distribution-section">
                  <span className="subsection-label">Day of Week Performance</span>
                  <div className="day-bars-container">
                    {cardView.dayBars.map((bar) => (
                      <div key={bar.dayName} className="day-bar-row">
                        <span className="day-name">{bar.dayName.slice(0, 3)}</span>
                        <div className="day-meter">
                          <div
                            className="day-meter-fill"
                            style={{ width: `${bar.percentage}%` }}
                          />
                        </div>
                        <span className="day-percentage">{bar.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {overview.correlations.length > 0 && (
        <div className="correlations-section">
          <h3>Habit Co-Occurrence Matrix</h3>
          <p>Identifies whether completing one habit significantly impacts another.</p>
          <div className="correlations-table-wrapper">
            <table className="correlations-table">
              <thead>
                <tr>
                  <th>Primary Habit</th>
                  <th>Secondary Habit</th>
                  <th>Sample Days</th>
                  <th>Correlation (r)</th>
                  <th>Relationship</th>
                </tr>
              </thead>
              <tbody>
                {overview.correlations.map((corr) => (
                  <tr key={`${corr.habitIdA}-${corr.habitIdB}`}>
                    <td>{corr.habitTitleA}</td>
                    <td>{corr.habitTitleB}</td>
                    <td>{corr.coOccurrenceCount}</td>
                    <td className="font-mono">
                      {corr.correlationCoefficient >= 0 ? "+" : ""}
                      {corr.correlationCoefficient.toFixed(2)}
                    </td>
                    <td>
                      <span className={`correlation-pill strength-${corr.strength.toLowerCase()}`}>
                        {corr.strength.replace("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
