/**
 * Decimal-safe money and quantity arithmetic.
 *
 * DOCUMENTED PRECISION CONTRACT
 * -----------------------------
 * Nothing in this application stores or computes a currency amount as a
 * JavaScript float. Every value below is a *signed integer* in a fixed minor
 * unit, so addition, subtraction and comparison are exact and reproducible.
 *
 *   Money      -> integer PAISE.          1 INR      = 100 paise      (2 dp)
 *   Quantity   -> integer MILLI-UNITS.    1 unit     = 1000 milli     (3 dp)
 *   Rate/pct   -> integer BASIS POINTS.   1 percent  = 100 bp         (2 dp)
 *
 * Safe range: JS integers are exact to 2^53 - 1 = 9,007,199,254,740,991.
 * In paise that is roughly 90,071,992,547,409 INR (~90 trillion), which is far
 * beyond any invoice this product will ever issue. `assertSafe` guards the
 * boundary anyway, because a silently-wrong total is the worst bug a billing
 * app can have.
 *
 * ROUNDING POLICY
 * ---------------
 * All division rounds HALF-UP AWAY FROM ZERO ("commercial rounding"):
 *   2.345 -> 2.35,  2.344 -> 2.34,  -2.345 -> -2.35
 * This is applied once, at each documented boundary:
 *   1. line taxable value        (after quantity x rate and line discount)
 *   2. each tax head amount      (CGST / SGST / UTGST / IGST / cess, separately)
 *   3. optional invoice round-off to the nearest rupee, carried as its own
 *      visible adjustment line so the arithmetic always reconciles.
 * Tax heads are never derived from a rounded sibling head: CGST and SGST are
 * each computed from the taxable value at half the rate, then compared, so a
 * half-paise never lands in only one head without being visible.
 */

export type Paise = number;
export type Milli = number;
export type BasisPoints = number;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Throws unless `value` is an exact integer inside the safe range. */
export function assertSafe(value: number, what = 'amount'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MoneyError(`${what} must be a finite number, received ${String(value)}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${what} must be an integer minor unit, received ${value}`);
  }
  if (Math.abs(value) > MAX_SAFE) {
    throw new MoneyError(`${what} exceeds the safe integer range`);
  }
  return value;
}

/**
 * Divide two integers, rounding half-up away from zero.
 * Used for every scaling step (quantity x rate, percentage of a base).
 */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new MoneyError('division by zero');
  assertSafe(numerator, 'numerator');
  const sign = numerator < 0 !== denominator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  // (n / d) rounded half-up == floor((2n + d) / (2d)) for non-negative integers,
  // but 2n can overflow the safe range for very large n, so do it with a
  // quotient/remainder split that never doubles the numerator.
  const q = Math.floor(n / d);
  const r = n - q * d;
  const rounded = r * 2 >= d ? q + 1 : q;
  return sign * rounded;
}

/** Multiply an integer base by a basis-point rate, rounded half-up. */
export function applyBasisPoints(base: number, bp: BasisPoints): number {
  assertSafe(base, 'base');
  assertSafe(bp, 'basis points');
  return divRound(base * bp, 10_000);
}

/**
 * Extract the tax component out of a tax-INCLUSIVE amount.
 * taxable = inclusive * 10000 / (10000 + bp);  tax = inclusive - taxable.
 * Returns the taxable value so the caller can recompute each head from it,
 * which keeps inclusive and exclusive pricing on the same code path.
 */
export function taxableFromInclusive(inclusive: Paise, bp: BasisPoints): Paise {
  assertSafe(inclusive, 'inclusive amount');
  assertSafe(bp, 'basis points');
  if (bp <= -10_000) throw new MoneyError('invalid tax rate for inclusive pricing');
  return divRound(inclusive * 10_000, 10_000 + bp);
}

/** Quantity (milli-units) x unit price (paise) -> paise, rounded half-up. */
export function lineGross(quantityMilli: Milli, unitPricePaise: Paise): Paise {
  assertSafe(quantityMilli, 'quantity');
  assertSafe(unitPricePaise, 'unit price');
  return divRound(quantityMilli * unitPricePaise, 1000);
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total = assertSafe(total + assertSafe(v, 'addend'), 'sum');
  return total;
}

/** Round paise to the nearest whole rupee. Returns the rounded paise amount. */
export function roundToRupee(paise: Paise): Paise {
  assertSafe(paise, 'amount');
  return divRound(paise, 100) * 100;
}

