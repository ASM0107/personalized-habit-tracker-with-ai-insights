import type { SyncCoordinator } from "./coordinator.js";
import type { RecordBase, StoragePort } from "../database/index.js";

export interface StoreSyncBindingOptions<T extends RecordBase> {
  readonly entityType: string;
  readonly storage: StoragePort<T>;
  readonly coordinator: SyncCoordinator;
  readonly onApplied?: (item: T, isDeleted: boolean) => Promise<void> | void;
}

export function bindStorageToSync<T extends RecordBase & { lamportTimestamp?: number }>(
  options: StoreSyncBindingOptions<T>
): () => void {
  const { entityType, storage, coordinator, onApplied } = options;

  coordinator.registerApplier(entityType, async (envelope) => {
    const entityId = envelope.entityId;
    const isDeleted = Boolean(envelope.isDeleted || envelope.tombstone);
    const incomingLamport = envelope.lamportTimestamp;
    const existing = await storage.getById(entityId);

    if (existing) {
      const existingLamport = existing.lamportTimestamp || 0;
      if (incomingLamport < existingLamport) {
        return;
      }
    }

    if (isDeleted) {
      if (existing) {
        await storage.delete(entityId);
        if (onApplied) {
          await onApplied(existing, true);
        }
      }
      return;
    }

    const payload = envelope.payload as T;
    if (existing) {
      await storage.update(entityId, () => payload);
    } else {
      await storage.insert(payload);
    }

    if (onApplied) {
      await onApplied(payload, false);
    }
  });

  return () => {
    coordinator.registerApplier(entityType, () => {});
  };
}
