import 'server-only';

import { randomUUID } from 'node:crypto';

import type { SavedItemRecord } from '@/lib/domain/types';
import { itemsCol } from '@/server/firebase/paths';

/**
 * The saved-item catalogue is an optional convenience, never a prerequisite.
 * An item is only stored when the owner explicitly chooses "Save for next time",
 * and changing a saved price NEVER rewrites an existing invoice or an agreed
 * recurring price -- those carry their own copy of the figure.
 */

export async function listItems(businessId: string, limit = 300): Promise<SavedItemRecord[]> {
  const snap = await itemsCol(businessId).orderBy('lastUsedAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data() as SavedItemRecord).filter((i) => !i.archived);
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
  await itemsCol(businessId).doc(record.id).set(record);
  return record;
}

export async function touchItem(businessId: string, itemId: string): Promise<void> {
  await itemsCol(businessId).doc(itemId).update({ lastUsedAt: new Date().toISOString() }).catch(() => undefined);
}

export async function archiveItem(businessId: string, itemId: string): Promise<void> {
  await itemsCol(businessId).doc(itemId).update({ archived: true, updatedAt: new Date().toISOString() });
}
