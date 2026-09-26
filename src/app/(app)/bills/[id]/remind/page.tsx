import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { RemindScreen } from '@/components/bill/RemindScreen';
import { Icon } from '@/components/Icon';
import { t } from '@/lib/copy';
import { moneyForMessage, reminderMessage, suggestedTone, type ReminderTone } from '@/lib/copy/messages';
import { daysBetween, todayIst } from '@/lib/dates';
import { requireCurrentContext } from '@/server/auth/current';
import { guessLanguage } from '@/lib/domain/language-guess';
import { getCustomer } from '@/server/repos/customers';
import { getInvoice } from '@/server/repos/invoices';

export const dynamic = 'force-dynamic';

/**
 * "{Name} ko yaad dilayein." The message in all three tones is drafted here,
 * on the server, from the customer record (who to greet, in what language)
 * and the bill; the screen only lets the owner pick and edit.
 */
export default async function RemindPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await requireCurrentContext();
  const invoice = await getInvoice(business.id, id);
  if (!invoice) notFound();
  if (invoice.status !== 'issued') redirect(`/bills/${id}`);
  if (invoice.balancePaise <= 0) redirect(`/bills/${id}`);

  const today = todayIst();
  const customer = invoice.customer.customerId ? await getCustomer(business.id, invoice.customer.customerId) : null;
  const who = {
    name: invoice.customer.name,
    contactPerson: customer?.contactPerson ?? null,
    language: customer?.language ?? null,
  };
  const bill = { number: invoice.number ?? '', amountDuePaise: invoice.balancePaise, issueDate: invoice.issueDate };
  const biz = { name: business.legalName, upiId: business.bank.upiId };
  const drafts = Object.fromEntries(
    (['gentle', 'direct', 'second'] as ReminderTone[]).map((tone) => [
      tone,
      reminderMessage({ customer: who, business: biz, bill, tone, today }),
    ]),
  ) as Record<ReminderTone, string>;
  const remindersSent = invoice.remindersSent ?? 0;
  const current = customer?.language ?? 'hi';
  const guess =
    customer && customer.languageSource !== 'owner'
      ? guessLanguage({
          name: customer.name,
          contactPerson: customer.contactPerson,
          city: customer.city ?? business.city,
          stateCode: customer.stateCode ?? business.stateCode,
        })
      : null;
  const language = {
    customerId: customer?.id ?? null,
    current,
    suggestion: guess && guess.language !== current ? guess : null,
  };

  return (
    <main className="page">
      <div className="row">
        <Link href={`/bills/${id}`} className="btn btn--ghost" aria-label={t('common.back')} style={{ paddingInline: 8 }}>
          <Icon name="back" size={20} />
        </Link>
        <div className="grow">
          <h1 style={{ fontSize: '1.3rem' }}>{t('remind.title', { name: invoice.customer.name })}</h1>
          <p className="faint">
            {t('remind.sub', {
              number: bill.number,
              amount: moneyForMessage(invoice.balancePaise),
              days: Math.max(0, daysBetween(invoice.issueDate, today)),
            })}
          </p>
        </div>
      </div>
      <RemindScreen
        businessId={business.id}
        invoiceId={invoice.id}
        number={bill.number}
        customerPhone={invoice.customer.phone ?? customer?.phone ?? null}
        suggested={suggestedTone({ issueDate: invoice.issueDate, today, remindersSent })}
        drafts={drafts}
        remindersSent={remindersSent}
        lastRemindedAt={invoice.lastRemindedAt ?? null}
        language={language}
      />
    </main>
  );
}
