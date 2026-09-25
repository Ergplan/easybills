import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { todayIst } from '@/lib/dates';
import { updateBusiness } from '@/server/repos/business';
import { emptyParty, issueInvoice, newInvoiceId, saveDraft } from '@/server/repos/invoices';
import { preparePeriod, approveForFiling, checkApprovalStillValid, declareCompleteness } from '@/server/gst/prepare';
import { listSupplierBills, reviewItc, latestSnapshot } from '@/server/gst/repo';
import { buildAccountantPack } from '@/lib/gst-returns/export';
import { RETURN_STATUS_LABELS } from '@/lib/gst-returns/types';

import { line, makeGstBusiness, ownerUidOf } from '../helpers';

const PERIOD = '2026-09';
const fixture = (name: string) => readFileSync(new URL(`../fixtures/gst/${name}`, import.meta.url), 'utf8');

async function gstBusiness() {
  const business = await makeGstBusiness();
  const uid = await ownerUidOf(business);
  const configured = await updateBusiness(business.id, uid, {
    gstReturns: {
      gstin: '27AAPFU0939F1ZV',
      registrationType: 'regular',
      filingFrequency: 'monthly',
      usesIff: false,
      filingStartPeriod: '2026-04',
      previouslyFiledPeriods: [],
      source: 'owner-declared',
      confirmedAt: new Date().toISOString(),
      confirmedByUid: uid,
    },
  });
  return { business: configured, uid };
}

/** Issue a sale inside the period so the outward tables have real data. */
async function issueSale(
  business: Awaited<ReturnType<typeof gstBusiness>>['business'],
  uid: string,
  opts: { amount: string; rate: string; posState: string; customerGstin?: string | null; date?: string },
) {
  const draft = await saveDraft({
    business,
    uid,
    invoiceId: newInvoiceId(),
    kind: 'customer-invoice',
    issueDate: opts.date ?? '2026-09-15',
    customer: { ...emptyParty('A Customer'), stateCode: opts.posState, gstin: opts.customerGstin ?? null },
    placeOfSupplyStateCode: opts.posState,
    supplyFlags: [],
    lines: [line('Consulting', '1', opts.amount, opts.rate)],
    notes: null,
    baseRevision: 0,
  });
  return issueInvoice({ business, uid, invoiceId: draft.id });
}

async function importers() {
  return import('@/server/gst/import-service');
}

