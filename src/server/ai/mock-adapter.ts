import 'server-only';

import type { InterpretRequest } from './adapters';
import type { AiInterpretation } from './schema';

/**
 * Deterministic mock adapter.
 *
 * This is a REAL adapter, not a stub that returns a canned blob: it parses the
 * instruction with plain rules, so development and tests exercise the same
 * downstream pipeline (resolution, validation, recalculation) that a live
 * provider would feed. It is deliberately simple, and it obeys the same
 * contract: it never invents a price, never returns an identifier, and treats
 * the instruction as data.
 *
 * It is selected only when AI_LLM_PROVIDER=mock. It is never silently
 * substituted for a configured provider that fails.
 */

const NUMBER_WORDS: Record<string, number> = {
  // English
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, a: 1, an: 1,
  // Hindi, as commonly typed in Latin script by owners
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6,
  saat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12,
};

/**
 * A quantity token is either digits or one of the number words above -- never an
 * arbitrary word. Without this anchor the pattern below happily treats "Bill" as
 * the quantity and swallows the customer name into the item description.
 */
const QTY_TOKEN = `(\\d{1,6}|${Object.keys(NUMBER_WORDS).filter((w) => w.length > 1).join('|')})`;

function wordToNumber(word: string): number | null {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w in NUMBER_WORDS) return NUMBER_WORDS[w]!;
  return null;
}

/** Strip Indian amount separators and a trailing "rupaye"/"rupees"/"rs". */
function cleanAmount(raw: string): string | null {
  const m = /(\d[\d,]*(?:\.\d{1,2})?)/.exec(raw);
  if (!m) return null;
  const n = m[1]!.replace(/,/g, '');
  return /^\d{1,9}(\.\d{1,2})?$/.test(n) ? n : null;
}

