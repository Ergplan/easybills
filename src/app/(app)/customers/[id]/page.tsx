import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatDateShort } from '@/lib/dates';
import { stateName } from '@/lib/gst/state-codes';
import { Money, StatusPill } from '@/components/Money';
import { TopBar } from '@/components/TopBar';
import { requireCurrentContext } from '@/server/auth/current';
import { getCustomer } from '@/server/repos/customers';
import { customerUnappliedCredit } from '@/server/repos/payments';
import { customerBalance } from '@/server/services/bill-search';
import { invoicesCol } from '@/server/firebase/paths';
import type { InvoiceRecord } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await requireCurrentContext();
  const customer = await getCustomer(business.id, id);
  if (!customer) notFound();

  const [balance, credit, invoiceSnap] = await Promise.all([
    customerBalance(business.id, id),
    customerUnappliedCredit(business.id, id),
    invoicesCol(business.id).where('customer.customerId', '==', id).orderBy('issueDate', 'desc').limit(50).get(),
  ]);
  const invoices = invoiceSnap.docs.map((d) => d.data() as InvoiceRecord);

  return (
    <>
      <TopBar title={customer.name} back={{ href: '/customers' }} />
      <main className="page">
        <section className="card stack">
          <div className="row row--between">
            <span className="muted">To collect</span>
            <Money paise={balance.outstandingPaise} big />
          </div>
          {balance.overduePaise > 0 && (
            <p className="small" style={{ color: 'var(--danger)', fontWeight: 650 }}>
              <Money paise={balance.overduePaise} symbol /> is past its due date
            </p>
          )}
          {credit > 0 && (
            <div className="notice notice--info">
              <span className="notice__icon" aria-hidden="true">i</span>
              <span className="small">
                This customer has <Money paise={credit} symbol /> paid in advance that has not been applied to a bill yet.
              </span>
            </div>
          )}
        </section>

        <section className="card stack">
          <h2>Details</h2>
          <div className="stack stack--tight small">
            {customer.phone && <div className="row row--between"><span className="muted">Phone</span><span>{customer.phone}</span></div>}
            {customer.email && <div className="row row--between"><span className="muted">Email</span><span className="truncate">{customer.email}</span></div>}
            {customer.addressLine1 && <div className="row row--between"><span className="muted">Address</span><span className="truncate">{customer.addressLine1}</span></div>}
            {customer.stateCode && <div className="row row--between"><span className="muted">State</span><span>{stateName(customer.stateCode)}</span></div>}
            {customer.gstin && <div className="row row--between"><span className="muted">GST number</span><span>{customer.gstin}</span></div>}
            {!customer.phone && !customer.email && !customer.gstin && (
              <p className="muted">Only a name is saved for this customer. That is fine.</p>
            )}
          </div>
          <p className="tiny muted">
            Changing these details affects future bills only. Bills already issued keep the details they were issued with.
          </p>
        </section>

        <section className="card card--flush">
          <div className="card__header row row--between">
            <h2>Bills</h2>
            <Link href="/bills/new" className="btn btn--ghost">+ New</Link>
          </div>
          {invoices.length === 0 ? (
            <div className="empty"><p>No bills for this customer yet.</p></div>
          ) : (
            <div className="list">
              {invoices.map((inv) => (
                <Link key={inv.id} href={`/bills/${inv.id}`} className="list__item">
                  <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="strong truncate">{inv.number ?? 'Draft'}</span>
                    <span className="faint">{formatDateShort(inv.issueDate)}</span>
                  </div>
                  <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                    <Money paise={inv.totals.grandTotalPaise} />
                    <StatusPill status={inv.status === 'draft' ? 'draft' : inv.paymentStatus} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
