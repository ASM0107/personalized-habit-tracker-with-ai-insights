import { describe, it, expect } from "vitest";
import {
  HabitScheduler,
  HabitValidator,
} from "../features/habits/index.js";
import { MomentumCalculator } from "../features/streaks/index.js";
import {
  ConsistencyAggregator,
  type HabitMeta,
  type LoggedDayRecord,
} from "../features/analytics/index.js";

describe("Unit Testing: Domain & Mathematical Edge Cases", () => {
  it("enforces strict boundary conditions on habit titles and targets", () => {
    const exactly100Chars = "A".repeat(100);
    expect(() => HabitValidator.validateTitle(exactly100Chars)).not.toThrow();

    const titleWith101Chars = "A".repeat(101);
    expect(() => HabitValidator.validateTitle(titleWith101Chars)).toThrow("exceeds maximum length");

    expect(() => HabitValidator.validateTarget("NUMERIC", 0.1)).not.toThrow();
    expect(() => HabitValidator.validateTarget("NUMERIC", 0)).toThrow("strictly positive");
    expect(() => HabitValidator.validateTarget("NUMERIC", -5)).toThrow("strictly positive");
    expect(() => HabitValidator.validateTarget("BOOLEAN", 0)).toThrow("strictly positive");
    expect(() => HabitValidator.validateTarget("BOOLEAN", 2)).toThrow("strictly equal 1");
  });

  it("handles calendar leap years and cross-year date boundaries", () => {
    const leapDays = HabitScheduler.calculateDaysBetween("2024-02-28", "2024-03-01");
    expect(leapDays).toBe(2);

    const nonLeapDays = HabitScheduler.calculateDaysBetween("2025-02-28", "2025-03-01");
    expect(nonLeapDays).toBe(1);

    const crossYearDays = HabitScheduler.calculateDaysBetween("2025-12-31", "2026-01-01");
    expect(crossYearDays).toBe(1);

    const parsedDate = HabitScheduler.parseDateKey("2026-11-15");
    expect(HabitScheduler.formatDateKey(parsedDate)).toBe("2026-11-15");
  });

  it("proves numerical stability of EMA momentum over 365 simulated days", () => {
    let fallingScore = 100;
    for (let day = 1; day <= 365; day += 1) {
      fallingScore = MomentumCalculator.calculateNextScore(fallingScore, 0.0);
    }
    expect(fallingScore).toBeGreaterThanOrEqual(0);
    expect(fallingScore).toBeLessThan(0.1);
    expect(Number.isFinite(fallingScore)).toBe(true);
    expect(Number.isNaN(fallingScore)).toBe(false);

    let risingScore = 0;
    for (let day = 1; day <= 365; day += 1) {
      risingScore = MomentumCalculator.calculateNextScore(risingScore, 1.0);
    }
    expect(risingScore).toBeCloseTo(100.0, 1);
    expect(Number.isFinite(risingScore)).toBe(true);
  });

  it("handles zero-variance edge cases in Pearson correlation calculation safely", () => {
    const habits: HabitMeta[] = [
      { id: "h-const-a", title: "Constant 100%" },
      { id: "h-const-b", title: "Constant 100% Also" },
    ];

    const recordsA: LoggedDayRecord[] = Array.from({ length: 10 }, (_, i) => ({
      dateKey: `2026-01-${String(i + 1).padStart(2, "0")}`,
      isCompleted: true,
    }));

    const recordsB: LoggedDayRecord[] = Array.from({ length: 10 }, (_, i) => ({
      dateKey: `2026-01-${String(i + 1).padStart(2, "0")}`,
      isCompleted: true,
    }));

    const map = new Map<string, readonly LoggedDayRecord[]>();
    map.set("h-const-a", recordsA);
    map.set("h-const-b", recordsB);

    const correlations = ConsistencyAggregator.computeCorrelations(habits, map);
    expect(correlations.length).toBe(1);
    expect(correlations[0]?.correlationCoefficient).toBe(0);
    expect(correlations[0]?.strength).toBe("NEUTRAL");
    expect(Number.isNaN(correlations[0]?.correlationCoefficient)).toBe(false);
  });
});
