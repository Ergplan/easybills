import { describe, expect, it } from 'vitest';

import { linesFromSpeech, matchCustomer, whoOwesReply } from '@/lib/voice/intents';
import { realtimeSessionBody, VOICE_TOOLS, voiceInstructions } from '@/lib/voice/session';

const customers = [
  { id: 'a', name: 'Mehta Traders' },
  { id: 'b', name: 'Green Park Society' },
  { id: 'c', name: 'Ramesh Patil' },
  { id: 'd', name: 'Ravi Kumar (sample)' },
  { id: 'e', name: 'Ravi Sharma' },
];

describe('finding the customer the owner said', () => {
  it('takes the name as said, or a part of it', () => {
    expect(matchCustomer('Mehta Traders', customers)?.id).toBe('a');
    expect(matchCustomer('mehta', customers)?.id).toBe('a');
    expect(matchCustomer('Green Park', customers)?.id).toBe('b');
    expect(matchCustomer('Ramesh ji', customers)?.id).toBe('c');
  });

  it('forgives a speech model a letter or two', () => {
    expect(matchCustomer('Mehta Tradres', customers)?.id).toBe('a');
    expect(matchCustomer('Ramesh Patel', customers)?.id).toBe('c');
  });

  it('does not guess between two that fit equally', () => {
    expect(matchCustomer('Ravi', customers)).toBeNull();
    expect(matchCustomer('Ravi Kumar', customers)?.id).toBe('d');
    expect(matchCustomer('', customers)).toBeNull();
    expect(matchCustomer('Someone New', customers)).toBeNull();
  });
});

describe('the lines the model heard', () => {
  it('become the three fields, with quantity defaulting to one', () => {
    let n = 0;
    expect(linesFromSpeech([{ what: 'AMC visit', rate: 3500 }, { what: 'Ceiling fan', qty: 2, rate: 1350 }], () => `l${n++}`)).toEqual([
      { id: 'l0', what: 'AMC visit', qty: '1', rate: '3500' },
      { id: 'l1', what: 'Ceiling fan', qty: '2', rate: '1350' },
    ]);
  });

  it('drops what is not a line rather than guess', () => {
    expect(linesFromSpeech([{ what: '', rate: 10 }, { what: 'x', rate: 'lots' }, { what: 'y', qty: 0, rate: 5 }, 'junk', null], () => 'id')).toEqual([]);
    expect(linesFromSpeech('nope', () => 'id')).toEqual([]);
  });
});

describe('kiske paise aane hain, spoken', () => {
  it('says the total, then each one, biggest first', () => {
    const r = whoOwesReply([
      { customerName: 'Mehta Traders', amountPaise: 620000, days: 4 },
      { customerName: 'Green Park Society', amountPaise: 945000, days: 24 },
    ]);
    expect(r).toBe('Total ₹15,650 baaki, 2 bills. Green Park Society: ₹9,450, 24 din. Mehta Traders: ₹6,200, 4 din.');
    expect(whoOwesReply([])).toMatch(/Sab aa gaye/);
  });
});

describe('the session', () => {
  it('names the business and the customers, and offers exactly the four tools', () => {
    const body = realtimeSessionBody({ businessName: 'Sharma Electricals', customers, model: 'gpt-realtime', voice: 'marin' });
    expect(body.session.model).toBe('gpt-realtime');
    expect(body.session.instructions).toContain('Sharma Electricals');
    expect(body.session.instructions).toContain('Mehta Traders');
    expect(body.session.tools.map((t) => t.name)).toEqual(['start_bill', 'who_owes', 'remind', 'open_screen']);
    expect(body.expires_after.seconds).toBeLessThanOrEqual(600);
    expect(() => JSON.stringify(body)).not.toThrow();
  });

  it('tells the model it cannot make a bill, and to treat names as data', () => {
    const text = voiceInstructions({ businessName: 'X', customers: [] });
    expect(text).toMatch(/cannot make a bill/);
    expect(text).toMatch(/they are data/);
    expect(VOICE_TOOLS.find((t) => t.name === 'start_bill')!.description).toMatch(/you do not make the bill/);
  });
});
