import 'server-only';

import { askConfig } from '@/lib/env';

/**
 * Embeddings for search by meaning. Null when no key is configured or the
 * call fails: search then runs on words alone, which is what it always does
 * underneath anyway.
 */
export async function embed(texts: string[]): Promise<number[][] | null> {
  const config = askConfig();
  if (!config.enabled || !config.apiKey || !texts.length) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(`${config.baseUrl}/v1/embeddings`, {
      method: 'POST',
      signal: controller.signal,
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.embeddingModel,
        input: texts.map((t) => t.slice(0, 8000)),
        dimensions: config.embeddingDimensions,
      }),
    });
    if (!res.ok) throw new Error(`embeddings ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ index: number; embedding: number[] }> };
    const out: number[][] = new Array(texts.length);
    for (const d of body.data ?? []) out[d.index] = d.embedding;
    return out.every((e) => Array.isArray(e) && e.length === config.embeddingDimensions) ? out : null;
  } catch (error) {
    console.error('[ekbill] embeddings unavailable, searching by words', (error as Error)?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** pgvector's text form: "[0.1,0.2,...]". */
export const toVector = (v: number[]) => `[${v.join(',')}]`;
