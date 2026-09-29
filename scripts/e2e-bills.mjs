/**
 * The bill as it leaves the shop: logo, design, colour, paper, photo or PDF,
 * and GST -- on every bill, a rate per item, or none on this one.
 *
 *   npm run e2e:bills   (with the Auth emulator and the dev server running)
 *
 * Sets the look under Aap the way an owner would (a logo file, a design, a
 * colour, Photo for WhatsApp), checks the sample drawn before saving, makes
 * a bill with two GST rates and one with no GST, and downloads every size
 * in both formats -- then reads what was stored, so the totals and the
 * document titles are checked against the engine, not the screen.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';

import { signUp } from './e2e-auth.mjs';

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

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5440/ekbill_dev' });
await db.connect();
const invoice = async (id) => (await db.query('select data from invoices where id = $1', [id])).rows[0]?.data ?? null;

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

// A logo to upload: drawn here, saved as a PNG file like one from a phone.
const logoPage = await browser.newPage({ viewport: { width: 360, height: 120 } });
await logoPage.setContent(
  '<body style="margin:0;display:flex;align-items:center;gap:12px;padding:10px;font:800 34px Arial;color:#0f766e">' +
    '<div style="width:90px;height:90px;border-radius:50%;background:#0f766e;color:#fff;display:grid;place-items:center">SE</div>Sharma<br>Electricals</body>',
);
const logoFile = `${OUT}/bills-logo.png`;
writeFileSync(logoFile, await logoPage.screenshot({ omitBackground: true }));
await logoPage.close();

const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const shot = (n, full = true) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: full });

try {
  console.log('\n1. Aap: how the bill looks');
  await signUp(page, BASE, { name: 'Sharma Electricals', gstin: '27AAPFU0939F1ZV', upiId: 'sharma@upi', city: 'Pune' });
  await page.goto(`${BASE}/you`, { waitUntil: 'networkidle' });
  check('Bill kaisa dikhe is on Aap', await page.getByTestId('bill-look').isVisible());
  check('Classic, A4 and PDF are chosen to start with', (await page.getByRole('radio', { name: /Classic/ }).getAttribute('aria-checked')) === 'true' && (await page.getByRole('radio', { name: 'A4' }).getAttribute('aria-checked')) === 'true' && (await page.getByRole('radio', { name: 'PDF' }).getAttribute('aria-checked')) === 'true');
  await page.getByTestId('logo-file').setInputFiles(logoFile);
  await page.locator('.look__logo-box img').waitFor({ timeout: 10000 });
  check('the logo shows once picked', (await page.locator('.look__logo-box img').getAttribute('src'))?.startsWith('data:image/png;base64,'));
  await page.getByRole('radio', { name: /Modern/ }).click();
  await page.getByRole('radio', { name: '#0f766e' }).click();
  await page.getByRole('radio', { name: 'Photo' }).click();
  await page.getByTestId('look-sample').click();
  await page.getByTestId('look-sample-img').waitFor({ timeout: 30000 });
  const sampleWidth = await page.getByTestId('look-sample-img').evaluate((img) => img.naturalWidth);
  check('a sample bill is drawn from the unsaved choices', sampleWidth > 1000, `(width ${sampleWidth})`);
  await page.getByTestId('bill-look').screenshot({ path: `${OUT}/bills-01-look.png` });
  await page.getByRole('button', { name: 'Save karo' }).click();
  await page.getByText('Save ho gaya').waitFor({ timeout: 15000 });
  const saved = (await db.query("select data from businesses where data->>'legalName' = 'Sharma Electricals' order by created_at desc limit 1")).rows[0].data;
  check('the look is saved', saved.billDesign === 'modern' && saved.billShareAs === 'jpg' && saved.accentColour === '#0f766e' && saved.billPaper === 'a4');
  check('the logo is saved, small', typeof saved.logoDataUrl === 'string' && saved.logoDataUrl.length < 300_000);
  const businessId = (await db.query("select id from businesses where data->>'legalName' = 'Sharma Electricals' order by created_at desc limit 1")).rows[0].id;

  console.log('\n2. A bill with a GST rate per item');
  await page.goto(`${BASE}/bills/start`, { waitUntil: 'networkidle' });
  await page.locator('.picker .person--new').click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 15000 });
  check('asks "Is bill pe GST lagega?", Haan to start with', (await page.locator('#bill-gst-yes').getAttribute('aria-pressed')) === 'true');
  await page.locator('#bill-customer').fill('Mehta Traders');
  await page.locator('input[id^="what-"]').nth(0).fill('Ceiling fan');
  await page.locator('input[id^="qty-"]').nth(0).fill('2');
  await page.locator('input[id^="rate-"]').nth(0).fill('2400');
  await page.getByRole('button', { name: '+ Aur kuch' }).click();
  await page.locator('input[id^="what-"]').nth(1).fill('Wiring work');
  await page.locator('input[id^="rate-"]').nth(1).fill('1500');
  check('one rate for the whole bill until asked', (await page.locator('select[id^="gst-"]').count()) === 0);
  await page.getByTestId('bill-per-line').click();
  check('each item gets its own rate, starting from the bill rate', (await page.locator('select[id^="gst-"]').count()) === 2 && (await page.locator('select[id^="gst-"]').nth(1).inputValue()) === '1800');
  await page.locator('select[id^="gst-"]').nth(1).selectOption('1200');
  const form = await page.locator('main').innerText();
  check('the running total splits GST by rate', /GST \(12%\)\s*₹180\.00/.test(form) && /GST \(18%\)\s*₹864\.00/.test(form), form.slice(-400));
  check('and the bar shows the total', /₹7,344/.test(await page.getByTestId('make-bar').innerText()));
  await shot('bills-02-per-line');
  await page.getByTestId('make-bar').getByRole('button').click();
  await page.waitForURL(/done=1/, { timeout: 20000 });
  const billId = page.url().match(/bills\/([0-9a-f-]{36})/)[1];
  const taxed = await invoice(billId);
  check('stored with each item at its rate', taxed.lines.map((l) => l.taxRateBp).join(',') === '1800,1200');
  check('GST worked out by the engine: ₹1,044, total ₹7,344', taxed.totals.totalTaxPaise === 104400 && taxed.totals.grandTotalPaise === 734400, JSON.stringify(taxed.totals));
  check('a Tax Invoice', taxed.issued.documentTitle === 'Tax Invoice');
  check('WhatsApp sends a Photo, as chosen under Aap', (await page.getByRole('radio', { name: 'Photo' }).getAttribute('aria-checked')) === 'true');
  await shot('bills-03-done');

  console.log('\n3. Every size, as a PDF and as a photo');
  for (const paper of ['a4', 'a5', '80mm', '58mm']) {
    for (const format of ['pdf', 'jpg']) {
      const r = await page.request.get(`${BASE}/api/invoices/${billId}/pdf?b=${businessId}&paper=${paper}&format=${format}`);
      const body = await r.body();
      const good = format === 'pdf' ? body.subarray(0, 4).toString() === '%PDF' : body[0] === 0xff && body[1] === 0xd8;
      check(`${paper} ${format}`, r.ok() && good && body.length > 20_000, `(status ${r.status()}, ${body.length} bytes)`);
      writeFileSync(`${OUT}/bills-${paper}.${format}`, body);
      if (format === 'pdf') {
        const box = /\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/.exec(body.toString('latin1'));
        const widthMm = box ? Math.round((Number(box[1]) * 25.4) / 72) : 0;
        check(`${paper} PDF is ${paper === 'a4' ? 210 : paper === 'a5' ? 148 : parseInt(paper, 10)}mm wide`, widthMm === (paper === 'a4' ? 210 : paper === 'a5' ? 148 : parseInt(paper, 10)), `(${widthMm}mm)`);
      }
    }
  }
  await page.locator('[data-testid="other-formats"] > summary').click();
  check('other sizes are offered on the done screen', (await page.locator('[data-testid="other-formats"] a').count()) === 8);

  console.log('\n4. The same customer, no GST on this one');
  await page.goto(`${BASE}/bills/start`, { waitUntil: 'networkidle' });
  await page.locator('.picker .person', { hasText: 'Mehta Traders' }).click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 15000 });
  await page.locator('input[id^="what-"]').nth(0).fill('Old fan repair');
  await page.locator('input[id^="rate-"]').nth(0).fill('800');
  await page.locator('#bill-gst-no').click();
  check('says it will be a Bill of Supply', await page.getByText(/Bill of Supply/).isVisible());
  check('no GST in the total', /₹800/.test(await page.getByTestId('make-bar').innerText()));
  await shot('bills-04-no-gst');
  await page.getByTestId('make-bar').getByRole('button').click();
  await page.waitForURL(/done=1/, { timeout: 20000 });
  const plain = await invoice(page.url().match(/bills\/([0-9a-f-]{36})/)[1]);
  check('stored as a Bill of Supply with no tax', plain.issued.documentKind === 'bill-of-supply' && plain.issued.documentTitle === 'Bill of Supply' && plain.totals.totalTaxPaise === 0);
  check('numbered in the same series', plain.number === 'INV-002', plain.number);

  console.log('\n5. The next bill still starts with GST on');
  await page.goto(`${BASE}/bills/start`, { waitUntil: 'networkidle' });
  await page.locator('.picker .person', { hasText: 'Mehta Traders' }).click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 15000 });
  check('GST lagega: Haan', (await page.locator('#bill-gst-yes').getAttribute('aria-pressed')) === 'true');

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
