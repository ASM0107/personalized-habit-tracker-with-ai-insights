import type { StoragePort } from "../../../core/database/index.js";
import type { EventBusPort } from "../../../core/event-bus/index.js";
import type { ClockPort } from "../../../core/sync/index.js";
import type {
  Habit,
  HabitEntry,
  HabitTargetType,
  HabitSchedule,
  HabitHistorySummary,
} from "../types/index.js";
import { HabitValidator } from "../logic/validator.js";
import { HabitScheduler } from "../logic/scheduler.js";

export interface CreateHabitInput {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly category: string;
  readonly targetType: HabitTargetType;
  readonly targetValue: number;
  readonly unit?: string;
  readonly schedule: HabitSchedule;
}

export interface UpdateHabitInput {
  readonly title?: string;
  readonly description?: string;
  readonly category?: string;
  readonly targetValue?: number;
  readonly unit?: string;
  readonly schedule?: HabitSchedule;
}

export interface CheckInInput {
  readonly habitId: string;
  readonly dateKey: string;
  readonly recordedValue: number;
  readonly isIncremental?: boolean;
  readonly notes?: string;
}

export class HabitStore {
  private readonly habitStorage: StoragePort<Habit>;
  private readonly entryStorage: StoragePort<HabitEntry>;
  private readonly eventBus: EventBusPort;
  private readonly clock: ClockPort;

  public constructor(
    habitStorage: StoragePort<Habit>,
    entryStorage: StoragePort<HabitEntry>,
    eventBus: EventBusPort,
    clock: ClockPort
  ) {
    this.habitStorage = habitStorage;
    this.entryStorage = entryStorage;
    this.eventBus = eventBus;
    this.clock = clock;
  }

  public async createHabit(input: CreateHabitInput): Promise<Habit> {
    HabitValidator.validateTitle(input.title);
    HabitValidator.validateTarget(input.targetType, input.targetValue);
    HabitValidator.validateSchedule(input.schedule);

    const now = Date.now();
    const habit: Habit = {
      id: input.id,
      title: input.title.trim(),
      ...(input.description ? { description: input.description.trim() } : {}),
      category: input.category.trim(),
      targetType: input.targetType,
      targetValue: input.targetValue,
      ...(input.unit ? { unit: input.unit.trim() } : {}),
      schedule: input.schedule,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };

    await this.habitStorage.insert(habit);
    this.eventBus.publish({
      id: `evt-${input.id}-${now}`,
      type: "HABIT_CREATED",
      timestamp: now,
      payload: {
        habitId: habit.id,
        title: habit.title,
        targetValue: habit.targetValue,
      },
    });

    return habit;
  }

