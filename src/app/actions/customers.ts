'use server';

import { revalidatePath } from 'next/cache';

import { customerInput } from '@/lib/domain/validation';
import type { CustomerRecord } from '@/lib/domain/types';
import { requireBusiness } from '@/server/auth/guard';
import { createCustomer, listCustomers, updateCustomer } from '@/server/repos/customers';

import { ok, toActionError, type ActionResult } from './common';

/**
 * Inline customer creation.
 *
 * Only a name is required. Address, state, GSTIN, PAN and contact details are
 * revealed when they are actually needed -- a customer with no GSTIN is a normal
 * customer, not an incomplete one.
 */
export async function createCustomerAction(businessId: string, raw: unknown): Promise<ActionResult<CustomerRecord>> {
  try {
    const { user } = await requireBusiness(businessId);
    const input = customerInput.parse(raw);
    const customer = await createCustomer(businessId, user.uid, input);
    revalidatePath('/customers');
    return ok(customer);
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateCustomerAction(
  businessId: string,
  customerId: string,
  raw: unknown,
): Promise<ActionResult<null>> {
  try {
    const { user } = await requireBusiness(businessId);
    const input = customerInput.parse(raw);
    await updateCustomer(businessId, user.uid, customerId, input);
    revalidatePath('/customers');
    revalidatePath(`/customers/${customerId}`);
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

export async function searchCustomersAction(businessId: string, query: string): Promise<ActionResult<CustomerRecord[]>> {
  try {
    await requireBusiness(businessId);
    const all = await listCustomers(businessId);
    const q = query.trim().toLowerCase();
    if (!q) return ok(all.slice(0, 20));
    return ok(
      all
        .filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q))
        .slice(0, 20),
    );
  } catch (error) {
    return toActionError(error);
  }
}
