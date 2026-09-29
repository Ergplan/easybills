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
import pg from 'pg';

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
 * Read what the app wrote, straight from Postgres -- the same database the dev
 * server is pointed at (DATABASE_URL, default the local dev database).
 */
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5440/ekbill_dev' });
await db.connect();
async function findBusiness(legalName) {
  const { rows } = await db.query(
    "select data from businesses where data->>'legalName' = $1 order by created_at desc limit 1",
    [legalName],
  );
  return rows[0]?.data ?? null;
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
  check('a new number is greeted as a first meeting', /Hum pehli baar mil rahe hain, to apne baare mein thoda bataiye please/.test(await page.locator('main').innerText()));

  console.log('\n3. Apne baare mein batayen: one question at a time');
  const aage = () => page.locator('.wizard__card').getByRole('button', { name: 'Aage', exact: true }).click();
  await page.locator('#you-name').waitFor({ timeout: 15000 });
  await shot('start-01-name');
  check('the phone is not asked again: sign-in gave it', (await page.locator('#you-phone').count()) === 0);
  const dots = await page.locator('.wizard__dot').count();
  check('progress dots show how many questions', dots >= 5, `(saw ${dots})`);
  await aage();
  await page.locator('.field__error').waitFor({ timeout: 5000 });
  check('an empty name is caught on its own screen', await page.locator('#you-name').isVisible());
  await page.locator('#you-name').fill('Sharma Electricals');
  await aage();

  await page.getByRole('button', { name: 'Haan, hai' }).waitFor({ timeout: 5000 });
  await shot('start-02-has-gst');
  check('asks "GST number hai?" as a yes/no', await page.getByRole('button', { name: 'Nahi', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Haan, hai' }).click();
  await page.locator('#you-gstin').fill('NOTAGST');
  await aage();
  await page.getByText('GST number theek nahi lag raha').waitFor({ timeout: 5000 });
  await shot('start-03-bad-gstin');
  check('a bad GST number is caught before going on', await page.locator('#you-gstin').isVisible());
  await page.locator('#you-gstin').fill('27AAPFU0939F1ZV');
  check('a GST number brings the e-invoice question', await page.getByText(/sarkari e-invoice \(IRN\)/).isVisible());
  await page.getByRole('button', { name: 'Nahi, mujhe nahi' }).click();
  await aage();

  await page.locator('#you-upiId').fill('sharma@upi');
  await aage();

  await page.locator('#you-city').waitFor({ timeout: 5000 });
  check('the state is already filled from the GST number', (await page.locator('#you-stateCode').inputValue()) === '27');
  await page.locator('#you-city').fill('Pune');
  await page.locator('#you-stateCode').selectOption('29');
  await aage();
  await page.locator('.field__error').waitFor({ timeout: 5000 });
  const mismatch = await page.locator('.field__error').textContent();
  check('a state that disagrees with the GST number is refused', /Maharashtra.*Karnataka chuna/.test(mismatch ?? ''), mismatch ?? '');
  await page.locator('#you-stateCode').selectOption('27');
  await aage();

  await page.getByRole('button', { name: 'Chalo, shuru karte hain' }).waitFor({ timeout: 5000 });
  await shot('start-04-review');
  const review = await page.locator('.wizard__review').innerText();
  check('the last screen shows every answer', ['Sharma Electricals', '27AAPFU0939F1ZV', 'sharma@upi', 'Pune'].every((v) => review.includes(v)), review);
  await page.locator('.wizard__row', { hasText: 'sharma@upi' }).getByRole('button', { name: 'Badlo' }).click();
  await page.locator('#you-upiId').fill('sharma.electricals@upi');
  await aage();
  await page.getByRole('button', { name: 'Chalo, shuru karte hain' }).waitFor({ timeout: 5000 });
  check('Badlo changes one answer and comes straight back', (await page.locator('.wizard__review').innerText()).includes('sharma.electricals@upi'));
  await page.getByRole('button', { name: 'Chalo, shuru karte hain' }).click();
  await page.waitForURL('**/home', { timeout: 25000 });
  check('lands on Home', true);

  console.log('\n4. What was saved');
  const health = await (await page.request.get(`${BASE}/api/health`)).json();
  check('sign-in is talking to the Auth emulator', health.authEmulator === true, JSON.stringify(health));
  const mine = await findBusiness('Sharma Electricals');
  check('business exists with the name given', Boolean(mine));
  check('registered under GST, because a GSTIN was given', mine?.registrationType === 'regular');
  check('state came from the GST number', mine?.stateCode === '27');
  check('phone stored in +91 form', mine?.phone === who.phone);
  check('UPI stored with the bank details', mine?.bank?.upiId === 'sharma.electricals@upi');
  check('city kept', mine?.city === 'Pune');

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
  check('no GST number means not registered, and no guessing', ramesh?.registrationType === 'not-registered');

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  console.error('\nCRASH', e);
  failures.push('crash');
  await shot('crash').catch(() => undefined);
} finally {
  await browser.close();
  await db.end();
}

console.log(failures.length ? `\n${failures.length} failed: ${failures.join(', ')}` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
