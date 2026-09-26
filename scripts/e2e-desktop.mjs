/**
 * The desktop layout, against a running dev server and the emulators.
 *
 *   Terminal 1: npm run emulators
 *   Terminal 2: npm run dev
 *   Terminal 3: node scripts/e2e-desktop.mjs
 *
 * The phone layout has its own checks at 360px. This is the other half: a
 * browser window, where the three destinations move to a rail, the content
 * stops stretching to whatever the monitor is, and the things folded away for
 * want of space are simply shown. It asserts the rules that survive the width
 * change -- three destinations and no more, one primary action, 44px targets,
 * no horizontal scroll -- and screenshots each page so the layout can be
 * looked at rather than inferred.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

import { signInByPhone } from './e2e-auth.mjs';

const OUT = process.env.E2E_OUT ?? './e2e-output/desktop';
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const WIDTH = Number(process.env.E2E_WIDTH ?? 1440);
const HEIGHT = Number(process.env.E2E_HEIGHT ?? 900);
mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label} ${detail}`); failures.push(label); }
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
// The Next dev overlay floats in a corner and swallows clicks meant for
// whatever is under it -- here, the settings icon in the top bar. It does not
// exist in a production build, so it is hidden rather than designed around.
await context.addInitScript(() => {
  const hide = () => {
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal { display: none !important; }';
    document.documentElement.appendChild(style);
  };
  if (document.documentElement) hide();
  else document.addEventListener('DOMContentLoaded', hide);
});

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const PERIOD = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);

/** Everything a layout has to get right, whatever page it is. */
async function layoutRules(name) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`${name}: no horizontal scrolling`, overflow <= 0, `(overflow ${overflow}px)`);

  const small = await page.evaluate(() => {
    const effective = (el) =>
      (el.type === 'checkbox' || el.type === 'radio') && el.closest('label') ? el.closest('label') : el;
    return [...document.querySelectorAll('button, a, input, select, textarea, summary')]
      .filter((el) => el.checkVisibility?.({ checkVisibilityCSS: true }) && !el.closest('.sr-only'))
      .map(effective)
      .filter((el) => el.getBoundingClientRect().height < 44)
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 50));
  });
  check(`${name}: every target is at least 44px`, small.length === 0, `(${small.join(', ')})`);

  // The rail is the navigation at this width; the bottom bar must be gone, and
  // gone from the accessibility tree too, not merely invisible.
  const nav = await page.evaluate(() => ({
    rails: [...document.querySelectorAll('.sidenav')].filter((e) => e.checkVisibility?.()).length,
    bars: [...document.querySelectorAll('.tabbar')].filter((e) => e.checkVisibility?.()).length,
    destinations: [...document.querySelectorAll('nav[aria-label="Main"] a')].filter((e) =>
      e.checkVisibility?.(),
    ).length,
  }));
  check(`${name}: navigation is the side rail`, nav.rails === 1 && nav.bars === 0, JSON.stringify(nav));
  // Ghar and Aap, plus GST once there is a GST number to speak of.
  check(`${name}: two or three destinations`, nav.destinations === 2 || nav.destinations === 3, `(saw ${nav.destinations})`);

  // Content must not stretch to the full monitor: long lines are unreadable.
  const measure = await page.evaluate(() => document.querySelector('main.page')?.getBoundingClientRect().width ?? 0);
  check(`${name}: content is held to a reading width`, measure > 0 && measure <= 1200, `(${Math.round(measure)}px)`);
}

