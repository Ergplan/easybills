/**
 * Sign in by phone against the Auth emulator, the way an owner does.
 *
 * The emulator sends no SMS. It prints the code and exposes it at
 * /emulator/v1/projects/<project>/verificationCodes, which is where this reads
 * it from -- so the test walks the real screens with a real OTP.
 */
const AUTH_EMULATOR = process.env.E2E_AUTH_EMULATOR ?? 'http://127.0.0.1:9099';
const PROJECT = process.env.E2E_FIREBASE_PROJECT ?? 'easybills-dev';

/** A fresh, valid-looking Indian mobile number for this run. */
export function freshPhone() {
  return `9${String(Date.now()).slice(-9)}`;
}

async function latestCodeFor(phoneE164) {
  const res = await fetch(`${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT}/verificationCodes`);
  if (!res.ok) throw new Error(`Auth emulator did not list verification codes: ${res.status}`);
  const { verificationCodes = [] } = await res.json();
  const mine = verificationCodes.filter((c) => c.phoneNumber === phoneE164);
  return mine.at(-1)?.code ?? null;
}

/**
 * Drive /signin: type the number, read the OTP from the emulator, type it.
 * Resolves once the app has moved on from the sign-in page.
 */
export async function signInByPhone(page, base, digits = freshPhone()) {
  await page.goto(`${base}/signin`, { waitUntil: 'networkidle' });
  await page.locator('#phone').fill(digits);
  await page.getByRole('button', { name: 'OTP bhejo' }).click();
  await page.locator('#otp').waitFor({ timeout: 20000 });

  let code = null;
  for (let i = 0; i < 40 && !code; i++) {
    code = await latestCodeFor(`+91${digits}`);
    if (!code) await page.waitForTimeout(250);
  }
  if (!code) throw new Error('No OTP appeared in the Auth emulator');

  await page.locator('#otp').fill(code);
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 20000 });
  return { phone: `+91${digits}`, digits };
}

/** Fill "Apne baare mein batayen" and land on Home. */
export async function fillProfile(page, base, profile) {
  await page.waitForURL('**/start', { timeout: 20000 });
  await page.locator('#you-name').fill(profile.name);
  if (profile.gstin) await page.locator('#you-gstin').fill(profile.gstin);
  if (profile.upiId) await page.locator('#you-upiId').fill(profile.upiId);
  if (profile.city) await page.locator('#you-city').fill(profile.city);
  if (profile.stateCode) await page.locator('#you-stateCode').selectOption(profile.stateCode);
  await page.getByRole('button', { name: 'Chalo, shuru karte hain' }).click();
  await page.waitForURL('**/home', { timeout: 20000 });
}

/** Sign in and set up a business in one go: what every journey starts with. */
export async function signUp(page, base, profile) {
  const who = await signInByPhone(page, base);
  await fillProfile(page, base, profile);
  return who;
}
