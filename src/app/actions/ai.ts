'use server';

import { requireBusiness } from '@/server/auth/guard';
import { AiUnavailableError, describeAiConfiguration } from '@/server/ai/adapters';
import { interpretInstruction, type InterpretationResult } from '@/server/ai/interpret';
import { RateLimitedError } from '@/server/ai/rate-limit';
import { recordAudit } from '@/server/services/audit';

import { ok, toActionError, type ActionResult } from './common';

/**
 * The only way the browser can reach a model.
 *
 * Note what this action CANNOT do, by construction: it returns a proposal. It
 * does not save a draft, issue anything, record a payment, change bank details
 * or commit a schedule edit. Those are separate actions the owner triggers after
 * reviewing what came back.
 */
export async function interpretInstructionAction(
  businessId: string,
  input: {
    intent: 'create-draft' | 'duplicate-invoice' | 'propose-schedule-change';
    instruction: string;
    invoiceId?: string;
    chosenCustomerId?: string;
  },
): Promise<ActionResult<InterpretationResult>> {
  try {
    const { business, user } = await requireBusiness(businessId);

    const result = await interpretInstruction({
      business,
      instruction: String(input.instruction ?? ''),
      chosenCustomerId: input.chosenCustomerId ?? null,
    });

    // Audited without the instruction text, which may contain customer details.
    await recordAudit(businessId, {
      actorUid: user.uid,
      actorKind: 'user',
      action: 'ai.interpreted',
      subjectType: 'invoice',
      subjectId: input.invoiceId ?? 'none',
      detail: { intent: result.intent, lineCount: result.lines.length, questions: result.questions.length },
    });

    return ok(result);
  } catch (error) {
    if (error instanceof RateLimitedError) return { ok: false, error: error.message, code: 'rate-limited' };
    if (error instanceof AiUnavailableError) {
      // The manual form is always the fallback, and we say so.
      return {
        ok: false,
        code: `ai-${error.reason}`,
        error: `${error.message} You can type the bill as usual — nothing you entered has been lost.`,
      };
    }
    return toActionError(error);
  }
}

export async function aiStatusAction(): Promise<ActionResult<ReturnType<typeof describeAiConfiguration>>> {
  return ok(describeAiConfiguration());
}