try {
  console.log(`\n1. Sign up at ${WIDTH}x${HEIGHT}`);
  await signInByPhone(page, BASE);
  await page.waitForURL('**/start', { timeout: 25000 });
  await shot('00-start');

  // The demo business, not an empty one. A layout judged on a blank account
  // looks fine and tells you nothing: what has to hold is a Home with figures
  // on it, a list with rows in it and a customer with history.
  await page.getByRole('button', { name: /demo/i }).click();
  await page.waitForURL('**/home', { timeout: 40000 });
  await page.waitForTimeout(1500);

  console.log('\n2. Home');
  await shot('01-home');
  await layoutRules('home');
  const railName = (await page.locator('.sidenav__name').innerText()).trim();
  check('the rail carries the business name', railName.length > 0, `(saw "${railName}")`);
  // A name that fits must not be cut off: the rail wraps rather than truncates.
  const topbars = await page.locator('.topbar__title').count();
  check('home has no top bar repeating the business name', topbars === 0, `(saw ${topbars})`);
  const primaries = await page.locator('main .btn--primary').count();
  check('home has no primary button: the chips are the action', primaries === 0, `(saw ${primaries})`);
  const chips = await page.locator('.chip').count();
  check('the demo customers are chips on the first card', chips >= 2, `(saw ${chips})`);

  console.log('\n3. The rail navigates');
  for (const [label, path] of [['Aap', '/you'], ['Ghar', '/home']]) {
    await page.locator('.sidenav__item', { hasText: label }).click();
    await page.waitForURL(`**${path}`, { timeout: 15000 });
    await page.waitForTimeout(700);
    const current = await page.locator('.sidenav__item[aria-current="page"]').innerText();
    check(`the rail marks ${label} as where you are`, current.trim() === label, `(marked "${current.trim()}")`);
  }

  console.log('\n4. Settings is behind Aap, not a destination of its own');
  const inRail = await page.locator('.sidenav a[href="/settings"]').count();
  check('settings is not in the rail', inRail === 0);
  await page.locator('.sidenav__item', { hasText: 'Aap' }).click();
  await page.waitForURL('**/you', { timeout: 15000 });
  await page.getByRole('link', { name: /Aur bhi/ }).click();
  await page.waitForURL('**/settings', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await shot('02-settings');
  await layoutRules('settings');

  console.log('\n5. The bill, three fields per line');
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  await page.locator('.chip').first().click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 25000 });
  await page.waitForTimeout(1200);
  await page.locator('input[id^="what-"]').first().fill('Ceiling fan installation');
  await page.locator('input[id^="qty-"]').first().fill('2');
  await page.locator('input[id^="rate-"]').first().fill('850');
  await page.waitForTimeout(600);
  await shot('04-editor');
  await layoutRules('editor');
  const total = (await page.locator('.bill-total').textContent())?.trim();
  check('the total follows the typing', total === '₹1,700', `(saw ${total})`);
  const nums = await page.evaluate(() => {
    const g = document.querySelector('.bill-line__nums');
    return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0;
  });
  check('quantity and rate sit side by side', nums >= 2, `(saw ${nums} tracks)`);

  console.log('\n6. Bheje hue bills');
  await page.goto(`${BASE}/bills`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await shot('05-bills');
  await layoutRules('bills');

  console.log('\n7. An issued bill, and the GST returns screen');
  await page.goto(`${BASE}/bills`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.locator('.row-line').filter({ hasText: 'DEMO-' }).first().click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await shot('07-issued-bill');
  await layoutRules('issued bill');

  // The GST tab exists only once there is a GST number, and the demo shop has
  // none -- so give it one under Aap, the way an owner would.
  await page.goto(`${BASE}/you`, { waitUntil: 'networkidle' });
  await page.locator('#you-gstin').fill('27AAAAA0000A1Z2');
  await page.getByRole('button', { name: 'Save karo' }).first().click();
  await page.getByText('Save ho gaya').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);

  await page.goto(`${BASE}/gst`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot('08-gst');
  await layoutRules('gst');
  const gstText = await page.locator('main').innerText();
  check('the GST screen is the quarter, in Hinglish', /GST ka hisaab/.test(gstText) && /Is quarter/.test(gstText));
  check('and offers CA ko bhejo', await page.getByRole('button', { name: 'CA ko bhejo' }).isVisible());
  check('it says the CA files, not the app', /file karna CA ka kaam hai/.test(gstText));

  console.log('\n8. Dark mode');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await shot('07-home-dark');
  const railInk = await page.evaluate(() => {
    const el = document.querySelector('.sidenav__item[aria-current="page"]');
    if (!el) return null;
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor };
  });
  check('the rail is themed in dark mode', railInk !== null && railInk.background !== 'rgba(0, 0, 0, 0)', JSON.stringify(railInk));
  await page.emulateMedia({ colorScheme: 'light' });

  console.log('\n9. Keyboard');
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  // Tab until something in the rail has focus, then check it is actually shown.
  let reached = false;
  for (let i = 0; i < 12 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.closest('.sidenav') !== null);
  }
  check('the rail is reachable by keyboard', reached);
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const s = getComputedStyle(el);
    return { width: s.outlineWidth, style: s.outlineStyle };
  });
  check('focus is visible', ring !== null && ring.style !== 'none' && parseFloat(ring.width) > 0, JSON.stringify(ring));

  console.log('\n10. Every width in between');

  // A layout with two shapes has a seam, and the seam is where it breaks. At
  // no width may the app lose its navigation, gain a second one, or scroll
  // sideways -- least of all at the pixel either side of the breakpoint.
  const WIDTHS = [320, 360, 390, 414, 600, 768, 834, 1023, 1024, 1180, 1280, 1440, 1920, 2560];
  for (const path of ['/home', '/bills', '/settings']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(220);
      const at = await page.evaluate(() => {
        const shown = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.checkVisibility?.()).length;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          navs: shown('.sidenav') + shown('.tabbar'),
          destinations: [...document.querySelectorAll('nav[aria-label="Main"] a')].filter((e) =>
            e.checkVisibility?.(),
          ).length,
        };
      });
      check(
        `${path} at ${w}px: one navigation, three destinations, no sideways scroll`,
        at.overflow <= 0 && at.navs === 1 && at.destinations === 3,
        JSON.stringify(at),
      );
    }
  }
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });

  console.log('\n11. No uncaught page errors');
  check('no uncaught client errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('  ERROR', e.message);
  failures.push(e.message);
  await shot('99-error').catch(() => {});
} finally {
  await browser.close();
}

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