  public async updateHabit(id: string, input: UpdateHabitInput): Promise<Habit> {
    if (input.title !== undefined) {
      HabitValidator.validateTitle(input.title);
    }
    if (input.schedule !== undefined) {
      HabitValidator.validateSchedule(input.schedule);
    }

    const now = Date.now();
    return this.habitStorage.update(id, (existing) => {
      if (input.targetValue !== undefined) {
        HabitValidator.validateTarget(existing.targetType, input.targetValue);
      }
      return {
        ...existing,
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.category !== undefined ? { category: input.category.trim() } : {}),
        ...(input.targetValue !== undefined ? { targetValue: input.targetValue } : {}),
        ...(input.unit !== undefined ? { unit: input.unit.trim() } : {}),
        ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
        updatedAt: now,
      };
    });
  }

  public async archiveHabit(id: string): Promise<Habit> {
    return this.habitStorage.update(id, (existing) => ({
      ...existing,
      status: "ARCHIVED",
      updatedAt: Date.now(),
    }));
  }

  public async unarchiveHabit(id: string): Promise<Habit> {
    return this.habitStorage.update(id, (existing) => ({
      ...existing,
      status: "ACTIVE",
      updatedAt: Date.now(),
    }));
  }

  public async deleteHabit(id: string): Promise<boolean> {
    const entries = await this.entryStorage.query((e) => e.habitId === id);
    for (const entry of entries) {
      await this.entryStorage.delete(entry.id);
    }
    return this.habitStorage.delete(id);
  }

  public async recordCheckIn(input: CheckInInput): Promise<HabitEntry> {
    HabitValidator.validateDateKey(input.dateKey);

    const habit = await this.habitStorage.getById(input.habitId);
    if (!habit) {
      throw new Error(`Habit not found with id ${input.habitId}`);
    }

    const now = Date.now();
    const entryId = `${input.habitId}-${input.dateKey}`;
    const lamport = this.clock.increment();

    const existingEntry = await this.entryStorage.getById(entryId);
    const currentValue = existingEntry && input.isIncremental ? existingEntry.recordedValue : 0;
    const finalRecordedValue = currentValue + input.recordedValue;
    const isCompleted = finalRecordedValue >= habit.targetValue;
    const status = isCompleted ? "COMPLETED" : finalRecordedValue > 0 ? "PARTIAL" : "MISSED";

    let entry: HabitEntry;

    if (existingEntry) {
      entry = await this.entryStorage.update(entryId, (current) => ({
        ...current,
        recordedValue: finalRecordedValue,
        targetValueSnapshot: habit.targetValue,
        status,
        ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
        updatedAt: now,
        lamportTimestamp: lamport,
      }));
    } else {
      entry = {
        id: entryId,
        habitId: input.habitId,
        dateKey: input.dateKey,
        recordedValue: finalRecordedValue,
        targetValueSnapshot: habit.targetValue,
        status,
        ...(input.notes ? { notes: input.notes.trim() } : {}),
        createdAt: now,
        updatedAt: now,
        lamportTimestamp: lamport,
      };
      await this.entryStorage.insert(entry);
    }

    this.eventBus.publish({
      id: `evt-${entryId}-${now}`,
      type: "HABIT_COMPLETED",
      timestamp: now,
      payload: {
        habitId: input.habitId,
        dateKey: input.dateKey,
        recordedValue: finalRecordedValue,
        isFullCompletion: isCompleted,
      },
    });

    return entry;
  }

  public async skipHabit(habitId: string, dateKey: string, reason: string): Promise<HabitEntry> {
    HabitValidator.validateDateKey(dateKey);

    const habit = await this.habitStorage.getById(habitId);
    if (!habit) {
      throw new Error(`Habit not found with id ${habitId}`);
    }

    const now = Date.now();
    const entryId = `${habitId}-${dateKey}`;
    const lamport = this.clock.increment();

    const existingEntry = await this.entryStorage.getById(entryId);
    let entry: HabitEntry;

    if (existingEntry) {
      entry = await this.entryStorage.update(entryId, (current) => ({
        ...current,
        status: "SKIPPED",
        skipReason: reason.trim(),
        updatedAt: now,
        lamportTimestamp: lamport,
      }));
    } else {
      entry = {
        id: entryId,
        habitId,
        dateKey,
        recordedValue: 0,
        targetValueSnapshot: habit.targetValue,
        status: "SKIPPED",
        skipReason: reason.trim(),
        createdAt: now,
        updatedAt: now,
        lamportTimestamp: lamport,
      };
      await this.entryStorage.insert(entry);
    }

    this.eventBus.publish({
      id: `evt-${entryId}-${now}`,
      type: "HABIT_SKIPPED",
      timestamp: now,
      payload: {
        habitId,
        dateKey,
        reason: reason.trim(),
      },
    });

    return entry;
  }

  public async revertCheckIn(habitId: string, dateKey: string): Promise<boolean> {
    const entryId = `${habitId}-${dateKey}`;
    return this.entryStorage.delete(entryId);
  }

  public async getHabit(id: string): Promise<Habit | null> {
    return this.habitStorage.getById(id);
  }

  public async getAllActiveHabits(): Promise<readonly Habit[]> {
    return this.habitStorage.query((h) => h.status === "ACTIVE");
  }

  public async getDueHabits(dateKey: string): Promise<readonly Habit[]> {
    const activeHabits = await this.getAllActiveHabits();
    return activeHabits.filter((h) => HabitScheduler.isHabitDue(h, dateKey));
  }

  public async getPendingHabits(dateKey: string): Promise<readonly Habit[]> {
    const dueHabits = await this.getDueHabits(dateKey);
    const pending: Habit[] = [];

    for (const habit of dueHabits) {
      const entryId = `${habit.id}-${dateKey}`;
      const entry = await this.entryStorage.getById(entryId);
      if (!entry || entry.status !== "COMPLETED") {
        pending.push(habit);
      }
    }

    return Object.freeze(pending);
  }

  public async getHabitHistory(
    habitId: string,
    startDateKey: string,
    endDateKey: string
  ): Promise<HabitHistorySummary> {
    HabitValidator.validateDateKey(startDateKey);
    HabitValidator.validateDateKey(endDateKey);

    const habit = await this.habitStorage.getById(habitId);
    if (!habit) {
      throw new Error(`Habit not found with id ${habitId}`);
    }

    const entries = await this.entryStorage.query(
      (e) => e.habitId === habitId && e.dateKey >= startDateKey && e.dateKey <= endDateKey
    );

    let totalCompleted = 0;
    let totalPartial = 0;
    let totalSkipped = 0;

    for (const entry of entries) {
      if (entry.status === "COMPLETED") {
        totalCompleted += 1;
      } else if (entry.status === "PARTIAL") {
        totalPartial += 1;
      } else if (entry.status === "SKIPPED") {
        totalSkipped += 1;
      }
    }

    const totalDays = entries.length;
    const completionRate = totalDays > 0 ? Math.round((totalCompleted / totalDays) * 100) / 100 : 0;

    return {
      habit,
      entries,
      totalDaysTracked: totalDays,
      totalCompleted,
      totalPartial,
      totalSkipped,
      completionRate,
    };
  }

  public async getEntriesForHabit(habitId: string): Promise<readonly HabitEntry[]> {
    return this.entryStorage.query((e) => e.habitId === habitId);
  }
}
