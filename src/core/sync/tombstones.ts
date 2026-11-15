export interface EntityTombstone {
  readonly entityId: string;
  readonly entityType: string;
  readonly lamportTimestamp: number;
  readonly deviceId: string;
  readonly operationId?: string | undefined;
  readonly deletedAt: number;
}

export class LocalTombstoneStore {
  private readonly storageKey: string;
  private readonly tombstones = new Map<string, EntityTombstone>();

  public constructor(partitionKey = "default") {
    this.storageKey = `habit_tracker_${partitionKey}_tombstones`;
    this.hydrate();
  }

  private getCompositeKey(entityType: string, entityId: string): string {
    return `${entityType}:${entityId}`;
  }

  private hydrate(): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (
              item &&
              typeof item === "object" &&
              typeof item.entityId === "string" &&
              typeof item.entityType === "string"
            ) {
              this.tombstones.set(this.getCompositeKey(item.entityType, item.entityId), item);
            }
          }
        }
      }
    } catch {
      this.tombstones.clear();
    }
  }

  private persist(): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    const list = Array.from(this.tombstones.values());
    if (list.length === 0) {
      window.localStorage.removeItem(this.storageKey);
    } else {
      window.localStorage.setItem(this.storageKey, JSON.stringify(list));
    }
  }

  public getTombstone(entityType: string, entityId: string): EntityTombstone | undefined {
    return this.tombstones.get(this.getCompositeKey(entityType, entityId));
  }

  public recordTombstone(tombstone: EntityTombstone): void {
    this.tombstones.set(this.getCompositeKey(tombstone.entityType, tombstone.entityId), tombstone);
    this.persist();
  }

  public removeTombstone(entityType: string, entityId: string): void {
    const key = this.getCompositeKey(entityType, entityId);
    if (this.tombstones.has(key)) {
      this.tombstones.delete(key);
      this.persist();
    }
  }

  public clear(): void {
    this.tombstones.clear();
    this.persist();
  }
}
