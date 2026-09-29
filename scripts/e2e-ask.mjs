/**
 * "Poocho" at 360px: ask about a bill you made, in Hinglish, and get the bill.
 *
 *   Terminal 1: npm run emulators    Terminal 2: npm run dev
 *   Terminal 3: node scripts/e2e-ask.mjs
 *
 * Runs without an OpenAI key, so it checks the path every installation has:
 * the matching records, linked. With a key the same screen writes an answer
 * above them (covered by tests/integration/search.test.ts).
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
page.on('pageerror', (e) => pageErrors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });

try {
  console.log('\n1. An owner makes one bill');
  await signInByPhone(page, BASE);
  await fillProfile(page, BASE, { name: 'Kumar Repairs', city: 'Nagpur' });
  await page.goto(`${BASE}/bills/new`, { waitUntil: 'networkidle' });
  await page.locator('#bill-customer').fill('Kapoor Dairy');
  await page.locator('input[id^="what-"]').first().fill('AMC visit');
  await page.locator('input[id^="rate-"]').first().fill('3500');
  await page.getByRole('button', { name: 'Bill banao' }).click();
  await page.getByText('Bill ban gaya!').waitFor({ timeout: 25000 });

  console.log('\n2. Poocho, from Home');
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Apne bills se kuch poocho' }).click();
  await page.waitForURL('**/ask', { timeout: 15000 });
  check('the screen says what it can answer from', /Apne bills, contracts aur upload kiye purane bills/.test(await page.locator('main').innerText()));
  check('it offers questions to try', await page.getByRole('button', { name: 'Sharma ko pichli baar kya rate diya?' }).isVisible());

  console.log('\n3. Kapoor ko AMC ka kya rate diya tha?');
  await page.locator('#ask-q').fill('Kapoor ko AMC ka kya rate diya tha?');
  await page.getByRole('button', { name: 'Poocho', exact: true }).click();
  await page.getByTestId('ask-result').waitFor({ timeout: 30000 });
  await page.waitForTimeout(300);
  await shot('ask-01-result');
  const result = await page.getByTestId('ask-result').innerText();
  check('without a key it says why there is no written answer', /OpenAI key chahiye/.test(result), result.slice(0, 200));
  check('and shows the bill it found', /Bill INV-001 · Kapoor Dairy/.test(result));
  check('with the rate in it', /AMC visit: 1 x ₹3,500/.test(result));
  await page.getByRole('link', { name: /Bill INV-001 · Kapoor Dairy/ }).click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}$/, { timeout: 15000 });
  check('the record opens the bill', /Kapoor Dairy/.test(await page.locator('main').innerText()));

  console.log('\n4. Something that is not there');
  await page.goto(`${BASE}/ask?q=${encodeURIComponent('Zebra crossing ka bill')}`, { waitUntil: 'networkidle' });
  await page.getByTestId('ask-result').waitFor({ timeout: 30000 });
  check('it says nothing matched, rather than inventing', /isse milta kuch nahi mila/.test(await page.getByTestId('ask-result').innerText()));
  check('no uploads yet, and it says where to add them', /Customers wale page se purane bills upload karo/.test(await page.locator('main').innerText()));

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  console.error('\nCRASH', e);
  failures.push('crash');
  await shot('ask-crash').catch(() => undefined);
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} failed: ${failures.join(', ')}` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
