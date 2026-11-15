import { useState } from "react";
import type { Habit, HabitEntry } from "../types/index.js";
import { HabitViewPresenter } from "./habit-view.js";

export interface HabitCardViewProps {
  readonly habit: Habit;
  readonly entry: HabitEntry | null;
  readonly onCheckIn: (habitId: string, value: number, isIncremental: boolean) => Promise<void>;
  readonly onSkip: (habitId: string, reason: string) => Promise<void>;
  readonly onDelete: (habitId: string) => Promise<void>;
}

export function HabitCardView({
  habit,
  entry,
  onCheckIn,
  onSkip,
  onDelete,
}: HabitCardViewProps) {
  const [isSkipping, setIsSkipping] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [incrementVal, setIncrementVal] = useState("1");

  const viewModel = HabitViewPresenter.presentHabitCard(habit, entry);

  const handleFullComplete = async () => {
    await onCheckIn(habit.id, habit.targetValue, false);
  };

  const handleIncremental = async () => {
    const val = Number.parseFloat(incrementVal) || 1;
    await onCheckIn(habit.id, val, true);
  };

  const handleConfirmSkip = async () => {
    if (!skipReason.trim()) {
      return;
    }
    await onSkip(habit.id, skipReason);
    setIsSkipping(false);
    setSkipReason("");
  };

  return (
    <div className="habit-card">
      <div className="habit-card-header">
        <div>
          <span className="habit-category">{viewModel.category}</span>
          <h3 className="habit-title">{viewModel.title}</h3>
        </div>
        <span className={`status-pill status-${viewModel.statusBadge.toLowerCase()}`}>
          {viewModel.statusBadge}
        </span>
      </div>

      <div className="habit-card-body">
        <div className="progress-bar-container">
          <div
            className="progress-bar-fill"
            style={{ width: `${viewModel.progressPercentage}%` }}
          />
        </div>

        <div className="habit-metrics-row">
          <span className="cadence-label">{viewModel.cadenceLabel}</span>
          <span className="progress-text">{viewModel.progressLabel}</span>
        </div>

        {isSkipping ? (
          <div className="skip-form-container">
            <input
              type="text"
              placeholder="Reason for skipping (e.g. travel, unwell)..."
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
              className="ui-input"
            />
            <div className="button-group">
              <button
                type="button"
                onClick={handleConfirmSkip}
                className="btn btn-warning btn-sm"
              >
                Confirm Skip
              </button>
              <button
                type="button"
                onClick={() => setIsSkipping(false)}
                className="btn btn-secondary btn-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="habit-actions-row">
            <button
              type="button"
              onClick={handleFullComplete}
              className="btn btn-primary btn-sm"
            >
              Complete
            </button>

            {habit.targetType !== "BOOLEAN" && (
              <div className="incremental-group">
                <input
                  type="number"
                  min="1"
                  value={incrementVal}
                  onChange={(e) => setIncrementVal(e.target.value)}
                  className="ui-input-narrow"
                />
                <button
                  type="button"
                  onClick={handleIncremental}
                  className="btn btn-secondary btn-sm"
                >
                  + Add
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsSkipping(true)}
              className="btn btn-outline btn-sm"
            >
              Skip
            </button>

            <button
              type="button"
              onClick={() => onDelete(habit.id)}
              className="btn btn-danger-text btn-sm"
              title="Delete habit"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
