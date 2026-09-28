/**
 * "Mera bill thoda complex hai": a bill that is a share of a bigger deal.
 *
 * A contractor agrees a job once -- five lakh, plus GST, thirty percent
 * advance, forty on delivery, thirty after installation, five percent held
 * back till the end -- and then raises three or four bills against it over
 * months, each one a percentage the owner has to work out on a calculator
 * and remember what was billed before. This module is that calculator.
 *
 * Percentages are basis points (10000 = 100%) and money is paise, as
 * everywhere else, so nothing here is a float that can be a paisa off.
 * The last instalment is always "what is left", so rounding never leaves a
 * contract a rupee short or over.
 */
import { t } from '@/lib/copy';
import { moneyForMessage } from '@/lib/copy/messages';

export type GstMode = 'extra' | 'included' | 'none';
export type BillingMode = 'milestones' | 'progress';

export interface Milestone {
  id: string;
  /** Printed on the bill, so usually English: "Advance", "On delivery". */
  label: string;
  pctBp: number;
}

export interface ContractTerms {
  name: string;
  /** The contract value exactly as agreed, in paise. */
  totalPaise: number;
  /** Whether GST is on top of that value, inside it, or not charged. */
  gstMode: GstMode;
  gstRateBp: number | null;
  billing: BillingMode;
  milestones: Milestone[];
  /** Share of each bill the customer holds back until completion. 0 for none. */
  retentionBp: number;
}

/** A bill already raised against the contract. Cancelled bills are not here. */
export interface BilledEntry {
  invoiceId: string;
  number: string | null;
  milestoneId: string | null;
  /** In contract terms: what this bill counted towards the contract value. */
  basisPaise: number;
  /** For a progress bill, how much of the work it billed up to. */
  cumulativeBp: number | null;
  status: 'issued' | 'draft';
}

export type TermsCheck = { ok: true; terms: ContractTerms } | { ok: false; field: keyof ContractTerms; message: string };

export const MAX_MILESTONES = 12;

export const PRESETS: Record<string, Array<{ label: string; pctBp: number }>> = {
  '50-50': [
    { label: 'Advance', pctBp: 5000 },
    { label: 'On completion', pctBp: 5000 },
  ],
  '30-40-30': [
    { label: 'Advance', pctBp: 3000 },
    { label: 'On delivery', pctBp: 4000 },
    { label: 'On installation', pctBp: 3000 },
  ],
  '20-40-40': [
    { label: 'Advance', pctBp: 2000 },
    { label: 'On delivery', pctBp: 4000 },
    { label: 'On completion', pctBp: 4000 },
  ],
};

export function pctText(bp: number): string {
  const s = (bp / 100).toFixed(2);
  return s.replace(/\.?0+$/, '');
}

export function checkTerms(terms: ContractTerms, opts: { chargesGst: boolean; allowedRatesBp: readonly number[] }): TermsCheck {
  const name = terms.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, field: 'name', message: t('error.required') };
  if (!Number.isInteger(terms.totalPaise) || terms.totalPaise <= 0 || terms.totalPaise > 1_000_000_000_00) {
    return { ok: false, field: 'totalPaise', message: t('help.error.total') };
  }
  let gstMode: GstMode = 'none';
  let gstRateBp: number | null = null;
  if (opts.chargesGst) {
    if (terms.gstMode !== 'extra' && terms.gstMode !== 'included') return { ok: false, field: 'gstMode', message: t('help.ask.gst') };
    if (terms.gstRateBp === null || !opts.allowedRatesBp.includes(terms.gstRateBp)) return { ok: false, field: 'gstRateBp', message: t('help.ask.rate') };
    gstMode = terms.gstMode;
    gstRateBp = terms.gstRateBp;
  }
  let milestones: Milestone[] = [];
  if (terms.billing === 'milestones') {
    milestones = terms.milestones
      .map((m) => ({ ...m, label: m.label.trim().replace(/\s+/g, ' ').slice(0, 80) }))
      .filter((m) => m.label || m.pctBp);
    if (!milestones.length || milestones.length > MAX_MILESTONES) return { ok: false, field: 'milestones', message: t('help.ms.sumWrong', { sum: '0' }) };
    if (milestones.some((m) => !m.label)) return { ok: false, field: 'milestones', message: t('error.required') };
    if (milestones.some((m) => !Number.isInteger(m.pctBp) || m.pctBp <= 0 || m.pctBp > 10000)) {
      return { ok: false, field: 'milestones', message: t('help.error.pct') };
    }
    const sum = milestones.reduce((s, m) => s + m.pctBp, 0);
    if (sum !== 10000) return { ok: false, field: 'milestones', message: t('help.ms.sumWrong', { sum: pctText(sum) }) };
  } else if (terms.billing !== 'progress') {
    return { ok: false, field: 'billing', message: t('help.ask.billing') };
  }
  if (!Number.isInteger(terms.retentionBp) || terms.retentionBp < 0 || terms.retentionBp > 2500) {
    return { ok: false, field: 'retentionBp', message: t('help.error.pct') };
  }
  return {
    ok: true,
    terms: { name: name.slice(0, 120), totalPaise: terms.totalPaise, gstMode, gstRateBp, billing: terms.billing, milestones, retentionBp: terms.retentionBp },
  };
}

