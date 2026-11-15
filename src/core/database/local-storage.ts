import type { QueryFilter, RecordBase, StoragePort } from "./index.js";

export class BrowserLocalStoragePort<T extends RecordBase> implements StoragePort<T> {
  private readonly storageKey: string;
  private readonly memoryFallback = new Map<string, T>();

  public constructor(collectionName: string) {
    this.storageKey = `habit_tracker_${collectionName}`;
    this.hydrateFromStorage();
  }

  private hydrateFromStorage(): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as readonly T[];
        for (const item of parsed) {
          this.memoryFallback.set(item.id, Object.freeze({ ...item }));
        }
      }
    } catch {
      this.memoryFallback.clear();
    }
  }

  private persistToStorage(): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      const allRecords = Array.from(this.memoryFallback.values());
      window.localStorage.setItem(this.storageKey, JSON.stringify(allRecords));
    } catch {
      return;
    }
  }

  public async insert(record: T): Promise<void> {
    if (this.memoryFallback.has(record.id)) {
      throw new Error(`Record with id ${record.id} already exists`);
    }
    this.memoryFallback.set(record.id, Object.freeze({ ...record }));
    this.persistToStorage();
  }

  public async update(id: string, mutator: (current: T) => T): Promise<T> {
    const existing = this.memoryFallback.get(id);
    if (!existing) {
      throw new Error(`Record with id ${id} not found`);
    }
    const updated = Object.freeze(mutator(existing));
    this.memoryFallback.set(id, updated);
    this.persistToStorage();
    return updated;
  }

  public async delete(id: string): Promise<boolean> {
    const deleted = this.memoryFallback.delete(id);
    if (deleted) {
      this.persistToStorage();
    }
    return deleted;
  }

  public async getById(id: string): Promise<T | null> {
    const record = this.memoryFallback.get(id);
    return record ? Object.freeze({ ...record }) : null;
  }

  public async query(filter?: QueryFilter<T>): Promise<readonly T[]> {
    const records = Array.from(this.memoryFallback.values());
    if (!filter) {
      return Object.freeze([...records]);
    }
    return Object.freeze(records.filter(filter));
  }

  public async clear(): Promise<void> {
    this.memoryFallback.clear();
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(this.storageKey);
    }
  }
}
