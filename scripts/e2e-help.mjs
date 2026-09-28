/**
 * "Mera bill thoda complex hai, help karo", end to end at 360px.
 *
 *   Terminal 1: npm run emulators
 *   Terminal 2: npm run dev
 *   Terminal 3: node scripts/e2e-help.mjs
 *
 * A GST-registered owner. One contract told in a sentence (5 lakh plus GST,
 * 30/40/30, 5% retention), billed instalment by instalment; one contract told
 * one question at a time (12 lakh, GST inside, running bills, 10% retention),
 * billed by work done. Checks the arithmetic the owner would otherwise do on
 * a calculator, and that nothing is billed twice.
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
const main = () => page.locator('main').innerText();

try {
  console.log('\n1. A GST-registered owner');
  await signInByPhone(page, BASE);
  await fillProfile(page, BASE, { name: 'Sharma Lifts', gstin: '27AAPFU0939F1ZV', city: 'Pune' });

  console.log('\n2. Mera bill thoda complex hai? Help karo');
  await page.getByRole('link', { name: 'Mera bill thoda complex hai? Help karo' }).click();
  await page.waitForURL('**/bills/help', { timeout: 15000 });
  check('the helper opens by asking whose work it is', /Kiska kaam hai\?/.test(await main()));
  await page.locator('#help-new-customer').fill('Green Park Society');
  await page.getByRole('button', { name: 'Aage' }).click();
  await page.waitForURL(/customer=/, { timeout: 15000 });
  await page.getByText('Deal kaise batana hai?').waitFor({ timeout: 15000 });

  console.log('\n3. The deal, told in one sentence');
  await page.getByRole('button', { name: 'Main likh deta hoon' }).click();
  await page.locator('#help-text').fill('Contract value 5 lakh plus GST 18%. 30% advance, 40% on delivery, 30% after installation. 5% retention.');
  await page.getByRole('button', { name: 'Samjho' }).click();
  await page.getByText('Maine yeh samjha').waitFor({ timeout: 20000 });
  await page.getByText('Is kaam ko kya bolte ho?').waitFor({ timeout: 5000 });
  check('it read the terms and asks only for the missing name', true);
  await page.locator('#help-name').fill('Lift renovation');
  await page.getByRole('button', { name: 'Aage' }).click();
  await page.getByText('Deal ka hisaab').last().waitFor({ timeout: 5000 });
  await shot('help-01-review');
  const review = await main();
  check('the deal: ₹5,00,000 + GST 18% on top', /Contract ₹5,00,000/.test(review) && /\+ GST 18% upar se/.test(review));
  check('the instalments: Advance 30 · Delivery 40 · Installation 30', /Advance 30% · Delivery 40% · Installation 30%/.test(review));
  check('5% retention', /5% retention aakhir tak/.test(review));
  await page.getByRole('button', { name: 'Deal save karo' }).click();
  await page.waitForURL(/project=/, { timeout: 15000 });
  await page.getByText('Kaunsi kist ka bill?').waitFor({ timeout: 15000 });

  console.log('\n4. The first instalment, worked out');
  await page.waitForTimeout(500);
  await shot('help-02-working');
  const working = await main();
  check('30% of ₹5,00,000 = ₹1,50,000', /Is bill: ₹5,00,000 ka 30% = ₹1,50,000/.test(working), working.slice(0, 400));
  check('+ GST 18% = ₹27,000, total about ₹1,77,000', /\+ GST 18% = ₹27,000/.test(working) && /Bill total lagbhag ₹1,77,000/.test(working));
  check('the retention: ₹1,68,150 now, ₹8,850 at the end', /customer abhi ₹1,68,150 dega, ₹8,850 aakhir mein/.test(working));
  check('left in the contract after this: ₹3,50,000', /Is bill ke baad contract mein baaki: ₹3,50,000/.test(working));
  await page.getByRole('button', { name: 'Bill taiyaar karo' }).click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}$/, { timeout: 20000 });
  await page.waitForTimeout(800);
  await shot('help-03-bill-form');
  const form = await main();
  check('the bill form carries the contract', /Contract: Lift renovation · Advance/.test(form));
  check('the line says what it is a share of', (await page.locator('input[id^="what-"]').first().inputValue()).includes('Advance (instalment 1 of 3: 30% of contract value ₹5,00,000)'));
  check('the bill total is ₹1,77,000', ((await page.locator('.bill-total').textContent()) ?? '').includes('₹1,77,000'));
  await page.getByRole('button', { name: 'Bill banao' }).click();
  await page.waitForURL(/\?done=1/, { timeout: 25000 });
  check('made, for ₹1,77,000', /₹1,77,000/.test(await main()));

  console.log('\n5. The next instalment knows the first');
  await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle' });
  await page.locator('.row-line', { hasText: 'Green Park Society' }).click();
  await page.waitForURL(/\/customers\/[0-9a-f-]{36}/, { timeout: 15000 });
  const customerText = await main();
  check('the customer page shows the contract, 1,50,000 of 5,00,000 billed', /Lift renovation/.test(customerText) && /₹5,00,000 mein se ₹1,50,000 ka bill bana/.test(customerText));
  await page.locator('.row-line', { hasText: 'Lift renovation' }).click();
  await page.getByText('Kaunsi kist ka bill?').waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const second = await main();
  check('Advance shows as billed, with its number', /Bill ho gaya · INV-001/.test(second));
  check('Delivery is next: 40% = ₹2,00,000, billed before ₹1,50,000', /₹5,00,000 ka 40% = ₹2,00,000/.test(second) && /Pehle ke bills: ₹1,50,000/.test(second));
  check('the Advance cannot be chosen again', await page.locator('input[name="help-ms"]').first().isDisabled());

  console.log('\n6. A running-bill contract, one question at a time');
  await page.goto(`${BASE}/bills/help`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Green Park Society' }).click();
  await page.getByRole('button', { name: 'Naya contract' }).click();
  await page.getByRole('button', { name: 'Ek ek karke poocho' }).click();
  await page.locator('#help-total').fill('12 lakh');
  check('the amount is read back as the owner types', /= ₹12,00,000/.test(await main()));
  await page.getByRole('button', { name: 'Aage' }).click();
  await page.getByRole('button', { name: 'Isi mein shaamil' }).click();
  await page.getByRole('button', { name: '18%' }).click();
  await page.getByRole('button', { name: /Jitna kaam, utna bill/ }).click();
  await page.getByRole('button', { name: '10%' }).click();
  await page.locator('#help-name').fill('Civil work');
  await page.getByRole('button', { name: 'Aage' }).click();
  const review2 = await main();
  check('review: GST 18% included, running bills, 10% retention', /GST 18% shaamil/.test(review2) && /Jitna kaam, utna bill/.test(review2) && /10% retention/.test(review2));
  await page.getByRole('button', { name: 'Deal save karo' }).click();
  await page.waitForURL(/project=/, { timeout: 15000 });
  await page.locator('#help-progress').waitFor({ timeout: 15000 });
  await page.locator('#help-progress').fill('40');
  await page.waitForTimeout(300);
  await shot('help-04-progress');
  const prog = await main();
  check('40% of 12 lakh = ₹4,80,000', /Kaam 40% = ₹4,80,000, pehle ka bill ₹0 ghata ke = ₹4,80,000/.test(prog), prog.slice(0, 400));
  check('GST taken out of it, not added', /GST andar hai: ₹4,06,779.66 \+ GST ₹73,220.34/.test(prog) && /Bill total lagbhag ₹4,80,000/.test(prog));
  await page.getByRole('button', { name: 'Bill taiyaar karo' }).click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}$/, { timeout: 20000 });
  await page.waitForTimeout(800);
  check('the bill comes to ₹4,80,000 with GST inside', ((await page.locator('.bill-total').textContent()) ?? '').includes('₹4,80,000'));
  await page.getByRole('button', { name: 'Bill banao' }).click();
  await page.waitForURL(/\?done=1/, { timeout: 25000 });

  console.log('\n7. Nothing billed twice');
  await page.goto(`${BASE}/bills/help`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Green Park Society' }).click();
  await page.getByRole('button', { name: /Civil work/ }).click();
  await page.locator('#help-progress').waitFor({ timeout: 15000 });
  check('it remembers 40% is billed', /Ab tak 40% ka bill ban chuka/.test(await main()));
  await page.locator('#help-progress').fill('30');
  await page.waitForTimeout(300);
  check('30% now is refused: already billed', /Naya kuch nahi: 40% ka bill pehle se bana hai/.test(await main()));
  await page.locator('#help-progress').fill('65');
  await page.waitForTimeout(300);
  check('65% bills only the 25% since: ₹3,00,000', /pehle ka bill ₹4,80,000 ghata ke = ₹3,00,000/.test(await main()));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal scrolling at 360px', overflow <= 0, `(overflow ${overflow}px)`);
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  console.error('\nCRASH', e);
  failures.push('crash');
  await shot('help-crash').catch(() => undefined);
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} failed: ${failures.join(', ')}` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
