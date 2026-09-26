/**
 * State transitions and double taps, against a running dev server and the
 * emulators.
 *
 *   Terminal 1: npm run emulators
 *   Terminal 2: npm run dev
 *   Terminal 3: node scripts/e2e-concurrency.mjs
 *
 * The repository tests already prove the transactions are safe. What they
 * cannot show is whether a real browser ever puts the owner in the dangerous
 * state: a second tab left open on a bill that has since been issued, the back
 * button after issuing, a slow screen tapped twice. This drives those.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

import { signUp } from './e2e-auth.mjs';

const OUT = process.env.E2E_OUT ?? './e2e-output/concurrency';
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label} ${detail}`); failures.push(label); }
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const pageErrors = [];
const onError = (e) => pageErrors.push(String(e));
page.on('pageerror', onError);
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });

/** A saved draft with one priced line, left un-issued. */
async function newDraft(p, desc, price) {
  await p.goto(`${BASE}/bills/new`, { waitUntil: 'networkidle' });
  await p.getByText('Quick bill', { exact: true }).click();
  await p.waitForURL(/\/bills\/[0-9a-f-]{36}/, { timeout: 25000 });
  await p.waitForTimeout(900);
  await p.locator('input[id^="desc-"]').first().fill(desc);
  await p.locator('input[id^="qty-"]').first().fill('1');
  await p.locator('input[id^="price-"]').first().fill(String(price));
  await p.waitForTimeout(1500);
  await p.locator('.save-state').first().filter({ hasText: 'Saved' }).waitFor({ timeout: 20000 }).catch(() => {});
  return p.url();
}

async function issueFrom(p) {
  await p.getByRole('button', { name: 'Review' }).click();
  await p.waitForTimeout(2000);
  await p.getByRole('button', { name: /^Issue/ }).click();
  await p.waitForTimeout(3500);
}

