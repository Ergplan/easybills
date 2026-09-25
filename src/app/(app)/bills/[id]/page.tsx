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
import { listAdjustmentsForInvoice } from '@/server/repos/adjustments';
import { getSchedule, listSchedules } from '@/server/repos/schedules';
import { assessIssuance } from '@/lib/gst/scenarios';
import { profileSetupStatus } from '@/lib/domain/setup-status';

import { IssuedInvoiceView } from './IssuedInvoiceView';
import { ScheduledDraftBanner } from './ScheduledDraftBanner';

export const dynamic = 'force-dynamic';

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await requireCurrentContext();
  const invoice = await getInvoice(business.id, id);
  if (!invoice) notFound();

  if (invoice.status === 'issued') {
    const [payments, adjustments] = await Promise.all([
      listPaymentsForInvoice(business.id, invoice.id),
      listAdjustmentsForInvoice(business.id, invoice.id),
    ]);

    // A schedule this bill belongs to, or one it started. Either way the owner
    // manages the monthly arrangement from the bill they know about.
    const schedule = invoice.scheduleId
      ? await getSchedule(business.id, invoice.scheduleId)
      : (await listSchedules(business.id)).find(
          (sc) => sc.customerId === invoice.customer.customerId && sc.status !== 'stopped',
        ) ?? null;

    return (
      <>
        <TopBar title={invoice.number ?? 'Bill'} back={{ href: '/bills' }} />
        <main className="page">
          <IssuedInvoiceView
            businessId={business.id}
            invoice={invoice}
            payments={payments}
            adjustments={adjustments}
            schedule={schedule ? JSON.parse(JSON.stringify(schedule)) : null}
          />
        </main>
      </>
    );
  }

  const [customers, items] = await Promise.all([recentCustomers(business.id), listItems(business.id)]);
  const draftSchedule = invoice.scheduleId ? await getSchedule(business.id, invoice.scheduleId) : null;

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
        {draftSchedule && (
          <ScheduledDraftBanner
            businessId={business.id}
            invoiceId={invoice.id}
            scheduleId={draftSchedule.id}
            billingPeriod={invoice.billingPeriod}
            issueDate={invoice.issueDate}
          />
        )}
        <InvoiceEditor
          bootstrap={{
            businessId: business.id,
            invoice,
            recentCustomers: customers,
            savedItems: items,
            sellerStateCode: business.stateCode,
            chargesGst: assessment.chargesGst,
            setupBlockers: profileSetupStatus(business, invoice.issueDate).blockers,
            selectableRatesBp: [...DEFAULT_RULE_PACK.selectableRates.value],
            defaultTaxRateBp: business.defaultTaxRateBp,
            aiEnabled: aiConfig().enabled,
          }}
        />
      </main>
    </>
  );
}
