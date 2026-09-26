import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CustomerForm } from '@/components/customer/CustomerForm';
import { Icon } from '@/components/Icon';
import { Money } from '@/components/Money';
import { t } from '@/lib/copy';
import { formatDateShort, todayIst } from '@/lib/dates';
import { summariseHome } from '@/lib/domain/home';
import { guessLanguage } from '@/lib/domain/language-guess';
import { requireCurrentContext } from '@/server/auth/current';
import { getCustomer } from '@/server/repos/customers';
import { listInvoices } from '@/server/repos/invoices';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await requireCurrentContext();
  const customer = await getCustomer(business.id, id);
  if (!customer || customer.archived) notFound();

  const bills = await listInvoices(business.id, { customerId: id, status: 'issued', limit: 100 });
  const view = summariseHome({ issued: bills, customers: [], today: todayIst(), recent: 100 });
  const owed = bills.reduce((s, b) => s + Math.max(0, b.balancePaise), 0);

  // The suggestion is offered only while the owner has not said.
  const suggestion =
    customer.languageSource === 'owner'
      ? null
      : guessLanguage({
          name: customer.name,
          contactPerson: customer.contactPerson,
          city: customer.city ?? business.city,
          stateCode: customer.stateCode ?? business.stateCode,
        });

  return (
    <main className="page">
      <div className="row">
        <Link href="/customers" className="btn btn--ghost" aria-label={t('common.back')} style={{ paddingInline: 8 }}>
          <Icon name="back" size={20} />
        </Link>
        <div className="grow">
          <h1 style={{ fontSize: '1.3rem' }}>{t('customer.title')}</h1>
          <p className="faint">{t('customer.sub')}</p>
        </div>
      </div>

      <CustomerForm
        businessId={business.id}
        customerId={customer.id}
        initial={{
          name: customer.name,
          contactPerson: customer.contactPerson ?? '',
          phone: customer.phone ?? '',
          gstin: customer.gstin ?? '',
          pan: customer.pan ?? '',
          addressLine1: customer.addressLine1 ?? '',
          city: customer.city ?? '',
          pincode: customer.pincode ?? '',
          stateCode: customer.stateCode ?? '',
          language: customer.language ?? '',
        }}
        suggestion={suggestion && suggestion.language !== (customer.language ?? 'hi') ? suggestion : null}
      />
      {customer.gstin && <p className="faint">{t('customer.gstNote')}</p>}

      <section className="card stack stack--tight">
        <div className="row row--between">
          <h2 className="card__title" style={{ fontSize: '1.1rem' }}>{t('customer.bills')}</h2>
          <span className={`pill ${owed > 0 ? 'pill--unpaid' : 'pill--paid'}`}>
            {owed > 0 ? t('customer.owes', { amount: '' }).trim() : t('customer.settled')}
            {owed > 0 && <Money paise={owed} whole />}
          </span>
        </div>
        {view.recentSent.length === 0 ? (
          <p className="muted">{t('customer.noBills')}</p>
        ) : (
          <div className="rows">
            {view.recentSent.map((row) => (
              <Link key={row.id} href={`/bills/${row.id}`} className="row-line">
                <div className="row-line__link">
                  <div className="row-line__name">{row.number}</div>
                  <div className="row-line__meta">{formatDateShort(row.issueDate)}</div>
                </div>
                <Money paise={row.grandTotalPaise} whole />
                <span className={`pill ${{ sent: 'pill--sent', paid: 'pill--paid', partly: 'pill--partly', due: 'pill--unpaid' }[row.status]}`}>
                  {t(({ sent: 'status.sent', paid: 'status.paid', partly: 'status.partly', due: 'status.due' } as const)[row.status])}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
