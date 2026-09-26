/**
 * The palette stays legible, in both themes.
 *
 * A visual refresh is exactly when contrast quietly breaks: a colour gets
 * nudged for looks, still reads fine to whoever nudged it on a good screen in
 * a dark room, and becomes unreadable on a cheap phone held up in daylight
 * outside a repair shop. That is this product's actual reading condition.
 *
 * So the pairings are asserted rather than commented. The numbers are WCAG 2.1
 * contrast ratios, computed from the tokens in globals.css itself, so the
 * assertion cannot drift from the stylesheet the way a comment does.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');

/** The tokens declared in a given block, as `--name: value` pairs. */
function tokensIn(blockStart: string): Record<string, string> {
  const from = css.indexOf(blockStart);
  if (from < 0) throw new Error(`No such block in globals.css: ${blockStart}`);
  // Read to the end of this declaration block.
  const open = css.indexOf('{', from);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = css.slice(open + 1, end);
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[name] = value.trim();
  }
  return out;
}

const LIGHT = tokensIn(':root {');
const DARK = { ...LIGHT, ...tokensIn(":root:not([data-theme='light'])") };

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a solid hex colour: "${hex}". Only opaque tokens can be checked.`);
  const n = parseInt(m[1]!, 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/**
 * Every pairing the app actually puts on screen, and the floor it has to clear.
 *
 * 4.5 is WCAG AA for body text. Body ink is held to 7 (AAA) because it is the
 * text an owner reads every day, on the worst screen in the worst light.
 */
const PAIRS: Array<{ text: string; on: string; min: number; what: string }> = [
  { text: '--ink', on: '--paper', min: 7, what: 'body text on a card' },
  { text: '--ink', on: '--paper-sunk', min: 7, what: 'body text on the page behind the cards' },
  { text: '--ink', on: '--paper-raised', min: 7, what: 'body text on a raised surface' },
  { text: '--ink-soft', on: '--paper', min: 4.5, what: 'secondary text and field labels' },
  { text: '--ink-soft', on: '--paper-sunk', min: 4.5, what: 'secondary text on the page' },
  { text: '--ink-faint', on: '--paper', min: 4.5, what: 'hints, dates, the smallest text there is' },
  { text: '--ink-faint', on: '--paper-sunk', min: 4.5, what: 'hints on the page' },
  { text: '--accent', on: '--paper', min: 4.5, what: 'links and ghost buttons' },
  { text: '--accent', on: '--paper-sunk', min: 4.5, what: 'links on the page' },
  { text: '--accent-ink', on: '--accent', min: 4.5, what: 'text on the deep accent' },
  { text: '--accent-fill-ink', on: '--accent-fill', min: 4.5, what: 'the label on the one primary button' },
  { text: '--accent', on: '--accent-soft', min: 4.5, what: 'the selected navigation item' },
  { text: '--ok', on: '--ok-soft', min: 4.5, what: '"Paid"' },
  { text: '--ok', on: '--paper', min: 4.5, what: 'a settled figure' },
  { text: '--warn', on: '--warn-soft', min: 4.5, what: '"Part paid", and every blocker notice' },
  { text: '--warn', on: '--paper', min: 4.5, what: 'a warning against a card' },
  { text: '--danger', on: '--danger-soft', min: 4.5, what: '"Unpaid" and "Past due"' },
  { text: '--danger', on: '--paper', min: 4.5, what: 'an overdue amount in a list' },
];

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('%s theme contrast', (_theme, tokens) => {
  it.each(PAIRS)('$text on $on is readable — $what', ({ text, on, min }) => {
    const a = tokens[text];
    const b = tokens[on];
    expect(a, `${text} is not declared`).toBeDefined();
    expect(b, `${on} is not declared`).toBeDefined();

    const ratio = contrast(a!, b!);
    expect(
      Number(ratio.toFixed(2)),
      `${text} (${a}) on ${on} (${b}) is ${ratio.toFixed(2)}:1, below the ${min}:1 floor`,
    ).toBeGreaterThanOrEqual(min);
  });
});

describe('the palette itself', () => {
  it('defines a dark counterpart for every colour the light theme has', () => {
    // A token that exists only in light leaks a light-theme colour into dark,
    // which is how a white card ends up on a black page.
    const colourish = (name: string) =>
      /^--(paper|ink|accent|ok|warn|danger|line|surface|wash)/.test(name) && !name.includes('blur');
    const declaredInDark = Object.keys(tokensIn(":root:not([data-theme='light'])"));
    const missing = Object.keys(LIGHT)
      .filter(colourish)
      .filter((name) => !declaredInDark.includes(name));
    expect(missing).toEqual([]);
  });
});
