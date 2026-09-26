/**
 * Customers from a spreadsheet: a Tally export, a Vyapar party list, a
 * hand-kept Excel. The header row says which column is which, in whatever
 * words it uses; a column nobody recognises is ignored, never guessed.
 */
import { checkGstin } from '@/lib/gst/gstin';
import { findState, GST_STATES } from '@/lib/gst/state-codes';

import type { ImportedCustomer } from './types';

const COLUMNS: Array<[keyof ColumnMap, RegExp]> = [
  ['name', /^(?:customer|party|client|buyer|name|customer\s*name|party\s*name|ledger|ledger\s*name|company|firm|naam)$/i],
  ['contactPerson', /^(?:contact(?:\s*person)?|person|attn|attention|kis\s*se)$/i],
  ['phone', /^(?:phone|mobile|mob|contact\s*(?:no|number)|whatsapp|cell|tel(?:ephone)?)$/i],
  ['gstin', /^(?:gstin|gst\s*(?:no|number|in)?|gstin\/uin|tax\s*id)$/i],
  ['pan', /^(?:pan|pan\s*(?:no|number))$/i],
  ['addressLine1', /^(?:address|addr|address\s*1|address\s*line\s*1|street|pata)$/i],
  ['city', /^(?:city|town|place|sheher)$/i],
  ['pincode', /^(?:pin|pincode|pin\s*code|postal\s*code|zip)$/i],
  ['stateCode', /^(?:state|state\s*name|state\s*code|rajya)$/i],
];

interface ColumnMap {
  name: number;
  contactPerson: number;
  phone: number;
  gstin: number;
  pan: number;
  addressLine1: number;
  city: number;
  pincode: number;
  stateCode: number;
}

export function mapHeader(header: string[]): Partial<ColumnMap> {
  const map: Partial<ColumnMap> = {};
  header.forEach((h, i) => {
    const key = h.trim().replace(/[*:]/g, '');
    for (const [field, re] of COLUMNS) {
      if (map[field] === undefined && re.test(key)) map[field] = i;
    }
  });
  return map;
}

export function readTable(rows: string[][]): { customers: ImportedCustomer[]; unrecognised: boolean } {
  const headerAt = rows.findIndex((r) => Object.keys(mapHeader(r)).includes('name'));
  if (headerAt < 0) return { customers: [], unrecognised: true };
  const map = mapHeader(rows[headerAt]!);
  const cell = (row: string[], i: number | undefined) => (i === undefined ? '' : (row[i] ?? '').trim());

  const customers: ImportedCustomer[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    const name = cell(row, map.name);
    if (!name) continue;
    const gstinRaw = cell(row, map.gstin).toUpperCase();
    const gstin = gstinRaw && checkGstin(gstinRaw).ok ? checkGstin(gstinRaw).normalised : null;
    const stateRaw = cell(row, map.stateCode);
    const stateCode =
      (gstin ? checkGstin(gstin).stateCode : null) ??
      (findState(stateRaw) ? stateRaw.padStart(2, '0') : GST_STATES.find((s) => s.name.toLowerCase() === stateRaw.toLowerCase())?.code ?? null);
    customers.push({
      name,
      contactPerson: cell(row, map.contactPerson) || null,
      phone: cell(row, map.phone) || null,
      gstin,
      pan: cell(row, map.pan).toUpperCase() || (gstin ? gstin.slice(2, 12) : null),
      addressLine1: cell(row, map.addressLine1) || null,
      city: cell(row, map.city) || null,
      pincode: cell(row, map.pincode) || null,
      stateCode,
      bill: null,
      source: `column "${rows[headerAt]![map.name!]}"`,
      confidence: 'high',
    });
  }
  return { customers, unrecognised: false };
}
