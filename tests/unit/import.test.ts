/**
 * Purane bills: what the reader takes from a bill's text, a spreadsheet
 * and an .xlsx, and what it refuses to guess.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseDate, readBill } from '@/lib/import/bill-text';
import { readTable } from '@/lib/import/table';
import { readXlsx } from '@/lib/xlsx-read';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/import/${name}`, import.meta.url));

describe('a Tally-style tax invoice', () => {
  const owner = { gstin: '27AAPFU0939F1ZV', phone: '9822012345', name: 'Sharma Electricals' };

  it('reads the buyer, not the seller', () => {
    const c = readBill(fixture('tally-invoice.txt').toString(), owner);
    expect(c).not.toBeNull();
    expect(c!.name).toBe('Green Park Co-operative Housing Society');
    expect(c!.gstin).toBe('27AABCG1234H1ZZ');
    expect(c!.pan).toBe('AABCG1234H');
    expect(c!.stateCode).toBe('27');
    expect(c!.phone).toBe('9876543210');
    expect(c!.pincode).toBe('440015');
    expect(c!.addressLine1).toContain('Plot 12, Wardha Road');
    expect(c!.city).toBe('Nagpur');
    expect(c!.confidence).toBe('high');
    expect(c!.source).toMatch(/Buyer/);
  });

  it('reads the bill number, date and grand total as evidence', () => {
    const c = readBill(fixture('tally-invoice.txt').toString(), owner)!;
    expect(c.bill).toEqual({ number: 'INV/2025-26/042', date: '2025-09-12', totalPaise: 731600 });
  });

  it('never takes the owner for a customer', () => {
    const c = readBill(fixture('tally-invoice.txt').toString(), { ...owner, gstin: null })!;
    // Without the owner's GSTIN the first GSTIN on the page is taken to be the seller.
    expect(c.gstin).toBe('27AABCG1234H1ZZ');
    expect(c.name).toBe('Green Park Co-operative Housing Society');
  });
});

describe("EkBill's own bill", () => {
  it('reads back what it printed', () => {
    const c = readBill(fixture('ekbill-style.txt').toString(), { gstin: '27AAPFU0939F1ZV', name: 'Kumar Electrical Repairs' })!;
    expect(c.name).toBe('Ramesh Patil');
    expect(c.phone).toBe('9876543210');
    expect(c.gstin).toBeNull();
    expect(c.bill).toEqual({ number: 'INV-001', date: '2026-09-26', totalPaise: 205000 });
  });
});

describe('a bill with no "Bill to" label', () => {
  it('takes the line above the customer GSTIN, but says it is not sure', () => {
    const c = readBill(fixture('no-label.txt').toString(), {})!;
    expect(c.name).toBe('Nilesh Patel');
    expect(c.gstin).toBe('24AAACP1234C1Z7');
    expect(c.stateCode).toBe('24');
    expect(c.confidence).toBe('low');
  });

  it('gives up rather than guess when there is nothing to hold on to', () => {
    expect(readBill('Some receipt\nTotal 500\n', {})).toBeNull();
    expect(readBill('', {})).toBeNull();
  });
});

describe('dates on bills', () => {
  it('reads the shapes Indian bills use', () => {
    expect(parseDate('12-09-2025')).toBe('2025-09-12');
    expect(parseDate('12/9/25')).toBe('2025-09-12');
    expect(parseDate('12 Sep 2025')).toBe('2025-09-12');
    expect(parseDate('2025-09-12')).toBe('2025-09-12');
    expect(parseDate('31/02/2025')).toBeNull();
  });

  it('reads a bare "No." the way our own PDF prints it, and not "No. of items"', () => {
    const c = readBill('Tax Invoice\nNo. INV-007\nDate: 1 Jan 2026\nBill to\nAsha Rao\nNo. of items: 3\nTotal ₹500.00\n', {})!;
    expect(c.bill?.number).toBe('INV-007');
  });
});

describe('a spreadsheet of parties', () => {
  it('maps the columns by their headings, whatever they are called', () => {
    const { customers, unrecognised } = readTable([
      ['Sr', 'Party Name', 'GSTIN', 'Mobile', 'City', 'State'],
      ['1', 'Mehta Traders', '27AAPFU0939F1ZV', '9876543210', 'Pune', 'Maharashtra'],
      ['2', 'Priya Boutique', '', '', 'Chennai', 'Tamil Nadu'],
      ['3', '', '', '', '', ''],
    ]);
    expect(unrecognised).toBe(false);
    expect(customers.map((c) => [c.name, c.gstin, c.pan, c.stateCode, c.city])).toEqual([
      ['Mehta Traders', '27AAPFU0939F1ZV', 'AAPFU0939F', '27', 'Pune'],
      ['Priya Boutique', null, null, '33', 'Chennai'],
    ]);
  });

  it('says so when no column looks like a name', () => {
    expect(readTable([['Item', 'Qty', 'Rate'], ['Fan', '2', '1350']])).toEqual({ customers: [], unrecognised: true });
  });
});

describe('an .xlsx, read without a library', () => {
  it('comes out as rows of strings, shared and inline strings alike', () => {
    const rows = readXlsx(new Uint8Array(fixture('parties.xlsx')));
    expect(rows).toEqual([
      ['Party Name', 'GSTIN', 'Mobile', 'City'],
      ['Mehta Traders', '27AAPFU0939F1ZV', '9876543210', 'Pune'],
      ['Priya & Co', '', '98765 00000', 'Chennai'],
    ]);
    const { customers } = readTable(rows);
    expect(customers.map((c) => c.name)).toEqual(['Mehta Traders', 'Priya & Co']);
  });
});
