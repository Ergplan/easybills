import { describe, expect, it } from 'vitest';

import { matchKey } from '@/lib/gst-returns/matching';
import { reconcilePurchases, reviewedEligibleItc } from '@/lib/gst-returns/reconcile';
import { assessReadiness, payloadHash, sourceFingerprint } from '@/lib/gst-returns/readiness';
import {
  applyCreditToLiability,
  buildGstr1,
  buildGstr3b,
  type LedgerBalances,
  type OutwardDocument,
} from '@/lib/gst-returns/workings';
import type { CompletenessDeclaration, GstStatementSnapshotRecord, SupplierBillRecord } from '@/lib/gst-returns/types';

const NOW = '2026-10-05T10:00:00.000Z';

function bill(over: Partial<SupplierBillRecord> = {}): SupplierBillRecord {
  const base: SupplierBillRecord = {
    id: over.id ?? `bill-${over.documentNumber ?? '1'}`,
    supplierGstin: '27AAPFU0939F1ZV',
    supplierName: 'Parts Supplier',
    documentNumber: 'PS/2026/001',
    matchKey: matchKey(over.documentNumber ?? 'PS/2026/001'),
    documentDate: '2026-09-10',
    documentType: 'invoice',
    period: '2026-09',
    taxableValuePaise: 100000,
    cgstPaise: 9000,
    sgstPaise: 9000,
    igstPaise: 0,
    cessPaise: 0,
    itcEligibility: 'not-reviewed',
    eligibleCgstPaise: 0,
    eligibleSgstPaise: 0,
    eligibleIgstPaise: 0,
    eligibleCessPaise: 0,
    eligibilityNote: null,
    eligibilityReviewedByUid: null,
    eligibilityReviewedAt: null,
    reverseCharge: false,
    source: 'manual',
    importBatchId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const merged = { ...base, ...over };
  return { ...merged, matchKey: matchKey(merged.documentNumber) };
}

function snapshot(rows: GstStatementSnapshotRecord['rows'], over: Partial<GstStatementSnapshotRecord> = {}): GstStatementSnapshotRecord {
  return {
    id: 'snap-1',
    gstin: '27AAAAA0000A1Z5',
    statementType: 'GSTR-2B',
    period: '2026-09',
    generatedAt: '2026-10-14T00:00:00.000Z',
    importedAt: '2026-10-15T00:00:00.000Z',
    importedByUid: 'uid-1',
    fileHash: 'hash-1',
    importVersion: 1,
    rows,
    supersededBySnapshotId: null,
    ...over,
  };
}

function statementRow(over: Partial<GstStatementSnapshotRecord['rows'][number]> = {}): GstStatementSnapshotRecord['rows'][number] {
  const base = {
    supplierGstin: '27AAPFU0939F1ZV',
    supplierName: 'Parts Supplier',
    documentNumber: 'PS/2026/001',
    matchKey: matchKey(over.documentNumber ?? 'PS/2026/001'),
    documentDate: '2026-09-10',
    documentType: 'invoice' as const,
    taxableValuePaise: 100000,
    cgstPaise: 9000,
    sgstPaise: 9000,
    igstPaise: 0,
    cessPaise: 0,
    statementItcAvailable: true,
  };
  const merged = { ...base, ...over };
  return { ...merged, matchKey: matchKey(merged.documentNumber) };
}

function outward(over: Partial<OutwardDocument> = {}): OutwardDocument {
  return {
    id: 'out-1',
    source: 'app',
    documentNumber: 'INV-001',
    documentDate: '2026-09-15',
    documentType: 'invoice',
    customerGstin: null,
    customerName: 'Walk-in customer',
    placeOfSupplyStateCode: '27',
    isInterState: false,
    taxRateBp: 1800,
    taxableValuePaise: 200000,
    cgstPaise: 18000,
    sgstPaise: 18000,
    igstPaise: 0,
    cessPaise: 0,
    hsnLines: [],
    ...over,
  };
}

const LEDGER_UNAVAILABLE: LedgerBalances = {
  creditCgstPaise: 0, creditSgstPaise: 0, creditIgstPaise: 0, creditCessPaise: 0,
  cashBalancePaise: 0, source: 'unavailable', asOf: null,
};

// ===========================================================================

describe('reconciliation', () => {
  it('matches a bill that agrees with the statement', () => {
    const r = reconcilePurchases({
      gstin: '27AAAAA0000A1Z5',
      period: '2026-09',
      supplierBills: [bill()],
      snapshot: snapshot([statementRow()]),
      nowIso: NOW,
    });
    expect(r.matchedCount).toBe(1);
    expect(r.findings.filter((f) => f.severity === 'blocking')).toHaveLength(0);
  });

  it('reports an amount mismatch as blocking, with both figures', () => {
    const r = reconcilePurchases({
      gstin: '27AAAAA0000A1Z5',
      period: '2026-09',
      supplierBills: [bill({ cgstPaise: 9500, sgstPaise: 9500 })],
      snapshot: snapshot([statementRow()]),
      nowIso: NOW,
    });
    const f = r.findings.find((x) => x.kind === 'amount-mismatch')!;
    expect(f.severity).toBe('blocking');
    expect(f.bookAmountPaise).toBe(19000);
    expect(f.statementAmountPaise).toBe(18000);
    expect(f.differencePaise).toBe(1000);
  });

  it('flags a bill missing from the statement', () => {
    const r = reconcilePurchases({
      gstin: '27AAAAA0000A1Z5',
      period: '2026-09',
      supplierBills: [bill()],
      snapshot: snapshot([]),
      nowIso: NOW,
    });
    expect(r.findings.some((f) => f.kind === 'missing-in-statement' && f.severity === 'blocking')).toBe(true);
  });

  it('flags a statement entry missing from the books', () => {
    const r = reconcilePurchases({
      gstin: '27AAAAA0000A1Z5',
      period: '2026-09',
      supplierBills: [],
      snapshot: snapshot([statementRow()]),
      nowIso: NOW,
    });
    expect(r.findings.some((f) => f.kind === 'missing-in-books')).toBe(true);
  });

  /** GATE: "duplicate imports/portal records do not inflate turnover or credit". */
  it('catches the same bill entered twice in the books', () => {
    const r = reconcilePurchases({
      gstin: '27AAAAA0000A1Z5',
      period: '2026-09',
      supplierBills: [bill({ id: 'a' }), bill({ id: 'b' })],
      snapshot: snapshot([statementRow()]),
      nowIso: NOW,
    });
    const dup = r.findings.find((f) => f.kind === 'duplicate-in-books')!;
    expect(dup.severity).toBe('blocking');
    expect(dup.bookAmountPaise).toBe(36000);
  });

  it('catches the same document listed twice in the statement', () => {
    const r = reconcilePurchases({
      gstin: '27AAAAA0000A1Z5',
      period: '2026-09',
      supplierBills: [bill()],
      snapshot: snapshot([statementRow(), statementRow()]),
      nowIso: NOW,
    });
    expect(r.findings.some((f) => f.kind === 'duplicate-in-statement')).toBe(true);
  });

  it('treats a match found only by loose normalisation as needing review', () => {
    const r = reconcilePurchases({
      gstin: '27AAAAA0000A1Z5',
      period: '2026-09',
      supplierBills: [bill({ documentNumber: 'PS-2026-0001' })],
      snapshot: snapshot([statementRow({ documentNumber: 'PS/2026/1' })]),
      nowIso: NOW,
    });
    expect(r.findings.some((f) => f.kind === 'fuzzy-match-needs-review')).toBe(true);
  });

  it('preserves the original document numbers alongside the matching key', () => {
    const b = bill({ documentNumber: 'PS/2026/001' });
    expect(b.documentNumber).toBe('PS/2026/001');
    expect(b.matchKey).toBe('PS2026001');
  });

  it('never matches two different suppliers', () => {
    const r = reconcilePurchases({
      gstin: '27AAAAA0000A1Z5',
      period: '2026-09',
      supplierBills: [bill({ supplierGstin: '29AAGCB7383J1Z4' })],
      snapshot: snapshot([statementRow()]),
      nowIso: NOW,
    });
    expect(r.matchedCount).toBe(0);
    expect(r.findings.some((f) => f.kind === 'missing-in-statement')).toBe(true);
  });

  it('blocks when no statement has been imported at all', () => {
    const r = reconcilePurchases({
      gstin: '27AAAAA0000A1Z5', period: '2026-09', supplierBills: [bill()], snapshot: null, nowIso: NOW,
    });
    expect(r.findings[0]!.severity).toBe('blocking');
  });
});

describe('input tax credit', () => {
  /** GATE: "ineligible ITC is not claimed automatically." */
  it('counts nothing for a bill nobody has reviewed', () => {
    const r = reviewedEligibleItc([bill()]);
    expect(r.cgstPaise).toBe(0);
    expect(r.sgstPaise).toBe(0);
    expect(r.unreviewedCount).toBe(1);
    expect(r.unreviewedTaxPaise).toBe(18000);
  });

  it('counts only what the owner confirmed as eligible', () => {
    const r = reviewedEligibleItc([
      bill({ itcEligibility: 'eligible', eligibleCgstPaise: 9000, eligibleSgstPaise: 9000 }),
    ]);
    expect(r.cgstPaise).toBe(9000);
    expect(r.sgstPaise).toBe(9000);
    expect(r.unreviewedCount).toBe(0);
  });

  it('counts nothing for blocked or ineligible credit', () => {
    for (const status of ['ineligible', 'blocked', 'deferred'] as const) {
      const r = reviewedEligibleItc([
        bill({ itcEligibility: status, eligibleCgstPaise: 9000, eligibleSgstPaise: 9000 }),
      ]);
      expect(r.cgstPaise).toBe(0);
    }
  });

  it('honours a partial claim exactly as reviewed', () => {
    const r = reviewedEligibleItc([
      bill({ itcEligibility: 'partial', eligibleCgstPaise: 4500, eligibleSgstPaise: 4500 }),
    ]);
    expect(r.cgstPaise).toBe(4500);
  });

  it('does not treat a statement saying credit is available as a decision', () => {
    // The statement row says available; the bill is still unreviewed, so nothing
    // is claimed. Appearing in GSTR-2B is not eligibility.
    const r = reconcilePurchases({
      gstin: '27AAAAA0000A1Z5',
      period: '2026-09',
      supplierBills: [bill()],
      snapshot: snapshot([statementRow({ statementItcAvailable: true })]),
      nowIso: NOW,
    });
    expect(r.matchedCount).toBe(1);
    expect(reviewedEligibleItc([bill()]).cgstPaise).toBe(0);
  });
});

describe('credit utilisation', () => {
  it('sets each head against its own liability first', () => {
    const r = applyCreditToLiability({
      liability: { cgstPaise: 10000, sgstPaise: 10000, igstPaise: 0, cessPaise: 0 },
      credit: { cgstPaise: 6000, sgstPaise: 6000, igstPaise: 0, cessPaise: 0 },
    });
    expect(r.payable).toMatchObject({ cgstPaise: 4000, sgstPaise: 4000, totalPaise: 8000 });
  });

  it('never lets CGST credit pay SGST liability', () => {
    const r = applyCreditToLiability({
      liability: { cgstPaise: 0, sgstPaise: 10000, igstPaise: 0, cessPaise: 0 },
      credit: { cgstPaise: 10000, sgstPaise: 0, igstPaise: 0, cessPaise: 0 },
    });
    // The SGST liability stands in full, and the CGST credit is untouched.
    expect(r.payable.sgstPaise).toBe(10000);
    expect(r.remainingCredit.cgstPaise).toBe(10000);
  });

  it('lets IGST credit meet IGST first, then CGST and SGST', () => {
    const r = applyCreditToLiability({
      liability: { cgstPaise: 5000, sgstPaise: 5000, igstPaise: 3000, cessPaise: 0 },
      credit: { cgstPaise: 0, sgstPaise: 0, igstPaise: 11000, cessPaise: 0 },
    });
    expect(r.payable.igstPaise).toBe(0);
    expect(r.payable.cgstPaise).toBe(0);
    expect(r.payable.sgstPaise).toBe(2000);
    expect(r.payable.totalPaise).toBe(2000);
  });

  it('keeps cess entirely separate', () => {
    const r = applyCreditToLiability({
      liability: { cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 5000 },
      credit: { cgstPaise: 9000, sgstPaise: 9000, igstPaise: 9000, cessPaise: 0 },
    });
    expect(r.payable.cessPaise).toBe(5000);
  });

  it('is not "sales GST minus purchase GST"', () => {
    // Naive netting would give zero to pay. The head rules give 5,000.
    const r = applyCreditToLiability({
      liability: { cgstPaise: 0, sgstPaise: 5000, igstPaise: 0, cessPaise: 0 },
      credit: { cgstPaise: 5000, sgstPaise: 0, igstPaise: 0, cessPaise: 0 },
    });
    expect(r.payable.totalPaise).toBe(5000);
  });
});

describe('GSTR-1 tables', () => {
  it('splits B2B from B2C and totals each', () => {
    const t = buildGstr1({
      period: '2026-09',
      documents: [
        outward({ id: 'a', documentNumber: 'INV-001', customerGstin: '29AAGCB7383J1Z4', customerName: 'Registered Buyer' }),
        outward({ id: 'b', documentNumber: 'INV-002', customerGstin: null }),
      ],
    });
    expect(t.b2b).toHaveLength(1);
    expect(t.b2b[0]!.customerGstin).toBe('29AAGCB7383J1Z4');
    expect(t.b2cSummary).toHaveLength(1);
    expect(t.totals.taxableValuePaise).toBe(400000);
  });

  it('summarises B2C by place of supply and rate', () => {
    const t = buildGstr1({
      period: '2026-09',
      documents: [
        outward({ id: 'a', taxRateBp: 1800, taxableValuePaise: 100000 }),
        outward({ id: 'b', taxRateBp: 1800, taxableValuePaise: 50000 }),
        outward({ id: 'c', taxRateBp: 500, taxableValuePaise: 20000 }),
      ],
    });
    expect(t.b2cSummary).toHaveLength(2);
    expect(t.b2cSummary.find((s) => s.taxRateBp === 1800)!.taxableValuePaise).toBe(150000);
  });

  it('subtracts a credit note rather than counting it as a sale', () => {
    const t = buildGstr1({
      period: '2026-09',
      documents: [
        outward({ id: 'a', taxableValuePaise: 200000, cgstPaise: 18000, sgstPaise: 18000 }),
        outward({ id: 'b', documentType: 'credit-note', taxableValuePaise: 50000, cgstPaise: 4500, sgstPaise: 4500 }),
      ],
    });
    expect(t.totals.taxableValuePaise).toBe(150000);
    expect(t.creditDebitNotes).toHaveLength(1);
  });

  it('keeps every figure traceable to its source documents', () => {
    const t = buildGstr1({ period: '2026-09', documents: [outward({ id: 'src-1' })] });
    expect(t.b2cSummary[0]!.sourceIds).toContain('src-1');
  });

  it('reports cancelled documents without counting them as sales', () => {
    const t = buildGstr1({
      period: '2026-09',
      documents: [outward({ documentNumber: 'INV-001' })],
      cancelledNumbers: ['INV-002'],
    });
    expect(t.documentSummary[0]!.cancelled).toBe(1);
    expect(t.totals.taxableValuePaise).toBe(200000);
  });
});

describe('GSTR-3B workings', () => {
  it('does not claim credit that has not been reviewed', () => {
    const w = buildGstr3b({
      period: '2026-09',
      outwardDocuments: [outward()],
      supplierBills: [bill()],
      ledger: LEDGER_UNAVAILABLE,
    });
    expect(w.eligibleItc.cgstPaise).toBe(0);
    expect(w.payableInCash.totalPaise).toBe(36000);
    expect(w.notes.join(' ')).toMatch(/not been checked/i);
  });

  it('uses reviewed credit and applies it head by head', () => {
    const w = buildGstr3b({
      period: '2026-09',
      outwardDocuments: [outward()],
      supplierBills: [bill({ itcEligibility: 'eligible', eligibleCgstPaise: 9000, eligibleSgstPaise: 9000 })],
      ledger: LEDGER_UNAVAILABLE,
    });
    expect(w.eligibleItc.cgstPaise).toBe(9000);
    expect(w.payableInCash.cgstPaise).toBe(9000);
    expect(w.payableInCash.sgstPaise).toBe(9000);
    expect(w.payableInCash.totalPaise).toBe(18000);
  });

  it('marks the cash figure provisional when ledger balances are unknown', () => {
    const w = buildGstr3b({
      period: '2026-09', outwardDocuments: [outward()], supplierBills: [], ledger: LEDGER_UNAVAILABLE,
    });
    expect(w.cashFigureIsProvisional).toBe(true);
    expect(w.notes.join(' ')).toMatch(/estimate/i);
  });

  it('uses imported ledger balances when they are available', () => {
    const w = buildGstr3b({
      period: '2026-09',
      outwardDocuments: [outward()],
      supplierBills: [],
      ledger: {
        creditCgstPaise: 18000, creditSgstPaise: 18000, creditIgstPaise: 0, creditCessPaise: 0,
        cashBalancePaise: 0, source: 'portal-import', asOf: '2026-10-01T00:00:00.000Z',
      },
    });
    expect(w.cashFigureIsProvisional).toBe(false);
    expect(w.payableInCash.totalPaise).toBe(0);
  });

  it('applies reversals before credit is used', () => {
    const w = buildGstr3b({
      period: '2026-09',
      outwardDocuments: [outward()],
      supplierBills: [bill({ itcEligibility: 'eligible', eligibleCgstPaise: 9000, eligibleSgstPaise: 9000 })],
      reversals: { cgstPaise: 4000, sgstPaise: 4000, igstPaise: 0, cessPaise: 0 },
      ledger: LEDGER_UNAVAILABLE,
    });
    expect(w.netItc.cgstPaise).toBe(5000);
    expect(w.payableInCash.cgstPaise).toBe(13000);
  });
});

describe('readiness', () => {
  const completeness: CompletenessDeclaration = {
    allSalesIncluded: true,
    allPurchasesIncluded: true,
    otherLiabilitiesConsidered: true,
    confirmedNilIfEmpty: false,
    declaredByUid: 'uid-1',
    declaredAt: NOW,
  };

  const goodWorkings = buildGstr3b({
    period: '2026-09',
    outwardDocuments: [outward()],
    supplierBills: [bill({ itcEligibility: 'eligible', eligibleCgstPaise: 9000, eligibleSgstPaise: 9000 })],
    ledger: { creditCgstPaise: 0, creditSgstPaise: 0, creditIgstPaise: 0, creditCessPaise: 0, cashBalancePaise: 0, source: 'portal-import', asOf: NOW },
  });

  function base(over: Partial<Parameters<typeof assessReadiness>[0]> = {}) {
    return assessReadiness({
      period: '2026-09',
      outwardDocuments: [outward()],
      supplierBills: [bill({ itcEligibility: 'eligible', eligibleCgstPaise: 9000, eligibleSgstPaise: 9000 })],
      findings: [],
      snapshot: snapshot([statementRow()]),
      workings: goodWorkings,
      completeness,
      dueDateVerified: true,
      rulePackFullyVerified: true,
      latestSourceChangeAt: null,
      today: '2026-10-05',
      ...over,
    });
  }

  it('is ready when everything is settled', () => {
    expect(base().ready).toBe(true);
  });

  it('blocks until the owner confirms the data is complete', () => {
    const r = base({ completeness: null });
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain('completeness-not-declared');
  });

  /** GATE: "nil-sales with purchases cannot become a false nil return". */
  it('refuses a nil return when there are no sales but there are purchases', () => {
    const r = base({ outwardDocuments: [] });
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain('no-sales-but-purchases');
  });

  it('refuses to assume a nil return just because the app is empty', () => {
    const r = base({ outwardDocuments: [], supplierBills: [] });
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain('nil-not-confirmed');
  });

  it('accepts a nil return when the owner explicitly confirms it', () => {
    const r = base({
      outwardDocuments: [],
      supplierBills: [],
      completeness: { ...completeness, confirmedNilIfEmpty: true },
      workings: buildGstr3b({ period: '2026-09', outwardDocuments: [], supplierBills: [], ledger: { creditCgstPaise: 0, creditSgstPaise: 0, creditIgstPaise: 0, creditCessPaise: 0, cashBalancePaise: 0, source: 'portal-import', asOf: NOW } }),
    });
    expect(r.ready).toBe(true);
  });

  /** GATE: "ineligible ITC is not claimed automatically". */
  it('blocks while any purchase is unreviewed for credit', () => {
    const r = base({ supplierBills: [bill()] });
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain('itc-not-reviewed');
  });

  /** GATE: "stale statements ... block readiness". */
  it('blocks when the books changed after the statement was imported', () => {
    const r = base({ latestSourceChangeAt: '2026-10-20T00:00:00.000Z' });
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain('statement-stale');
  });

  it('blocks a statement for the wrong period, and a superseded one', () => {
    expect(base({ snapshot: snapshot([statementRow()], { period: '2026-08' }) }).blockers.map((b) => b.code)).toContain('statement-wrong-period');
    expect(base({ snapshot: snapshot([statementRow()], { supersededBySnapshotId: 'snap-2' }) }).blockers.map((b) => b.code)).toContain('statement-superseded');
  });

  /** GATE: "unsupported liabilities block readiness". */
  it('blocks when a purchase carries reverse-charge liability', () => {
    const r = base({
      supplierBills: [bill({ reverseCharge: true, itcEligibility: 'eligible', eligibleCgstPaise: 9000, eligibleSgstPaise: 9000 })],
    });
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain('reverse-charge-not-supported');
  });

  it('blocks while unresolved blocking findings remain', () => {
    const findings = reconcilePurchases({
      gstin: '27AAAAA0000A1Z5',
      period: '2026-09',
      supplierBills: [bill({ cgstPaise: 9500, itcEligibility: 'eligible', eligibleCgstPaise: 9500, eligibleSgstPaise: 9000 })],
      snapshot: snapshot([statementRow()]),
      nowIso: NOW,
    }).findings;
    const r = base({ findings });
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain('unresolved-findings');
  });

  it('blocks when the installation has not verified its tax rules', () => {
    const r = base({ rulePackFullyVerified: false });
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain('rules-unverified');
  });

  it('warns rather than inventing a due date when none is verified', () => {
    const r = base({ dueDateVerified: false });
    expect(r.warnings.map((w) => w.code)).toContain('due-date-unverified');
  });

  it('warns when the period has not finished', () => {
    const r = base({ today: '2026-09-15' });
    expect(r.warnings.map((w) => w.code)).toContain('period-not-finished');
  });

  it('gives every blocker something the owner can actually do', () => {
    const r = base({ completeness: null, supplierBills: [bill()], snapshot: null });
    expect(r.blockers.length).toBeGreaterThan(0);
    for (const b of r.blockers) {
      expect(b.whatYouCanDo.length).toBeGreaterThan(15);
      // Plain language: no rule numbers or section references in owner-facing text.
      expect(b.message).not.toMatch(/section \d|rule \d{2}/i);
    }
  });
});

describe('approval binding', () => {
  /** GATE: "post-review changes invalidate approval". */
  it('changes the fingerprint when any source record changes', () => {
    const args = {
      outwardDocuments: [outward()],
      supplierBills: [bill()],
      snapshotId: 'snap-1',
      snapshotHash: 'hash-1',
      completeness: null,
      rulePackVersion: '0.0.0',
    };
    const before = sourceFingerprint(args);
    expect(sourceFingerprint(args)).toBe(before);

    expect(sourceFingerprint({ ...args, supplierBills: [bill({ cgstPaise: 9001 })] })).not.toBe(before);
    expect(sourceFingerprint({ ...args, outwardDocuments: [outward({ taxableValuePaise: 200001 })] })).not.toBe(before);
    expect(sourceFingerprint({ ...args, snapshotHash: 'hash-2' })).not.toBe(before);
    expect(sourceFingerprint({ ...args, rulePackVersion: '1.0.0' })).not.toBe(before);
  });

  it('changes the fingerprint when credit eligibility is revised', () => {
    const args = {
      outwardDocuments: [outward()],
      supplierBills: [bill()],
      snapshotId: 'snap-1',
      snapshotHash: 'hash-1',
      completeness: null,
      rulePackVersion: '0.0.0',
    };
    const before = sourceFingerprint(args);
    const after = sourceFingerprint({
      ...args,
      supplierBills: [bill({ itcEligibility: 'eligible', eligibleCgstPaise: 9000, eligibleSgstPaise: 9000 })],
    });
    expect(after).not.toBe(before);
  });

  it('does not change the fingerprint when records are merely reordered', () => {
    const a = bill({ id: 'a', documentNumber: 'A/1' });
    const b = bill({ id: 'b', documentNumber: 'B/1' });
    const common = { outwardDocuments: [], snapshotId: null, snapshotHash: null, completeness: null, rulePackVersion: '0.0.0' };
    expect(sourceFingerprint({ ...common, supplierBills: [a, b] })).toBe(
      sourceFingerprint({ ...common, supplierBills: [b, a] }),
    );
  });

  it('hashes a payload independently of key order', () => {
    expect(payloadHash({ a: 1, b: { c: 2, d: 3 } })).toBe(payloadHash({ b: { d: 3, c: 2 }, a: 1 }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });
});
