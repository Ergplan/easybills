/**
 * The front door, end to end: phone, OTP, "Apne baare mein batayen", Home.
 *
 *   Terminal 1: npm run emulators
 *   Terminal 2: npm run dev
 *   Terminal 3: node scripts/e2e-signin.mjs
 *
 * Walks the real screens at 360px with a real OTP read from the Auth
 * emulator, and checks the things that would embarrass us: a wrong OTP says
 * so in Hinglish and lets the owner retry, a bad GST number is caught before
 * anything is saved, a GST number decides the state, and signing in again
 * with the same number goes straight to Home, not back through setup.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

import { fillProfile, freshPhone, signInByPhone } from './e2e-auth.mjs';

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

/**
 * Read what the app wrote, through the Firestore emulator's REST surface. The
 * rules deny every client read, so this presents the emulator's owner token,
 * which the emulator treats the way it treats the Admin SDK.
 */
async function findBusiness(legalName) {
  const res = await fetch('http://127.0.0.1:8080/v1/projects/easybills-dev/databases/(default)/documents:runQuery', {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'businesses' }],
        where: { fieldFilter: { field: { fieldPath: 'legalName' }, op: 'EQUAL', value: { stringValue: legalName } } },
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
        limit: 1,
      },
    }),
  });
  const rows = await res.json();
  return rows.find((r) => r.document)?.document?.fields ?? null;
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });

try {
  console.log('\n1. The phone screen');
  await page.goto(`${BASE}/signin`, { waitUntil: 'networkidle' });
  await shot('signin-01-phone');
  check('asks for the phone number in Hinglish', await page.getByText('Apna phone number daalo').isVisible());
  check('has no password field anywhere', (await page.locator('input[type=password]').count()) === 0);
  check('the +91 is fixed, not typed', await page.locator('.tel__prefix').isVisible());
  check('send is disabled until ten digits are in', await page.getByRole('button', { name: 'OTP bhejo' }).isDisabled());
  await page.locator('#phone').fill('12345');
  check('still disabled for a number that is not a mobile', await page.getByRole('button', { name: 'OTP bhejo' }).isDisabled());

  console.log('\n2. A wrong OTP, then the right one');
  const digits = freshPhone();
  await page.locator('#phone').fill(digits);
  await page.getByRole('button', { name: 'OTP bhejo' }).click();
  await page.locator('#otp').waitFor({ timeout: 20000 });
  await shot('signin-02-otp');
  check('says where the OTP went', await page.getByText(`+91 ${digits.slice(0, 5)} ${digits.slice(5)} pe bheja hai`).isVisible());
  await page.locator('#otp').fill('000000');
  await page.getByText('OTP galat hai').waitFor({ timeout: 15000 });
  await shot('signin-03-wrong-otp');
  check('a wrong OTP says so, in Hinglish', true);
  check('and clears the box for another go', (await page.locator('#otp').inputValue()) === '');

  await page.goto(`${BASE}/signin`, { waitUntil: 'networkidle' });
  const who = await signInByPhone(page, BASE, digits);
  await page.waitForURL('**/start', { timeout: 20000 });
  check('a new number lands on "Apne baare mein batayen"', true);

  console.log('\n3. Apne baare mein batayen');
  await shot('start-01-empty');
  check('the phone is shown, not asked again', (await page.locator('#you-phone').inputValue()) === `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`);
  check('the phone cannot be edited', await page.locator('#you-phone').evaluate((el) => el.readOnly));

  await page.locator('#you-name').fill('Sharma Electricals');
  await page.locator('#you-gstin').fill('NOTAGST');
  await page.getByRole('button', { name: 'Chalo, shuru karte hain' }).click();
  await page.getByText('GST number theek nahi lag raha').waitFor({ timeout: 5000 });
  await shot('start-02-bad-gstin');
  check('a bad GST number is caught on the phone, before saving', page.url().includes('/start'));

  await page.locator('#you-gstin').fill('27AAPFU0939F1ZV');
  await page.locator('#you-stateCode').selectOption('29');
  await page.getByRole('button', { name: 'Chalo, shuru karte hain' }).click();
  await page.locator('.field__error').waitFor({ timeout: 5000 });
  const mismatch = await page.locator('.field__error').textContent();
  check('a state that disagrees with the GST number is refused', /Maharashtra.*Karnataka chuna/.test(mismatch ?? ''), mismatch ?? '');

  await page.locator('#you-stateCode').selectOption('');
  await page.locator('#you-upiId').fill('sharma@upi');
  await page.locator('#you-city').fill('Pune');
  await shot('start-03-filled');
  await page.getByRole('button', { name: 'Chalo, shuru karte hain' }).click();
  await page.waitForURL('**/home', { timeout: 25000 });
  check('lands on Home', true);

  console.log('\n4. What was saved');
  const health = await (await page.request.get(`${BASE}/api/health`)).json();
  check('the server is talking to the emulator', health.usingEmulators === true, JSON.stringify(health));
  const mine = await findBusiness('Sharma Electricals');
  check('business exists with the name given', Boolean(mine));
  check('registered under GST, because a GSTIN was given', mine?.registrationType?.stringValue === 'regular');
  check('state came from the GST number', mine?.stateCode?.stringValue === '27');
  check('phone stored in +91 form', mine?.phone?.stringValue === who.phone);
  check('UPI stored with the bank details', mine?.bank?.mapValue?.fields?.upiId?.stringValue === 'sharma@upi');
  check('city kept', mine?.city?.stringValue === 'Pune');

  console.log('\n5. Sign out, sign in again');
  await page.request.delete(`${BASE}/api/auth/session`);
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  check('signed out, the app asks for the phone again', page.url().includes('/signin'));
  await signInByPhone(page, BASE, digits);
  await page.waitForURL('**/home', { timeout: 20000 });
  check('the same number goes straight to Home', true);

  console.log('\n6. A number-only sign-in with no GST number');
  await page.request.delete(`${BASE}/api/auth/session`);
  await signInByPhone(page, BASE);
  await fillProfile(page, BASE, { name: 'Ramesh Patil' });
  const ramesh = await findBusiness('Ramesh Patil');
  check('no GST number means not registered, and no guessing', ramesh?.registrationType?.stringValue === 'not-registered');

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
