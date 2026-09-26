/**
 * Read a customer out of the text of a bill.
 *
 * An Indian invoice, from Tally or Vyapar or a Word template or EkBill's own
 * PDF, has the same bones: the seller at the top, a "Bill to" or "Buyer" or
 * "M/s" block for the customer, a GSTIN or two, a number, a date, a total.
 * These rules find that block and read it. They are deliberately literal --
 * a GSTIN is only a GSTIN if its check digit says so, a name is only a name
 * if a label pointed at it -- and where they are unsure they say so with a
 * low confidence rather than a guess dressed up as a fact.
 *
 * The seller is recognised by the owner's own GSTIN, PAN and phone when
 * known, and otherwise taken to be the first GSTIN on the page.
 */
import { makeCivilDate, type CivilDate } from '@/lib/dates';
import { checkGstin } from '@/lib/gst/gstin';
import { findState, GST_STATES } from '@/lib/gst/state-codes';
import { parseMoney } from '@/lib/money';

import type { ImportedCustomer } from './types';

export interface Owner {
  gstin?: string | null;
  pan?: string | null;
  phone?: string | null;
  name?: string | null;
}

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const PHONE_RE = /(?:\+91[\s-]?|0)?([6-9]\d{4}[\s-]?\d{5})\b/g;
const PIN_RE = /\b[1-9]\d{5}\b/;
const CUSTOMER_LABEL =
  /^\s*(?:bill(?:ed)?\s*to|buyer(?:'s)?\s*(?:name|details)?|customer(?:\s*(?:name|details))?|party(?:\s*name)?|consignee|details\s+of\s+receiver|receiver|invoice\s+to|to|name\s+of\s+(?:the\s+)?(?:customer|buyer|party)|client(?:\s*name)?|sold\s+to)\b\s*(?:\([^)]*\))?\s*,?\s*[:\-–]?\s*(.*)$/i;
const NOISE_LABEL = /^\s*(?:ship\s*to|deliver(?:y)?\s*(?:to|address)|place\s+of\s+supply|state(?:\s*(?:name|code))?|gstin|gst\s*no|pan|phone|mobile|mob|contact|email|e-mail|address|invoice|bill|date|due|terms|payment|bank|ifsc|a\/c|account|upi|description|item|qty|rate|amount|total|sub\s*total|cgst|sgst|igst|hsn|sac|sr\.?|s\.?\s*no)\b/i;
const HONORIFIC = /^(?:m\/s\.?|mr\.?|mrs\.?|ms\.?|shri|smt\.?|dr\.?)\s+/i;
const NUMBER_LABEL = /(?:(?:invoice|bill|inv|document)\s*(?:no|number|#)|^no)\.?\s*[:\-–]?\s*([A-Z0-9][A-Z0-9\/\-]{1,30})/i;
const DATE_LABEL = /(?:invoice\s+date|bill\s+date|dated|date)\s*[:\-–]?\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}|[0-9]{1,2}[\s\-][A-Za-z]{3,9},?[\s\-][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i;
const TOTAL_LABEL = /(?:grand\s+total|total\s+amount|net\s+amount|amount\s+payable|invoice\s+total|total\s+payable|^total)\s*[:\-–]?\s*(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Split a page's text into trimmed lines, dropping empties. */
export function linesOf(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function readBill(text: string, owner: Owner = {}): ImportedCustomer | null {
  const lines = linesOf(text);
  if (!lines.length) return null;

  const gstins = uniq([...text.toUpperCase().matchAll(GSTIN_RE)].map((m) => m[0])).filter((g) => checkGstin(g).ok);
  const ownerGstin = owner.gstin?.toUpperCase() ?? null;
  const ownerPan = owner.pan?.toUpperCase() ?? gstinPan(ownerGstin);
  const ownerPhone = digitsOf(owner.phone);

  // The seller is the owner when we know them; otherwise the first GSTIN.
  const sellerGstin = ownerGstin && gstins.includes(ownerGstin) ? ownerGstin : (ownerGstin ? null : gstins[0] ?? null);
  const customerGstins = gstins.filter((g) => g !== sellerGstin);

  // Find the customer block: the line after a "Bill to"-like label.
  let name: string | null = null;
  let nameAt = -1;
  let source = '';
  for (let i = 0; i < lines.length; i += 1) {
    const m = CUSTOMER_LABEL.exec(lines[i]!);
    if (!m) continue;
    const inline = cleanName(m[1] ?? '');
    if (inline && !NOISE_LABEL.test(inline)) {
      name = inline;
      nameAt = i;
      source = lines[i]!.slice(0, 40);
      break;
    }
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
      const candidate = cleanName(lines[j]!);
      if (candidate && !NOISE_LABEL.test(candidate) && !isMostlyDigits(candidate)) {
        name = candidate;
        nameAt = j;
        source = lines[i]!.slice(0, 40);
        break;
      }
    }
    if (name) break;
  }

  // No label: the line just above the customer's GSTIN, if there is one.
  let confidence: ImportedCustomer['confidence'] = name ? 'high' : 'low';
  if (!name && customerGstins[0]) {
    const at = lines.findIndex((l) => l.toUpperCase().includes(customerGstins[0]!));
    for (let j = at - 1; j >= Math.max(0, at - 3); j -= 1) {
      const candidate = cleanName(lines[j]!);
      if (candidate && !NOISE_LABEL.test(candidate) && !isMostlyDigits(candidate) && !isOwnerName(candidate, owner)) {
        name = candidate;
        nameAt = j;
        source = `above ${customerGstins[0]}`;
        confidence = 'low';
        break;
      }
    }
  }
  if (!name) return null;
  if (isOwnerName(name, owner)) return null;

  // The block: the lines after the name until something that is clearly not address.
  const block = lines.slice(nameAt + 1, nameAt + 8);
  const blockText = block.join('\n');

  const gstin =
    customerGstins.find((g) => blockText.toUpperCase().includes(g)) ?? (customerGstins.length === 1 ? customerGstins[0]! : null);
  let pan: string | null = gstin ? gstinPan(gstin) : null;
  if (!pan) {
    const pans = uniq([...blockText.toUpperCase().matchAll(PAN_RE)].map((m) => m[0])).filter((p) => p !== ownerPan && !gstins.some((g) => gstinPan(g) === p));
    pan = pans[0] ?? null;
  }
  const phone =
    [...blockText.matchAll(PHONE_RE)]
      .map((m) => m[1]!.replace(/[\s-]/g, ''))
      .find((p) => p !== ownerPhone && p.length === 10) ?? null;

  const stateFromGstin = gstin ? checkGstin(gstin).stateCode ?? null : null;
  const stateFromText = stateFromGstin ?? readStateName(blockText);
  const pincode = PIN_RE.exec(blockText)?.[0] ?? null;

  const addressLines = block
    .filter((l) => !NOISE_LABEL.test(l) && !GSTIN_RE.test(l.toUpperCase()) && !/^\s*(?:pan|gstin|phone|mob|state|email)/i.test(l))
    .filter((l) => !PHONE_RE.test(l) || l.length > 30)
    .slice(0, 3);
  const addressLine1 = addressLines.join(', ').replace(/,\s*,/g, ',').trim() || null;
  const city = guessCity(addressLines, stateFromText);

  return {
    name,
    contactPerson: null,
    phone,
    gstin,
    pan,
    addressLine1,
    city,
    pincode,
    stateCode: stateFromText,
    bill: readBillMeta(lines),
    source,
    confidence,
  };
}

function readBillMeta(lines: string[]): ImportedCustomer['bill'] {
  let number: string | null = null;
  let date: CivilDate | null = null;
  let totalPaise: number | null = null;
  for (const line of lines) {
    if (!number) {
      const m = NUMBER_LABEL.exec(line);
      // A number has a digit in it; "No. of items" does not.
      if (m && /\d/.test(m[1]!) && !/^date$/i.test(m[1]!)) number = m[1]!;
    }
    if (!date) {
      const m = DATE_LABEL.exec(line);
      if (m) date = parseDate(m[1]!);
    }
    const t = TOTAL_LABEL.exec(line);
    if (t) {
      try {
        totalPaise = parseMoney(t[1]!);
      } catch {
        // not money after all
      }
    }
  }
  return number || date || totalPaise !== null ? { number, date, totalPaise } : null;
}

export function parseDate(raw: string): CivilDate | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return safeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(raw);
  if (dmy) {
    const year = dmy[3]!.length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return safeDate(year, Number(dmy[2]), Number(dmy[1]));
  }
  const dMy = /^(\d{1,2})[\s\-]([A-Za-z]{3,9}),?[\s\-](\d{2,4})$/.exec(raw);
  if (dMy) {
    const month = MONTHS.indexOf(dMy[2]!.slice(0, 3).toLowerCase()) + 1;
    const year = dMy[3]!.length === 2 ? 2000 + Number(dMy[3]) : Number(dMy[3]);
    if (month) return safeDate(year, month, Number(dMy[1]));
  }
  return null;
}

function safeDate(y: number, m: number, d: number): CivilDate | null {
  try {
    return makeCivilDate(y, m, d);
  } catch {
    return null;
  }
}

function readStateName(text: string): string | null {
  const m = /state\s*(?:name)?\s*[:\-–]?\s*([A-Za-z &]+?)(?:\s*,?\s*code\s*[:\-–]?\s*(\d{2}))?\s*(?:\n|$)/i.exec(text);
  if (m?.[2] && findState(m[2])) return m[2]!.padStart(2, '0');
  const named = (m?.[1] ?? '').trim().toLowerCase();
  if (named) {
    const hit = GST_STATES.find((s) => s.name.toLowerCase() === named);
    if (hit) return hit.code;
  }
  for (const s of GST_STATES) {
    if (new RegExp(`\\b${s.name}\\b`, 'i').test(text)) return s.code;
  }
  return null;
}

function guessCity(addressLines: string[], stateCode: string | null): string | null {
  const stateNames = GST_STATES.map((s) => s.name.toLowerCase());
  for (const line of [...addressLines].reverse()) {
    const parts = line
      .split(/[,\-]/)
      .map((p) => p.replace(PIN_RE, '').replace(/\d+/g, '').trim())
      .filter((p) => p && !stateNames.includes(p.toLowerCase()) && !/india/i.test(p));
    const last = parts[parts.length - 1];
    if (last && /^[A-Za-z .]{3,30}$/.test(last)) return last;
  }
  void stateCode;
  return null;
}

function cleanName(raw: string): string {
  return raw
    .replace(HONORIFIC, '')
    .replace(/\s*(?:\(|-)?\s*(?:gstin|gst\s*no|pan|phone|mob(?:ile)?)\b.*$/i, '')
    .replace(/[:\-–]\s*$/, '')
    .trim()
    .slice(0, 200);
}

function isMostlyDigits(s: string): boolean {
  const digits = (s.match(/\d/g) ?? []).length;
  return digits > s.length / 2;
}

function isOwnerName(name: string, owner: Owner): boolean {
  const own = (owner.name ?? '').trim().toLowerCase();
  return Boolean(own) && name.trim().toLowerCase() === own;
}

function gstinPan(gstin: string | null): string | null {
  return gstin ? gstin.slice(2, 12) : null;
}

function digitsOf(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  return d ? d.slice(-10) : null;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
