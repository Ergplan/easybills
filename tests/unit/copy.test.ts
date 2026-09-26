/**
 * The voice, enforced.
 *
 * docs/voice.md says how EkBill talks. Most of that is judgement. The parts
 * that are not -- every key present in every column, placeholders that agree,
 * and the words the owner never uses never appearing -- are checked here, so
 * a string added in a hurry cannot quietly drift into "Generate invoice".
 */
import { describe, expect, it } from 'vitest';

import { DICTIONARY, fill, t, tCount, type CopyKey } from '@/lib/copy';
import {
  billSentMessage,
  looksLikeShop,
  moneyForMessage,
  reminderMessage,
  salutationFor,
  suggestedTone,
} from '@/lib/copy/messages';

const KEYS = Object.keys(DICTIONARY) as CopyKey[];

const placeholdersOf = (s: string) => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();

/**
 * Words that mean something to an accountant and nothing to the owner. If one
 * of these is the right word, docs/voice.md is wrong and should change first.
 */
const JARGON = [
  /\binvoice/i,
  /\breceivable/i,
  /\boutstanding\b/i,
  /\badjustment/i,
  /\bschedule/i,
  /\boccurrence/i,
  /\breconcil/i,
  /\bledger\b/i,
  /\bsubmit/i,
  /\bconfigur/i,
  /\bauthori[sz]/i,
  /\bcredential/i,
  /\bvalidat/i,
  /\btransaction/i,
  /\bgenerate/i,
];

describe('the dictionary', () => {
  it('has something to say', () => {
    expect(KEYS.length).toBeGreaterThan(100);
  });

  it.each(KEYS)('%s is written in both columns and neither is blank', (key) => {
    const entry = DICTIONARY[key];
    expect(entry.en.trim().length, `${key}.en is empty`).toBeGreaterThan(0);
    expect(entry.hi.trim().length, `${key}.hi is empty`).toBeGreaterThan(0);
  });

  it.each(KEYS)('%s uses the same placeholders in both columns', (key) => {
    const entry = DICTIONARY[key];
    expect(placeholdersOf(entry.hi), `${key}: hi has different placeholders from en`).toEqual(
      placeholdersOf(entry.en),
    );
  });

  it.each(KEYS)('%s does not talk like an accountant', (key) => {
    const hit = JARGON.find((rx) => rx.test(DICTIONARY[key].hi));
    expect(hit, `${key}.hi contains "${hit}" -- see docs/voice.md`).toBeUndefined();
  });

  it('keeps buttons short', () => {
    // A button is one or two words. Keys that name an action are the ones on
    // buttons; a long one is a sentence that wants to be a hint instead.
    const buttons = KEYS.filter((k) =>
      /\.(save|ok|cancel|back|next|done|remove|retry|button|go|yes|make|whatsapp|later|view|send|verify|resend|markPaid|addItem|newCustomer|logout)$/.test(k),
    );
    expect(buttons.length).toBeGreaterThan(10);
    for (const key of buttons) {
      const words = DICTIONARY[key].hi.replace(/[+✓]/g, '').trim().split(/\s+/).length;
      expect(words, `${key}.hi is ${words} words; a button is at most 3`).toBeLessThanOrEqual(3);
    }
  });

  it('never leaves a placeholder on the screen', () => {
    expect(t('home.greeting', { name: 'Sharma ji' })).toBe('Namaste, Sharma ji');
    expect(() => t('home.greeting')).toThrow(/missing a value for \{name\}/);
  });

  it('picks the right shape for a count', () => {
    const keys = { zero: 'home.sent.subEmpty', one: 'home.sent.subOne', many: 'home.sent.sub' } as const;
    expect(tCount(0, keys)).toMatch(/koi bill nahi/);
    expect(tCount(1, keys)).toBe('1 bill is mahine');
    expect(tCount(4, keys)).toBe('4 bills is mahine');
  });

  it('fills templates without touching text that is not a placeholder', () => {
    expect(fill('GST ({rate}%) on {amount}', { rate: 18, amount: '₹100' })).toBe('GST (18%) on ₹100');
    expect(fill('no placeholders here')).toBe('no placeholders here');
  });
});

describe('who a message greets', () => {
  it('says ji to a person, by first name', () => {
    expect(salutationFor({ name: 'Ramesh Patil' })).toBe('Ramesh ji');
    expect(salutationFor({ name: 'Dr. Anjali Kulkarni' })).toBe('Anjali ji');
    expect(salutationFor({ name: 'Mr Suresh' })).toBe('Suresh ji');
  });

  it('does not say ji to a shop', () => {
    expect(salutationFor({ name: 'Mehta Traders' })).toBe('Mehta Traders');
    expect(salutationFor({ name: 'Green Park Society' })).toBe('Green Park Society');
    expect(salutationFor({ name: 'Priya Boutique' })).toBe('Priya Boutique');
    expect(salutationFor({ name: 'Sharma & Sons' })).toBe('Sharma & Sons');
  });

  it('greets the person at a shop when the owner has named one', () => {
    expect(salutationFor({ name: 'Green Park Society', contactPerson: 'Vinod Patil' })).toBe('Vinod ji');
  });

  it('knows a shop when it sees one', () => {
    expect(looksLikeShop('Kulkarni Electricals')).toBe(true);
    expect(looksLikeShop('Ramesh Patil')).toBe(false);
    expect(looksLikeShop('Ravi Kumar')).toBe(false);
  });
});

