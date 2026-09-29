'use server';

import { todayIst } from '@/lib/dates';
import { requireBusiness } from '@/server/auth/guard';
import { loadHome } from '@/server/services/home';

import { ok, toActionError, type ActionResult } from './common';

export interface VoiceContext {
  businessName: string;
  customers: Array<{ id: string; name: string }>;
  due: Array<{ invoiceId: string; customerId: string | null; customerName: string; amountPaise: number; days: number }>;
}

/** What voice needs to match names and answer "kiske paise aane hain", fresh when asked. */
export async function voiceContextAction(businessId: string): Promise<ActionResult<VoiceContext>> {
  try {
    const { business } = await requireBusiness(businessId);
    const home = await loadHome(business.id, todayIst());
    return ok({
      businessName: business.legalName,
      customers: home.allCustomers.map((c) => ({ id: c.id, name: c.name })),
      due: home.due.map((d) => ({ invoiceId: d.id, customerId: d.customerId, customerName: d.customerName, amountPaise: d.balancePaise, days: d.days })),
    });
  } catch (error) {
    return toActionError(error);
  }
}
