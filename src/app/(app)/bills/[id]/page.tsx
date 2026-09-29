import { notFound } from 'next/navigation';

import { DEFAULT_RULE_PACK } from '@/lib/gst/ruleset';
import { BillDone } from '@/components/bill/BillDone';
import { BillView } from '@/components/bill/BillView';
import { BillForm } from '@/components/bill/BillForm';
import { billSentMessage } from '@/lib/copy/messages';
import { Icon } from '@/components/Icon';
import { t } from '@/lib/copy';
import { formatDateShort, todayIst } from '@/lib/dates';
import { linesToDraft, summariseLines } from '@/lib/domain/bill-form';
import Link from 'next/link';

import { TopBar } from '@/components/TopBar';
import { requireCurrentContext } from '@/server/auth/current';
import { getInvoice, lastIssuedForCustomer, listInvoices } from '@/server/repos/invoices';
import { listAdjustmentsForInvoice } from '@/server/repos/adjustments';
import { getProject } from '@/server/repos/projects';
import { Money } from '@/components/Money';
import { listPaymentsForInvoice } from '@/server/repos/payments';
import { assessIssuance } from '@/lib/gst/scenarios';
import { guessLanguage } from '@/lib/domain/language-guess';
import { getCustomer } from '@/server/repos/customers';
import { profileSetupStatus } from '@/lib/domain/setup-status';


export const dynamic = 'force-dynamic';

export default async function BillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; resumed?: string }>;
}) {
  const { id } = await params;
  const { done, resumed } = await searchParams;
  const { business } = await requireCurrentContext();
  const invoice = await getInvoice(business.id, id);
  if (!invoice) notFound();

  // Just made: "Bill ban gaya!" and the WhatsApp button. Its own address, so
  // a reload or a back-swipe from WhatsApp lands here and not on the ledger.
  if (invoice.status === 'issued' && done === '1') {
    const customer = invoice.customer.customerId ? await getCustomer(business.id, invoice.customer.customerId) : null;
    const current = customer?.language ?? 'hi';
    const guess =
      customer && customer.languageSource !== 'owner'
        ? guessLanguage({ name: customer.name, contactPerson: customer.contactPerson, city: customer.city ?? business.city, stateCode: customer.stateCode ?? business.stateCode })
        : null;
    return (
      <>
      <TopBar title={t('bill.title', { customer: invoice.customer.name })} sub={invoice.number} back={{ href: '/home' }} />
      <main className="page">
        <BillDone
          businessId={business.id}
          invoiceId={invoice.id}
          number={invoice.number ?? ''}
          customerName={invoice.customer.name}
          totalPaise={invoice.totals.grandTotalPaise}
          message={billSentMessage({
            customer: { name: invoice.customer.name, contactPerson: customer?.contactPerson, language: customer?.language },
            business: { name: business.legalName, upiId: business.bank.upiId },
            bill: { number: invoice.number ?? '', amountDuePaise: invoice.balancePaise, issueDate: invoice.issueDate },
          })}
          language={customer ? { customerId: customer.id, current, suggestion: guess && guess.language !== current ? guess : null } : null}
        />
      </main>
      </>
    );
  }

  if (invoice.status === 'cancelled') {
    const redone = invoice.redoneAsInvoiceId ? await getInvoice(business.id, invoice.redoneAsInvoiceId) : null;
    return (
      <>
      <TopBar title={t('bill.title', { customer: invoice.customer.name })} sub={invoice.number} back={{ href: '/bills' }} />
      <main className="page">
        <section className="card stack stack--tight">
          <span className="pill pill--draft" style={{ alignSelf: 'flex-start' }}>{t('fix.cancelled')}</span>
          <p className="muted">{t('fix.cancelledOn', { date: formatDateShort((invoice.cancelledAt ?? '').slice(0, 10) as never), reason: invoice.cancelledReason ?? '' })}</p>
          {redone && (
            <Link href={`/bills/${redone.id}`} className="btn btn--secondary" style={{ alignSelf: 'flex-start' }}>
              {t('fix.redoneAs', { number: redone.number ?? t('status.draft') })}
            </Link>
          )}
          <p className="faint"><Money paise={invoice.totals.grandTotalPaise} whole /></p>
        </section>
      </main>
      </>
    );
  }

  if (invoice.status === 'issued') {
    const [payments, adjustments] = await Promise.all([listPaymentsForInvoice(business.id, invoice.id), listAdjustmentsForInvoice(business.id, invoice.id)]);
    return (
      <>
      <TopBar
        title={t('bill.title', { customer: invoice.customer.name })}
        sub={
          <>
            <span>{invoice.number}</span>
            {invoice.customer.customerId && <Link href={`/customers/${invoice.customer.customerId}`}>{t('customer.details')}</Link>}
          </>
        }
        back={{ href: '/bills' }}
      />
      <main className="page">
        <BillView
          businessId={business.id}
          invoice={invoice}
          payments={payments.filter((p) => !p.reversalOfPaymentId && !p.reversedByPaymentId)}
          adjustments={adjustments.map((a) => ({ number: a.number ?? '', amountPaise: a.amountPaise, reason: a.reason, issueDate: a.issueDate }))}
          today={todayIst()}
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
  const project = invoice.projectId ? await getProject(business.id, invoice.projectId) : null;
  const outstandingPaise = invoice.customer.customerId
    ? (await listInvoices(business.id, { status: 'issued', customerId: invoice.customer.customerId, limit: 100 })).reduce((s, b) => s + Math.max(0, b.balancePaise), 0)
    : 0;
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
    <>
    <TopBar
      title={title}
      sub={invoice.customer.customerId ? <Link href={`/customers/${invoice.customer.customerId}`}>{t('customer.details')}</Link> : undefined}
      back={{ href: '/bills/start' }}
    />
    <main className="page">
      <BillForm
        businessId={business.id}
        invoiceId={invoice.id}
        baseRevision={invoice.revision}
        issueDate={invoice.issueDate}
        customer={{ customerId: invoice.customer.customerId, name: invoice.customer.name, phone: invoice.customer.phone }}
        chargesGst={assessment.chargesGst}
        gstRatesBp={[...DEFAULT_RULE_PACK.selectableRates.value]}
        defaultGstRateBp={
          invoice.lines[0]?.taxRateChosen && invoice.lines[0].taxRateBp > 0
            ? invoice.lines[0].taxRateBp
            : business.defaultTaxRateBp ?? (assessment.chargesGst ? 1800 : null)
        }
        lastTime={lastTime}
        blockers={setup.blockers.map((b) => ({ code: b.code, message: b.message, whatYouCanDo: b.whatYouCanDo }))}
        outstandingPaise={outstandingPaise}
        resumed={resumed === '1'}
        initialLines={invoice.lines.some((l) => l.description.trim()) ? linesToDraft(invoice.lines, () => crypto.randomUUID()) : []}
        project={project ? { id: project.id, name: project.name, stage: invoice.projectStage?.label ?? '' } : null}
      />
    </main>
    </>
  );
}
