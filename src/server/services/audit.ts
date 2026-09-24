import 'server-only';

import { auditCol } from '@/server/firebase/paths';
import type { AuditEventRecord } from '@/lib/domain/types';

/**
 * Append-only audit trail.
 *
 * `detail` is deliberately small and non-sensitive: it records WHAT changed and
 * by how much, never bank account numbers, full customer records, PANs or AI
 * prompts. Anything that would be uncomfortable in a log stays out of one.
 */
export async function recordAudit(
  businessId: string,
  event: Omit<AuditEventRecord, 'id' | 'at'> & { at?: string },
): Promise<void> {
  const ref = auditCol(businessId).doc();
  const record: AuditEventRecord = {
    id: ref.id,
    at: event.at ?? new Date().toISOString(),
    actorUid: event.actorUid,
    actorKind: event.actorKind,
    action: event.action,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    detail: event.detail ?? null,
  };
  await ref.set(record);
}

/** Same, but inside an existing transaction so the audit row cannot be orphaned. */
export function recordAuditInTransaction(
  tx: FirebaseFirestore.Transaction,
  businessId: string,
  event: Omit<AuditEventRecord, 'id' | 'at'> & { at?: string },
): void {
  const ref = auditCol(businessId).doc();
  tx.set(ref, {
    id: ref.id,
    at: event.at ?? new Date().toISOString(),
    actorUid: event.actorUid,
    actorKind: event.actorKind,
    action: event.action,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    detail: event.detail ?? null,
  } satisfies AuditEventRecord);
}
