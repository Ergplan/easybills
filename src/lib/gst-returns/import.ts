/**
 * CSV import for purchases and for sales raised outside this app.
 *
 * Three commitments this file keeps:
 *
 *  1. PROVENANCE. Every imported row remembers the batch, the file and the file
 *     hash it came from, so "where did this number come from?" always has an
 *     answer.
 *  2. NO SILENT DUPLICATES. Re-importing the same file is detected by hash, and
 *     a row that already exists (same supplier and document number) is skipped
 *     and counted rather than added again. Double-counted purchases inflate
 *     credit; double-counted sales inflate turnover.
 *  3. NO INVENTED IDENTIFIERS. An externally-raised sale keeps its ORIGINAL
 *     document number. This app never renumbers someone else's invoice.
 */

import { createHash } from 'node:crypto';

import { isCivilDate, monthPeriodOf, type CivilDate, type MonthPeriod } from '@/lib/dates';
import { checkGstin } from '@/lib/gst/gstin';
import { parseMoney, parsePercent } from '@/lib/money';

import { matchKey } from './matching';

export interface ParsedRow<T> {
  rowNumber: number;
  value: T | null;
  error: string | null;
}

export interface ParsedSupplierBill {
  supplierGstin: string | null;
  supplierName: string;
  documentNumber: string;
  matchKey: string;
  documentDate: CivilDate;
  documentType: 'invoice' | 'debit-note' | 'credit-note';
  period: MonthPeriod;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  reverseCharge: boolean;
}

export interface ParsedExternalSale {
  documentNumber: string;
  matchKey: string;
  documentDate: CivilDate;
  period: MonthPeriod;
  customerGstin: string | null;
  customerName: string;
  placeOfSupplyStateCode: string | null;
  documentType: 'invoice' | 'credit-note' | 'debit-note';
  taxRateBp: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
}