export interface ProjectBill {
  milestoneId: string | null;
  cumulativeBp: number | null;
  /** What this bill counts towards the contract value. */
  basisPaise: number;
  /** The rate on the bill's one line, before GST. */
  linePaise: number;
  /** Approximate bill total including GST (the engine has the final word). */
  totalPaise: number;
  gstPaise: number;
  billedBeforePaise: number;
  remainingAfterPaise: number;
  retentionPaise: number;
  /** English, for the document. */
  description: string;
  notes: string;
  /** Hinglish lines for the helper to show the owner how it was worked out. */
  working: string[];
}

export type BillPlan = { ok: true; bill: ProjectBill } | { ok: false; message: string };

function billedSum(entries: readonly BilledEntry[]): number {
  return entries.filter((e) => e.status === 'issued').reduce((s, e) => s + e.basisPaise, 0);
}

export function billedCumulativeBp(terms: ContractTerms, entries: readonly BilledEntry[]): number {
  const issued = entries.filter((e) => e.status === 'issued');
  const fromProgress = Math.max(0, ...issued.map((e) => e.cumulativeBp ?? 0));
  const fromMoney = terms.totalPaise ? Math.round((billedSum(issued) * 10000) / terms.totalPaise) : 0;
  return Math.max(fromProgress, fromMoney);
}

/** Which instalments are billed, started, or still to come. */
export function milestoneStatus(terms: ContractTerms, entries: readonly BilledEntry[]) {
  return terms.milestones.map((m) => {
    const issued = entries.find((e) => e.milestoneId === m.id && e.status === 'issued');
    const draft = entries.find((e) => e.milestoneId === m.id && e.status === 'draft');
    return { milestone: m, state: issued ? ('billed' as const) : draft ? ('draft' as const) : ('pending' as const), entry: issued ?? draft ?? null };
  });
}

export function planMilestoneBill(terms: ContractTerms, milestoneId: string, entries: readonly BilledEntry[]): BillPlan {
  const index = terms.milestones.findIndex((m) => m.id === milestoneId);
  const m = terms.milestones[index];
  if (!m) return { ok: false, message: t('error.notFound') };
  const already = entries.find((e) => e.milestoneId === m.id && e.status === 'issued');
  if (already) return { ok: false, message: t('help.alreadyBilled', { number: already.number ?? '' }) };

  const before = billedSum(entries);
  const othersPending = terms.milestones.filter(
    (x) => x.id !== m.id && !entries.some((e) => e.milestoneId === x.id && e.status === 'issued'),
  );
  // The last instalment is what is left, so rounding never leaves the
  // contract a rupee short or over.
  const basis = othersPending.length === 0 ? terms.totalPaise - before : Math.round((terms.totalPaise * m.pctBp) / 10000);
  const description = `${terms.name} - ${m.label} (instalment ${index + 1} of ${terms.milestones.length}: ${pctText(m.pctBp)}% of contract value ${moneyForMessage(terms.totalPaise)})`;
  const working = [t('help.calc.this', { pct: pctText(m.pctBp), total: moneyForMessage(terms.totalPaise), amount: moneyForMessage(basis) })];
  return { ok: true, bill: finish(terms, { basis, before, milestoneId: m.id, cumulativeBp: null, description, working }) };
}

