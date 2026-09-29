import { describe, expect, it } from 'vitest';

import { todayIst } from '@/lib/dates';
import { isMember } from '@/server/repos/business';
import { listCustomers } from '@/server/repos/customers';
import { pool } from '@/server/db/pool';
import { createCustomer } from '@/server/repos/customers';
import { emptyParty, getInvoice, issueInvoice, listInvoices, newInvoiceId, saveDraft } from '@/server/repos/invoices';

import { line, makeGstBusiness, ownerUidOf } from '../helpers';

/**
 * GATE: "two test businesses cannot access each other's records".
 *
 * Isolation here is structural, not a filter someone might forget: business data
 * lives UNDER `businesses/{id}`, and the only way in is `requireBusiness`, which
 * re-reads the membership document on every request. These tests assert both
 * halves -- that the data really is separate, and that membership is what gates it.
 */
describe('tenant isolation', () => {
  it('keeps invoices and customers in separate business subtrees', async () => {
    const alpha = await makeGstBusiness({ legalName: 'Alpha Repairs' });
    const beta = await makeGstBusiness({ legalName: 'Beta Consulting' });
    const alphaUid = await ownerUidOf(alpha);
    const betaUid = await ownerUidOf(beta);

    expect(alpha.id).not.toBe(beta.id);

    const alphaDraft = await saveDraft({
      business: alpha,
      uid: alphaUid,
      invoiceId: newInvoiceId(),
      kind: 'customer-invoice',
      issueDate: todayIst(),
      customer: emptyParty('Alpha Customer'),
      placeOfSupplyStateCode: '27',
      supplyFlags: [],
      lines: [line('Alpha work', '1', '1000', '18')],
      notes: null,
      baseRevision: 0,
    });
    await issueInvoice({ business: alpha, uid: alphaUid, invoiceId: alphaDraft.id });

    await createCustomer(beta.id, betaUid, {
      name: 'Beta Customer',
      phone: null,
      email: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      pincode: null,
      stateCode: '29',
      gstin: null,
      pan: null,
      notes: null,
    });

    // Beta's invoice list cannot contain Alpha's invoice.
    const betaInvoices = await listInvoices(beta.id);
    expect(betaInvoices).toHaveLength(0);

    // Reading Alpha's invoice id under Beta's path finds nothing.
    expect(await getInvoice(beta.id, alphaDraft.id)).toBeNull();
    expect(await getInvoice(alpha.id, alphaDraft.id)).not.toBeNull();

    // Alpha's customer collection is untouched by Beta's write.
    expect(await listCustomers(alpha.id, { includeArchived: true })).toHaveLength(0);
    expect(await listCustomers(beta.id, { includeArchived: true })).toHaveLength(1);
  });

  it('grants access only to members of the business', async () => {
    const alpha = await makeGstBusiness({ legalName: 'Alpha Repairs' });
    const beta = await makeGstBusiness({ legalName: 'Beta Consulting' });
    const alphaUid = await ownerUidOf(alpha);
    const betaUid = await ownerUidOf(beta);

    // Alpha's owner is a member of Alpha only.
    expect(await isMember(alpha.id, alphaUid)).toBe(true);
    expect(await isMember(alpha.id, betaUid)).toBe(false);
    expect(await isMember(beta.id, alphaUid)).toBe(false);
  });

  it('numbers each business independently', async () => {
    const alpha = await makeGstBusiness({ legalName: 'Alpha Repairs' });
    const beta = await makeGstBusiness({ legalName: 'Beta Consulting' });
    const alphaUid = await ownerUidOf(alpha);
    const betaUid = await ownerUidOf(beta);

    const mk = async (b: typeof alpha, uid: string) => {
      const d = await saveDraft({
        business: b,
        uid,
        invoiceId: newInvoiceId(),
        kind: 'customer-invoice',
        issueDate: todayIst(),
        customer: emptyParty('Someone'),
        placeOfSupplyStateCode: '27',
        supplyFlags: [],
        lines: [line('Work', '1', '1000', '18')],
        notes: null,
        baseRevision: 0,
      });
      const { invoice } = await issueInvoice({ business: b, uid, invoiceId: d.id });
      return invoice.number;
    };

    expect(await mk(alpha, alphaUid)).toBe('INV-001');
    expect(await mk(beta, betaUid)).toBe('INV-001');
    expect(await mk(alpha, alphaUid)).toBe('INV-002');
  });

  it('stores every invoice against its own business', async () => {
    const alpha = await makeGstBusiness();
    const alphaUid = await ownerUidOf(alpha);
    const d = await saveDraft({
      business: alpha,
      uid: alphaUid,
      invoiceId: newInvoiceId(),
      kind: 'quick-bill',
      issueDate: todayIst(),
      customer: emptyParty(),
      placeOfSupplyStateCode: '27',
      supplyFlags: [],
      lines: [line('Work', '1', '500', '18')],
      notes: null,
      baseRevision: 0,
    });
    const { rows } = await pool().query<{ business_id: string }>('select business_id from invoices where id = $1', [d.id]);
    expect(rows.map((r) => r.business_id)).toEqual([alpha.id]);
  });
});
