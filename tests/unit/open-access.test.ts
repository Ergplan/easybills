/**
 * Open access is off unless somebody meant it.
 *
 * The switch removes authentication entirely: everyone who opens the address
 * becomes the same user and can read and change every bill. A flag that
 * dangerous must not be reachable by accident -- by a stray "1", by the word
 * "yes", or by the variable merely being present and empty, which is what a
 * half-finished config file looks like.
 */
import { afterEach, describe, expect, it } from 'vitest';

const saved = process.env.AUTH_BYPASS;

afterEach(() => {
  if (saved === undefined) delete process.env.AUTH_BYPASS;
  else process.env.AUTH_BYPASS = saved;
});

async function isOpen() {
  const { openAccess } = await import('@/lib/env');
  return openAccess();
}

describe('open access', () => {
  it('is off when nothing is set, which is every normal deployment', async () => {
    delete process.env.AUTH_BYPASS;
    expect(await isOpen()).toBe(false);
  });

  it.each(['', ' ', '1', 'yes', 'on', 'TRUE', 'True', 'false'])(
    'is off for %o, rather than guessing what was meant',
    async (value) => {
      process.env.AUTH_BYPASS = value;
      expect(await isOpen()).toBe(false);
    },
  );

  // Surrounding whitespace is trimmed, as it is for every other variable this
  // app reads. A stray space in a config file is a typo, not a decision to
  // leave authentication on, and a switch that behaved differently from its
  // neighbours would be the more surprising thing.
  it.each(['true', ' true', 'true ', '  true  '])('is on for %o', async (value) => {
    process.env.AUTH_BYPASS = value;
    expect(await isOpen()).toBe(true);
  });
});