describe('GST period preparation end to end', () => {
  it('builds outward tables from issued invoices only', async () => {
    const { business, uid } = await gstBusiness();
    // One issued sale inside the period, and one DRAFT that must be ignored.
    await issueSale(business, uid, { amount: '10000', rate: '18', posState: '27' });
    await saveDraft({
      business,
      uid,
      invoiceId: newInvoiceId(),
      kind: 'customer-invoice',
      issueDate: '2026-09-20',
      customer: emptyParty('Draft Customer'),
      placeOfSupplyStateCode: '27',
      supplyFlags: [],
      lines: [line('Never issued', '1', '99999', '18')],
      notes: null,
      baseRevision: 0,
    });

    const prepared = await preparePeriod({ business, period: PERIOD });

    expect(prepared.summary.salesCount).toBe(1);
    expect(prepared.gstr1.totals.taxableValuePaise).toBe(1_000_000);
    // Intra-state: the tax splits into two equal heads, and there is no IGST.
    expect(prepared.gstr1.totals.cgstPaise).toBe(90_000);
    expect(prepared.gstr1.totals.sgstPaise).toBe(90_000);
    expect(prepared.gstr1.totals.igstPaise).toBe(0);
  });

  it('separates B2B from B2C and keeps interstate tax in IGST', async () => {
    const { business, uid } = await gstBusiness();
    await issueSale(business, uid, { amount: '10000', rate: '18', posState: '27' }); // B2C intra
    await issueSale(business, uid, { amount: '20000', rate: '18', posState: '29', customerGstin: '29AAGCB7383J1Z4' }); // B2B inter

    const prepared = await preparePeriod({ business, period: PERIOD });

    expect(prepared.gstr1.b2b).toHaveLength(1);
    expect(prepared.gstr1.b2b[0]!.customerGstin).toBe('29AAGCB7383J1Z4');
    expect(prepared.gstr1.b2cSummary).toHaveLength(1);

    expect(prepared.gstr1.totals.igstPaise).toBe(360_000); // 20,000 @ 18%
    expect(prepared.gstr1.totals.cgstPaise).toBe(90_000); // 10,000 @ 9%
    expect(prepared.gstr1.totals.sgstPaise).toBe(90_000);
  });

  it('imports purchases and the statement, then reconciles them', async () => {
    const { business, uid } = await gstBusiness();
    const { importSupplierBills, importGstr2b } = await importers();

    const purchaseResult = await importSupplierBills({
      businessId: business.id, uid,
      filename: 'purchases-2026-09.csv',
      contents: fixture('purchases-2026-09.csv'),
      period: PERIOD,
    });
    expect(purchaseResult.imported).toBe(4);

    await importGstr2b({
      business, uid,
      filename: 'gstr2b-2026-09.csv',
      contents: fixture('gstr2b-2026-09.csv'),
      period: PERIOD,
      generatedAt: '2026-10-14T00:00:00.000Z',
    });

    const prepared = await preparePeriod({ business, period: PERIOD });

    const kinds = prepared.findings.map((f) => f.kind);
    // PS/2026/002 differs by 100 in tax -> amount mismatch.
    expect(kinds).toContain('amount-mismatch');
    // OR/09/26 is in the books but not the statement.
    expect(kinds).toContain('missing-in-statement');
    // UV/77 is in the statement but not the books.
    expect(kinds).toContain('missing-in-books');
  });

  /** GATE: "duplicate imports ... do not inflate turnover or credit". */
  it('does not import the same file twice', async () => {
    const { business, uid } = await gstBusiness();
    const { importSupplierBills } = await importers();
    const contents = fixture('purchases-2026-09.csv');

    const first = await importSupplierBills({ businessId: business.id, uid, filename: 'p.csv', contents, period: PERIOD });
    const second = await importSupplierBills({ businessId: business.id, uid, filename: 'p.csv', contents, period: PERIOD });

    expect(first.imported).toBe(4);
    expect(second.alreadyImported).toBe(true);
    expect(second.imported).toBe(0);

    expect(await listSupplierBills(business.id, PERIOD)).toHaveLength(4);
  });

  it('skips rows already present when the same bill arrives in a different file', async () => {
    const { business, uid } = await gstBusiness();
    const { importSupplierBills } = await importers();
    const original = fixture('purchases-2026-09.csv');
    // Same rows, different file: a trailing newline changes the file hash, so
    // only the per-row key can catch this.
    const reshuffled = `${original}\n`;

    await importSupplierBills({ businessId: business.id, uid, filename: 'a.csv', contents: original, period: PERIOD });
    const second = await importSupplierBills({ businessId: business.id, uid, filename: 'b.csv', contents: reshuffled, period: PERIOD });

    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(4);
    expect(await listSupplierBills(business.id, PERIOD)).toHaveLength(4);
  });

  it('imports external sales without renumbering them', async () => {
    const { business, uid } = await gstBusiness();
    const { importExternalSales } = await importers();
    const r = await importExternalSales({
      businessId: business.id, uid,
      filename: 'external.csv',
      contents: fixture('external-sales-2026-09.csv'),
      period: PERIOD,
    });
    expect(r.imported).toBe(1);

    const prepared = await preparePeriod({ business, period: PERIOD });
    const external = prepared.outwardDocuments.find((d) => d.source === 'external');
    expect(external?.documentNumber).toBe('LEGACY/2026/44');
    expect(external?.igstPaise).toBe(270_000);
  });
});

