import { notFound } from 'next/navigation';

import { DEFAULT_RULE_PACK } from '@/lib/gst/ruleset';
import { TopBar } from '@/components/TopBar';
import { BillDone } from '@/components/bill/BillDone';
import { BillForm } from '@/components/bill/BillForm';
import { billSentMessage } from '@/lib/copy/messages';
import { Icon } from '@/components/Icon';
import { t } from '@/lib/copy';
import { formatDateShort } from '@/lib/dates';
import { summariseLines } from '@/lib/domain/bill-form';
import Link from 'next/link';
import { requireCurrentContext } from '@/server/auth/current';
import { getInvoice, lastIssuedForCustomer } from '@/server/repos/invoices';
import { listPaymentsForInvoice } from '@/server/repos/payments';
import { listAdjustmentsForInvoice } from '@/server/repos/adjustments';
import { getSchedule, listSchedules } from '@/server/repos/schedules';
import { assessIssuance } from '@/lib/gst/scenarios';
import { profileSetupStatus } from '@/lib/domain/setup-status';

import { IssuedInvoiceView } from './IssuedInvoiceView';

export const dynamic = 'force-dynamic';

export default async function BillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { id } = await params;
  const { done } = await searchParams;
  const { business } = await requireCurrentContext();
  const invoice = await getInvoice(business.id, id);
  if (!invoice) notFound();

  // Just made: "Bill ban gaya!" and the WhatsApp button. Its own address, so
  // a reload or a back-swipe from WhatsApp lands here and not on the ledger.
  if (invoice.status === 'issued' && done === '1') {
    return (
      <main className="page">
        <BillDone
          businessId={business.id}
          invoiceId={invoice.id}
          number={invoice.number ?? ''}
          customerName={invoice.customer.name}
          totalPaise={invoice.totals.grandTotalPaise}
          message={billSentMessage({
            customer: { name: invoice.customer.name },
            business: { name: business.legalName, upiId: business.bank.upiId },
            bill: { number: invoice.number ?? '', amountDuePaise: invoice.balancePaise, issueDate: invoice.issueDate },
          })}
        />
      </main>
    );
  }

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

  // The three-field bill. What the engine needs to know is settled here,
  // once, from the business's standing: whether GST is charged at all, and
  // whether anything in the profile stops a bill going out.
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
  const setup = profileSetupStatus(business, invoice.issueDate);

  const last = invoice.customer.customerId ? await lastIssuedForCustomer(business.id, invoice.customer.customerId) : null;
  const lastTime = last
    ? {
        month: formatDateShort(last.issueDate).split(' ')[1] ?? '',
        summary: summariseLines(last.lines),
        amountPaise: last.totals.grandTotalPaise,
        lines: last.lines,
      }
    : null;

  const title = invoice.customer.name ? t('bill.title', { customer: invoice.customer.name }) : t('bill.titleNew');

  return (
    <main className="page">
      <div className="row">
        <Link href="/home" className="btn btn--ghost" aria-label={t('common.back')} style={{ paddingInline: 8 }}>
          <Icon name="back" size={20} />
        </Link>
        <div className="grow">
          <h1 style={{ fontSize: '1.3rem' }}>{title}</h1>
        </div>
      </div>
      <BillForm
        businessId={business.id}
        invoiceId={invoice.id}
        baseRevision={invoice.revision}
        issueDate={invoice.issueDate}
        customer={{ customerId: invoice.customer.customerId, name: invoice.customer.name, phone: invoice.customer.phone }}
        chargesGst={assessment.chargesGst}
        gstRatesBp={[...DEFAULT_RULE_PACK.selectableRates.value]}
        defaultGstRateBp={business.defaultTaxRateBp ?? (assessment.chargesGst ? 1800 : null)}
        lastTime={lastTime}
        blockers={setup.blockers.map((b) => ({ message: b.message, whatYouCanDo: b.whatYouCanDo }))}
      />
    </main>
  );
}
