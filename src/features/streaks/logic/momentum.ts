import type { HabitHealthTier, MomentumTrend } from "../types/index.js";

export class MomentumCalculator {
  public static readonly DEFAULT_ALPHA = 0.15;
  public static readonly INITIAL_MOMENTUM = 100;
  public static readonly RECOVERY_TARGET_MOMENTUM = 80;

  public static calculateNextScore(
    previousScore: number,
    completionFactor: number,
    alpha = MomentumCalculator.DEFAULT_ALPHA
  ): number {
    const clampedCompletion = Math.max(0, Math.min(1, completionFactor));
    const targetContribution = clampedCompletion * 100;
    const nextScore = alpha * targetContribution + (1 - alpha) * previousScore;
    return Math.round(Math.max(0, Math.min(100, nextScore)) * 10000) / 10000;
  }

  public static resolveCompletionFactor(status: string, isShielded: boolean): number {
    if (status === "COMPLETED") {
      return 1.0;
    }
    if (isShielded || status === "PARTIAL" || status === "SHIELDED") {
      return 0.5;
    }
    return 0.0;
  }

  public static determineHealthTier(score: number): HabitHealthTier {
    if (score >= 85) {
      return "EXEMPLARY";
    }
    if (score >= 70) {
      return "CONSISTENT";
    }
    if (score >= 50) {
      return "AT_RISK";
    }
    return "CRITICAL";
  }

  public static determineTrend(currentScore: number, previousScore: number): MomentumTrend {
    const diff = currentScore - previousScore;
    if (diff > 1.0) {
      return "RISING";
    }
    if (diff < -1.0) {
      return "FALLING";
    }
    return "STABLE";
  }

  public static estimateDaysToRecover(
    currentScore: number,
    targetThreshold = MomentumCalculator.RECOVERY_TARGET_MOMENTUM,
    alpha = MomentumCalculator.DEFAULT_ALPHA
  ): number {
    if (currentScore >= targetThreshold) {
      return 0;
    }

    let simulatedScore = currentScore;
    let days = 0;
    const maxDaysCap = 60;

    while (simulatedScore < targetThreshold && days < maxDaysCap) {
      simulatedScore = this.calculateNextScore(simulatedScore, 1.0, alpha);
      days += 1;
    }

    return days;
  }
}
