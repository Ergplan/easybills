/**
 * Every screen, the way an owner moves through them: in by the button on the
 * screen before, out by the back arrow, round by the tabs.
 *
 *   npm run e2e:flow   (with the Auth emulator and the dev server running)
 *
 * Two owners: one brand new, with nothing in the app yet (every empty screen
 * must still say what to do), and one with the demo shop's customers and
 * bills. On every screen the same rules are checked, so a screen added later
 * is held to them too:
 *   - nothing scrolls sideways at 360px
 *   - there is always a way out: the back arrow, or the tabs
 *   - buttons, links and fields are big enough to tap (40px or more)
 *   - no "undefined", "NaN" or "[object" on screen, no broken pictures
 *   - no English-only buttons left over from the old app
 *   - back goes to the screen you came from
 * Screenshots of every screen land in E2E_OUT for a person to look at.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

import { fillProfile, signInByPhone } from './e2e-auth.mjs';

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
page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e}`));
let n = 0;
const path = () => new URL(page.url()).pathname;
const settle = () => page.waitForLoadState('networkidle').then(() => page.waitForTimeout(500));

/** The rules every screen is held to. */
async function audit(name) {
  await settle();
  await page.screenshot({ path: `${OUT}/flow-${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  const r = await page.evaluate(() => {
    const visible = (el) => {
      const s = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0 && !el.closest('details:not([open]) > :not(summary)');
    };
    const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
    const small = [...document.querySelectorAll('button, a.btn, a.person, a.task, .chip, input:not([type=checkbox]):not([type=file]):not([type=radio]), select, summary, .tabbar__item')]
      .filter(visible)
      .filter((el) => !el.closest('.voice-offer__note, .field__hint'))
      .filter((el) => el.getBoundingClientRect().height < 40)
      .map((el) => `${label(el)} (${Math.round(el.getBoundingClientRect().height)}px)`);
    const text = document.body.innerText;
    const english = [...document.querySelectorAll('button, a.btn')]
      .filter(visible)
      .map((el) => el.textContent.trim())
      .filter((t) => /^(Save|Submit|Cancel|Delete|Settings|Issue|Continue|Next|Back|Business details|Download|Download PDF|OK)$/i.test(t));
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      hasBack: Boolean(document.querySelector('.topbar__back')),
      hasTabs: [...document.querySelectorAll('.tabbar, .sidenav')].some(visible),
      small,
      junk: /\bundefined\b|\bNaN\b|\[object /.test(text) ? text.match(/.{0,30}(undefined|NaN|\[object ).{0,30}/)?.[0] : null,
      brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && visible(i)).length,
      english,
    };
  });
  const where = `${name} (${path()})`;
  const problems = [];
  if (r.overflow > 1) problems.push(`scrolls sideways by ${r.overflow}px`);
  // First-time setup comes before the app, so it has no tabs; its questions have their own Peeche.
  if (!r.hasBack && !r.hasTabs && path() !== '/start') problems.push('no way out: no back arrow, no tabs');
  if (r.small.length) problems.push(`small tap targets: ${r.small.slice(0, 5).join(', ')}`);
  if (r.junk) problems.push(`junk text: "${r.junk}"`);
  if (r.brokenImages) problems.push(`${r.brokenImages} broken picture(s)`);
  if (r.english.length) problems.push(`English-only buttons: ${r.english.join(', ')}`);
  check(`${where} passes the screen rules`, problems.length === 0, problems.join(' | '));
}

/** Tap into a screen, check it, go back, check we are where we started. */
async function inAndBack(name, open, expectPath) {
  const from = path();
  await open();
  await page.waitForURL((u) => u.pathname !== from, { timeout: 15000 });
  if (expectPath) check(`${name} opens at ${expectPath}`, expectPath instanceof RegExp ? expectPath.test(path()) : path() === expectPath, path());
  await audit(name);
  await page.locator('.topbar__back').first().click();
  await page.waitForURL((u) => u.pathname === from, { timeout: 15000 }).catch(() => undefined);
  check(`back from ${name} returns to ${from}`, path() === from, `(landed on ${path()})`);
}

async function tab(label, expectPath) {
  await page.locator('.tabbar__item', { hasText: label }).click();
  await page.waitForURL(`**${expectPath}`, { timeout: 15000 });
  const current = await page.locator('.tabbar__item[aria-current="page"]').innerText().catch(() => '');
  check(`the ${label} tab is marked as where you are`, current.trim() === label, `(marked "${current.trim()}")`);
}

try {
  console.log('\nA. A brand-new owner, nothing in the app yet');
  await signInByPhone(page, BASE);
  await audit('setup-name');
  await fillProfile(page, BASE, { name: 'Naya Dukaan', city: 'Nashik' });
  await audit('home-empty');
  const homeText = await page.locator('body').innerText();
  check('Home greets and asks how to help', /kaise help karein/i.test(homeText));
  await inAndBack('bill-start-empty', () => page.getByTestId('task-bill').click(), '/bills/start');
  await inAndBack('dues-empty', () => page.getByTestId('task-due').click(), '/dues');
  check('Home does not say "sab paise aa gaye" before there is a bill', /Abhi koi bill nahi/.test(await page.getByTestId('task-due').innerText()));
  await page.getByTestId('task-due').click();
  await page.waitForURL('**/dues');
  check('an empty dues screen offers the first bill', await page.getByRole('link', { name: 'Pehla bill banao' }).isVisible());
  await page.locator('.topbar__back').click();
  await page.waitForURL('**/home');
  await inAndBack('ask-empty', () => page.getByTestId('task-ask').click(), '/ask');
  await tab('Bills', '/bills');
  await audit('bills-empty');
  await page.getByRole('link', { name: 'Pehla bill banao' }).click();
  await page.waitForURL('**/bills/start', { timeout: 15000 });
  check('an empty Bills screen leads straight to the first bill', true);
  check('and says to tap "Naya customer"', /Pehla bill\? "Naya customer"/.test(await page.locator('main').innerText()));
  await page.locator('.topbar__back').click();
  await page.waitForURL('**/bills', { timeout: 15000 });
  await tab('Customers', '/customers');
  await audit('customers-empty');
  await inAndBack('customer-new', () => page.getByTestId('customer-new').click(), '/customers/new');
  await tab('Aap', '/you');
  await audit('aap');
  await tab('Ghar', '/home');

  console.log('\nB. The first bill, from Home to WhatsApp');
  await page.getByTestId('task-bill').click();
  await page.waitForURL('**/bills/start');
  await page.locator('.picker .person--new').click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 15000 });
  await audit('bill-new-customer');
  await page.locator('#bill-customer').fill('Pehla Customer');
  await page.locator('input[id^="what-"]').first().fill('Service');
  await page.locator('input[id^="rate-"]').first().fill('500');
  await page.getByTestId('make-bar').getByRole('button').click();
  await page.waitForURL(/done=1/, { timeout: 20000 });
  await audit('bill-done');
  await page.getByRole('link', { name: 'Bill dekho' }).click();
  await page.waitForURL((u) => !u.search.includes('done'), { timeout: 15000 });
  await audit('bill-view');
  await page.locator('.topbar__back').click();
  await settle();
  check('back from a new bill goes to where it was started, not into the form again', ['/bills/start', '/home', '/bills'].includes(path()), path());
  await tab('Ghar', '/home');
  check('Home now shows the customer', await page.locator('.people .person', { hasText: 'Pehla Customer' }).isVisible());

  console.log('\nC. The demo shop, every screen with data in it');
  await page.request.delete(`${BASE}/api/auth/session`);
  await signInByPhone(page, BASE);
  await page.waitForURL('**/start', { timeout: 20000 });
  await page.getByRole('button', { name: /demo|Demo|namuna|Namuna/ }).first().click();
  await page.waitForURL('**/home', { timeout: 30000 });
  await audit('home-demo');

  await inAndBack('dues', () => page.getByTestId('task-due').click(), '/dues');
  await page.getByTestId('task-due').click();
  await page.waitForURL('**/dues');
  await inAndBack('remind-from-dues', () => page.getByRole('link', { name: 'Yaad dilao' }).first().click(), /\/remind$/);
  await page.locator('.topbar__back').click();
  await page.waitForURL('**/home', { timeout: 15000 }).catch(() => undefined);
  check('and back again to Home', path() === '/home', path());

  await page.getByTestId('task-bill').click();
  await page.waitForURL('**/bills/start');
  await audit('bill-start');
  await inAndBack('bill-existing-customer', () => page.locator('.picker .person:not(.person--new)').first().click(), /\/bills\/[0-9a-f-]{36}$/);
  await inAndBack('bill-help', () => page.goto(`${BASE}/bills/help`), '/bills/help');

  await tab('Bills', '/bills');
  await audit('bills');
  const firstBill = page.locator('main a[href^="/bills/"]').filter({ hasNotText: /Naya/ }).first();
  await inAndBack('bill-issued', () => firstBill.click(), /\/bills\/[0-9a-f-]{36}$/);

  await tab('Customers', '/customers');
  await audit('customers');
  await inAndBack('customer', () => page.locator('.picker .person:not(.person--new)').first().click(), /\/customers\/[0-9a-f-]{36}$/);

  await tab('Aap', '/you');
  await audit('aap-demo');
  const tabs = (await page.locator('.tabbar__item').allInnerTexts()).map((t) => t.trim());
  if (tabs.includes('GST')) {
    await tab('GST', '/gst');
    await audit('gst');
  }
  await tab('Ghar', '/home');
  await inAndBack('ask', () => page.getByTestId('task-ask').click(), '/ask');

  console.log('\nD. The same screens on a desktop');
  await page.setViewportSize({ width: 1280, height: 860 });
  for (const p of ['/home', '/bills', '/customers', '/dues', '/you', '/bills/start']) {
    await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle' });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${p} at 1280px: no sideways scroll, the side rail is there`, over <= 1 && (await page.locator('.sidenav').isVisible()), `(overflow ${over})`);
  }

  check('no page errors anywhere', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  console.error('\nCRASH', e);
  failures.push('crash');
  await page.screenshot({ path: `${OUT}/flow-crash.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} failed:\n - ${failures.join('\n - ')}` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
