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
const email = `desk${Date.now()}@example.test`;
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
  check(`${name}: exactly three destinations`, nav.destinations === 3, `(saw ${nav.destinations})`);

  // Content must not stretch to the full monitor: long lines are unreadable.
  const measure = await page.evaluate(() => document.querySelector('main.page')?.getBoundingClientRect().width ?? 0);
  check(`${name}: content is held to a reading width`, measure > 0 && measure <= 1200, `(${Math.round(measure)}px)`);
}

try {
  console.log(`\n1. Sign up at ${WIDTH}x${HEIGHT}`);
  await page.goto(`${BASE}/signin`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('testpassword123');
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await page.waitForURL('**/start', { timeout: 25000 });
  await shot('00-start');

  // The demo business, not an empty one. A layout judged on a blank account
  // looks fine and tells you nothing: what has to hold is a Home with figures
  // on it, a list with rows in it and a customer with history.
  await page.getByRole('button', { name: /Try a demo business/ }).click();
  await page.waitForURL('**/home', { timeout: 40000 });
  await page.waitForTimeout(1500);

  console.log('\n2. Home');
  await shot('01-home');
  await layoutRules('home');
  const railName = (await page.locator('.sidenav__name').innerText()).trim();
  check('the rail carries the business name', railName.length > 0, `(saw "${railName}")`);
  // A name that fits must not be cut off: the rail wraps rather than truncates.
  const topbarName = (await page.locator('.topbar__title').innerText()).trim();
  check('the business name is not repeated across the top', topbarName === 'Home', `(saw "${topbarName}")`);
  // The one primary action rule survives the width change.
  const primaries = await page.locator('main .btn--primary').count();
  check('home still has exactly one primary action', primaries === 1, `(saw ${primaries})`);
  const createBtn = await page.getByRole('link', { name: '+ Create bill' }).boundingBox();
  check(
    'the primary action is a button, not a full-width bar',
    createBtn !== null && createBtn.width < 400,
    `(${createBtn ? Math.round(createBtn.width) : 0}px wide)`,
  );

  console.log('\n3. The rail navigates');
  for (const [label, path] of [['Bills', '/bills'], ['Customers', '/customers'], ['Home', '/home']]) {
    await page.locator('.sidenav__item', { hasText: label }).click();
    await page.waitForURL(`**${path}`, { timeout: 15000 });
    await page.waitForTimeout(700);
    const current = await page.locator('.sidenav__item[aria-current="page"]').innerText();
    check(`the rail marks ${label} as where you are`, current.trim() === label, `(marked "${current.trim()}")`);
  }

  console.log('\n4. Settings is behind the top bar icon, not a fourth destination');
  const inRail = await page.locator('.sidenav a[href="/settings"]').count();
  check('settings is not in the rail', inRail === 0);
  await page.getByRole('link', { name: 'Business settings' }).click();
  await page.waitForURL('**/settings', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await shot('02-settings');
  await layoutRules('settings');

  console.log('\n5. The bill editor with its preview beside it');
  await page.goto(`${BASE}/bills/new`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shot('03-new-bill');
  await page.getByText('Quick bill', { exact: true }).click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 25000 });
  await page.waitForTimeout(1200);
  await page.locator('input[id^="desc-"]').first().fill('Ceiling fan installation');
  await page.locator('input[id^="qty-"]').first().fill('2');
  await page.locator('input[id^="price-"]').first().fill('850');
  await page.waitForTimeout(1800);
  await shot('04-editor');
  await layoutRules('editor');
  const preview = await page.locator('.editor-preview').first().isVisible().catch(() => false);
  check('the live preview sits beside the form', preview);
  // A line item's fields go in one row, and fill it: no empty tracks left over
  // because this business happens not to charge GST.
  const grid = await page.evaluate(() => {
    const g = document.querySelector('.line-item__grid');
    if (!g) return null;
    const tracks = getComputedStyle(g).gridTemplateColumns.split(' ').map(parseFloat);
    const fields = [...g.children].length;
    return { tracks: tracks.filter((t) => t > 0).length, fields, width: g.getBoundingClientRect().width,
             covered: tracks.reduce((a, b) => a + b, 0) };
  });
  check('a line item lays its fields out in one row', grid !== null && grid.tracks === grid.fields, JSON.stringify(grid));
  check(
    'the fields fill the row rather than leaving empty columns',
    grid !== null && grid.covered > grid.width - 60,
    JSON.stringify(grid),
  );

  console.log('\n6. Bills and customers lists');
  await page.goto(`${BASE}/bills`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await shot('05-bills');
  await layoutRules('bills');
  await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await shot('06-customers');
  await layoutRules('customers');

  console.log('\n7. An issued bill, and the GST returns screen');
  await page.goto(`${BASE}/bills`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.locator('.list__item').filter({ hasText: 'DEMO-' }).first().click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await shot('07-issued-bill');
  await layoutRules('issued bill');

  // The GST screen is hidden from businesses it does not apply to, and the
  // demo one is not registered -- so register it. It is the densest screen in
  // the app and the one a desktop layout has most to do for.
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.getByText('Regular GST', { exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('#gstin').fill('27AAAAA0000A1Z2');
  await page.locator('#turnover').fill('4000000');
  await page.getByText('I have checked, and the government e-invoice system does not apply to my business.').click();
  await page.getByRole('button', { name: /Save GST status/ }).click();
  await page.waitForTimeout(2500);

  await page.goto(`${BASE}/gst`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  if (await page.locator('#g-gstin').count()) {
    await page.locator('#g-gstin').fill('27AAAAA0000A1Z2');
    await page.getByText('Every month', { exact: true }).click();
    await page.locator('#g-start').fill(PERIOD);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.waitForTimeout(3000);
  }
  await page.goto(`${BASE}/gst?period=${PERIOD}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot('08-gst');
  await layoutRules('gst');

  const steps = await page.evaluate(() => {
    const strip = document.querySelector('.segmented');
    if (!strip) return null;
    return { scrolls: strip.scrollWidth > strip.clientWidth + 1, count: strip.children.length };
  });
  check('all four GST steps are visible at once', steps !== null && !steps.scrolls && steps.count === 4, JSON.stringify(steps));

  // The drill-down is the widest thing in the app; a desktop is where it has
  // room to be read rather than scrolled sideways.
  const disclosure = page.getByText('See every sale behind these figures', { exact: true });
  if (await disclosure.count()) {
    await disclosure.click();
    await page.waitForTimeout(800);
    await shot('09-gst-drilldown');
    await layoutRules('gst drill-down');
    const wide = await page.evaluate(() => {
      const t = document.querySelector('table.data');
      if (!t) return null;
      const box = t.closest('.table-scroll');
      return box ? { scrolls: box.scrollWidth > box.clientWidth + 1 } : { scrolls: false };
    });
    check('the HSN table fits without sideways scrolling', wide !== null && !wide.scrolls, JSON.stringify(wide));
  }

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
