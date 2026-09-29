import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TopBar } from '@/components/TopBar';

import { CustomerForm } from '@/components/customer/CustomerForm';
import { StartBillButton } from '@/components/customer/StartBillButton';
import { Icon } from '@/components/Icon';
import { Money } from '@/components/Money';
import { t } from '@/lib/copy';
import { formatDateShort, todayIst } from '@/lib/dates';
import { summariseHome } from '@/lib/domain/home';
import { guessLanguage } from '@/lib/domain/language-guess';
import { requireCurrentContext } from '@/server/auth/current';
import { getCustomer } from '@/server/repos/customers';
import { listInvoices } from '@/server/repos/invoices';
import { billsForProject, listProjectsForCustomer } from '@/server/repos/projects';
import { moneyForMessage } from '@/lib/copy/messages';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await requireCurrentContext();
  const customer = await getCustomer(business.id, id);
  if (!customer || customer.archived) notFound();

  const bills = await listInvoices(business.id, { customerId: id, status: 'issued', limit: 100 });
  const view = summariseHome({ issued: bills, customers: [], today: todayIst(), recent: 100 });
  const owed = bills.reduce((s, b) => s + Math.max(0, b.balancePaise), 0);
  const contracts = await Promise.all(
    (await listProjectsForCustomer(business.id, customer.id)).map(async (p) => ({
      id: p.id,
      name: p.name,
      totalPaise: p.totalPaise,
      billedPaise: (await billsForProject(business.id, p.id)).entries.filter((e) => e.status === 'issued').reduce((s, e) => s + e.basisPaise, 0),
    })),
  );

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
    <>
    <TopBar title={customer.name} sub={t('customer.sub')} back={{ href: '/customers' }} />
    <main className="page">

      <StartBillButton customerId={customer.id} label={t('customer.billFor')} />


      <section className="card stack stack--tight customer-bills">
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

      {contracts.length > 0 && (
        <section className="card stack stack--tight">
          <h2 className="card__title" style={{ fontSize: '1.1rem' }}>{t('help.projects')}</h2>
          <div className="rows">
            {contracts.map((c) => (
              <Link key={c.id} href={`/bills/help?customer=${customer.id}&project=${c.id}`} className="row-line">
                <div className="row-line__link">
                  <div className="row-line__name">{c.name}</div>
                  <div className="row-line__meta">
                    {t('help.progressLine', { billed: moneyForMessage(c.billedPaise), total: moneyForMessage(c.totalPaise) })}
                  </div>
                  <div className="help__bar" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, Math.round((c.billedPaise * 100) / Math.max(1, c.totalPaise)))}%` }} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <Link href={`/bills/help?customer=${customer.id}`} className="btn btn--ghost btn--small help-link">{t('help.newProject')}</Link>
        </section>
      )}

      {/* The details are needed once, when the customer is added, and rarely
          after: folded away, so their bills come first. */}
      <details className="card disclosure customer-details">
        <summary>{t('customer.detailsFold')}</summary>
        <div className="disclosure__body stack">
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
        </div>
      </details>
    </main>
    </>
  );
}
