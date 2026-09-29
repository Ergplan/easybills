import 'server-only';

import { randomUUID } from 'node:crypto';

import type { SavedItemRecord } from '@/lib/domain/types';
import { insertDoc, patchDoc, queryDocs } from '@/server/db/docs';
import { pool } from '@/server/db/pool';

/**
 * The saved-item catalogue is an optional convenience, never a prerequisite.
 * An item is only stored when the owner explicitly chooses "Save for next time",
 * and changing a saved price NEVER rewrites an existing invoice or an agreed
 * recurring price -- those carry their own copy of the figure.
 */

export async function listItems(businessId: string, limit = 300): Promise<SavedItemRecord[]> {
  const items = await queryDocs<SavedItemRecord>(pool(), 'items', businessId, {
    order: 'last_used_at desc nulls last',
    limit,
  });
  return items.filter((i) => !i.archived);
}

export async function createItem(
  businessId: string,
  input: Omit<SavedItemRecord, 'id' | 'archived' | 'createdAt' | 'updatedAt' | 'lastUsedAt'>,
): Promise<SavedItemRecord> {
  const now = new Date().toISOString();
  const record: SavedItemRecord = {
    ...input,
    id: randomUUID(),
    archived: false,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
  };
  await insertDoc(pool(), 'items', businessId, record.id, record);
  return record;
}

export async function touchItem(businessId: string, itemId: string): Promise<void> {
  await patchDoc(pool(), 'items', businessId, itemId, { lastUsedAt: new Date().toISOString() }).catch(() => undefined);
}

export async function archiveItem(businessId: string, itemId: string): Promise<void> {
  await patchDoc(pool(), 'items', businessId, itemId, { archived: true, updatedAt: new Date().toISOString() });
}
