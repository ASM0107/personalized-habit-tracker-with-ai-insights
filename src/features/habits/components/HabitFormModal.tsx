import React, { useState } from "react";
import type { HabitTargetType, RecurrenceType } from "../types/index.js";
import { HabitScheduler } from "../logic/scheduler.js";
import type { CreateHabitInput } from "../state/store.js";

export interface HabitFormModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (input: CreateHabitInput) => Promise<void>;
  readonly defaultStartDateKey: string;
}

export function HabitFormModal({
  isOpen,
  onClose,
  onSubmit,
  defaultStartDateKey,
}: HabitFormModalProps) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Health");
  const [targetType, setTargetType] = useState<HabitTargetType>("BOOLEAN");
  const [targetValue, setTargetValue] = useState("1");
  const [unit, setUnit] = useState("");
  const [recurrence, setRecurrence] = useState<RecurrenceType>("DAILY");
  const [intervalDays, setIntervalDays] = useState("3");
  const [frequencyPerWeek, setFrequencyPerWeek] = useState("3");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const parsedValue = targetType === "BOOLEAN" ? 1 : Number.parseFloat(targetValue);
      if (Number.isNaN(parsedValue) || parsedValue <= 0) {
        throw new Error("Target value must be a positive number");
      }

      let schedule;
      if (recurrence === "WEEKDAY_MASK") {
        schedule = HabitScheduler.createWeekdaySchedule(defaultStartDateKey);
      } else if (recurrence === "INTERVAL_DAYS") {
        const parsedInterval = Number.parseInt(intervalDays, 10);
        if (Number.isNaN(parsedInterval) || parsedInterval <= 0) {
          throw new Error("Interval days must be greater than zero");
        }
        schedule = HabitScheduler.createIntervalSchedule(defaultStartDateKey, parsedInterval);
      } else if (recurrence === "X_TIMES_PER_WEEK") {
        const parsedFreq = Number.parseInt(frequencyPerWeek, 10);
        if (Number.isNaN(parsedFreq) || parsedFreq < 1 || parsedFreq > 7) {
          throw new Error("Frequency must be between 1 and 7 days per week");
        }
        schedule = HabitScheduler.createXTimesPerWeekSchedule(defaultStartDateKey, parsedFreq);
      } else {
        schedule = HabitScheduler.createDailySchedule(defaultStartDateKey);
      }

      const input: CreateHabitInput = {
        id: `habit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        title,
        category,
        targetType,
        targetValue: parsedValue,
        schedule,
        ...(unit.trim() ? { unit: unit.trim() } : {}),
      };

      await onSubmit(input);
      setTitle("");
      setUnit("");
      onClose();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to create habit");
      }
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Create New Habit</h2>
          <button type="button" onClick={onClose} className="modal-close-btn">
            ✕
          </button>
        </div>

        {error && <div className="alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="modal-form">
          <label className="form-field">
            <span>Habit Title *</span>
            <input
              type="text"
              required
              placeholder="e.g. Morning 20m Meditation"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="ui-input"
            />
          </label>

          <div className="form-row">
            <label className="form-field">
              <span>Category</span>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="ui-input"
              />
            </label>

            <label className="form-field">
              <span>Target Type</span>
              <select
                value={targetType}
                onChange={(e) => {
                  const val = e.target.value as HabitTargetType;
                  setTargetType(val);
                  if (val === "BOOLEAN") {
                    setTargetValue("1");
                    setUnit("");
                  }
                }}
                className="ui-select"
              >
                <option value="BOOLEAN">Simple Completion (Yes/No)</option>
                <option value="NUMERIC">Numeric Count (e.g. Glasses, Pages)</option>
                <option value="DURATION">Duration in Minutes</option>
              </select>
            </label>
          </div>

          {targetType !== "BOOLEAN" && (
            <div className="form-row">
              <label className="form-field">
                <span>Target Value *</span>
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  required
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  className="ui-input"
                />
              </label>

              <label className="form-field">
                <span>Unit (optional)</span>
                <input
                  type="text"
                  placeholder="e.g. pages, mins, km"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="ui-input"
                />
              </label>
            </div>
          )}

          <label className="form-field">
            <span>Recurrence Cadence</span>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as RecurrenceType)}
              className="ui-select"
            >
              <option value="DAILY">Daily (7 days / week)</option>
              <option value="WEEKDAY_MASK">Weekdays Only (Mon-Fri)</option>
              <option value="INTERVAL_DAYS">Custom Interval (Every N days)</option>
              <option value="X_TIMES_PER_WEEK">Flexible (X times per week)</option>
            </select>
          </label>

          {recurrence === "INTERVAL_DAYS" && (
            <label className="form-field">
              <span>Repeat every (days):</span>
              <input
                type="number"
                min="1"
                max="30"
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
                className="ui-input"
              />
            </label>
          )}

          {recurrence === "X_TIMES_PER_WEEK" && (
            <label className="form-field">
              <span>Target times per week:</span>
              <input
                type="number"
                min="1"
                max="7"
                value={frequencyPerWeek}
                onChange={(e) => setFrequencyPerWeek(e.target.value)}
                className="ui-input"
              />
            </label>
          )}

          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">
              Create Habit
            </button>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
