/**
 * One line under each customer's name: what they owe, or that they are
 * settled, or that nothing has been billed yet. Pure, from Home's view.
 */
import { t } from '@/lib/copy';
import { moneyForMessage } from '@/lib/copy/messages';
import type { PickerCustomer } from '@/components/customer/CustomerPicker';
import type { HomeView } from '@/lib/domain/home';

export function peopleRows(view: Pick<HomeView, 'allCustomers' | 'due'>): PickerCustomer[] {
  const owed = new Map<string, number>();
  for (const d of view.due) {
    if (d.customerId) owed.set(d.customerId, (owed.get(d.customerId) ?? 0) + d.balancePaise);
  }
  return view.allCustomers.map((c) => {
    const due = owed.get(c.id) ?? 0;
    if (due > 0) return { id: c.id, name: c.name, meta: t('people.owes', { amount: moneyForMessage(due) }), tone: 'due' };
    if (c.lastBilledAt) return { id: c.id, name: c.name, meta: t('people.clear'), tone: 'clear' };
    return { id: c.id, name: c.name, meta: t('people.new'), tone: 'plain' };
  });
}
