import 'server-only';

import { randomUUID } from 'node:crypto';

import { askConfig } from '@/lib/env';
import type { AdjustmentRecord, InvoiceRecord, ProjectRecord } from '@/lib/domain/types';
import { billDocument, chunkText, projectDocument, type DocumentDraft } from '@/lib/search/documents';
import { pool, withTx } from '@/server/db/pool';

import { embed, toVector } from './embed';

/**
 * Keeping the search index in step with the records.
 *
 * Rather than every action remembering to re-index, `catchUp` compares each
 * issued bill's and contract's updatedAt with what was indexed and redoes the
 * ones that moved. It runs before a question is answered, so a payment
 * recorded a minute ago is already in the answer. Drafts are never indexed.
 */
export async function catchUp(businessId: string, limit = 300): Promise<number> {
  const stale = await pool().query<{ kind: 'bill' | 'project'; data: InvoiceRecord | ProjectRecord }>(
    `select 'bill' as kind, i.data from invoices i
       left join documents d on d.business_id = i.business_id and d.kind = 'bill' and d.source_id = i.id
     where i.business_id = $1 and i.status in ('issued', 'cancelled')
       and (d.id is null or d.source_updated_at is distinct from i.updated_at)
     union all
     select 'project' as kind, p.data from projects p
       left join documents d on d.business_id = p.business_id and d.kind = 'project' and d.source_id = p.id
     where p.business_id = $1 and (d.id is null or d.source_updated_at is distinct from p.data->>'updatedAt')
     limit $2`,
    [businessId, limit],
  );
  if (!stale.rows.length) return 0;

  const billIds = stale.rows.filter((r) => r.kind === 'bill').map((r) => r.data.id);
  const notes = billIds.length
    ? (
        await pool().query<{ data: AdjustmentRecord }>(
          'select data from adjustments where business_id = $1 and invoice_id = any($2)',
          [businessId, billIds],
        )
      ).rows.map((r) => r.data)
    : [];

  const drafts: DocumentDraft[] = stale.rows.map((r) =>
    r.kind === 'bill'
      ? billDocument(r.data as InvoiceRecord, notes.filter((n) => n.invoiceId === r.data.id))
      : projectDocument(r.data as ProjectRecord),
  );
  await writeDocuments(businessId, drafts);
  return drafts.length;
}

/** An old bill the owner uploaded: its text is kept so "Poocho" can find it. */
export async function indexUpload(businessId: string, filename: string, pages: string[], meta: Record<string, unknown> = {}): Promise<string | null> {
  const text = pages.join('\n\n').trim();
  if (text.replace(/\s/g, '').length < 20) return null;
  const draft: DocumentDraft = {
    id: `upload:${randomUUID()}`,
    kind: 'upload',
    sourceId: null,
    title: filename.slice(0, 120),
    sourceUpdatedAt: null,
    text,
    href: null,
  };
  await writeDocuments(businessId, [draft], meta);
  return draft.id;
}

export interface UploadedDocument {
  id: string;
  title: string;
  createdAt: string;
  chars: number;
}

export async function listUploads(businessId: string): Promise<UploadedDocument[]> {
  const { rows } = await pool().query<{ id: string; title: string; created_at: Date; chars: string }>(
    `select d.id, d.title, d.created_at, coalesce(sum(length(c.text)), 0) as chars
     from documents d left join chunks c on c.business_id = d.business_id and c.document_id = d.id
     where d.business_id = $1 and d.kind = 'upload'
     group by d.id, d.title, d.created_at order by d.created_at desc limit 200`,
    [businessId],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at.toISOString(), chars: Number(r.chars) }));
}

/** The owner's "Hata do". Only uploads: bills and contracts follow their records. */
export async function removeUpload(businessId: string, documentId: string): Promise<boolean> {
  const res = await pool().query("delete from documents where business_id = $1 and id = $2 and kind = 'upload'", [
    businessId,
    documentId,
  ]);
  return (res.rowCount ?? 0) > 0;
}

async function writeDocuments(businessId: string, drafts: DocumentDraft[], meta: Record<string, unknown> = {}): Promise<void> {
  const chunked = drafts.map((d) => ({ d, chunks: chunkText(d.text) }));
  // Embeddings first, outside the transaction: a slow API must not hold locks.
  const flat = chunked.flatMap((c) => c.chunks);
  const vectors = await embed(flat);
  const model = vectors ? askConfig().embeddingModel : null;

  let v = 0;
  await withTx(async (tx) => {
    for (const { d, chunks } of chunked) {
      await tx.query('delete from documents where business_id = $1 and id = $2', [businessId, d.id]);
      await tx.query(
        `insert into documents (business_id, id, kind, source_id, title, source_updated_at, data)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [businessId, d.id, d.kind, d.sourceId, d.title, d.sourceUpdatedAt, JSON.stringify({ ...meta, href: d.href })],
      );
      for (let i = 0; i < chunks.length; i += 1) {
        const vec = vectors?.[v];
        v += 1;
        await tx.query(
          'insert into chunks (business_id, document_id, ord, text, embedding, model) values ($1, $2, $3, $4, $5, $6)',
          [businessId, d.id, i, chunks[i], vec ? toVector(vec) : null, vec ? model : null],
        );
      }
    }
  });
}
