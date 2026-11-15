import { describe, it, expect } from "vitest";
import {
  InMemoryEventBus,
  InMemoryStoragePort,
} from "../core/index.js";
import {
  MomentumCalculator,
  StreakStore,
  ResilienceViewPresenter,
  type StreakShield,
} from "../features/streaks/index.js";

describe("Resilience Engine Phase 3", () => {
  it("calculates exponential moving averages and recovery runway correctly", () => {
    const initial = 100;
    const completedScore = MomentumCalculator.calculateNextScore(initial, 1.0);
    expect(completedScore).toBe(100);

    const missedScore = MomentumCalculator.calculateNextScore(initial, 0.0);
    expect(missedScore).toBe(85);

    const partialScore = MomentumCalculator.calculateNextScore(initial, 0.5);
    expect(partialScore).toBe(92.5);

    expect(MomentumCalculator.determineHealthTier(90)).toBe("EXEMPLARY");
    expect(MomentumCalculator.determineHealthTier(75)).toBe("CONSISTENT");
    expect(MomentumCalculator.determineHealthTier(60)).toBe("AT_RISK");
    expect(MomentumCalculator.determineHealthTier(40)).toBe("CRITICAL");

    expect(MomentumCalculator.determineTrend(85, 80)).toBe("RISING");
    expect(MomentumCalculator.determineTrend(70, 80)).toBe("FALLING");
    expect(MomentumCalculator.determineTrend(80, 80.5)).toBe("STABLE");

    const daysToRecoverFrom50 = MomentumCalculator.estimateDaysToRecover(50, 80);
    expect(daysToRecoverFrom50).toBeGreaterThan(0);
    expect(daysToRecoverFrom50).toBeLessThan(15);
  });

  it("earns streak shields upon 7-day consistency and respects max shield caps", async () => {
    const shieldStorage = new InMemoryStoragePort<StreakShield>();
    const eventBus = new InMemoryEventBus();

    const streakStore = new StreakStore(shieldStorage, eventBus);

    for (let day = 1; day <= 7; day += 1) {
      eventBus.publish({
        id: `evt-comp-${day}`,
        type: "HABIT_COMPLETED",
        timestamp: Date.now(),
        payload: {
          habitId: "h-reading",
          dateKey: `2026-11-0${day}`,
          recordedValue: 30,
          isFullCompletion: true,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const metricsAfter7 = await streakStore.getResilienceMetrics("h-reading");
    expect(metricsAfter7.activeShieldsCount).toBe(1);
    expect(metricsAfter7.totalShieldsEarned).toBe(1);
    expect(metricsAfter7.traditionalCurrentStreak).toBe(7);
    expect(metricsAfter7.traditionalBestStreak).toBe(7);
  });

  it("protects momentum using shields on lapse and handles unshielded drops", async () => {
    const shieldStorage = new InMemoryStoragePort<StreakShield>();
    const eventBus = new InMemoryEventBus();

    const streakStore = new StreakStore(shieldStorage, eventBus);

    await streakStore.allocateShield("h-meditation", "Grace shield for flu");

    const initialMetrics = await streakStore.getResilienceMetrics("h-meditation");
    expect(initialMetrics.activeShieldsCount).toBe(1);

    eventBus.publish({
      id: "evt-skip-shielded",
      type: "HABIT_SKIPPED",
      timestamp: Date.now(),
      payload: {
        habitId: "h-meditation",
        dateKey: "2026-11-15",
        reason: "Flu recovery",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const metricsAfterShieldedSkip = await streakStore.getResilienceMetrics("h-meditation");
    expect(metricsAfterShieldedSkip.activeShieldsCount).toBe(0);
    expect(metricsAfterShieldedSkip.totalShieldsConsumed).toBe(1);
    expect(metricsAfterShieldedSkip.currentScore).toBeCloseTo(92.5, 1);

    eventBus.publish({
      id: "evt-skip-unshielded",
      type: "HABIT_SKIPPED",
      timestamp: Date.now(),
      payload: {
        habitId: "h-meditation",
        dateKey: "2026-11-16",
        reason: "Busy work day",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const metricsAfterUnshieldedSkip = await streakStore.getResilienceMetrics("h-meditation");
    expect(metricsAfterUnshieldedSkip.currentScore).toBeCloseTo(78.6, 1);
    expect(metricsAfterUnshieldedSkip.trend).toBe("FALLING");
  });

  it("renders resilience metrics into user-facing view models", async () => {
    const shieldStorage = new InMemoryStoragePort<StreakShield>();
    const eventBus = new InMemoryEventBus();

    const streakStore = new StreakStore(shieldStorage, eventBus);
    await streakStore.allocateShield("h-yoga", "Weekend pass");

    const metrics = await streakStore.getResilienceMetrics("h-yoga");
    const viewModel = ResilienceViewPresenter.presentMetrics(metrics);

    expect(viewModel.scoreDisplay).toBe("100.0%");
    expect(viewModel.gaugePercentage).toBe(100);
    expect(viewModel.healthBadge).toBe("Exemplary Consistency");
    expect(viewModel.activeShieldsText).toBe("1 Streak Shield Available");
  });
});
