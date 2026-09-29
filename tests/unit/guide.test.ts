/**
 * The guided tour: every screen maps to its tour, and every tour says
 * something in Hinglish about things that exist.
 */
import { describe, expect, it } from 'vitest';

import { SCREEN_PURPOSE, screenOf, tourFor, TOUR_SCREENS } from '@/lib/guide/tours';

describe('which screen is this', () => {
  it.each([
    ['/home', 'home'],
    ['/bills/start', 'bill-start'],
    ['/bills/3f1c2a9e-0000-4000-8000-000000000000', 'bill'],
    ['/bills/3f1c2a9e-0000-4000-8000-000000000000/remind', 'bill-remind'],
    ['/bills/help', 'help'],
    ['/bills', 'bills'],
    ['/dues', 'dues'],
    ['/customers', 'customers'],
    ['/customers/abc', 'customer'],
    ['/ask', 'ask'],
    ['/you', 'you'],
    ['/gst', 'gst'],
    ['/start', 'start'],
    ['/signin', 'signin'],
    ['/settings', 'other'],
  ])('%s is %s', (path, screen) => {
    expect(screenOf(path)).toBe(screen);
  });
});

describe('the tours', () => {
  it('every screen people use has one, and a purpose voice is told', () => {
    for (const s of TOUR_SCREENS.filter((s) => s !== 'other')) {
      expect(tourFor(s).length, s).toBeGreaterThan(0);
      expect(SCREEN_PURPOSE[s].length, s).toBeGreaterThan(10);
    }
  });

  it('says each step in a sentence or two, without office words', () => {
    for (const s of TOUR_SCREENS) {
      for (const step of tourFor(s)) {
        expect(step.say.length, step.say).toBeLessThan(160);
        expect(step.say, step.say).not.toMatch(/(?<!e-)\binvoice|\boutstanding|\breceivable|\bsubmit/i);
      }
    }
  });

  it('walks the bill in the order it is filled: who, what, how many, rate, then Bill banao', () => {
    const order = tourFor('bill').map((s) => (typeof s.target === 'string' ? s.target : s.target.text));
    const at = (x: string) => order.findIndex((o) => o.includes(x));
    expect(at('#bill-customer')).toBeLessThan(at('what-'));
    expect(at('what-')).toBeLessThan(at('qty-'));
    expect(at('qty-')).toBeLessThan(at('rate-'));
    expect(at('rate-')).toBeLessThan(at('Bill banao'));
  });
});
