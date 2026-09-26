/**
 * What the browser does with what the model asked for.
 *
 * The model returns a customer name the way the owner said it; this finds
 * the record it meant, or says there is none. It turns the lines the model
 * heard into the bill form's three fields, dropping anything that is not a
 * line. And it writes the "who owes" answer the model reads out.
 */
import { moneyForMessage } from '@/lib/copy/messages';
import type { LineDraft } from '@/lib/domain/bill-form';

import type { VoiceCustomer, VoiceDue } from './session';

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(sample\)/g, '')
    .replace(/\b(ji|sahab|saheb|bhai|sir|madam|ka|ki|ke|ko)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return norm(s).split(' ').filter((t) => t.length > 1);
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
}

/**
 * The customer the owner meant. Exact after normalising, then every spoken
 * token found in the name (so "Mehta" finds "Mehta Traders"), then a name
 * within a couple of letters of what was said, for the mishearings a speech
 * model makes. Two customers that match equally well is no match: the owner
 * is asked, not guessed for.
 */
export function matchCustomer(spoken: string, customers: VoiceCustomer[]): VoiceCustomer | null {
  const said = norm(spoken);
  if (!said) return null;
  const exact = customers.filter((c) => norm(c.name) === said);
  if (exact.length === 1) return exact[0]!;

  const saidTokens = tokens(spoken);
  const byTokens = customers.filter((c) => {
    const nameTokens = tokens(c.name);
    return saidTokens.length > 0 && saidTokens.every((t) => nameTokens.some((n) => n.startsWith(t) || t.startsWith(n)));
  });
  if (byTokens.length === 1) return byTokens[0]!;

  const close = customers
    .map((c) => ({ c, d: editDistance(norm(c.name), said) }))
    .filter(({ c, d }) => d <= Math.max(1, Math.floor(norm(c.name).length / 5)))
    .sort((a, b) => a.d - b.d);
  if (close.length === 1 || (close.length > 1 && close[0]!.d < close[1]!.d)) return close[0]!.c;
  return null;
}

interface SpokenLine {
  what?: unknown;
  qty?: unknown;
  rate?: unknown;
}

/** The lines the model heard, as the form takes them. Nonsense is dropped, not guessed. */
export function linesFromSpeech(raw: unknown, newId: () => string): LineDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: LineDraft[] = [];
  for (const item of raw as SpokenLine[]) {
    const what = typeof item?.what === 'string' ? item.what.trim().slice(0, 300) : '';
    const rate = Number(item?.rate);
    const qty = item?.qty === undefined || item?.qty === null || item?.qty === '' ? 1 : Number(item.qty);
    if (!what || !Number.isFinite(rate) || rate < 0 || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({ id: newId(), what, qty: String(qty), rate: String(rate) });
  }
  return out;
}

/** The answer to "kiske paise aane hain", for the model to read out. */
export function whoOwesReply(due: VoiceDue[]): string {
  if (!due.length) return 'Koi paise baaki nahi. Sab aa gaye.';
  const total = due.reduce((s, d) => s + d.amountPaise, 0);
  const rows = [...due]
    .sort((a, b) => b.amountPaise - a.amountPaise)
    .slice(0, 6)
    .map((d) => `${d.customerName}: ${moneyForMessage(d.amountPaise)}, ${d.days} din`);
  return `Total ${moneyForMessage(total)} baaki, ${due.length} bills. ${rows.join('. ')}.`;
}

/** Where a voice-started bill's lines wait for the form to open. */
export const PREFILL_KEY = (invoiceId: string) => `ekbill.voice.prefill:${invoiceId}`;
