import 'server-only';

import { askConfig } from '@/lib/env';
import { ASK_INSTRUCTIONS, askUserMessage, citationsIn, fuseRanks, tsQueryFor, type Source } from '@/lib/search/documents';
import { pool } from '@/server/db/pool';

import { embed, toVector } from './embed';
import { catchUp } from './index-records';

export interface Hit {
  documentId: string;
  ord: number;
  kind: 'bill' | 'project' | 'upload';
  title: string;
  text: string;
  href: string | null;
}

export interface AskResult {
  question: string;
  /** Null when no model is configured, or it failed: the hits are shown instead. */
  answer: string | null;
  /** The records the answer cites, or the best hits when there is no answer. */
  sources: Hit[];
  mode: 'answer' | 'search' | 'nothing';
}

/**
 * The owner's records most relevant to a question: by words always, and by
 * meaning when embeddings exist, fused. Everything is scoped to one business.
 */
export async function searchRecords(businessId: string, question: string, k = 8): Promise<Hit[]> {
  const q = tsQueryFor(question);
  const lists: string[][] = [];
  const byKey = new Map<string, Hit>();
  const keep = (rows: Array<Hit & { href: string | null }>) => {
    lists.push(
      rows.map((r) => {
        const key = `${r.documentId}#${r.ord}`;
        byKey.set(key, r);
        return key;
      }),
    );
  };
  const select = `select c.document_id as "documentId", c.ord, d.kind, d.title, c.text, d.data->>'href' as href
     from chunks c join documents d on d.business_id = c.business_id and d.id = c.document_id
     where c.business_id = $1`;

  if (q) {
    const { rows } = await pool().query<Hit>(
      `${select} and c.tsv @@ to_tsquery('simple', $2)
       order by ts_rank(c.tsv, to_tsquery('simple', $2)) desc limit 20`,
      [businessId, q],
    );
    keep(rows);
  }
  const [vector] = (await embed([question])) ?? [];
  if (vector) {
    const { rows } = await pool().query<Hit>(
      `${select} and c.embedding is not null order by c.embedding <=> $2::vector limit 20`,
      [businessId, toVector(vector)],
    );
    keep(rows);
  }
  return fuseRanks(lists)
    .slice(0, k)
    .map((key) => byKey.get(key)!);
}

/**
 * "Poocho": answer a question from the owner's own records.
 *
 * The index is brought up to date first, then the best matches are handed to
 * the model as numbered records with instructions to answer only from them
 * and cite what it used. Without a key -- or if the model fails -- the owner
 * gets the matching records themselves, which is still an answer of a kind.
 */
export async function askRecords(businessId: string, question: string): Promise<AskResult> {
  const q = question.trim().slice(0, 500);
  await catchUp(businessId).catch((error) => console.error('[ekbill] search catch-up failed', (error as Error)?.message));
  const hits = await searchRecords(businessId, q);
  if (!hits.length) return { question: q, answer: null, sources: [], mode: 'nothing' };

  const config = askConfig();
  if (!config.enabled || !config.apiKey) return { question: q, answer: null, sources: hits.slice(0, 5), mode: 'search' };

  const sources: Source[] = hits.map((h, i) => ({ n: i + 1, title: h.title, text: h.text.slice(0, 1500) }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.answerModel,
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: 'system', content: ASK_INSTRUCTIONS },
          { role: 'user', content: askUserMessage(q, sources) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`model ${res.status}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const answer = (body.choices?.[0]?.message?.content ?? '').trim();
    if (!answer) throw new Error('empty answer');
    // Renumber the citations to match the list shown under the answer.
    const cited = citationsIn(answer, hits.length);
    const renumbered = answer.replace(/\[(\d{1,2})\]/g, (m, n) => {
      const at = cited.indexOf(Number(n));
      return at >= 0 ? `[${at + 1}]` : '';
    });
    return {
      question: q,
      answer: renumbered.replace(/\s+([.,])/g, '$1').trim(),
      sources: cited.length ? cited.map((n) => hits[n - 1]!) : hits.slice(0, 3),
      mode: 'answer',
    };
  } catch (error) {
    console.error('[ekbill] ask fell back to search results', (error as Error)?.message);
    return { question: q, answer: null, sources: hits.slice(0, 5), mode: 'search' };
  } finally {
    clearTimeout(timer);
  }
}
