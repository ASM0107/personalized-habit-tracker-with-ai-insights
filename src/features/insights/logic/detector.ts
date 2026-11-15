import type { BehaviorObservation, PatternType, SeverityLevel } from "../types/index.js";

export interface DetectedPattern {
  readonly patternType: PatternType;
  readonly severityLevel: SeverityLevel;
  readonly isTriggerWorthy: boolean;
  readonly contextDays: readonly string[];
  readonly description: string;
}

export class BehavioralPatternDetector {
  public static evaluateLapseSequence(observations: readonly BehaviorObservation[]): DetectedPattern {
    if (observations.length < 3) {
      return this.createStablePattern();
    }

    const recent = observations.slice(-3);
    const consecutiveMisses = recent.every(
      (obs) => obs.status === "MISSED" || obs.status === "SKIPPED"
    );

    if (consecutiveMisses) {
      return {
        patternType: "CONSECUTIVE_LAPSE",
        severityLevel: "high",
        isTriggerWorthy: true,
        contextDays: recent.map((r) => r.dateKey),
        description: "Three consecutive days of habit lapse detected",
      };
    }

    return this.createStablePattern();
  }

  public static evaluateTargetOverreach(observations: readonly BehaviorObservation[]): DetectedPattern {
    if (observations.length < 3) {
      return this.createStablePattern();
    }

    const recent = observations.slice(-4);
    const partials = recent.filter((obs) => obs.status === "PARTIAL");

    if (partials.length >= 3) {
      return {
        patternType: "TARGET_OVERREACH",
        severityLevel: "medium",
        isTriggerWorthy: true,
        contextDays: partials.map((r) => r.dateKey),
        description: "Consistently completing only partial target over multiple days",
      };
    }

    return this.createStablePattern();
  }

  public static evaluateWeekendDropoff(observations: readonly BehaviorObservation[]): DetectedPattern {
    const weekendFailures: string[] = [];

    for (const obs of observations) {
      const [yearStr, monthStr, dayStr] = obs.dateKey.split("-");
      if (!yearStr || !monthStr || !dayStr) {
        continue;
      }
      const date = new Date(
        Date.UTC(
          Number.parseInt(yearStr, 10),
          Number.parseInt(monthStr, 10) - 1,
          Number.parseInt(dayStr, 10)
        )
      );
      const dayOfWeek = date.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      if (isWeekend && (obs.status === "MISSED" || obs.status === "SKIPPED")) {
        weekendFailures.push(obs.dateKey);
      }
    }

    if (weekendFailures.length >= 2) {
      return {
        patternType: "WEEKEND_DROPOFF",
        severityLevel: "medium",
        isTriggerWorthy: true,
        contextDays: weekendFailures,
        description: "Recurring lapse on weekend days detected",
      };
    }

    return this.createStablePattern();
  }

  public static evaluateMidweekSlump(observations: readonly BehaviorObservation[]): DetectedPattern {
    const midweekFailures: string[] = [];

    for (const obs of observations) {
      const [yearStr, monthStr, dayStr] = obs.dateKey.split("-");
      if (!yearStr || !monthStr || !dayStr) {
        continue;
      }
      const date = new Date(
        Date.UTC(
          Number.parseInt(yearStr, 10),
          Number.parseInt(monthStr, 10) - 1,
          Number.parseInt(dayStr, 10)
        )
      );
      const dayOfWeek = date.getDay();
      const isMidweek = dayOfWeek === 3 || dayOfWeek === 4;

      if (isMidweek && (obs.status === "MISSED" || obs.status === "SKIPPED")) {
        midweekFailures.push(obs.dateKey);
      }
    }

    if (midweekFailures.length >= 2) {
      return {
        patternType: "MIDWEEK_SLUMP",
        severityLevel: "low",
        isTriggerWorthy: true,
        contextDays: midweekFailures,
        description: "Recurring midweek drop-off detected on Wednesday or Thursday",
      };
    }

    return this.createStablePattern();
  }

  public static detectPrimaryPattern(observations: readonly BehaviorObservation[]): DetectedPattern {
    const lapse = this.evaluateLapseSequence(observations);
    if (lapse.isTriggerWorthy) {
      return lapse;
    }

    const overreach = this.evaluateTargetOverreach(observations);
    if (overreach.isTriggerWorthy) {
      return overreach;
    }

    const weekend = this.evaluateWeekendDropoff(observations);
    if (weekend.isTriggerWorthy) {
      return weekend;
    }

    const midweek = this.evaluateMidweekSlump(observations);
    if (midweek.isTriggerWorthy) {
      return midweek;
    }

    return this.createStablePattern();
  }

  public static computeSignature(
    habitId: string,
    patternType: PatternType,
    contextDays: readonly string[]
  ): string {
    const sortedDays = [...contextDays].sort().join(",");
    return `${habitId}:${patternType}:${sortedDays}`;
  }

  private static createStablePattern(): DetectedPattern {
    return {
      patternType: "STABLE",
      severityLevel: "low",
      isTriggerWorthy: false,
      contextDays: [],
      description: "Consistent habit cadence maintained",
    };
  }
}
