import type { ResilienceMetrics } from "../types/index.js";

export interface ResilienceCardViewModel {
  readonly habitId: string;
  readonly scoreDisplay: string;
  readonly gaugePercentage: number;
  readonly healthBadge: string;
  readonly trendLabel: string;
  readonly activeShieldsText: string;
  readonly recoveryAdvisory: string;
}

export class ResilienceViewPresenter {
  public static presentMetrics(metrics: ResilienceMetrics): ResilienceCardViewModel {
    const gaugePercentage = Math.max(0, Math.min(100, Math.round(metrics.currentScore)));
    const scoreDisplay = `${metrics.currentScore.toFixed(1)}%`;

    let healthBadge: string;
    switch (metrics.healthTier) {
      case "EXEMPLARY":
        healthBadge = "Exemplary Consistency";
        break;
      case "CONSISTENT":
        healthBadge = "Consistent Cadence";
        break;
      case "AT_RISK":
        healthBadge = "At Risk of Lapse";
        break;
      case "CRITICAL":
        healthBadge = "Critical Momentum Drop";
        break;
    }

    let trendLabel: string;
    switch (metrics.trend) {
      case "RISING":
        trendLabel = `+${metrics.velocity.toFixed(1)}% (Rising)`;
        break;
      case "FALLING":
        trendLabel = `${metrics.velocity.toFixed(1)}% (Falling)`;
        break;
      case "STABLE":
        trendLabel = "0.0% (Stable)";
        break;
    }

    const activeShieldsText =
      metrics.activeShieldsCount === 1
        ? "1 Streak Shield Available"
        : `${metrics.activeShieldsCount} Streak Shields Available`;

    let recoveryAdvisory = "Peak consistency maintained.";
    if (metrics.estimatedDaysToRecover > 0) {
      recoveryAdvisory = `${metrics.estimatedDaysToRecover} consecutive completed days needed to reach 80% momentum target.`;
    }

    return {
      habitId: metrics.habitId,
      scoreDisplay,
      gaugePercentage,
      healthBadge,
      trendLabel,
      activeShieldsText,
      recoveryAdvisory,
    };
  }
}
