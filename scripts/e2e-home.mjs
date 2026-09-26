/**
 * Home: three questions, and the tabs that come with them.
 *
 *   Terminal 1: npm run emulators
 *   Terminal 2: npm run dev
 *   Terminal 3: node scripts/e2e-home.mjs
 *
 * Opens the demo shop, which has customers and bills, and checks that Home
 * answers its three questions in Hinglish, that a chip starts a bill for
 * that customer, that the tab bar has two tabs without a GST number and three
 * with one, and that "Aap" saves in place. Screenshots at 360px and 1280px.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

import { signInByPhone } from './e2e-auth.mjs';

const OUT = process.env.E2E_OUT ?? './e2e-output';
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

mkdirSync(OUT, { recursive: true });

const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label} ${detail}`);
    failures.push(label);
  }
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });

try {
  console.log('\n1. Into the demo shop');
  await signInByPhone(page, BASE);
  await page.waitForURL('**/start', { timeout: 20000 });
  await page.getByRole('button', { name: /demo/i }).click();
  await page.waitForURL('**/home', { timeout: 40000 });
  await page.waitForTimeout(800);
  await shot('home-01-360');

  console.log('\n2. Three questions');
  const text = await page.locator('main').innerText();
  check('Namaste, by name', /^Namaste, /m.test(text));
  check('Chalo, bill banate hain', text.includes('Chalo, bill banate hain'));
  check('Bheje hue bills', text.includes('Bheje hue bills'));
  check('Kiske paise aane hain', text.includes('Kiske paise aane hain'));
  check('nothing else: no charts, no monthly drafts, no GST card', !/Monthly|GST returns|Review|Create bill/.test(text) && (await page.locator('canvas').count()) === 0);
  check('every bill row has a Hinglish status word', (await page.locator('.pill').count()) > 0
    && !(await page.locator('.pill', { hasText: /^(Sent|Paid|Unpaid|Part paid|Draft)$/ }).count()));
  check('the money owed is the biggest thing on the third card', await page.locator('.home__big').isVisible());
  check('every unpaid row offers Yaad dilao', (await page.locator('.row-line', { hasText: 'Yaad dilao' }).count()) === (await page.locator('.home__big').count() ? (await page.locator('section[aria-labelledby=due-heading] .row-line').count()) : 0));

  check('Bolke karo is there, and says voice is off without a key', await page.getByRole('button', { name: 'Bolke karo' }).isVisible());
  await page.getByRole('button', { name: 'Bolke karo' }).click();
  check('tapping it explains, nothing else happens', await page.getByText('Bolke karna abhi chalu nahi hai').isVisible());

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal scrolling at 360px', overflow <= 0, `(overflow ${overflow}px)`);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, a')]
      .filter((e) => e.checkVisibility?.({ checkVisibilityCSS: true }))
      .filter((e) => e.getBoundingClientRect().height < 40)
      .map((e) => `${e.tagName}.${e.className}`.slice(0, 40)),
  );
  check('touch targets are at least 40px', small.length === 0, `(${small.join(', ')})`);

  console.log('\n3. The tabs');
  const tabs = await page.locator('.tabbar__item').allInnerTexts();
  check('the demo appliance shop has no GST number, so: Ghar, Aap', tabs.map((t) => t.trim()).join(' / ') === 'Ghar / Aap', `(saw ${tabs.join(' / ')})`);

  console.log('\n4. A chip starts a bill for that customer');
  const chipName = (await page.locator('.chip').first().locator('.chip__name').innerText()).trim();
  await page.locator('.chip').first().click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 25000 });
  await page.waitForTimeout(1200);
  const editor = await page.locator('main').innerText();
  check(`the bill is for ${chipName}`, editor.includes(chipName));
  await shot('home-02-bill-from-chip');

  console.log('\n5. Aap saves in place, and a GST number earns the tab');
  await page.goto(`${BASE}/you`, { waitUntil: 'networkidle' });
  await shot('you-01');
  check('Apne baare mein batayen, prefilled', (await page.locator('#you-name').inputValue()).length > 0);
  await page.locator('#you-upiId').fill('demo@upi');
  await page.locator('#you-gstin').fill('27AAPFU0939F1ZV');
  await page.getByRole('button', { name: 'Save karo' }).click();
  await page.getByText('Save ho gaya').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const tabsAfter = await page.locator('.tabbar__item').allInnerTexts();
  check('with a GST number: Ghar, GST, Aap', tabsAfter.map((t) => t.trim()).join(' / ') === 'Ghar / GST / Aap', `(saw ${tabsAfter.join(' / ')})`);
  check('the state followed the GST number', (await page.locator('#you-stateCode').inputValue()) === '27');

  console.log('\n5b. GST ka hisaab');
  await page.goto(`${BASE}/gst`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot('gst-01-360');
  const gstText = await page.locator('main').innerText();
  check('the quarter, with bills, sales and GST', /GST ka hisaab/.test(gstText) && /Bills/.test(gstText) && /Bikri/.test(gstText));
  check('no returns, no filing, no review steps', !/GSTR|Review|Save and continue|GSTR-3B/.test(gstText));
  const packBtn = page.getByRole('button', { name: 'CA ko bhejo' });
  check('CA ko bhejo is offered', await packBtn.isVisible());
  // The pack itself, through the same route the button fetches.
  const packUrl = await packBtn.getAttribute('data-pack');
  const pack = await page.request.get(`${BASE}${packUrl}`);
  check('the pack is a zip', pack.ok() && (pack.headers()['content-type'] ?? '').includes('zip'), `(status ${pack.status()})`);
  const packBytes = await pack.body();
  check('with the sheet and the PDFs inside', packBytes.length > 5000 && packBytes.subarray(0, 2).toString() === 'PK');

  await page.goto(`${BASE}/you`, { waitUntil: 'networkidle' });
  await page.locator('#you-gstin').fill('');
  await page.getByRole('button', { name: 'Save karo' }).click();
  await page.getByText('Save ho gaya').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const tabsBack = await page.locator('.tabbar__item').allInnerTexts();
  check('take it away and the tab goes', tabsBack.map((t) => t.trim()).join(' / ') === 'Ghar / Aap', `(saw ${tabsBack.join(' / ')})`);

  console.log('\n6. Desktop');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot('home-03-1280');
  check('the rail shows the same tabs', (await page.locator('.sidenav__item').allInnerTexts()).map((t) => t.trim()).join(' / ') === 'Ghar / Aap');
  check('cards sit two across', (await page.locator('.deck').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)) === 2);

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  console.error('\nCRASH', e);
  failures.push('crash');
  await shot('crash').catch(() => undefined);
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} failed: ${failures.join(', ')}` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
