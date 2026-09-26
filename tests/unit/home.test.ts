/**
 * Home's three cards, from the records.
 */
import { describe, expect, it } from 'vitest';

import { initialOf, summariseHome } from '@/lib/domain/home';
import type { CustomerRecord, InvoiceRecord } from '@/lib/domain/types';

const today = '2026-09-26' as const;

function bill(over: Partial<InvoiceRecord> & { id: string; issueDate: InvoiceRecord['issueDate'] }): InvoiceRecord {
  const total = over.totals?.grandTotalPaise ?? 100000;
  return {
    kind: 'invoice',
    status: 'issued',
    number: `INV-${over.id}`,
    numberSequence: Number(over.id.replace(/\D/g, '')) || 0,
    financialYear: '2026-27',
    dueDate: null,
    paymentTermsDays: null,
    billingPeriod: null,
    customer: { customerId: `c-${over.id}`, name: `Customer ${over.id}`, phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null, stateCode: null, gstin: null, pan: null },
    placeOfSupplyStateCode: null,
    supplyFlags: [],
    lines: [],
    notes: null,
    totals: { subtotalPaise: total, totalDiscountPaise: 0, taxableValuePaise: total, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0, totalTaxPaise: 0, totalBeforeRoundingPaise: total, roundOffPaise: 0, grandTotalPaise: total },
    paymentStatus: 'unpaid',
    amountPaidPaise: 0,
    creditAppliedPaise: 0,
    debitAppliedPaise: 0,
    settlementDeductionPaise: 0,
    balancePaise: total,
    issued: null,
    cancelledAt: null,
    cancelledReason: null,
    scheduleId: null,
    occurrenceKey: null,
    duplicatedFromInvoiceId: null,
    revision: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    createdByUid: 'u',
    ...over,
  } as InvoiceRecord;
}

function customer(name: string, lastBilledAt: string | null, archived = false): CustomerRecord {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null,
    stateCode: null, gstin: null, pan: null, notes: null,
    contactPerson: null, language: null, languageSource: null,
    archived, lastBilledAt, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as CustomerRecord;
}

describe('kiske paise aane hain', () => {
  const issued = [
    bill({ id: '40', issueDate: '2026-09-02', balancePaise: 945000 }),
    bill({ id: '41', issueDate: '2026-09-18', balancePaise: 0, amountPaidPaise: 285000, paymentStatus: 'paid' }),
    bill({ id: '42', issueDate: '2026-09-22', balancePaise: 620000 }),
    bill({ id: '39', issueDate: '2026-08-14', balancePaise: 50000, amountPaidPaise: 50000, paymentStatus: 'partly-paid', dueDate: '2026-08-21' }),
  ];

  it('adds up what is owed, oldest first, and counts the people', () => {
    const h = summariseHome({ issued, customers: [], today });
    expect(h.duePaise).toBe(945000 + 620000 + 50000);
    expect(h.due.map((d) => d.number)).toEqual(['INV-39', 'INV-40', 'INV-42']);
    expect(h.dueFrom).toBe(3);
    expect(h.oldestDays).toBe(43);
    expect(h.due[1]!.days).toBe(24);
  });

  it('counts this month and shows the latest bills first', () => {
    const h = summariseHome({ issued, customers: [], today });
    expect(h.sentThisMonth).toBe(3);
    expect(h.recentSent.map((r) => r.number)).toEqual(['INV-42', 'INV-41', 'INV-40', 'INV-39']);
    expect(h.recentSent.map((r) => r.status)).toEqual(['sent', 'paid', 'sent', 'partly']);
  });

  it('says Baaki once the due date has gone, Bheja before', () => {
    const late = bill({ id: '50', issueDate: '2026-09-01', dueDate: '2026-09-08' });
    const fresh = bill({ id: '51', issueDate: '2026-09-25', dueDate: '2026-10-02' });
    const h = summariseHome({ issued: [late, fresh], customers: [], today });
    expect(h.recentSent.find((r) => r.number === 'INV-50')!.status).toBe('due');
    expect(h.recentSent.find((r) => r.number === 'INV-51')!.status).toBe('sent');
  });

  it('is empty, cleanly, for a new business', () => {
    const h = summariseHome({ issued: [], customers: [], today });
    expect(h).toMatchObject({ duePaise: 0, due: [], dueFrom: 0, oldestDays: 0, sentThisMonth: 0, recentSent: [] });
  });

  it('ignores drafts and cancelled bills that slipped in', () => {
    const h = summariseHome({ issued: [bill({ id: '60', issueDate: '2026-09-20', status: 'draft', number: null })], customers: [], today });
    expect(h.recentSent).toEqual([]);
  });
});

describe('the chips', () => {
  it('puts the recently billed first, then the never-billed by name, and never an archived one', () => {
    const h = summariseHome({
      issued: [],
      customers: [
        customer('Zara Boutique', null),
        customer('Mehta Traders', '2026-09-22T00:00:00.000Z'),
        customer('Anil Kumar', null),
        customer('Old Shop', '2026-09-25T00:00:00.000Z', true),
        customer('Green Park Society', '2026-09-12T00:00:00.000Z'),
      ],
      today,
    });
    expect(h.customers.map((c) => c.name)).toEqual(['Mehta Traders', 'Green Park Society', 'Anil Kumar', 'Zara Boutique']);
  });

  it('offers at most eight', () => {
    const many = Array.from({ length: 12 }, (_, i) => customer(`Customer ${String(i).padStart(2, '0')}`, null));
    expect(summariseHome({ issued: [], customers: many, today }).customers).toHaveLength(8);
  });

  it('takes an initial the way a person would', () => {
    expect(initialOf('Mehta Traders')).toBe('M');
    expect(initialOf('Dr. Anjali Kulkarni')).toBe('A');
    expect(initialOf('  ')).toBe('?');
  });
});