export async function mockInterpret(req: InterpretRequest): Promise<AiInterpretation> {
  const text = req.instruction.trim();
  const lower = text.toLowerCase();

  const ambiguities: string[] = [];
  const missingFields: string[] = [];

  // --- customer -----------------------------------------------------------
  // Match against the candidate names we were given, which come only from the
  // caller's own business. Otherwise fall back to a name-shaped phrase.
  let customerHint: string | null = null;
  for (const name of req.candidateCustomerNames) {
    if (lower.includes(name.toLowerCase())) {
      customerHint = name;
      break;
    }
  }
  if (!customerHint) {
    // "Bill <Name> for ..." | "<Name> ko ..." | "for <Name>,"
    const patterns = [
      /\bbill\s+([A-Za-z][\w'.&-]*(?:\s+[A-Za-z][\w'.&-]*){0,3}?)\s+(?:for|ke|ko)\b/i,
      /^([A-Za-z][\w'.&-]*(?:\s+[A-Za-z][\w'.&-]*){0,3}?)\s+ko\b/i,
      /\bfor\s+([A-Z][\w'.&-]*(?:\s+[A-Z][\w'.&-]*){0,3})\b/,
    ];
    for (const re of patterns) {
      const m = re.exec(text);
      if (m?.[1]) {
        customerHint = m[1].trim();
        break;
      }
    }
  }

  // --- previous-invoice reference ----------------------------------------
  const referencesPreviousInvoice = /\b(same as last month|same as before|like last month|pichhle mahine)\b/i.test(text);

  // --- line items ---------------------------------------------------------
  const lines: AiInterpretation['lines'] = [];
  /**
   * Character ranges of the instruction that produced something.
   *
   * Without this, a fragment the patterns do not match -- "and some lining
   * material" -- is simply dropped, and the owner gets a bill missing an item
   * with nothing on screen to tell them. Anything substantive left unconsumed
   * is reported back as an ambiguity.
   */
  const consumed: Array<[number, number]> = [];

  // Pattern A: "<qty-word|number> <description> at <amount> each"
  const atEach = new RegExp(
    `\\b${QTY_TOKEN}\\s+([a-z][a-z\\s]{2,40}?)\\s+(?:at|@|for)\\s+(?:rs\\.?\\s*|\u20b9\\s*)?([\\d,]+(?:\\.\\d{1,2})?)\\s*(?:each|per|rupaye|rupees)?`,
    'gi',
  );
  for (const m of text.matchAll(atEach)) {
    if (m.index !== undefined) consumed.push([m.index, m.index + m[0].length]);
    const qty = /^\d+$/.test(m[1]!) ? Number(m[1]) : wordToNumber(m[1]!);
    const amount = cleanAmount(m[3]!);
    if (qty === null || amount === null) continue;
    const description = m[2]!.trim().replace(/\s+/g, ' ');
    if (!description) continue;
    lines.push({
      description: titleCase(description),
      quantity: String(qty),
      unitPriceQuoted: amount,
      amountIsLineTotal: false,
    });
  }

  // Pattern B (Hindi): "<qty> <description>, har <unit> <amount> rupaye"
  const harPattern = new RegExp(
    `\\b${QTY_TOKEN}\\s+([a-z][a-z\\s]{2,40}?)\\s*,?\\s*har\\s+\\w+\\s+(?:rs\\.?\\s*)?([\\d,]+)\\s*(?:rupaye|rupees|rs)?`,
    'i',
  );
  const harMatch = harPattern.exec(text);
  if (harMatch && !lines.length) {
    if (harMatch.index !== undefined) consumed.push([harMatch.index, harMatch.index + harMatch[0].length]);
    const qty = /^\d+$/.test(harMatch[1]!) ? Number(harMatch[1]) : wordToNumber(harMatch[1]!);
    const amount = cleanAmount(harMatch[3]!);
    if (qty !== null && amount !== null) {
      lines.push({
        description: titleCase(harMatch[2]!.trim()),
        quantity: String(qty),
        unitPriceQuoted: amount,
        amountIsLineTotal: false,
      });
    }
  }

  // Pattern C: "<description> of <amount>" / "<description> <amount>" as a flat total
  const ofPattern = /\b(?:and|plus|aur)\s+([a-z][a-z\s]{2,40}?)\s+(?:of|for|worth)\s+(?:rs\.?\s*|₹\s*)?([\d,]+(?:\.\d{1,2})?)/gi;
  for (const m of text.matchAll(ofPattern)) {
    if (m.index !== undefined) consumed.push([m.index, m.index + m[0].length]);
    const amount = cleanAmount(m[2]!);
    if (amount === null) continue;
    lines.push({
      description: titleCase(m[1]!.trim()),
      quantity: '1',
      unitPriceQuoted: amount,
      amountIsLineTotal: true,
    });
  }

  // Pattern D: "add one extra <description> for <amount>"
  const extraPattern = /\badd\s+(\d+|[a-z]+)?\s*(?:extra\s+)?([a-z][a-z\s]{2,40}?)\s+(?:for|at|@)\s+(?:rs\.?\s*|₹\s*)?([\d,]+(?:\.\d{1,2})?)/i;
  const extraMatch = extraPattern.exec(text);
  if (extraMatch) {
    if (extraMatch.index !== undefined) consumed.push([extraMatch.index, extraMatch.index + extraMatch[0].length]);
    const qty = extraMatch[1] ? (/^\d+$/.test(extraMatch[1]) ? Number(extraMatch[1]) : wordToNumber(extraMatch[1])) : 1;
    const amount = cleanAmount(extraMatch[3]!);
    if (amount !== null && !lines.some((l) => l.description.toLowerCase() === titleCase(extraMatch[2]!.trim()).toLowerCase())) {
      lines.push({
        description: titleCase(extraMatch[2]!.trim()),
        quantity: String(qty ?? 1),
        unitPriceQuoted: amount,
        amountIsLineTotal: false,
      });
    }
  }

  // A described item with no amount anywhere: keep it, flag the missing price.
  if (!lines.length) {
    const bare = /(?:bill|charge|invoice)\s+(?:[A-Za-z][\w'.&-]*\s+)*?for\s+([a-z][a-z\s]{2,60})/i.exec(text);
    if (bare?.[1]) {
      if (bare.index !== undefined) consumed.push([bare.index, bare.index + bare[0].length]);
      lines.push({ description: titleCase(bare[1].trim()), quantity: '1', unitPriceQuoted: null, amountIsLineTotal: false });
      missingFields.push(`Price for "${titleCase(bare[1].trim())}"`);
    }
  }

  for (const l of lines) {
    if (l.unitPriceQuoted === null) missingFields.push(`Price for "${l.description}"`);
  }

  for (const leftover of unconsumedFragments(text, consumed, customerHint)) {
    ambiguities.push(
      `we could not read "${leftover}" \u2014 add it by hand if it belongs on this bill`,
    );
  }
  if (!lines.length) ambiguities.push('We could not pick out any items from that instruction.');
  if (!customerHint) missingFields.push('Customer name');

  // --- recurrence ---------------------------------------------------------
  let recurring: AiInterpretation['recurring'] = null;
  if (/\b(every month|monthly|har mahine|repeat)\b/i.test(text)) {
    recurring = { action: 'start', effectiveFrom: null, note: 'Owner asked for a monthly repeat' };
  } else if (/\b(pause|rok)\b/i.test(text)) {
    recurring = { action: 'pause', effectiveFrom: null, note: null };
  } else if (/\b(stop|band karo|cancel the repeat)\b/i.test(text)) {
    recurring = { action: 'stop', effectiveFrom: null, note: null };
  } else if (/\bskip\b/i.test(text)) {
    recurring = { action: 'skip-one', effectiveFrom: null, note: null };
  }

  const intent: AiInterpretation['intent'] = recurring
    ? 'propose-schedule-change'
    : referencesPreviousInvoice
      ? 'duplicate-invoice'
      : 'create-draft';

  return {
    intent,
    customerHint,
    lines,
    explicitDates: [],
    recurring,
    missingFields: [...new Set(missingFields)],
    ambiguities,
    referencesPreviousInvoice,
  };
}

/**
 * Substantive parts of the instruction that no pattern matched.
 *
 * Filters out the connecting words and the customer's own name, so only text
 * that looks like it was meant to be billed is reported back.
 */
const FILLER = new Set([
  'bill', 'for', 'to', 'ko', 'and', 'plus', 'aur', 'the', 'a', 'an', 'of', 'please', 'charge',
  'invoice', 'ka', 'ke', 'ki', 'se', 'this', 'month', 'also', 'with', 'some', 'my', 'our',
]);

function unconsumedFragments(
  text: string,
  consumed: ReadonlyArray<[number, number]>,
  customerHint: string | null,
): string[] {
  if (!consumed.length) return [];
  const covered = [...consumed].sort((a, b) => a[0] - b[0]);

  const gaps: string[] = [];
  let cursor = 0;
  for (const [start, end] of covered) {
    if (start > cursor) gaps.push(text.slice(cursor, start));
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) gaps.push(text.slice(cursor));

  const hint = (customerHint ?? '').toLowerCase();
  const out: string[] = [];

  for (const raw of gaps) {
    const fragment = raw.replace(/[.,;]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!fragment) continue;
    const words = fragment.split(' ').filter(Boolean);
    const meaningful = words.filter(
      (w) => !FILLER.has(w.toLowerCase()) && !hint.includes(w.toLowerCase()) && /[a-z]/i.test(w),
    );
    // Two or more real words is a phrase somebody meant, not leftover grammar.
    if (meaningful.length >= 2) out.push(meaningful.join(' '));
  }
  return out.slice(0, 3);
}

function titleCase(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Mock transcription.
 *
 * It cannot actually hear anything, and it says so rather than fabricating a
 * plausible sentence -- a fake transcript would be indistinguishable from a real
 * one to the owner, which is exactly the kind of fiction this build refuses.
 */
export async function mockTranscribe(audio: Blob): Promise<string> {
  const seconds = Math.max(1, Math.round(audio.size / 16000));
  return `[Mock transcription: ${seconds}s of audio received. No speech provider is configured, so nothing was actually transcribed. Type your instruction instead, or set AI_TRANSCRIPTION_PROVIDER.]`;
}