describe('readiness and approval', () => {
  async function readyish() {
    const { business, uid } = await gstBusiness();
    const { importSupplierBills, importGstr2b } = await importers();
    await issueSale(business, uid, { amount: '10000', rate: '18', posState: '27' });
    await importSupplierBills({
      businessId: business.id, uid,
      filename: 'p.csv',
      contents: fixture('purchases-2026-09.csv'),
      period: PERIOD,
    });
    await importGstr2b({
      business, uid,
      filename: '2b.csv',
      contents: fixture('gstr2b-2026-09.csv'),
      period: PERIOD,
      generatedAt: '2026-10-14T00:00:00.000Z',
    });
    await declareCompleteness({
      business,
      uid,
      period: PERIOD,
      form: 'GSTR-3B',
      answers: {
        allSalesIncluded: true,
        allPurchasesIncluded: true,
        otherLiabilitiesConsidered: true,
        confirmedNilIfEmpty: false,
      },
    });
    return { business, uid };
  }

  it('is not ready while credit decisions are outstanding', async () => {
    const { business } = await readyish();
    const prepared = await preparePeriod({ business, period: PERIOD });
    expect(prepared.readiness.ready).toBe(false);
    expect(prepared.readiness.blockers.map((b) => b.code)).toContain('itc-not-reviewed');
  });

  it('claims no credit at all until a person decides', async () => {
    const { business } = await readyish();
    const prepared = await preparePeriod({ business, period: PERIOD });
    expect(prepared.gstr3b.eligibleItc.cgstPaise).toBe(0);
    expect(prepared.gstr3b.eligibleItc.igstPaise).toBe(0);
    // The whole outward tax is payable, because nothing has been confirmed.
    expect(prepared.gstr3b.payableInCash.totalPaise).toBe(180_000);
  });

  it('uses only the credit a person confirmed, head by head', async () => {
    const { business, uid } = await readyish();
    const bills = await listSupplierBills(business.id, PERIOD);
    const intra = bills.find((b) => b.documentNumber === 'PS/2026/001')!;
    const inter = bills.find((b) => b.documentNumber === 'IT-990')!;

    await reviewItc({
      businessId: business.id, uid, billId: intra.id, eligibility: 'eligible',
      eligibleCgstPaise: intra.cgstPaise, eligibleSgstPaise: intra.sgstPaise, eligibleIgstPaise: 0, eligibleCessPaise: 0,
      note: 'Goods received',
    });
    await reviewItc({
      businessId: business.id, uid, billId: inter.id, eligibility: 'ineligible',
      eligibleCgstPaise: 0, eligibleSgstPaise: 0, eligibleIgstPaise: 0, eligibleCessPaise: 0,
      note: 'Personal use',
    });

    const prepared = await preparePeriod({ business, period: PERIOD });
    expect(prepared.gstr3b.eligibleItc.cgstPaise).toBe(90_000);
    expect(prepared.gstr3b.eligibleItc.sgstPaise).toBe(90_000);
    // The ineligible interstate bill contributes nothing.
    expect(prepared.gstr3b.eligibleItc.igstPaise).toBe(0);
    // Outward 90,000 CGST + 90,000 SGST, fully met by the confirmed credit.
    expect(prepared.gstr3b.payableInCash.totalPaise).toBe(0);
  });

  /** GATE: "post-review changes invalidate approval". */
  it('invalidates an approval when a purchase changes afterwards', async () => {
    const { business, uid } = await readyish();
    const bills = await listSupplierBills(business.id, PERIOD);
    for (const b of bills) {
      await reviewItc({
        businessId: business.id, uid, billId: b.id, eligibility: 'ineligible',
        eligibleCgstPaise: 0, eligibleSgstPaise: 0, eligibleIgstPaise: 0, eligibleCessPaise: 0, note: 'not claimed',
      });
    }
    // Resolve the reconciliation findings so nothing else is blocking.
    const { listFindings, resolveFinding } = await import('@/server/gst/repo');
    for (const f of await listFindings(business.id, PERIOD)) {
      await resolveFinding(business.id, f.id, uid, 'checked with supplier');
    }

    const prepared = await preparePeriod({ business, period: PERIOD });
    // The unverified rule pack still blocks approval in this build, which is
    // itself the honest behaviour -- so assert that, then test the binding
    // directly against the fingerprint.
    expect(prepared.readiness.blockers.map((b) => b.code)).toContain('rules-unverified');

    const fakeApproved = {
      id: 'v1',
      returnPeriodId: 'rp',
      gstin: prepared.gstin,
      form: 'GSTR-3B' as const,
      period: PERIOD,
      versionNumber: 1,
      createdAt: new Date().toISOString(),
      createdByUid: uid,
      sourceFingerprint: prepared.fingerprint,
      payloadHash: 'p',
      rulePackVersion: prepared.rulePackVersion,
      schemaVersion: null,
      workings: {},
      approvedByUid: uid,
      approvedAt: new Date().toISOString(),
      invalidatedAt: null,
      invalidationReason: null,
    };

    expect(checkApprovalStillValid(fakeApproved, prepared.fingerprint).valid).toBe(true);

    // Now change one purchase and re-prepare.
    await reviewItc({
      businessId: business.id, uid, billId: bills[0]!.id, eligibility: 'eligible',
      eligibleCgstPaise: bills[0]!.cgstPaise, eligibleSgstPaise: bills[0]!.sgstPaise,
      eligibleIgstPaise: 0, eligibleCessPaise: 0, note: 'changed my mind',
    });
    const after = await preparePeriod({ business, period: PERIOD });

    expect(after.fingerprint).not.toBe(prepared.fingerprint);
    const check = checkApprovalStillValid(fakeApproved, after.fingerprint);
    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/changed after it was approved/i);
  });

  it('refuses to approve a return that is not ready', async () => {
    const { business, uid } = await readyish();
    const prepared = await preparePeriod({ business, period: PERIOD });
    await expect(
      approveForFiling({ business, uid, form: 'GSTR-3B', prepared }),
    ).rejects.toThrow(/not ready/i);
  });
});

