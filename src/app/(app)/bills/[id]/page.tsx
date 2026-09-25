import { notFound } from 'next/navigation';

import { aiConfig } from '@/lib/env';
import { DEFAULT_RULE_PACK } from '@/lib/gst/ruleset';
import { TopBar } from '@/components/TopBar';
import { InvoiceEditor } from '@/components/editor/InvoiceEditor';
import { requireCurrentContext } from '@/server/auth/current';
import { getInvoice } from '@/server/repos/invoices';
import { recentCustomers } from '@/server/repos/customers';
import { listItems } from '@/server/repos/items';
import { listPaymentsForInvoice } from '@/server/repos/payments';
import { assessIssuance } from '@/lib/gst/scenarios';

import { IssuedInvoiceView } from './IssuedInvoiceView';

export const dynamic = 'force-dynamic';

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await requireCurrentContext();
  const invoice = await getInvoice(business.id, id);
  if (!invoice) notFound();

  if (invoice.status === 'issued') {
    const payments = await listPaymentsForInvoice(business.id, invoice.id);
    return (
      <>
        <TopBar title={invoice.number ?? 'Bill'} back={{ href: '/bills' }} />
        <main className="page">
          <IssuedInvoiceView businessId={business.id} invoice={invoice} payments={payments} />
        </main>
      </>
    );
  }

  const [customers, items] = await Promise.all([recentCustomers(business.id), listItems(business.id)]);

  // Whether the editor shows tax fields at all is decided here, once, from the
  // business's confirmed standing -- not by a toggle the owner can flip.
  const assessment = assessIssuance({
    registrationType: business.registrationType,
    sellerStateCode: business.stateCode,
    sellerGstin: business.gstin,
    placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
    supplyFlags: invoice.supplyFlags,
    declaredAggregateTurnoverPaise: business.declaredAggregateTurnoverPaise,
    eInvoicingSelfDeclaredNotApplicable: business.eInvoicingSelfDeclaredNotApplicable,
    issueDate: invoice.issueDate,
  });

  return (
    <>
      <TopBar
        title={invoice.kind === 'quick-bill' ? 'Quick bill' : 'Invoice'}
        back={{ href: '/bills' }}
      />
      <main className="page page--wide">
        <InvoiceEditor
          bootstrap={{
            businessId: business.id,
            invoice,
            recentCustomers: customers,
            savedItems: items,
            sellerStateCode: business.stateCode,
            chargesGst: assessment.chargesGst,
            selectableRatesBp: [...DEFAULT_RULE_PACK.selectableRates.value],
            defaultTaxRateBp: business.defaultTaxRateBp,
            aiEnabled: aiConfig().enabled,
          }}
        />
      </main>
    </>
  );
}
