import 'server-only';

import { randomUUID } from 'node:crypto';

import type { AuditEventRecord } from '@/lib/domain/types';
import { pool, type Db } from '@/server/db/pool';

/**
 * Append-only audit trail.
 *
 * `detail` is deliberately small and non-sensitive: it records WHAT changed and
 * by how much, never bank account numbers, full customer records, PANs or AI
 * prompts. Anything that would be uncomfortable in a log stays out of one.
 *
 * Pass the transaction's client as `db` and the row commits or rolls back with
 * the change it describes, so an audit row can never be orphaned.
 */
export async function recordAudit(
  businessId: string,
  event: Omit<AuditEventRecord, 'id' | 'at'> & { at?: string },
  db: Db = pool(),
): Promise<void> {
  const record: AuditEventRecord = {
    id: randomUUID(),
    at: event.at ?? new Date().toISOString(),
    actorUid: event.actorUid,
    actorKind: event.actorKind,
    action: event.action,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    detail: event.detail ?? null,
  };
  await db.query('insert into audit_events (business_id, id, at, data) values ($1, $2, $3, $4)', [
    businessId,
    record.id,
    record.at,
    JSON.stringify(record),
  ]);
}

/** Same, inside a transaction. Kept as a name so call sites read as they did. */
export const recordAuditInTransaction = (
  db: Db,
  businessId: string,
  event: Omit<AuditEventRecord, 'id' | 'at'> & { at?: string },
): Promise<void> => recordAudit(businessId, event, db);

export async function listAudit(businessId: string, limit = 100): Promise<AuditEventRecord[]> {
  const { rows } = await pool().query<{ data: AuditEventRecord }>(
    'select data from audit_events where business_id = $1 order by at desc limit $2',
    [businessId, limit],
  );
  return rows.map((r) => r.data);
}
