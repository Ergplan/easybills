'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import { t } from '@/lib/copy';
import { todayIst } from '@/lib/dates';
import { checkTerms, milestoneId, planMilestoneBill, planProgressBill, type ContractTerms } from '@/lib/domain/contract';
import { gstTabVisible } from '@/lib/domain/gst-tab';
import type { ProjectRecord } from '@/lib/domain/types';
import { DEFAULT_RULE_PACK } from '@/lib/gst/ruleset';
import { requireBusiness } from '@/server/auth/guard';
import { invoicesCol } from '@/server/firebase/paths';
import { customerToParty, getCustomer } from '@/server/repos/customers';
import { cancelDraft, getInvoice, newInvoiceId, saveDraft } from '@/server/repos/invoices';
import { billsForProject, createProject, getProject, updateProjectTerms } from '@/server/repos/projects';

import { ok, toActionError, type ActionResult } from './common';

const RATES = () => [...DEFAULT_RULE_PACK.selectableRates.value];

/**
 * "Deal save karo." The terms are checked here exactly as the helper checked
 * them, with GST switched off for an owner who does not charge it.
 */
export async function saveProjectAction(
  businessId: string,
  input: { projectId: string | null; customerId: string; terms: ContractTerms; source: ProjectRecord['source'] },
): Promise<ActionResult<{ projectId: string }> | { ok: false; error: string; field: keyof ContractTerms }> {
  try {
    const { business, user } = await requireBusiness(businessId);
    const customer = await getCustomer(businessId, input.customerId);
    if (!customer) return { ok: false, error: t('error.notFound'), code: 'not-found' };
    const withIds = { ...input.terms, milestones: input.terms.milestones.map((m, i) => ({ ...m, id: m.id || milestoneId(i) })) };
    const checked = checkTerms(withIds, { chargesGst: gstTabVisible(business), allowedRatesBp: RATES() });
    if (!checked.ok) return { ok: false, error: checked.message, field: checked.field };
    if (input.projectId) {
      const existing = await getProject(businessId, input.projectId);
      if (!existing || existing.customerId !== customer.id) return { ok: false, error: t('error.notFound'), code: 'not-found' };
      await updateProjectTerms(businessId, user.uid, existing.id, checked.terms);
      revalidatePath(`/customers/${customer.id}`);
      return ok({ projectId: existing.id });
    }
    const project = await createProject({
      businessId,
      uid: user.uid,
      customerId: customer.id,
      customerName: customer.name,
      terms: checked.terms,
      source: input.source,
    });
    revalidatePath(`/customers/${customer.id}`);
    return ok({ projectId: project.id });
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * "Bill taiyaar karo." The bill for one instalment, or for the work done so
 * far, opened on the ordinary bill form with the line and the contract's
 * standing already on it. The owner still taps Bill banao; this never issues.
 *
 * An instalment already started opens that bill again rather than a second
 * one. The empty bill the owner came from, if any, is cleared away.
 */
export async function prepareProjectBillAction(
  businessId: string,
  input: { projectId: string; milestoneId?: string | null; cumulativeBp?: number | null; replaceDraftId?: string | null },
): Promise<ActionResult<{ invoiceId: string }>> {
  try {
    const { business, user } = await requireBusiness(businessId);
    const project = await getProject(businessId, input.projectId);
    if (!project) return { ok: false, error: t('error.notFound'), code: 'not-found' };
    const customer = await getCustomer(businessId, project.customerId);
    if (!customer) return { ok: false, error: t('error.notFound'), code: 'not-found' };
    const { entries } = await billsForProject(businessId, project.id);

    if (project.billing === 'milestones') {
      const open = entries.find((e) => e.milestoneId === input.milestoneId && e.status === 'draft');
      if (open) return ok({ invoiceId: open.invoiceId });
    } else {
      // A running bill started earlier is replaced: the work done has moved on.
      for (const e of entries.filter((x) => x.status === 'draft')) await cancelDraft(businessId, e.invoiceId);
    }

    const plan =
      project.billing === 'milestones'
        ? planMilestoneBill(project, String(input.milestoneId ?? ''), entries)
        : planProgressBill(project, Number(input.cumulativeBp ?? 0), entries.filter((e) => e.status === 'issued'));
    if (!plan.ok) return { ok: false, error: plan.message, code: 'validation' };
    const bill = plan.bill;

    const invoiceId = newInvoiceId();
    const party = customerToParty(customer);
    const chargesGst = gstTabVisible(business) && project.gstMode !== 'none';
    await saveDraft({
      business,
      uid: user.uid,
      invoiceId,
      kind: 'customer-invoice',
      issueDate: todayIst(),
      customer: party,
      placeOfSupplyStateCode: party.stateCode ?? business.stateCode,
      supplyFlags: [],
      lines: [
        {
          id: randomUUID(),
          description: bill.description,
          quantityMilli: 1000,
          unitPricePaise: bill.linePaise,
          discountPaise: 0,
          taxRateBp: chargesGst ? project.gstRateBp ?? 0 : 0,
          taxRateChosen: true,
          cessRateBp: 0,
          priceIncludesTax: false,
          unit: null,
          hsnCode: null,
          savedItemId: null,
        },
      ],
      notes: bill.notes,
      baseRevision: 0,
    });
    const label =
      project.billing === 'milestones'
        ? project.milestones.find((m) => m.id === bill.milestoneId)?.label ?? ''
        : `${(bill.cumulativeBp ?? 0) / 100}%`;
    await invoicesCol(businessId).doc(invoiceId).update({
      projectId: project.id,
      projectStage: { milestoneId: bill.milestoneId, label, basisPaise: bill.basisPaise, cumulativeBp: bill.cumulativeBp },
    });

    if (input.replaceDraftId && input.replaceDraftId !== invoiceId) {
      const old = await getInvoice(businessId, input.replaceDraftId);
      if (old && old.status === 'draft' && !old.projectId && !old.lines.some((l) => l.description.trim() || l.unitPricePaise > 0)) {
        await cancelDraft(businessId, old.id);
      }
    }
    return ok({ invoiceId });
  } catch (error) {
    return toActionError(error);
  }
}
