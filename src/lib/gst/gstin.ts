/**
 * GSTIN and PAN structural validation.
 *
 * WHAT THIS PROVES: that a string has the correct shape and that its check
 * digit is self-consistent. A typo is caught here.
 *
 * WHAT THIS DOES NOT PROVE: that the GSTIN exists, belongs to the named party,
 * is active, or is registered under the type the owner selected. Only the GST
 * portal (or an authorised GSP taxpayer-search API) can establish that. The app
 * therefore never claims a GSTIN is "verified" on the strength of this check --
 * it says "format looks right".
 */

import { findState } from './state-codes';

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export type GstinProblem =
  | 'empty'
  | 'length'
  | 'format'
  | 'unknown-state'
  | 'checksum';

export interface GstinCheck {
  ok: boolean;
  normalised: string;
  problem?: GstinProblem;
  message?: string;
  stateCode?: string;
  stateName?: string;
  pan?: string;
}

/** The published GSTIN check-digit scheme: weighted mod-36 over the first 14 characters. */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = ALPHABET.indexOf(first14[i]!);
    if (value < 0) throw new Error('invalid character in GSTIN');
    const factor = i % 2 === 0 ? 1 : 2;
    const product = value * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36]!;
}

export function checkGstin(input: string | null | undefined): GstinCheck {
  const normalised = String(input ?? '').toUpperCase().replace(/\s/g, '');
  if (!normalised) return { ok: false, normalised, problem: 'empty', message: 'Enter a GSTIN' };
  if (normalised.length !== 15) {
    return { ok: false, normalised, problem: 'length', message: 'A GSTIN has 15 characters' };
  }
  if (!GSTIN_RE.test(normalised)) {
    return { ok: false, normalised, problem: 'format', message: 'This does not look like a GSTIN' };
  }
  const stateCode = normalised.slice(0, 2);
  const state = findState(stateCode);
  if (!state) {
    return { ok: false, normalised, problem: 'unknown-state', message: `${stateCode} is not a known GST state code`, stateCode };
  }
  if (gstinCheckDigit(normalised.slice(0, 14)) !== normalised[14]) {
    return {
      ok: false,
      normalised,
      problem: 'checksum',
      message: 'The last character does not match the rest of the GSTIN. Please re-check it.',
      stateCode,
      stateName: state.name,
    };
  }
  return {
    ok: true,
    normalised,
    stateCode,
    stateName: state.name,
    pan: normalised.slice(2, 12),
  };
}

export function isValidGstin(input: string | null | undefined): boolean {
  return checkGstin(input).ok;
}

export function checkPan(input: string | null | undefined): { ok: boolean; normalised: string; message?: string } {
  const normalised = String(input ?? '').toUpperCase().replace(/\s/g, '');
  if (!normalised) return { ok: false, normalised, message: 'Enter a PAN' };
  if (!PAN_RE.test(normalised)) return { ok: false, normalised, message: 'A PAN looks like ABCDE1234F' };
  return { ok: true, normalised };
}

/** State code implied by a GSTIN, used for place-of-supply defaults. */
export function stateCodeOfGstin(gstin: string | null | undefined): string | null {
  const check = checkGstin(gstin);
  return check.ok ? check.stateCode! : null;
}
