import 'server-only';

import { todayIst } from '@/lib/dates';
import type { BusinessRecord, CustomerRecord, SavedItemRecord } from '@/lib/domain/types';
import { aiConfig } from '@/lib/env';
import { formatMoneyPlain, formatPercentPlain, parseMoney, parseQuantity } from '@/lib/money';
import { listCustomers } from '@/server/repos/customers';
import { listItems } from '@/server/repos/items';

import { AiUnavailableError, interpretWithModel } from './adapters';
import { consumeAiBudget } from './rate-limit';
import type { AiInterpretation } from './schema';

/**
 * The pipeline between a sentence and a draft.
 *
 *   instruction -> [model: reading only] -> authorised lookup -> deterministic
 *   validation and pricing -> PROPOSAL for the owner to review
 *
 * The model contributes exactly one thing: a structured reading of the words.
 * Everything with consequences -- which customer, which saved price, what the
 * amounts are -- happens here, against records belonging to THIS business, with
 * every number recomputed by the application.
 */

export interface ProposedLine {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string | null;
  /** True when the price came from the saved catalogue rather than the instruction. */
  priceFromSavedItem: boolean;
  savedItemId: string | null;
  /** True when no price could be established. The owner must supply one. */
  priceMissing: boolean;
}

export interface InterpretationResult {
  intent: AiInterpretation['intent'];
  customer: { name: string; customerId: string | null } | null;
  /** More than one plausible customer -- the owner chooses, we do not guess. */
  customerChoices: Array<{ id: string; name: string }>;
  lines: ProposedLine[];
  questions: string[];
  notes: string[];
  recurringProposal: AiInterpretation['recurring'];
  usedSavedPrices: boolean;
}

export async function interpretInstruction(args: {
  business: BusinessRecord;
  instruction: string;
  chosenCustomerId?: string | null;
}): Promise<InterpretationResult> {
  const config = aiConfig();
  const instruction = args.instruction.trim();

  if (!instruction) throw new AiUnavailableError('Please say or type what you want to bill.', 'malformed');
  if (instruction.length > config.maxInputChars) {
    throw new AiUnavailableError('That instruction is too long. Please shorten it or type the bill.', 'malformed');
  }

  await consumeAiBudget(args.business.id, 'interpret');

  // Only NAMES are sent, and only a bounded number of them. Phone numbers,
  // addresses, GSTINs, PANs and bank details never leave the server, and the
  // full customer database is never handed to a model.
  const customers = await listCustomers(args.business.id, { limit: 200 });
  const candidateNames = customers.slice(0, 40).map((c) => c.name);

  const reading = await interpretWithModel({
    instruction,
    todayIso: todayIst(),
    candidateCustomerNames: candidateNames,
  });

  return assembleProposal({
    reading,
    customers,
    savedItems: await listItems(args.business.id, 200),
    chosenCustomerId: args.chosenCustomerId ?? null,
  });
}

/**
 * Turn a model reading into a proposal, using only this business's records.
 *
 * Split out from the network call so it can be tested exhaustively without a
 * provider, including against deliberately hostile readings.
 */
