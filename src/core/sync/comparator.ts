export interface ComparableEnvelope {
  readonly lamportTimestamp: number;
  readonly deviceId: string;
  readonly operationId?: string | undefined;
}

export function isIncomingWinner(
  existing: ComparableEnvelope | null | undefined,
  incoming: ComparableEnvelope
): boolean {
  if (!existing) {
    return true;
  }
  if (incoming.lamportTimestamp > existing.lamportTimestamp) {
    return true;
  }
  if (incoming.lamportTimestamp < existing.lamportTimestamp) {
    return false;
  }
  if (incoming.deviceId !== existing.deviceId) {
    return incoming.deviceId > existing.deviceId;
  }
  const inOp = incoming.operationId || "";
  const exOp = existing.operationId || "";
  return inOp >= exOp;
}
