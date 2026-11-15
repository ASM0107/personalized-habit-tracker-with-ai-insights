import type { SyncCoordinator } from "./coordinator.js";
import type { RecordBase, StoragePort } from "../database/index.js";
import { isIncomingWinner, type ComparableEnvelope } from "./comparator.js";
import { LocalTombstoneStore } from "./tombstones.js";

export interface StoreSyncBindingOptions<T extends RecordBase> {
  readonly entityType: string;
  readonly storage: StoragePort<T>;
  readonly coordinator: SyncCoordinator;
  readonly tombstoneStore?: LocalTombstoneStore;
  readonly onApplied?: (item: T, isDeleted: boolean) => Promise<void> | void;
}

export function bindStorageToSync<
  T extends RecordBase & {
    lamportTimestamp?: number;
    deviceId?: string;
    operationId?: string;
  }
>(options: StoreSyncBindingOptions<T>): () => void {
  const { entityType, storage, coordinator, onApplied } = options;
  const tombstoneStore = options.tombstoneStore ?? new LocalTombstoneStore("default");

  coordinator.registerApplier(entityType, async (envelope) => {
    const entityId = envelope.entityId;
    const isDeleted = Boolean(envelope.isDeleted || envelope.tombstone);
    const incomingComparable: ComparableEnvelope = {
      lamportTimestamp: envelope.lamportTimestamp,
      deviceId: envelope.deviceId,
      operationId: envelope.operationId,
    };

    const existingTombstone = tombstoneStore.getTombstone(entityType, entityId);
    if (existingTombstone) {
      if (!isIncomingWinner(existingTombstone, incomingComparable)) {
        return;
      }
    }

    const existing = await storage.getById(entityId);
    if (existing) {
      const existingComparable: ComparableEnvelope = {
        lamportTimestamp: existing.lamportTimestamp ?? 0,
        deviceId: existing.deviceId ?? "",
        operationId: existing.operationId ?? "",
      };
      if (!isIncomingWinner(existingComparable, incomingComparable)) {
        return;
      }
    }

    if (isDeleted) {
      tombstoneStore.recordTombstone({
        entityId,
        entityType,
        lamportTimestamp: envelope.lamportTimestamp,
        deviceId: envelope.deviceId,
        operationId: envelope.operationId,
        deletedAt: Date.now(),
      });

      if (existing) {
        await storage.delete(entityId);
        if (onApplied) {
          await onApplied(existing, true);
        }
      }
      return;
    }

    tombstoneStore.removeTombstone(entityType, entityId);

    const payload = envelope.payload as T;
    const itemToStore: T = {
      ...payload,
      lamportTimestamp: envelope.lamportTimestamp,
      deviceId: envelope.deviceId,
      operationId: envelope.operationId,
    };

    if (existing) {
      await storage.update(entityId, () => itemToStore);
    } else {
      await storage.insert(itemToStore);
    }

    if (onApplied) {
      await onApplied(itemToStore, false);
    }
  });

  return () => {
    coordinator.registerApplier(entityType, () => {});
  };
}