export function assembleProposal(args: {
  reading: AiInterpretation;
  customers: CustomerRecord[];
  savedItems: SavedItemRecord[];
  chosenCustomerId: string | null;
}): InterpretationResult {
  const { reading, customers, savedItems } = args;
  const questions: string[] = [];
  const notes: string[] = [];

  // --- resolve the customer, inside this business only --------------------
  let customer: InterpretationResult['customer'] = null;
  let customerChoices: InterpretationResult['customerChoices'] = [];

  if (args.chosenCustomerId) {
    const picked = customers.find((c) => c.id === args.chosenCustomerId);
    // An id that is not in this business's own list is simply not honoured.
    if (picked) customer = { name: picked.name, customerId: picked.id };
  } else if (reading.customerHint) {
    const hint = reading.customerHint.trim().toLowerCase();
    const exact = customers.filter((c) => c.name.toLowerCase() === hint);
    const partial = customers.filter(
      (c) => c.name.toLowerCase().includes(hint) || hint.includes(c.name.toLowerCase()),
    );
    const matches = exact.length ? exact : partial;

    if (matches.length === 1) {
      customer = { name: matches[0]!.name, customerId: matches[0]!.id };
    } else if (matches.length > 1) {
      customerChoices = matches.slice(0, 5).map((c) => ({ id: c.id, name: c.name }));
      questions.push('Which customer did you mean?');
    } else {
      // A name we do not know becomes a NEW customer's name, not a fabricated id.
      customer = { name: reading.customerHint.trim(), customerId: null };
      notes.push(`We have not billed "${reading.customerHint.trim()}" before. Check the name before you issue.`);
    }
  }

  // --- resolve the lines --------------------------------------------------
  let usedSavedPrices = false;
  const lines: ProposedLine[] = [];

  for (const raw of reading.lines) {
    const description = raw.description.trim().slice(0, 200);
    if (!description) continue;

    // Quantity: validated by our own parser, defaulting to 1 rather than 0, so a
    // misread quantity can never quietly zero out a line.
    let quantity = '1';
    if (raw.quantity) {
      try {
        const milli = parseQuantity(raw.quantity);
        if (milli > 0) quantity = String(milli / 1000);
      } catch {
        questions.push(`How many "${description}"?`);
      }
    }

    let unitPrice = '';
    let priceFromSavedItem = false;
    let savedItemId: string | null = null;

    if (raw.unitPriceQuoted) {
      try {
        const paise = parseMoney(raw.unitPriceQuoted);
        if (paise >= 0) {
          // An amount stated as a line total is converted back to a unit price
          // by OUR arithmetic, never by the model's.
          const qtyMilli = parseQuantity(quantity);
          const unitPaise = raw.amountIsLineTotal && qtyMilli > 0
            ? Math.round((paise * 1000) / qtyMilli)
            : paise;
          unitPrice = formatMoneyPlain(unitPaise);
        }
      } catch {
        questions.push(`What is the price for "${description}"?`);
      }
    }

    // No price in the instruction: fall back to a CONFIRMED saved price, and say
    // so. We never invent one, and a saved price is only used on a clear match.
    if (!unitPrice) {
      const match = savedItems.find((i) => i.description.trim().toLowerCase() === description.toLowerCase());
      if (match) {
        unitPrice = formatMoneyPlain(match.unitPricePaise);
        priceFromSavedItem = true;
        savedItemId = match.id;
        usedSavedPrices = true;
      }
    }

    const priceMissing = unitPrice === '';
    if (priceMissing) questions.push(`What is the price for "${description}"?`);

    const savedMatch = savedItemId ? savedItems.find((i) => i.id === savedItemId) : undefined;

    lines.push({
      description,
      quantity,
      unitPrice,
      taxRate: savedMatch?.taxRateBp != null ? formatPercentPlain(savedMatch.taxRateBp) : null,
      priceFromSavedItem,
      savedItemId,
      priceMissing,
    });
  }

  // Ask about ONE thing at a time: a wall of questions is worse than the form.
  const orderedQuestions = [...new Set(questions)];
  const finalQuestions = customerChoices.length ? ['Which customer did you mean?'] : orderedQuestions.slice(0, 1);

  for (const a of reading.ambiguities.slice(0, 3)) notes.push(`Please check: ${a}`);
  if (usedSavedPrices) notes.push('We filled in some prices from your saved items. Please check them.');
  if (reading.referencesPreviousInvoice) {
    notes.push('You mentioned a previous bill. Please check the items below against it before issuing.');
  }

  return {
    intent: reading.intent,
    customer,
    customerChoices,
    lines,
    questions: finalQuestions,
    notes,
    recurringProposal: reading.recurring,
    usedSavedPrices,
  };
}
