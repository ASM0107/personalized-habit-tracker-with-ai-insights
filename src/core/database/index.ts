export interface RecordBase {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type QueryFilter<T> = (record: T) => boolean;

export interface StoragePort<T extends RecordBase> {
  insert(record: T): Promise<void>;
  update(id: string, mutator: (current: T) => T): Promise<T>;
  delete(id: string): Promise<boolean>;
  getById(id: string): Promise<T | null>;
  query(filter?: QueryFilter<T>): Promise<readonly T[]>;
  clear(): Promise<void>;
}

export class InMemoryStoragePort<T extends RecordBase> implements StoragePort<T> {
  private readonly table = new Map<string, T>();

  public async insert(record: T): Promise<void> {
    if (this.table.has(record.id)) {
      throw new Error(`Record with id ${record.id} already exists`);
    }
    this.table.set(record.id, Object.freeze({ ...record }));
  }

  public async update(id: string, mutator: (current: T) => T): Promise<T> {
    const existing = this.table.get(id);
    if (!existing) {
      throw new Error(`Record with id ${id} not found`);
    }
    const updated = Object.freeze(mutator(existing));
    this.table.set(id, updated);
    return updated;
  }

  public async delete(id: string): Promise<boolean> {
    return this.table.delete(id);
  }

  public async getById(id: string): Promise<T | null> {
    const record = this.table.get(id);
    return record ? Object.freeze({ ...record }) : null;
  }

  public async query(filter?: QueryFilter<T>): Promise<readonly T[]> {
    const records = Array.from(this.table.values());
    if (!filter) {
      return Object.freeze([...records]);
    }
    return Object.freeze(records.filter(filter));
  }

  public async clear(): Promise<void> {
    this.table.clear();
  }
}

export * from "./local-storage.js";