describe('money and dates in a chat', () => {
  it('drops the paise when there are none, keeps them when there are', () => {
    expect(moneyForMessage(945000)).toBe('₹9,450');
    expect(moneyForMessage(11240000)).toBe('₹1,12,400');
    expect(moneyForMessage(123456)).toBe('₹1,234.56');
  });
});

describe('the reminder', () => {
  const customer = { name: 'Green Park Society', contactPerson: 'Vinod Patil' };
  const business = { name: 'Sharma Electricals', upiId: 'sharma@upi' };
  const bill = { number: 'INV-040', amountDuePaise: 945000, issueDate: '2026-09-12' as const };

  it('is gentle first: a namaste, the bill, when convenient, the UPI, a thank you', () => {
    const msg = reminderMessage({ customer, business, bill, tone: 'gentle', today: '2026-09-26' });
    expect(msg).toBe(
      'Namaste Vinod ji 🙏 Bill no. INV-040 (₹9,450, 12 Sep) ka payment abhi baaki hai. ' +
        'UPI se bhej sakte hain: sharma@upi. Bill saath laga hai. Dhanyavaad! — Sharma Electricals',
    );
  });

  it('is direct after a while: says how many days, asks for today', () => {
    const msg = reminderMessage({ customer, business, bill, tone: 'direct', today: '2026-10-06' });
    expect(msg).toContain('24 din se baaki hai');
    expect(msg).toContain('aaj bhej dein');
    expect(msg).toMatch(/— Sharma Electricals$/);
  });

  it('names the second reminder as the second, and opens the door', () => {
    const msg = reminderMessage({ customer, business, bill, tone: 'second', today: '2026-10-20' });
    expect(msg).toContain('doosra reminder');
    expect(msg).toContain('38 din se pending');
    expect(msg).toContain('Koi dikkat ho toh bata dein');
  });

  it('leaves out the UPI line when the owner has no UPI id, cleanly', () => {
    const msg = reminderMessage({
      customer,
      business: { name: 'Sharma Electricals', upiId: null },
      bill,
      tone: 'gentle',
      today: '2026-09-26',
    });
    expect(msg).not.toContain('UPI');
    expect(msg).not.toMatch(/\s{2,}/);
    expect(msg).toContain('baaki hai. Bill saath laga hai.');
  });

  it('never threatens and never apologises', () => {
    for (const tone of ['gentle', 'direct', 'second'] as const) {
      const msg = reminderMessage({ customer, business, bill, tone, today: '2026-10-20' });
      expect(msg).not.toMatch(/legal|action|penalty|interest|sorry|maaf|warning/i);
      expect(msg).toMatch(/^Namaste /);
    }
  });

  it('speaks Hinglish to a customer whose language is not written yet', () => {
    // A Tamil customer today gets Hinglish, not a blank, not a crash. The day
    // Tamil templates exist, this test is where that changes.
    const msg = reminderMessage({ customer: { ...customer, language: 'ta' }, business, bill, tone: 'gentle', today: '2026-09-26' });
    expect(msg).toMatch(/^Namaste Vinod ji/);
  });

  it('suggests gentle, then direct after two weeks, then second once one has gone', () => {
    expect(suggestedTone({ issueDate: '2026-09-12', today: '2026-09-20', remindersSent: 0 })).toBe('gentle');
    expect(suggestedTone({ issueDate: '2026-09-12', today: '2026-09-26', remindersSent: 0 })).toBe('direct');
    expect(suggestedTone({ issueDate: '2026-09-12', today: '2026-09-14', remindersSent: 1 })).toBe('second');
  });
});

describe('the note that goes with a bill', () => {
  it('says what it is, how to pay, and who it is from', () => {
    const msg = billSentMessage({
      customer: { name: 'Ramesh Patil' },
      business: { name: 'Sharma Electricals', upiId: 'sharma@upi' },
      bill: { number: 'INV-043', amountDuePaise: 620000, issueDate: '2026-09-26' },
    });
    expect(msg).toBe(
      'Namaste Ramesh ji 🙏 Aapka bill no. INV-043 (₹6,200) bhej raha hoon. ' +
        'UPI se bhej sakte hain: sharma@upi. Dhanyavaad! — Sharma Electricals',
    );
  });
});
