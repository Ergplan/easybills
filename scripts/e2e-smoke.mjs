/**
 * End-to-end smoke test against a running dev server and Firebase emulators.
 *
 *   Terminal 1: npm run emulators
 *   Terminal 2: npm run dev
 *   Terminal 3: node scripts/e2e-smoke.mjs
 *
 * It drives a real browser at 360px -- the width the product must work at -- and
 * walks the whole journey: sign in by phone, say who you are, quick bill,
 * issue, record a payment, download the PDF. It asserts the things that
 * would be embarrassing to get wrong, and fails loudly rather than logging.
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

const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

try {
  console.log('\n1. Sign up');
  await signInByPhone(page, BASE);
  await page.waitForURL('**/start', { timeout: 20000 });
  check('reaches business setup after sign up', true);

  console.log('\n2. Name the business');
  await fillProfile(page, BASE, { name: 'Kumar Electrical Repairs', city: 'Pune', stateCode: '27' });
  await page.waitForTimeout(600);
  await shot('01-home');
  check('Home asks the three questions', await page.getByText('Chalo, bill banate hain').isVisible()
    && await page.getByText('Bheje hue bills').isVisible() && await page.getByText('Kiske paise aane hain').isVisible());
  check('no GST number, so two tabs: Ghar and Aap', (await page.locator('.tabbar__item').count()) === 2);
  check('Home shows no chart', (await page.locator('canvas, svg.chart').count()) === 0);

  // The 44px floor applies on every screen, not only the editor.
  const homeSmall = await page.evaluate(() => {
    const eff = (e) => ((e.type === 'checkbox' || e.type === 'radio') && e.closest('label') ? e.closest('label') : e);
    return [...document.querySelectorAll('button, a, input, select, textarea')]
      .filter((e) => e.checkVisibility?.({ checkVisibilityCSS: true }) && !e.closest('.sr-only'))
      .map(eff)
      .filter((e) => e.getBoundingClientRect().height < 44)
      .map((e) => `${e.tagName}.${e.className}`.slice(0, 40));
  });
  check('Home touch targets are at least 44px', homeSmall.length === 0, `(${homeSmall.join(', ')})`);

  console.log('\n3. Quick bill at 360px');
  await page.goto(`${BASE}/bills/new`, { waitUntil: 'networkidle' });
  await page.getByText('Quick bill', { exact: true }).click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 20000 });
  await page.waitForTimeout(1000);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal scrolling at 360px', overflow <= 0, `(overflow ${overflow}px)`);

  const smallTargets = await page.evaluate(() => {
    const isHidden = (el) => {
      const s = getComputedStyle(el);
      return s.visibility === 'hidden' || s.display === 'none' || el.closest('.sr-only') !== null;
    };
    // A checkbox or radio inside a label is tapped via the LABEL, so the label
    // is the real target; measure that rather than the 24px box inside it.
    const effective = (el) => {
      if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) return el.closest('label');
      return el;
    };
    return [...document.querySelectorAll('button, a, input, select, textarea')]
      .filter((el) => !isHidden(el))
      .map(effective)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return r.height < 44;
      })
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 40));
  });
  check('all visible touch targets are at least 44px', smallTargets.length === 0, `(${smallTargets.join(', ')})`);

  console.log('\n4. Enter the worked example (2 visits at 800 + parts 450)');
  await page.locator('input[id^="desc-"]').first().fill('Repair visit');
  await page.locator('input[id^="qty-"]').first().fill('2');
  await page.locator('input[id^="price-"]').first().fill('800');
  await page.getByRole('button', { name: '+ Add another item' }).click();
  await page.waitForTimeout(300);
  await page.locator('input[id^="desc-"]').nth(1).fill('Spare parts');
  await page.locator('input[id^="qty-"]').nth(1).fill('1');
  await page.locator('input[id^="price-"]').nth(1).fill('450');
  await page.waitForTimeout(1200);
  await shot('02-editor');

  const total = (await page.locator('.sticky-total .amount').first().textContent())?.trim();
  check('sticky total is the expected 2,050 before tax', total === '₹2,050.00', `(saw ${total})`);

  // Wait for autosave to settle rather than assuming a fixed delay.
  await page.locator('.save-state').first().filter({ hasText: 'Saved' }).waitFor({ timeout: 15000 }).catch(() => {});
  const saveState = (await page.locator('.save-state').first().textContent())?.trim();
  check('autosave reports Saved once the server has it', saveState === 'Saved', `(saw "${saveState}")`);

  console.log('\n5. Review and issue');
  // GST status was settled on the first screen: no GST number given means not
  // registered, so nothing blocks issuing and there is no detour to settings.
  await page.getByRole('button', { name: 'Review' }).click();
  await page.waitForTimeout(2000);
  await shot('04-review-ok');
  const reviewText = await page.locator('main').innerText();
  check('review does not ask about GST status, the profile already answered', !/GST status/i.test(reviewText));
  const issueNow = page.getByRole('button', { name: /^Issue/ });
  check('issue button is enabled straight away', await issueNow.isEnabled());

  await issueNow.click();
  await page.waitForTimeout(3500);
  await shot('05-issued');
  const issuedText = await page.locator('main').innerText();
  check('issued bill shows a number', /INV-\d+/.test(issuedText), `(text: ${issuedText.slice(0, 80)})`);
  check('issued bill shows the total', issuedText.includes('2,050.00'));
  check('issued bill shows it is unpaid', /Unpaid/i.test(issuedText));

  console.log('\n7. Record a part payment');
  await page.getByRole('button', { name: 'Payment received' }).click();
  await page.waitForTimeout(500);
  await page.locator('#pay-amount').fill('1000');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.waitForTimeout(3000);
  await shot('06-part-paid');
  const paidText = await page.locator('main').innerText();
  check('bill now shows as part paid', /Part paid/i.test(paidText));
  check('remaining balance is 1,050', paidText.includes('1,050.00'), `(text: ${paidText.slice(0, 200)})`);

  console.log('\n8. PDF downloads');
  const pdfResponse = await page.request.get(`${BASE}${new URL(page.url()).pathname.replace('/bills/', '/api/invoices/')}/pdf?b=${await page.evaluate(() => document.cookie ? '' : '')}`).catch(() => null);
  // The PDF link in the page carries the right business id; use it directly.
  const pdfHref = await page.locator('a:has-text("View PDF")').getAttribute('href');
  const res = await page.request.get(`${BASE}${pdfHref}`);
  check('PDF endpoint returns a PDF', res.ok() && res.headers()['content-type']?.includes('pdf'), `(status ${res.status()})`);
  const bytes = await res.body();
  check('PDF has real content', bytes.length > 5000 && bytes.subarray(0, 4).toString() === '%PDF');

  console.log('\n9. Correct the bill with a credit note');
  await page.getByRole('button', { name: 'Raise a credit or debit note' }).click();
  await page.waitForTimeout(400);
  await page.locator('#adj-amount').fill('50');
  await page.locator('#adj-reason').fill('One item was billed twice');
  await page.getByRole('button', { name: /Raise credit note/ }).click();
  await page.waitForTimeout(3000);
  await shot('08-credit-note');
  const correctedText = await page.locator('main').innerText();
  check('credit note is listed with its own number', /CN-001/.test(correctedText));
  check('credit note is recorded as balance-only by default', /GST unchanged/i.test(correctedText));
  check('balance drops by the credit note', correctedText.includes('1,000.00'), '(expected 1,050 - 50)');

  console.log('\n10. Turn on monthly repeat');
  // A quick bill has no saved customer, so the monthly option must say so
  // rather than silently failing.
  await page.getByRole('button', { name: 'Repeat every month' }).click();
  await page.waitForTimeout(500);
  await shot('09-repeat');
  const repeatText = await page.locator('main').innerText();
  check('monthly setup states that a draft is prepared for review', /prepare a draft for you to review/i.test(repeatText));
  check('monthly setup explains a saved customer is needed for a walk-in bill', /needs a saved customer/i.test(repeatText));
  const turnOn = page.getByRole('button', { name: 'Turn on monthly bills' });
  check('monthly cannot be turned on without a customer', await turnOn.isDisabled());

  console.log('\n11. Bills list and search');
  await page.goto(`${BASE}/bills`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot('07-bills');
  check('bills list shows the issued bill', (await page.locator('.list__item').count()) >= 1);

  console.log('\n12. No uncaught page errors');
  check('no uncaught client errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
