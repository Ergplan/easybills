'use server';

import { t, type CustomerLanguage } from '@/lib/copy';
import { parseCustomer, type CustomerClean, type CustomerField, type CustomerInput } from '@/lib/domain/customer-form';

import { revalidatePath } from 'next/cache';

import { customerInput } from '@/lib/domain/validation';
import type { CustomerRecord } from '@/lib/domain/types';
import { requireBusiness } from '@/server/auth/guard';
import { createCustomer, getCustomer, listCustomers, updateCustomer } from '@/server/repos/customers';

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

/**
 * "Customer ke baare mein batayen", saved. The GST number sets the state,
 * and the state sets the tax on the next bill; nothing already issued
 * changes, because an issued bill keeps its own snapshot.
 */
export async function saveCustomerAction(
  businessId: string,
  customerId: string,
  input: CustomerInput,
): Promise<ActionResult<CustomerClean> | { ok: false; error: string; field: CustomerField }> {
  try {
    const { user } = await requireBusiness(businessId);
    const existing = await getCustomer(businessId, customerId);
    if (!existing) return { ok: false, error: t('error.notFound'), code: 'not-found' };
    const checked = parseCustomer(input);
    if (!checked.ok) return { ok: false, error: checked.message, field: checked.field };
    const c = checked.customer;
    await updateCustomer(businessId, user.uid, customerId, {
      name: c.name,
      contactPerson: c.contactPerson,
      phone: c.phone,
      gstin: c.gstin,
      pan: c.pan,
      addressLine1: c.addressLine1,
      city: c.city,
      pincode: c.pincode,
      stateCode: c.stateCode,
      language: c.language,
      // The owner chose, or chose to leave it: either way the app stops suggesting.
      languageSource: c.language === existing.language && existing.languageSource ? existing.languageSource : 'owner',
    });
    revalidatePath('/home');
    revalidatePath('/customers');
    revalidatePath(`/customers/${customerId}`);
    return ok(c);
  } catch (error) {
    return toActionError(error);
  }
}

/** One tap on a suggestion: this customer is spoken to in this language from now on. */
export async function setCustomerLanguageAction(
  businessId: string,
  customerId: string,
  language: CustomerLanguage,
): Promise<ActionResult<null>> {
  try {
    const { user } = await requireBusiness(businessId);
    await updateCustomer(businessId, user.uid, customerId, { language, languageSource: 'owner' });
    revalidatePath(`/customers/${customerId}`);
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * The customers the owner ticked on the import screen, added. Each one goes
 * through the same checks as the customer form, so a GSTIN that does not
 * add up or a phone that is not one is refused by name rather than saved
 * wrong. Duplicates of a record that already exists are skipped, not merged.
 */
export async function importCustomersAction(
  businessId: string,
  rows: CustomerInput[],
): Promise<ActionResult<{ added: number; skipped: Array<{ name: string; reason: string }> }>> {
  try {
    const { user } = await requireBusiness(businessId);
    const existing = await listCustomers(businessId);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    let added = 0;
    const skipped: Array<{ name: string; reason: string }> = [];
    for (const row of rows.slice(0, 200)) {
      const checked = parseCustomer(row);
      if (!checked.ok) {
        skipped.push({ name: row.name, reason: checked.message });
        continue;
      }
      const c = checked.customer;
      const dup = existing.find(
        (e) => (c.gstin && e.gstin === c.gstin) || (c.phone && e.phone === c.phone) || norm(e.name) === norm(c.name),
      );
      if (dup) {
        skipped.push({ name: c.name, reason: t('import.already') });
        continue;
      }
      const created = await createCustomer(businessId, user.uid, {
        name: c.name,
        phone: c.phone,
        email: null,
        addressLine1: c.addressLine1,
        addressLine2: null,
        city: c.city,
        pincode: c.pincode,
        stateCode: c.stateCode,
        gstin: c.gstin,
        pan: c.pan,
        notes: null,
        contactPerson: c.contactPerson,
        language: c.language,
        languageSource: c.language ? 'owner' : null,
      });
      existing.push(created);
      added += 1;
    }
    revalidatePath('/home');
    revalidatePath('/customers');
    return ok({ added, skipped });
  } catch (error) {
    return toActionError(error);
  }
}
