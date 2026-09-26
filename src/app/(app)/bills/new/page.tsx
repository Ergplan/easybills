import { redirect } from 'next/navigation';

import { startBillForCustomerAction } from '@/app/actions/invoices';

export const dynamic = 'force-dynamic';

/**
 * A bill with nobody on it yet. Home's chips are the usual way in; this is
 * the address for a link that says "new bill" without naming a customer.
 */
export default async function NewBillPage() {
  const r = await startBillForCustomerAction(null);
  if (!r.ok) redirect('/home');
  redirect(`/bills/${r.data.invoiceId}`);
}
