'use server';

import { revalidatePath } from 'next/cache';

import { t } from '@/lib/copy';
import { askConfig } from '@/lib/env';
import { consumeAiBudget, RateLimitedError } from '@/server/ai/rate-limit';
import { requireBusiness } from '@/server/auth/guard';
import { askRecords, type AskResult } from '@/server/search/ask';
import { removeUpload } from '@/server/search/index-records';

import { ok, toActionError, type ActionResult } from './common';

/** "Poocho": a question about the owner's own bills, contracts and uploaded old bills. */
export async function askAction(businessId: string, question: string): Promise<ActionResult<AskResult>> {
  try {
    await requireBusiness(businessId);
    const q = String(question ?? '').trim();
    if (q.length < 2) return { ok: false, error: t('ask.empty'), code: 'empty' };
    // A model call costs money; the same budget as the other assistants.
    if (askConfig().apiKey) await consumeAiBudget(businessId, 'interpret');
    return ok(await askRecords(businessId, q));
  } catch (error) {
    if (error instanceof RateLimitedError) return { ok: false, error: error.message, code: 'rate-limited' };
    return toActionError(error);
  }
}

/** "Hata do": forget an uploaded old bill's text. */
export async function removeUploadAction(businessId: string, documentId: string): Promise<ActionResult<null>> {
  try {
    await requireBusiness(businessId);
    await removeUpload(businessId, documentId);
    revalidatePath('/ask');
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}
