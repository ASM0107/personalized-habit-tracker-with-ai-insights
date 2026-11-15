import { useState } from "react";
import type { ResilienceMetrics, StreakShield } from "../types/index.js";
import { ResilienceViewPresenter } from "./resilience-view.js";

export interface MomentumDashboardViewProps {
  readonly metrics: readonly ResilienceMetrics[];
  readonly habitTitles: ReadonlyMap<string, string>;
  readonly activeShields: readonly StreakShield[];
  readonly consumedShields: readonly StreakShield[];
  readonly onAllocateShield: (habitId: string, reason: string) => Promise<void>;
}

export function MomentumDashboardView({
  metrics,
  habitTitles,
  activeShields,
  consumedShields,
  onAllocateShield,
}: MomentumDashboardViewProps) {
  const [selectedHabitId, setSelectedHabitId] = useState<string>("");
  const [shieldReason, setShieldReason] = useState("");
  const [isAllocating, setIsAllocating] = useState(false);

  const handleAllocate = async () => {
    if (!selectedHabitId || !shieldReason.trim()) {
      return;
    }
    await onAllocateShield(selectedHabitId, shieldReason);
    setShieldReason("");
    setIsAllocating(false);
  };

  if (metrics.length === 0) {
    return (
      <div className="empty-state">
        <p>No active habits to compute momentum. Create a habit to start tracking resilience.</p>
      </div>
    );
  }

  const averageMomentum =
    metrics.reduce((acc, m) => acc + m.currentScore, 0) / (metrics.length || 1);

  return (
    <div className="momentum-container">
      <div className="momentum-overview-card">
        <div className="momentum-header-row">
          <div>
            <span className="section-eyebrow">Resilience Engine</span>
            <h2>System Momentum Average</h2>
          </div>
          <button
            type="button"
            onClick={() => setIsAllocating(true)}
            className="btn btn-outline btn-sm"
          >
            + Allocate Rest Shield
          </button>
        </div>

        <div className="momentum-gauge-display">
          <div className="gauge-circle">
            <span className="gauge-number">{averageMomentum.toFixed(1)}%</span>
            <span className="gauge-caption">Consistency Index</span>
          </div>
          <div className="shield-badges-container">
            <div className="shield-metric-box">
              <span className="shield-metric-value">{activeShields.length}</span>
              <span className="shield-metric-label">Active Shields</span>
            </div>
            <div className="shield-metric-box">
              <span className="shield-metric-value">{consumedShields.length}</span>
              <span className="shield-metric-label">Shields Consumed</span>
            </div>
          </div>
        </div>
      </div>

      {isAllocating && (
        <div className="shield-allocation-banner">
          <h4>Allocate Manual Grace Shield</h4>
          <div className="allocation-form-row">
            <select
              value={selectedHabitId}
              onChange={(e) => setSelectedHabitId(e.target.value)}
              className="ui-select"
            >
              <option value="">Select Target Habit...</option>
              {metrics.map((m) => (
                <option key={m.habitId} value={m.habitId}>
                  {habitTitles.get(m.habitId) || m.habitId}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Reason (e.g. flu, travel, rest)..."
              value={shieldReason}
              onChange={(e) => setShieldReason(e.target.value)}
              className="ui-input"
            />
            <button
              type="button"
              onClick={handleAllocate}
              disabled={!selectedHabitId || !shieldReason.trim()}
              className="btn btn-primary btn-sm"
            >
              Save Shield
            </button>
            <button
              type="button"
              onClick={() => setIsAllocating(false)}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="momentum-cards-grid">
        {metrics.map((m) => {
          const title = habitTitles.get(m.habitId) || m.habitId;
          const cardViewModel = ResilienceViewPresenter.presentMetrics(m);

          return (
            <div key={m.habitId} className="resilience-card">
              <div className="resilience-card-header">
                <h3>{title}</h3>
                <span className={`health-tier-badge tier-${m.healthTier.toLowerCase()}`}>
                  {cardViewModel.healthBadge}
                </span>
              </div>

              <div className="resilience-score-row">
                <span className="resilience-score-number">{cardViewModel.scoreDisplay}</span>
                <span className="resilience-trend-badge">{cardViewModel.trendLabel}</span>
              </div>

              <div className="progress-bar-container">
                <div
                  className={`progress-bar-fill fill-${m.healthTier.toLowerCase()}`}
                  style={{ width: `${cardViewModel.gaugePercentage}%` }}
                />
              </div>

              <div className="resilience-footer">
                <span className="shield-info-tag">{cardViewModel.activeShieldsText}</span>
                <span className="streak-count-tag">
                  {m.traditionalCurrentStreak}d streak (best {m.traditionalBestStreak}d)
                </span>
              </div>

              <p className="recovery-advisory-text">{cardViewModel.recoveryAdvisory}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
