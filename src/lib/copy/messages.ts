/**
 * What the CUSTOMER reads: the reminder on WhatsApp, the note that goes with a
 * bill. A different audience from the dictionary, and a different language
 * decision -- the owner's app is in Hinglish; the message goes in whatever the
 * customer speaks, which the customer record says and which, in time, a model
 * will suggest from their name and their city.
 *
 * Only Hinglish is written today. Each template is keyed by language so the
 * next one is a new entry here, not a new code path.
 *
 * These are the highest-value strings in the product. People delay a reminder
 * because every draft they write reads wrong; a good one written for them, in
 * their voice, is the feature they will tell a friend about. Read
 * docs/voice.md before changing a word.
 */
import { formatDateShort, daysBetween, type CivilDate } from '@/lib/dates';
import { formatMoneyIndian } from '@/lib/money';

import { fill, type CustomerLanguage } from './index';

export type ReminderTone = 'gentle' | 'direct' | 'second';

interface Templates {
  billSent: string;
  reminder: Record<ReminderTone, string>;
}

/**
 * `{salutation}` is the greeting line for this customer, worked out below --
 * "Patil ji" for a person, the shop name for a shop. `{business}` is the
 * owner's, and signs every message so the customer knows who is asking.
 */
const TEMPLATES: Partial<Record<CustomerLanguage, Templates>> = {
  hi: {
    billSent:
      'Namaste {salutation} 🙏 Aapka bill no. {number} ({amount}) bhej raha hoon. ' +
      '{payLine}Dhanyavaad! — {business}',
    reminder: {
      gentle:
        'Namaste {salutation} 🙏 Bill no. {number} ({amount}, {date}) ka payment abhi baaki hai. ' +
        '{payLine}Bill saath laga hai. Dhanyavaad! — {business}',
      direct:
        'Namaste {salutation}, bill no. {number} ka {amount} {days} din se baaki hai. ' +
        'Kripya aaj bhej dein. {payLine}Bill saath laga hai. — {business}',
      second:
        'Namaste {salutation}, yeh doosra reminder hai. Bill no. {number} ({amount}) {days} din se pending hai. ' +
        'Kripya jald se jald bhej dein. {payLine}Koi dikkat ho toh bata dein. — {business}',
    },
  },
};

/** The line that says how to pay, or nothing if the owner has not said. */
const PAY_LINE: Partial<Record<CustomerLanguage, string>> = {
  hi: 'UPI se bhej sakte hain: {upi}. ',
};

export interface MessageCustomer {
  /** The name on the record: a person or a shop. */
  name: string;
  /** The person the owner actually talks to, for a shop. Null for a person. */
  contactPerson?: string | null;
  /** The language this customer should be spoken to in. Null means the owner's. */
  language?: CustomerLanguage | null;
}

export interface MessageBusiness {
  name: string;
  upiId?: string | null;
}

export interface MessageBill {
  number: string;
  /** In paise. */
  amountDuePaise: number;
  issueDate: CivilDate;
}

/**
 * Who to greet, and how.
 *
 * A person gets their first name and "ji": "Patil ji". A shop gets the shop's
 * name as it is, because "Mehta Traders ji" is not a thing anyone says -- unless
 * the owner told us who they talk to there, in which case that person, with ji.
 * "ji" is not optional politeness in this register; leaving it off reads curt.
 */
export function salutationFor(customer: MessageCustomer): string {
  const person = customer.contactPerson?.trim();
  if (person) return `${firstWord(person)} ji`;
  if (looksLikeShop(customer.name)) return customer.name.trim();
  return `${firstWord(customer.name)} ji`;
}

function firstWord(name: string): string {
  const cleaned = name.trim().replace(/^(mr|mrs|ms|dr|shri|smt|sri)\.?\s+/i, '');
  return cleaned.split(/\s+/)[0] ?? cleaned;
}

/**
 * Names that are businesses, not people. Conservative on purpose: a person
 * wrongly treated as a shop loses their "ji", which is the worse mistake.
 *
 * The ampersand is checked on its own because it is not a word character, so
 * a word-boundary pattern never sees "Sharma & Sons" as anything but a name.
 */
const SHOP_WORDS =
  /\b(traders?|enterprises?|stores?|industries|pvt|ltd|llp|society|associates|agencies|agency|solutions|services|works|mart|boutique|electricals?|hardware|motors|textiles?|and\s+sons|brothers|bros|co\.?|company|corp|centre|center|clinic|hospital|school|academy|institute|shop|hotel|restaurant|cafe|bakery|studio|infotech|technologies|tech|systems|repairs?|appliances?|consulting|consultants|kitchen|designs?|classes|tuitions?|caterers|foods?|sweets|garments|fashions?|furniture|interiors|builders|constructions?|developers|printers|photography|events|sample)\b/i;

export function looksLikeShop(name: string): boolean {
  return name.includes('&') || SHOP_WORDS.test(name);
}

/** "₹9,450" -- Indian grouping, no paise when there are none. This is a chat, not a ledger. */
export function moneyForMessage(paise: number): string {
  const s = formatMoneyIndian(paise, { withSymbol: false });
  return `₹${s.endsWith('.00') ? s.slice(0, -3) : s}`;
}

/** The message that goes with a bill when it is first sent. */
export function billSentMessage(args: { customer: MessageCustomer; business: MessageBusiness; bill: MessageBill }): string {
  const lang = pick(args.customer.language);
  return fill(TEMPLATES[lang]!.billSent, {
    salutation: salutationFor(args.customer),
    number: args.bill.number,
    amount: moneyForMessage(args.bill.amountDuePaise),
    payLine: payLine(lang, args.business),
    business: args.business.name,
  });
}

/** The nudge. Three tones, chosen by the owner; the rest is written for them. */
export function reminderMessage(args: {
  customer: MessageCustomer;
  business: MessageBusiness;
  bill: MessageBill;
  tone: ReminderTone;
  today: CivilDate;
}): string {
  const lang = pick(args.customer.language);
  const days = Math.max(0, daysBetween(args.bill.issueDate, args.today));
  return fill(TEMPLATES[lang]!.reminder[args.tone], {
    salutation: salutationFor(args.customer),
    number: args.bill.number,
    amount: moneyForMessage(args.bill.amountDuePaise),
    date: shortDayMonth(args.bill.issueDate),
    days,
    payLine: payLine(lang, args.business),
    business: args.business.name,
  });
}

/**
 * The tone the app should offer first, so the owner is not asked to choose
 * before they have to. Gentle to begin with, direct after a couple of weeks,
 * and "second reminder" once one has already gone.
 */
export function suggestedTone(args: { issueDate: CivilDate; today: CivilDate; remindersSent: number }): ReminderTone {
  if (args.remindersSent > 0) return 'second';
  return daysBetween(args.issueDate, args.today) >= 14 ? 'direct' : 'gentle';
}

function payLine(lang: CustomerLanguage, business: MessageBusiness): string {
  const upi = business.upiId?.trim();
  if (!upi) return '';
  return fill(PAY_LINE[lang] ?? PAY_LINE.hi!, { upi });
}

/** A customer whose language is not written yet is spoken to in the owner's. */
function pick(language: CustomerLanguage | null | undefined): CustomerLanguage {
  return language && TEMPLATES[language] ? language : 'hi';
}

/** "12 Sep" -- the year is noise inside a message about last month's bill. */
function shortDayMonth(date: CivilDate): string {
  return formatDateShort(date).replace(/\s\d{4}$/, '');
}