describe('accountant pack', () => {
  it('labels itself as prepared, not filed, and shows the credit decisions', async () => {
    const { business, uid } = await gstBusiness();
    const { importSupplierBills } = await importers();
    await issueSale(business, uid, { amount: '10000', rate: '18', posState: '27' });
    await importSupplierBills({
      businessId: business.id, uid, filename: 'p.csv', contents: fixture('purchases-2026-09.csv'), period: PERIOD,
    });

    const prepared = await preparePeriod({ business, period: PERIOD });
    const files = buildAccountantPack({
      gstin: prepared.gstin,
      period: PERIOD,
      businessName: business.legalName,
      outwardDocuments: prepared.outwardDocuments,
      supplierBills: prepared.supplierBills,
      findings: prepared.findings,
      gstr1: prepared.gstr1,
      gstr3b: prepared.gstr3b,
      rulePackVersion: prepared.rulePackVersion,
      preparedAt: new Date().toISOString(),
      statusLabel: RETURN_STATUS_LABELS.draft,
    });

    const names = files.map((f) => f.filename);
    expect(names.some((n) => n.startsWith('sales-'))).toBe(true);
    expect(names.some((n) => n.startsWith('purchases-'))).toBe(true);
    expect(names.some((n) => n.startsWith('reconciliation-'))).toBe(true);
    expect(names.some((n) => n.startsWith('gstr1-tables-'))).toBe(true);
    expect(names.some((n) => n.startsWith('gstr3b-workings-'))).toBe(true);

    const all = files.map((f) => f.content).join('\n');
    expect(all).toMatch(/is not a filed return/i);
    // The README must spell out the difference between the stages.
    const readme = files.find((f) => f.filename.startsWith('README'))!.content;
    expect(readme).toMatch(/Uploaded/);
    expect(readme).toMatch(/Filed/);
    expect(readme).toMatch(/acknowledgement number/i);
    // Credit decisions travel with the purchases.
    const purchases = files.find((f) => f.filename.startsWith('purchases-'))!.content;
    expect(purchases).toMatch(/Credit decision/);
    expect(purchases).toMatch(/not-reviewed/);
  });
});
