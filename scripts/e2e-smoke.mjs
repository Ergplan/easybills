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

  console.log('\n3. A bill from the Naya customer chip, at 360px');
  await page.getByRole('button', { name: 'Naya customer' }).click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 20000 });
  await page.waitForTimeout(800);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal scrolling at 360px', overflow <= 0, `(overflow ${overflow}px)`);

  const smallTargets = await page.evaluate(() => {
    const isHidden = (el) => {
      const s = getComputedStyle(el);
      return s.visibility === 'hidden' || s.display === 'none' || el.closest('.sr-only') !== null;
    };
    return [...document.querySelectorAll('button, a, input, select, textarea')]
      .filter((el) => !isHidden(el))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return r.height < 44;
      })
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 40));
  });
  check('all visible touch targets are at least 44px', smallTargets.length === 0, `(${smallTargets.join(', ')})`);

  console.log('\n4. The worked example: 2 visits at 800 + parts 450');
  const billText = await page.locator('main').innerText();
  check('the bill asks the three questions, in Hinglish', /Kya kiya\?/.test(billText) && /Kitna/.test(billText) && /Rate \(₹\)/.test(billText));
  check('a non-GST owner is not asked for a GST rate', !/GST rate/.test(billText));
  await page.locator('#bill-customer').fill('Ramesh Patil');
  await page.locator('input[id^="what-"]').first().fill('Repair visit');
  await page.locator('input[id^="qty-"]').first().fill('2');
  await page.locator('input[id^="rate-"]').first().fill('800');
  await page.getByRole('button', { name: '+ Aur kuch' }).click();
  await page.locator('input[id^="what-"]').nth(1).fill('Spare parts');
  await page.locator('input[id^="rate-"]').nth(1).fill('450');
  await page.waitForTimeout(300);
  await shot('02-bill');
  const total = (await page.locator('.bill-total').textContent())?.trim();
  check('the total updates as you type: 2,050', total === '₹2,050', `(saw ${total})`);

  console.log('\n5. Bill banao');
  await page.getByRole('button', { name: 'Bill banao' }).click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}\?done=1/, { timeout: 25000 });
  await page.getByText('Bill ban gaya!').waitFor({ timeout: 25000 });
  await page.waitForTimeout(400);
  await shot('05-done');
  const doneText = await page.locator('main').innerText();
  check('the bill has a number', /INV-\d+/.test(doneText), `(text: ${doneText.slice(0, 80)})`);
  check('and the total', doneText.includes('₹2,050'));
  check('WhatsApp is the next thing', await page.getByRole('button', { name: 'WhatsApp pe bhejo' }).isVisible());
  check('the message greets the customer with ji and gives the amount', /Namaste Ramesh ji/.test(doneText) && /₹2,050/.test(doneText));

  console.log('\n6. The new customer is now a chip, and the bill is on Home');
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const homeText = await page.locator('main').innerText();
  check('Ramesh Patil is a chip', await page.locator('.chip', { hasText: 'Ramesh Patil' }).isVisible());
  check('the bill is under Bheje hue bills', /1 bill is mahine/.test(homeText));
  check('and under Kiske paise aane hain', /₹2,050/.test(homeText) && /Yaad dilao/.test(homeText));
  await page.locator('section[aria-labelledby=sent-heading] .row-line').first().click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 20000 });
  await page.waitForTimeout(800);
  await shot('05-issued');
  const issuedText = await page.locator('main').innerText();
  check('the issued bill shows its number', /INV-\d+/.test(issuedText));
  check('and says Bheja, with the total', /Bheja/.test(issuedText) && /₹2,050/.test(issuedText));

  console.log('\n7. Likh lo: part of it came');
  await page.getByRole('button', { name: 'Paise aa gaye' }).click();
  await page.getByText('Kitne aaye?').waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Kuch hissa' }).click();
  await page.locator('#paid-amount').fill('1000');
  await page.getByRole('button', { name: 'Likh lo' }).click();
  await page.getByText('Likh liya').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await shot('06-part-paid');
  const paidText = await page.locator('main').innerText();
  check('the bill now says Thoda aaya', /Thoda aaya/.test(paidText));
  check('and ₹1,050 abhi baaki', /₹1,050 abhi baaki/.test(paidText), `(text: ${paidText.slice(0, 200)})`);
  check('the payment is listed', /Aaye hue paise/.test(paidText) && /₹1,000/.test(paidText));

  console.log('\n8. More than what is left is refused, in Hinglish');
  await page.getByRole('button', { name: 'Paise aa gaye' }).click();
  await page.getByRole('button', { name: 'Kuch hissa' }).click();
  await page.locator('#paid-amount').fill('5000');
  await page.getByRole('button', { name: 'Likh lo' }).click();
  await page.getByText('Bill se zyada?').waitFor({ timeout: 10000 });
  check('says only ₹1,050 is left', await page.getByText(/Sirf ₹1,050 baaki hai/).isVisible());
  await page.getByRole('button', { name: 'Rehne do' }).click();

  console.log('\n9. PDF downloads');
  const pdfHref = await page.locator('a:has-text("PDF download karo")').getAttribute('href');
  const res = await page.request.get(`${BASE}${pdfHref}`);
  check('PDF endpoint returns a PDF', res.ok() && res.headers()['content-type']?.includes('pdf'), `(status ${res.status()})`);
  const bytes = await res.body();
  check('PDF has real content', bytes.length > 5000 && bytes.subarray(0, 4).toString() === '%PDF');

  console.log('\n10. Yaad dilao');
  await page.getByRole('link', { name: 'Yaad dilao' }).click();
  await page.waitForURL(/\/remind$/, { timeout: 15000 });
  await page.waitForTimeout(600);
  await shot('08-remind');
  const remindText = await page.locator('main').innerText();
  check('the reminder is addressed to Ramesh ji', /Ramesh Patil ko yaad dilayein/.test(remindText));
  const draft = await page.locator('#remind-text').inputValue();
  check('gentle by default, with the amount still due and the UPI line left out (no UPI id)', /^Namaste Ramesh ji 🙏/.test(draft) && /₹1,050/.test(draft) && !/UPI/.test(draft));
  await page.getByRole('button', { name: 'Seedha' }).click();
  const direct = await page.locator('#remind-text').inputValue();
  check('Seedha asks for it today', /aaj bhej dein/.test(direct));
  check('WhatsApp kholo is the button', await page.getByRole('button', { name: 'WhatsApp kholo' }).isVisible());

  console.log('\n11. Bheje hue bills');
  await page.goto(`${BASE}/bills`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot('07-bills');
  check('the bills page lists the bill', (await page.locator('.row-line').count()) >= 1);

  console.log('\n12. No uncaught page errors');
  check('no uncaught client errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