export function hashFile(contents: string | Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

/** A small, strict CSV reader. Handles quoted fields and embedded commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const normalised = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalised.length; i += 1) {
    const ch = normalised[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (normalised[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function headerIndex(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    map[h.trim().toLowerCase().replace(/[\s_]+/g, '')] = i;
  });
  return map;
}

function pick(row: string[], idx: Record<string, number>, ...names: string[]): string {
  for (const n of names) {
    const i = idx[n];
    if (i !== undefined && row[i] !== undefined) return row[i]!.trim();
  }
  return '';
}

function money(raw: string, what: string): number {
  if (!raw) return 0;
  return parseMoney(raw, what);
}

function date(raw: string, what: string): CivilDate {
  const trimmed = raw.trim();
  if (isCivilDate(trimmed)) return trimmed;
  // Accept the day-first formats Indian accounting tools commonly export.
  const m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(trimmed);
  if (m) {
    const d = String(m[1]).padStart(2, '0');
    const mo = String(m[2]).padStart(2, '0');
    const candidate = `${m[3]}-${mo}-${d}`;
    if (isCivilDate(candidate)) return candidate;
  }
  throw new Error(`${what} is not a valid date: "${raw}". Use YYYY-MM-DD or DD/MM/YYYY.`);
}

export const SUPPLIER_BILL_CSV_HEADER = [
  'supplier_gstin',
  'supplier_name',
  'document_number',
  'document_date',
  'document_type',
  'taxable_value',
  'cgst',
  'sgst',
  'igst',
  'cess',
  'reverse_charge',
] as const;

export function parseSupplierBillCsv(text: string): Array<ParsedRow<ParsedSupplierBill>> {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const idx = headerIndex(rows[0]!);
  const out: Array<ParsedRow<ParsedSupplierBill>> = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r]!;
    try {
      const gstinRaw = pick(row, idx, 'suppliergstin', 'gstin');
      let supplierGstin: string | null = null;
      if (gstinRaw) {
        const check = checkGstin(gstinRaw);
        if (!check.ok) throw new Error(`Supplier GSTIN "${gstinRaw}" does not look valid.`);
        supplierGstin = check.normalised;
      }

      const documentNumber = pick(row, idx, 'documentnumber', 'invoicenumber', 'billnumber');
      if (!documentNumber) throw new Error('A document number is required.');

      const documentDate = date(pick(row, idx, 'documentdate', 'invoicedate', 'billdate'), 'Document date');
      const typeRaw = pick(row, idx, 'documenttype', 'type').toLowerCase();
      const documentType = typeRaw.includes('credit') ? 'credit-note' : typeRaw.includes('debit') ? 'debit-note' : 'invoice';

      out.push({
        rowNumber: r + 1,
        error: null,
        value: {
          supplierGstin,
          supplierName: pick(row, idx, 'suppliername', 'supplier', 'name') || 'Unnamed supplier',
          documentNumber,
          matchKey: matchKey(documentNumber),
          documentDate,
          documentType,
          period: monthPeriodOf(documentDate),
          taxableValuePaise: money(pick(row, idx, 'taxablevalue', 'taxable', 'value'), 'Taxable value'),
          cgstPaise: money(pick(row, idx, 'cgst'), 'CGST'),
          sgstPaise: money(pick(row, idx, 'sgst', 'sgstutgst', 'utgst'), 'SGST'),
          igstPaise: money(pick(row, idx, 'igst'), 'IGST'),
          cessPaise: money(pick(row, idx, 'cess'), 'Cess'),
          reverseCharge: /^(y|yes|true|1)$/i.test(pick(row, idx, 'reversecharge', 'rcm')),
        },
      });
    } catch (error) {
      out.push({ rowNumber: r + 1, value: null, error: error instanceof Error ? error.message : 'Could not read this row.' });
    }
  }
  return out;
}

export const EXTERNAL_SALE_CSV_HEADER = [
  'document_number',
  'document_date',
  'document_type',
  'customer_gstin',
  'customer_name',
  'place_of_supply_state_code',
  'tax_rate_percent',
  'taxable_value',
  'cgst',
  'sgst',
  'igst',
  'cess',
] as const;

export function parseExternalSaleCsv(text: string): Array<ParsedRow<ParsedExternalSale>> {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const idx = headerIndex(rows[0]!);
  const out: Array<ParsedRow<ParsedExternalSale>> = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r]!;
    try {
      const documentNumber = pick(row, idx, 'documentnumber', 'invoicenumber');
      if (!documentNumber) throw new Error('A document number is required.');
      const documentDate = date(pick(row, idx, 'documentdate', 'invoicedate'), 'Document date');

      const gstinRaw = pick(row, idx, 'customergstin', 'gstin');
      let customerGstin: string | null = null;
      if (gstinRaw) {
        const check = checkGstin(gstinRaw);
        if (!check.ok) throw new Error(`Customer GSTIN "${gstinRaw}" does not look valid.`);
        customerGstin = check.normalised;
      }

      const typeRaw = pick(row, idx, 'documenttype', 'type').toLowerCase();
      out.push({
        rowNumber: r + 1,
        error: null,
        value: {
          // The original number is preserved exactly. We never renumber it.
          documentNumber,
          matchKey: matchKey(documentNumber),
          documentDate,
          period: monthPeriodOf(documentDate),
          customerGstin,
          customerName: pick(row, idx, 'customername', 'customer') || 'Unnamed customer',
          placeOfSupplyStateCode: pick(row, idx, 'placeofsupplystatecode', 'placeofsupply', 'pos') || null,
          documentType: typeRaw.includes('credit') ? 'credit-note' : typeRaw.includes('debit') ? 'debit-note' : 'invoice',
          taxRateBp: pick(row, idx, 'taxratepercent', 'taxrate', 'rate')
            ? parsePercent(pick(row, idx, 'taxratepercent', 'taxrate', 'rate'), 'Tax rate')
            : 0,
          taxableValuePaise: money(pick(row, idx, 'taxablevalue', 'taxable'), 'Taxable value'),
          cgstPaise: money(pick(row, idx, 'cgst'), 'CGST'),
          sgstPaise: money(pick(row, idx, 'sgst', 'sgstutgst'), 'SGST'),
          igstPaise: money(pick(row, idx, 'igst'), 'IGST'),
          cessPaise: money(pick(row, idx, 'cess'), 'Cess'),
        },
      });
    } catch (error) {
      out.push({ rowNumber: r + 1, value: null, error: error instanceof Error ? error.message : 'Could not read this row.' });
    }
  }
  return out;
}

/** The GSTR-2B rows we understand, from the portal's CSV export. */
export function parseGstr2bCsv(text: string): Array<ParsedRow<{
  supplierGstin: string | null;
  supplierName: string;
  documentNumber: string;
  matchKey: string;
  documentDate: CivilDate;
  documentType: 'invoice' | 'debit-note' | 'credit-note';
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  statementItcAvailable: boolean | null;
}>> {
  const parsed = parseSupplierBillCsv(text);
  const rows = parseCsv(text);
  const idx = rows.length ? headerIndex(rows[0]!) : {};

  return parsed.map((p, i) => {
    if (!p.value) return p as never;
    const raw = rows[i + 1] ?? [];
    const availability = pick(raw, idx, 'itcavailable', 'availability', 'itcavailability');
    return {
      rowNumber: p.rowNumber,
      error: null,
      value: {
        supplierGstin: p.value.supplierGstin,
        supplierName: p.value.supplierName,
        documentNumber: p.value.documentNumber,
        matchKey: p.value.matchKey,
        documentDate: p.value.documentDate,
        documentType: p.value.documentType,
        taxableValuePaise: p.value.taxableValuePaise,
        cgstPaise: p.value.cgstPaise,
        sgstPaise: p.value.sgstPaise,
        igstPaise: p.value.igstPaise,
        cessPaise: p.value.cessPaise,
        // What the STATEMENT says. Never treated as a decision about eligibility.
        statementItcAvailable: availability ? /^(y|yes|true|1)$/i.test(availability) : null,
      },
    };
  });
}

/** Duplicate detection key: same supplier, same document number. */
export function duplicateKey(supplierGstin: string | null, documentNumber: string): string {
  return `${supplierGstin ?? 'unknown'}|${matchKey(documentNumber)}`;
}