// ---------------------------------------------------------------------------
// Parsing and formatting. User input is always a string from a text field; it
// is parsed exactly, never via parseFloat, so "0.1 + 0.2" style drift and
// locale separators cannot corrupt a stored amount.
// ---------------------------------------------------------------------------

function parseFixed(input: string | number, decimals: number, what: string): number {
  const raw = typeof input === 'number' ? String(input) : input;
  const trimmed = raw.trim().replace(/[\s, ]/g, '');
  if (trimmed === '') throw new MoneyError(`${what} is empty`);
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!m) throw new MoneyError(`${what} is not a valid number: ${raw}`);
  const sign = m[1] === '-' ? -1 : 1;
  const whole = m[2] || '0';
  const frac = m[3] || '';
  if (whole === '0' && frac === '' && (m[2] === undefined || m[2] === '')) {
    throw new MoneyError(`${what} is not a valid number: ${raw}`);
  }
  if (frac.length > decimals) {
    // More precision than we store. Round half-up rather than silently truncate.
    const keep = frac.slice(0, decimals);
    const nextDigit = Number(frac[decimals]);
    const base = Number(whole) * 10 ** decimals + Number(keep || '0');
    const bumped = nextDigit >= 5 ? base + 1 : base;
    return sign * assertSafe(bumped, what);
  }
  const padded = frac.padEnd(decimals, '0');
  const value = Number(whole) * 10 ** decimals + Number(padded || '0');
  return sign * assertSafe(value, what);
}

/** "1,234.50" -> 123450 paise */
export function parseMoney(input: string | number, what = 'amount'): Paise {
  return parseFixed(input, 2, what);
}

/** "2.5" -> 2500 milli-units */
export function parseQuantity(input: string | number, what = 'quantity'): Milli {
  return parseFixed(input, 3, what);
}

/** "18" -> 1800 basis points */
export function parsePercent(input: string | number, what = 'percentage'): BasisPoints {
  return parseFixed(input, 2, what);
}

function formatFixed(value: number, decimals: number, trimTrailing: boolean): string {
  assertSafe(value, 'value');
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const unit = 10 ** decimals;
  const whole = Math.floor(abs / unit);
  let frac = String(abs - whole * unit).padStart(decimals, '0');
  if (trimTrailing) frac = frac.replace(/0+$/, '');
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

/** 123450 -> "1234.50" (plain, for exports and machine payloads) */
export function formatMoneyPlain(paise: Paise): string {
  return formatFixed(paise, 2, false);
}

/** 2500 -> "2.5" (plain, trailing zeros trimmed) */
export function formatQuantityPlain(milli: Milli): string {
  return formatFixed(milli, 3, true);
}

/** 1800 -> "18" */
export function formatPercentPlain(bp: BasisPoints): string {
  return formatFixed(bp, 2, true);
}

/** Indian digit grouping: 1234567 paise -> "12,345.67" */
export function formatMoneyIndian(paise: Paise, opts: { withSymbol?: boolean } = {}): string {
  const plain = formatMoneyPlain(paise);
  const negative = plain.startsWith('-');
  const [whole = '0', frac = '00'] = plain.replace('-', '').split('.');
  // Indian grouping: last three digits, then pairs.
  let grouped: string;
  if (whole.length <= 3) {
    grouped = whole;
  } else {
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  const body = `${grouped}.${frac}`;
  const symbol = opts.withSymbol ? '₹' : '';
  return `${negative ? '-' : ''}${symbol}${body}`;
}

/** Words for the invoice footer: 205000 paise -> "Two Thousand Fifty Rupees Only" */
export function amountInWords(paise: Paise): string {
  assertSafe(paise, 'amount');
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const pais = abs - rupees * 100;
  const parts: string[] = [];
  if (rupees > 0 || pais === 0) parts.push(`${indianWords(rupees)} Rupees`);
  if (pais > 0) parts.push(`${indianWords(pais)} Paise`);
  return `${negative ? 'Minus ' : ''}${parts.join(' and ')} Only`;
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]} ${ONES[o]}` : (TENS[t] ?? '');
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const head = h ? `${ONES[h]} Hundred` : '';
  const tail = rest ? twoDigits(rest) : '';
  return [head, tail].filter(Boolean).join(' ');
}

/** Indian numbering system: crore, lakh, thousand, hundred. */
function indianWords(n: number): string {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  const chunks: string[] = [];
  if (crore) chunks.push(`${indianWords(crore)} Crore`);
  if (lakh) chunks.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) chunks.push(`${twoDigits(thousand)} Thousand`);
  if (rest) chunks.push(threeDigits(rest));
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}