export function planProgressBill(terms: ContractTerms, cumulativeBp: number, entries: readonly BilledEntry[]): BillPlan {
  if (!Number.isInteger(cumulativeBp) || cumulativeBp <= 0 || cumulativeBp > 10000) return { ok: false, message: t('help.error.pct') };
  const before = billedSum(entries);
  const upTo = cumulativeBp === 10000 ? terms.totalPaise : Math.round((terms.totalPaise * cumulativeBp) / 10000);
  const basis = upTo - before;
  if (basis <= 0) return { ok: false, message: t('help.nothingToBill', { pct: pctText(billedCumulativeBp(terms, entries)) }) };
  const runNo = entries.filter((e) => e.status === 'issued').length + 1;
  const description = `${terms.name} - running bill ${runNo}: work completed to ${pctText(cumulativeBp)}% of contract value ${moneyForMessage(terms.totalPaise)}`;
  const working = [
    t('help.calc.progress', { pct: pctText(cumulativeBp), upto: moneyForMessage(upTo), before: moneyForMessage(before), amount: moneyForMessage(basis) }),
  ];
  return { ok: true, bill: finish(terms, { basis, before, milestoneId: null, cumulativeBp, description, working }) };
}

function finish(
  terms: ContractTerms,
  p: { basis: number; before: number; milestoneId: string | null; cumulativeBp: number | null; description: string; working: string[] },
): ProjectBill {
  const rate = terms.gstRateBp ?? 0;
  let linePaise = p.basis;
  let gstPaise = 0;
  let totalPaise = p.basis;
  const working = [...p.working];
  if (terms.gstMode === 'extra' && rate) {
    gstPaise = Math.round((p.basis * rate) / 10000);
    totalPaise = p.basis + gstPaise;
    working.push(t('help.calc.gst', { rate: pctText(rate), amount: moneyForMessage(gstPaise) }));
  } else if (terms.gstMode === 'included' && rate) {
    linePaise = Math.round((p.basis * 10000) / (10000 + rate));
    gstPaise = p.basis - linePaise;
    working.push(t('help.calc.included', { taxable: moneyForMessage(linePaise), gst: moneyForMessage(gstPaise) }));
  }
  const retentionPaise = Math.round((totalPaise * terms.retentionBp) / 10000);
  const remainingAfter = terms.totalPaise - p.before - p.basis;
  working.push(t('help.calc.total', { amount: moneyForMessage(totalPaise) }));
  working.push(t('help.calc.before', { amount: moneyForMessage(p.before) }));
  working.push(t('help.calc.after', { amount: moneyForMessage(remainingAfter) }));
  if (retentionPaise > 0) {
    working.push(
      t('help.calc.retention', { pct: pctText(terms.retentionBp), now: moneyForMessage(totalPaise - retentionPaise), held: moneyForMessage(retentionPaise) }),
    );
  }
  const notes = contractNotes(terms, p.before, p.basis, totalPaise);
  return {
    milestoneId: p.milestoneId,
    cumulativeBp: p.cumulativeBp,
    basisPaise: p.basis,
    linePaise,
    totalPaise,
    gstPaise,
    billedBeforePaise: p.before,
    remainingAfterPaise: remainingAfter,
    retentionPaise,
    description: p.description.slice(0, 300),
    notes,
    working,
  };
}

/**
 * The contract's standing, printed under the bill's lines in English so the
 * customer's accountant can follow it. Restated when the owner changes the
 * amount on the bill form, so the words never disagree with the figures.
 */
