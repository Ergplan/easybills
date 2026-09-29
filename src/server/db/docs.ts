import 'server-only';

import type { Db } from './pool';

/**
 * Reading and writing records that live in a `data jsonb` column.
 *
 * Every business-owned table has the key (business_id, id). Asking for a record
 * without the business id is not possible through these helpers, which keeps
 * "which business does this belong to?" a property of every query rather than
 * a filter somebody might forget.
 */
export type BusinessTable = 'customers' | 'items' | 'invoices' | 'payments' | 'adjustments' | 'projects';

export async function getDoc<T>(
  db: Db,
  table: BusinessTable,
  businessId: string,
  id: string,
  opts: { lock?: boolean } = {},
): Promise<T | null> {
  const { rows } = await db.query<{ data: T }>(
    `select data from ${table} where business_id = $1 and id = $2${opts.lock ? ' for update' : ''}`,
    [businessId, id],
  );
  return rows[0]?.data ?? null;
}

/** Insert a new record. Fails with a unique violation if the id is taken. */
export async function insertDoc(db: Db, table: BusinessTable, businessId: string, id: string, data: object): Promise<void> {
  await db.query(`insert into ${table} (business_id, id, data) values ($1, $2, $3)`, [businessId, id, JSON.stringify(data)]);
}

/** Write a record whole, creating it if needed. */
export async function putDoc(db: Db, table: BusinessTable, businessId: string, id: string, data: object): Promise<void> {
  await db.query(
    `insert into ${table} (business_id, id, data) values ($1, $2, $3)
     on conflict (business_id, id) do update set data = excluded.data`,
    [businessId, id, JSON.stringify(data)],
  );
}

/**
 * Merge top-level fields into a record. Returns false when there is no such
 * record, so a caller that needs one can say so.
 */
export async function patchDoc(
  db: Db,
  table: BusinessTable,
  businessId: string,
  id: string,
  patch: object,
): Promise<boolean> {
  const res = await db.query(`update ${table} set data = data || $3::jsonb where business_id = $1 and id = $2`, [
    businessId,
    id,
    JSON.stringify(dropUndefined(patch)),
  ]);
  return (res.rowCount ?? 0) > 0;
}

export async function deleteDoc(db: Db, table: BusinessTable, businessId: string, id: string): Promise<void> {
  await db.query(`delete from ${table} where business_id = $1 and id = $2`, [businessId, id]);
}

/**
 * Records of one business matching a SQL condition. `where` and `order` are
 * written by this codebase, never by a user; values go in `params`, numbered
 * from $2 ($1 is the business id).
 */
export async function queryDocs<T>(
  db: Db,
  table: BusinessTable,
  businessId: string,
  opts: { where?: string; params?: unknown[]; order?: string; limit?: number } = {},
): Promise<T[]> {
  const sql = [
    `select data from ${table} where business_id = $1`,
    opts.where ? `and (${opts.where})` : '',
    opts.order ? `order by ${opts.order}` : '',
    `limit ${Math.max(1, Math.min(opts.limit ?? 500, 5000))}`,
  ].join(' ');
  const { rows } = await db.query<{ data: T }>(sql, [businessId, ...(opts.params ?? [])]);
  return rows.map((r) => r.data);
}

/** JSON has no `undefined`; an optional field left out means "leave as is". */
export function dropUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
