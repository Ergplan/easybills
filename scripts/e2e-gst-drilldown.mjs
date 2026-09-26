/**
 * GSTR-1 drill-down check, against a running dev server and the emulators.
 *
 *   Terminal 1: npm run emulators
 *   Terminal 2: npm run dev
 *   Terminal 3: node scripts/e2e-gst-drilldown.mjs
 *
 * A return is a claim about specific documents. An owner asked to approve one
 * must be able to get from any figure back to the bills behind it -- otherwise
 * "check your sales" means "trust our total". This walks that path in a real
 * browser at 360px: set up a regular-GST business, issue two bills, open the
 * period, expand the breakdown, and follow a link through to the bill it named.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

import { signUp } from './e2e-auth.mjs';

const OUT = process.env.E2E_OUT ?? './e2e-output/gst-drilldown';
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label} ${detail}`); failures.push(label); }
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
// The bills are issued today, so they land in this month's return.
const PERIOD = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);

async function quickBill(desc, qty, price, ratePercent, { expectRateBlock = false } = {}) {
  await page.goto(`${BASE}/bills/new`, { waitUntil: 'networkidle' });
  await page.getByText('Quick bill', { exact: true }).click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 25000 });
  await page.waitForTimeout(900);
  await page.locator('input[id^="desc-"]').first().fill(desc);
  await page.locator('input[id^="qty-"]').first().fill(String(qty));
  await page.locator('input[id^="price-"]').first().fill(String(price));
  await page.waitForTimeout(1500);
  await page.locator('.save-state').first().filter({ hasText: 'Saved' }).waitFor({ timeout: 20000 }).catch(() => {});
  const url = page.url();

  // A tax invoice that charges no GST because nobody answered the rate question
  // is a wrong document. Prove it is refused before answering it.
  if (expectRateBlock) {
    await page.getByRole('button', { name: 'Review' }).click();
    await page.waitForTimeout(2000);
    const blocked = await page.getByRole('button', { name: /^Issue/ }).isDisabled();
    await shot('00-rate-block');
    const why = await page.locator('main').innerText();
    check('issuing is refused while an item has no GST rate chosen', blocked, `(text: ${why.slice(0, 200)})`);
    check('the refusal names the fix, including a deliberate 0%', /choose 0%/i.test(why), `(text: ${why.slice(0, 400)})`);
    // A preview that prints "0%" for an unanswered rate looks identical to a
    // deliberate nil-rated supply, which is the confusion being fixed.
    check('the preview says the rate is not chosen rather than showing 0%', /not chosen/i.test(why), `(text: ${why.slice(0, 500)})`);
    await page.getByRole('button', { name: /Back to edit/ }).click();
    await page.waitForTimeout(1200);
  }

  await page.locator('select[id^="rate-"]').first().selectOption(String(ratePercent));
  await page.waitForTimeout(1500);
  await page.locator('.save-state').first().filter({ hasText: 'Saved' }).waitFor({ timeout: 20000 }).catch(() => {});

  await page.getByRole('button', { name: 'Review' }).click();
  await page.waitForTimeout(2000);
  const issue = page.getByRole('button', { name: /^Issue/ });
  if (await issue.isDisabled()) {
    console.log('    issue blocked:', (await page.locator('main').innerText()).slice(0, 400));
    throw new Error(`cannot issue ${desc}`);
  }
  await issue.click();
  await page.waitForTimeout(3500);
  const text = await page.locator('main').innerText();
  const num = text.match(/INV-\d+/)?.[0] ?? null;
  return { url, id: url.split('/bills/')[1], number: num };
}

try {
  console.log('\n1. Sign up and name the business');
  await signUp(page, BASE, { name: 'Deshmukh Hardware' });

  console.log('\n2. Give the business an address and a state');
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.locator('select').first().selectOption({ label: 'Maharashtra' });
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await page.waitForTimeout(2000);

  console.log('\n3. Become a regular GST business');
  await page.getByText('Regular GST', { exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('#gstin').fill('27AAAAA0000A1Z2');
  await page.locator('#turnover').fill('4000000');
  await page.getByText('I have checked, and the government e-invoice system does not apply to my business.').click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Save GST status/ }).click();
  await page.waitForTimeout(2500);
  await shot('01-settings');

  console.log('\n4. Issue two walk-in bills in this month');
  const a = await quickBill('Cement bags', 4, 380, 18, { expectRateBlock: true });
  console.log('    bill A', a.number, a.id);
  const b = await quickBill('Paint tins', 2, 725, 18);
  console.log('    bill B', b.number, b.id);

  console.log('\n5. Turn on GST returns');
  await page.goto(`${BASE}/gst`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  if (await page.locator('#g-gstin').count()) {
    await page.locator('#g-gstin').fill('27AAAAA0000A1Z2');
    await page.getByText('Every month', { exact: true }).click();
    await page.locator('#g-start').fill(PERIOD);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.waitForTimeout(3000);
  }

  console.log('\n6. Open the period the bills are in');
  await page.goto(`${BASE}/gst?period=${PERIOD}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await shot('02-gst-step1');

  const disclosure = page.getByText('See every sale behind these figures', { exact: true });
  check('step 1 offers a drill-down', await disclosure.count() > 0);
  if (await disclosure.count() === 0) {
    console.log((await page.locator('main').innerText()).slice(0, 1500));
    throw new Error('no drill-down');
  }

  await disclosure.click();
  await page.waitForTimeout(700);
  await shot('03-drilldown-open');
  const body = await page.locator('main').innerText();
  check('drill-down names the unregistered-sales group', /Sales to everyone else/i.test(body));
  check('drill-down counts the bills in the row', /2 bills/.test(body), `(text: ${body.slice(0, 300)})`);
  check('drill-down shows the HSN summary heading', /What you sold, by code/i.test(body));
  check(
    'a mixed HSN group is not named after one of its items',
    /Cement bags and Paint tins/.test(body),
    `(hsn table: ${await page.locator('table.data').first().innerText().catch(() => 'no table')})`,
  );
  check('drill-down shows bill numbers used', /Bill numbers used this period/i.test(body));
  check('drill-down reconciles to a taxable total', /Taxable value of everything above/i.test(body));

  console.log('\n7. Open the B2C summary row');
  const row = page.locator('details.line-item').first();
  await row.locator('summary').click();
  await page.waitForTimeout(500);
  await shot('04-row-open');
  const openLinks = page.locator('a.btn--secondary', { hasText: 'Open bill' });
  const n = await openLinks.count();
  check('the summary row opens to the bills behind it', n === 2, `(saw ${n})`);

  const hrefs = await openLinks.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  check('each link points at a real bill', hrefs.every((h) => /^\/bills\/[0-9a-f-]{36}$/.test(h)), `(${hrefs.join(', ')})`);
  check('the links are the two bills just issued', hrefs.includes(`/bills/${a.id}`) && hrefs.includes(`/bills/${b.id}`), `(${hrefs.join(', ')})`);

  console.log('\n8. Touch targets inside the drill-down');
  const small = await page.evaluate(() => {
    const root = document.querySelector('details.disclosure[open]') ?? document;
    return [...root.querySelectorAll('a, button, summary')]
      .filter((e) => e.checkVisibility?.({ checkVisibilityCSS: true }))
      .filter((e) => e.getBoundingClientRect().height < 44)
      .map((e) => `${e.tagName}.${e.className}`.slice(0, 50));
  });
  check('drill-down touch targets are at least 44px', small.length === 0, `(${small.join(', ')})`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('drill-down does not overflow 360px', overflow <= 0, `(overflow ${overflow}px)`);

  console.log('\n9. Follow a link through to the bill');
  const target = hrefs[0];
  await openLinks.first().click();
  await page.waitForURL(`**${target}`, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await shot('05-bill-from-drilldown');
  const billText = await page.locator('main').innerText();
  const expected = target === `/bills/${a.id}` ? a.number : b.number;
  check('the link lands on the bill it named', billText.includes(expected), `(wanted ${expected}, got ${billText.slice(0, 120)})`);

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