export function contractNotes(terms: ContractTerms, beforePaise: number, basisPaise: number, billTotalPaise: number): string {
  const gstWords = terms.gstMode === 'extra' ? ' plus GST' : terms.gstMode === 'included' ? ' including GST' : '';
  const remaining = terms.totalPaise - beforePaise - basisPaise;
  const retention = Math.round((billTotalPaise * terms.retentionBp) / 10000);
  return [
    `Contract: ${terms.name}, value ${moneyForMessage(terms.totalPaise)}${gstWords}.`,
    `Billed before this bill: ${moneyForMessage(beforePaise)}. This bill: ${moneyForMessage(basisPaise)}. Balance of contract after this bill: ${moneyForMessage(remaining)}.`,
    retention > 0 ? `Retention: ${pctText(terms.retentionBp)}% of this bill (${moneyForMessage(retention)}) is payable on completion.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Reading the terms out of what the owner typed, or a contract's text.
// ---------------------------------------------------------------------------

/** "5 lakh", "2.5L", "1 crore", "50k", "₹5,00,000/-", "500000" -> paise. */
export function parseAmount(raw: string): number | null {
  const s = raw.toLowerCase().replace(/₹|rs\.?|inr|\/-/g, ' ').trim();
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|lac|l\b|crores?|cr\b|k\b|thousand|hazaa?r|hazar)?/.exec(s);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2] ?? '';
  const mult = /^(lakh|lac|l$)/.test(unit) ? 100000 : /^(crore|cr)/.test(unit) ? 10000000 : /^(k|thousand|haza)/.test(unit) ? 1000 : 1;
  const rupees = n * mult;
  if (rupees > 1_000_000_000) return null;
  return Math.round(rupees * 100);
}

export interface ParsedContract {
  name: string | null;
  totalPaise: number | null;
  gstMode: GstMode | null;
  gstRateBp: number | null;
  billing: BillingMode | null;
  milestones: Array<{ label: string; pctBp: number }>;
  retentionBp: number | null;
}

const AMOUNT_RE = /(?:₹|rs\.?|inr)?\s*\d[\d,]*(?:\.\d+)?\s*(?:lakhs?|lacs?|lac|l\b|crores?|cr\b|k\b|thousand|hazaa?r|hazar)?(?:\s*\/-)?/gi;
const PCT_RE = /(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|percent|per\s*cent|pc\b|pratishat)/i;
const TOTAL_WORDS = /\b(contract|total|value|order|project|deal|kaam|kul|poora|pura|worth|amount|price|quotation|quote)\b/i;
const FILLER = /\b(on|at|after|before|upon|of|the|time|of|par|pe|ke|baad|pehle|mein|me|jab|hoga|hone|milega|milenge|payment|payable|due|paid|release|released|against|with|when|and|aur|balance|baaki|remaining|rest|is|to|be|shall|will)\b/gi;

function labelFrom(clause: string): string {
  const cleaned = clause
    .replace(PCT_RE, ' ')
    .replace(AMOUNT_RE, ' ')
    .replace(/[:\-–(),.]/g, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(' ').slice(0, 5).join(' ');
  if (/^advance|^adv\b|^booking/i.test(words)) return 'Advance';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The rules reading of a contract's terms. Deliberately literal: a total is
 * a total only when a word like "contract" or "value" stands next to it,
 * or it is the largest amount in the text; a percentage is an instalment
 * only when it is not the GST rate or the retention. Whatever it cannot
 * find is left empty, for the helper to ask.
 */
export function parseContractText(text: string, allowedRatesBp: readonly number[]): ParsedContract {
  const flat = text.replace(/\r/g, '').slice(0, 20000);
  const lower = flat.toLowerCase();
  const out: ParsedContract = { name: null, totalPaise: null, gstMode: null, gstRateBp: null, billing: null, milestones: [], retentionBp: null };

  // GST: on top, or inside, and at what rate.
  if (/(plus|\+|extra|excluding|exclusive\s+of|excl\.?|alag\s*se|upar\s*se|over\s+and\s+above)\s*(?:the\s+)?(?:applicable\s+)?gst|gst\s*(extra|alag|additional|as\s+applicable|will\s+be\s+charged|upar)/i.test(lower)) {
    out.gstMode = 'extra';
  } else if (/(including|inclusive\s+of|incl\.?|inc\.?|with|saath|sahit|shaamil)\s*(?:all\s+)?(?:taxes|gst)|gst\s*(included|inclusive|including|saath|shaamil)/i.test(lower)) {
    out.gstMode = 'included';
  } else if (/\b(no\s+gst|without\s+gst|gst\s+nahi|bina\s+gst)\b/i.test(lower)) {
    out.gstMode = 'none';
  }
  const rateMatch = /gst\s*(?:@|at|of)?\s*(\d{1,2}(?:\.\d+)?)\s*%|(\d{1,2}(?:\.\d+)?)\s*%\s*gst/i.exec(lower);
  let gstPctText: string | null = null;
  if (rateMatch) {
    const bp = Math.round(Number(rateMatch[1] ?? rateMatch[2]) * 100);
    if (allowedRatesBp.includes(bp)) {
      out.gstRateBp = bp;
      gstPctText = rateMatch[0];
    }
  }

  // Retention: a share held back till the end.
  const retMatch =
    /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:as\s+)?(?:retention|retained|held\s+back|hold\s*back|rok|security\s+deposit)|(?:retention|security\s+deposit)\s*(?:money)?\s*(?:of|@|at)?\s*(\d{1,2}(?:\.\d+)?)\s*%/i.exec(lower);
  let retText: string | null = null;
  if (retMatch) {
    out.retentionBp = Math.round(Number(retMatch[1] ?? retMatch[2]) * 100);
    retText = retMatch[0];
  }

  // The total: an amount next to a word like "contract", else the largest.
  const lines = flat.split(/\n+/);
  let total: number | null = null;
  for (const line of lines) {
    if (!TOTAL_WORDS.test(line)) continue;
    const amounts = [...line.matchAll(AMOUNT_RE)].map((m) => ({ raw: m[0], paise: parseAmount(m[0]) })).filter((a) => a.paise && a.paise >= 100000);
    // An amount that is really a percentage ("30%") is not money.
    const money = amounts.filter((a) => !new RegExp(`${a.raw.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*%`).test(line));
    if (money.length) {
      total = Math.max(...money.map((a) => a.paise!));
      break;
    }
  }
  if (total === null) {
    const all = [...flat.matchAll(AMOUNT_RE)]
      .filter((m) => !/^\s*\d{1,3}(?:\.\d+)?\s*$/.test(m[0]) || /lakh|lac|crore|cr|k\b|hazar/i.test(m[0]))
      .map((m) => parseAmount(m[0]))
      .filter((p): p is number => p !== null && p >= 1000000);
    if (all.length) total = Math.max(...all);
  }
  out.totalPaise = total;

  // Instalments: every clause with a percentage that is not GST or retention.
  const clauses = flat
    .split(/\n|;|,(?!\d)|\band\b|\baur\b|\.(?!\d)/i)
    .map((c) => c.trim())
    .filter(Boolean);
  for (const clause of clauses) {
    if ((gstPctText && clause.toLowerCase().includes(gstPctText)) || (retText && clause.toLowerCase().includes(retText))) continue;
    if (/gst|retention|security deposit|tds|interest|penalty|late/i.test(clause)) continue;
    const pm = PCT_RE.exec(clause);
    let pctBp: number | null = pm ? Math.round(Number(pm[1]) * 100) : null;
    if (pctBp === null && total) {
      // "Advance 1 lakh": an amount instalment, as a share of the total.
      const amt = [...clause.matchAll(AMOUNT_RE)].map((m) => parseAmount(m[0])).find((p) => p !== null && p < total!);
      if (amt && /advance|delivery|installation|completion|handover|stage|phase|kist|milestone|on\s|after|par|pe\b/i.test(clause)) {
        pctBp = Math.round((amt * 10000) / total);
      }
    }
    if (pctBp === null || pctBp <= 0 || pctBp > 10000) continue;
    out.milestones.push({ label: labelFrom(clause) || `Stage ${out.milestones.length + 1}`, pctBp });
  }
  if (out.milestones.length) out.billing = 'milestones';
  else if (/running\s+(account\s+)?bill|\bra\s+bill|as\s+per\s+(work|progress|measurement)|jitna\s+kaam|work\s+done|progress/i.test(lower)) out.billing = 'progress';

  const nameMatch = /(?:work|project|job|kaam|contract)\s*(?:of|for|:|-)\s*([A-Za-z][A-Za-z0-9 &/-]{3,60})/i.exec(flat);
  if (nameMatch) out.name = nameMatch[1]!.trim().replace(/\s+(worth|value|for|of|at)\b.*$/i, '').slice(0, 80);
  return out;
}

/** A fresh id for an instalment; readable in a URL and a test. */
export function milestoneId(index: number): string {
  return `m${index + 1}-${Math.random().toString(36).slice(2, 7)}`;
}