try {
  console.log('\n1. An unregistered business, so nothing else blocks issuing');
  await signUp(page, BASE, { name: 'Patil Hardware' });
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.getByText('Not registered for GST', { exact: true }).click();
  await page.getByRole('button', { name: /Save GST status/ }).click();
  await page.waitForTimeout(2000);

  console.log('\n2. The back button after issuing');
  const billUrl = await newDraft(page, 'Ceiling fan', 2400);
  await issueFrom(page);
  const issuedText = await page.locator('main').innerText();
  check('the bill is issued', /INV-\d+/.test(issuedText), `(text: ${issuedText.slice(0, 120)})`);

  await page.goBack();
  await page.waitForTimeout(2500);
  await shot(page, '01-after-back');
  const backText = await page.locator('main').innerText();
  // Back must not restore an editor that would let the bill be issued again.
  check(
    'going back shows the issued bill, not an editable draft',
    /INV-\d+/.test(backText) && !/Add another item/i.test(backText),
    `(text: ${backText.slice(0, 200)})`,
  );
  check('there is no second Issue button to press', (await page.getByRole('button', { name: /^Issue/ }).count()) === 0);

  console.log('\n3. A second tab left open on a bill issued elsewhere');
  const draftUrl = await newDraft(page, 'Wall socket', 180);
  const stale = await context.newPage();
  stale.on('pageerror', onError);
  await stale.goto(draftUrl, { waitUntil: 'networkidle' });
  await stale.waitForTimeout(1500);
  check('the second tab opened the same draft', (await stale.locator('input[id^="desc-"]').count()) > 0);

  // Issue it in the first tab. The second tab still shows an editor.
  await issueFrom(page);
  const number = (await page.locator('main').innerText()).match(/INV-\d+/)?.[0] ?? null;
  check('the first tab issued it', number !== null);

  // The stale tab types. Its autosave must be refused, and say so.
  await stale.locator('input[id^="price-"]').first().fill('9999');
  await stale.waitForTimeout(4000);
  await shot(stale, '02-stale-tab');
  const saveState = (await stale.locator('.save-state').first().textContent())?.trim() ?? '';
  check(
    'the stale tab says its edit was not saved',
    /cannot be edited|changed somewhere else|issued/i.test(saveState),
    `(save state: "${saveState}")`,
  );

  // And issuing from the stale tab must not produce a second bill.
  await stale.getByRole('button', { name: 'Review' }).click();
  await stale.waitForTimeout(2500);
  const staleIssue = stale.getByRole('button', { name: /^Issue/ });
  if (await staleIssue.count()) {
    await staleIssue.click();
    await stale.waitForTimeout(3500);
  }
  await shot(stale, '03-stale-issue');
  const staleText = await stale.locator('main').innerText();
  check(
    'the stale tab lands on the bill that was already issued, with its number',
    staleText.includes(number),
    `(text: ${staleText.slice(0, 200)})`,
  );

  await page.goto(`${BASE}/bills`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const numbersOnList = await page.locator('.list__item').allInnerTexts();
  const issuedCount = numbersOnList.filter((t) => /INV-\d+/.test(t)).length;
  check('only two bills were ever issued', issuedCount === 2, `(saw ${issuedCount}: ${numbersOnList.join(' / ').slice(0, 200)})`);
  await stale.close();

  console.log('\n4. The same submission arriving twice: payment');

  // A disabled button stops a second tap, and the app does disable it -- but a
  // dropped response, a retried request or a resubmitted form still puts two
  // identical writes on the wire. Replay the request the page sends, so the
  // server sees exactly that, and see what the ledger says afterwards.
  // Everything up to here is the app behaving normally, so it must be clean.
  check('no uncaught client errors in normal use', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  const errorsBeforeReplay = pageErrors.length;

  let duplicateNext = false;
  let duplicates = 0;
  await context.route('**/*', async (route) => {
    const req = route.request();
    const isAction = req.method() === 'POST' && Boolean(req.headers()['next-action']);
    if (duplicateNext && isAction) {
      duplicateNext = false;
      duplicates += 1;
      // Let the page's own request go first, then put an identical one behind
      // it. Awaiting the replay here would hold the page's response stream
      // open, so it is deliberately not awaited -- what the assertions read is
      // the ledger after a reload, not whatever the live page managed to show.
      await route.continue();
      void context.request.fetch(req, { maxRedirects: 0 }).catch(() => {});
      return;
    }
    await route.continue();
  });

  await page.goto(draftUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Payment received' }).click();
  await page.waitForTimeout(600);
  await page.locator('#pay-amount').fill('50');
  duplicateNext = true;
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.waitForTimeout(6000);
  // Read the ledger, not the live page: the replay disturbs the page's own
  // response stream, and what matters is how much money the bill says it took.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, '04-after-double-pay');
  check('the payment request really was sent twice', duplicates === 1, `(duplicated ${duplicates})`);
  const paidText = await page.locator('main').innerText();
  check('one payment of 50 was taken, not two', /130\.00/.test(paidText), `(text: ${paidText.replace(/\n+/g, ' | ').slice(0, 700)})`);

  console.log('\n5. The same submission arriving twice: credit note');
  await page.getByRole('button', { name: 'Raise a credit or debit note' }).click();
  await page.waitForTimeout(500);
  await page.locator('#adj-amount').fill('30');
  await page.locator('#adj-reason').fill('Returned one socket');
  duplicateNext = true;
  await page.getByRole('button', { name: /Raise credit note/ }).click();
  await page.waitForTimeout(6000);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, '05-after-double-note');
  check('the credit note request really was sent twice', duplicates === 2, `(duplicated ${duplicates})`);
  const notedText = await page.locator('main').innerText();
  const noteCount = (notedText.match(/CN-\d+/g) ?? []).length;
  check('one credit note was raised, not two', noteCount === 1, `(saw ${noteCount}: ${notedText.slice(0, 300)})`);
  check('the balance dropped by the note once', /100\.00/.test(notedText), `(text: ${notedText.slice(0, 300)})`);

  console.log('\n6. No uncaught page errors beyond the ones the replay causes');
  // Replaying a request corrupts the React flight stream the page was reading,
  // so its decoder throws. That is this harness, not the app -- but anything
  // else appearing here is not, so it is named rather than waved through.
  const KNOWN_REPLAY_NOISE = /enqueueModel|writable stream|Connection closed|Failed to fetch/i;
  const unexpected = pageErrors.slice(errorsBeforeReplay).filter((e) => !KNOWN_REPLAY_NOISE.test(e));
  check('the replay caused nothing but flight-stream noise', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
} catch (e) {
  console.log('  ERROR', e.message);
  failures.push(e.message);
  await shot(page, '99-error').catch(() => {});
} finally {
  await browser.close();
}

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
