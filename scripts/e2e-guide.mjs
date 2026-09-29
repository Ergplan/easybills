/**
 * The guided tour on every screen, and the guide the way voice drives it.
 *
 *   Terminal 1: npm run emulators    Terminal 2: npm run dev
 *   Terminal 3: node scripts/e2e-guide.mjs
 *
 * For each screen: "?" starts the tour, the ring is round something real on
 * every step, and the bubble speaks Hinglish. Then, on a bill: voice's fill
 * puts words and numbers in the fields and the total follows, voice's tap
 * presses "+ Aur kuch", and is refused on "Bill banao", which gets the ring
 * so the owner can tap it.
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

async function walkTour(name) {
  await page.getByTestId('guide-btn').first().click();
  await page.waitForTimeout(700);
  const bubble = page.locator('.guide-bubble');
  if (!(await bubble.isVisible())) {
    check(`${name}: the tour opens`, false);
    return;
  }
  const count = (await bubble.locator('.guide-bubble__count').innerText().catch(() => '')).trim();
  const total = Number(count.split('/')[1] ?? 0);
  check(`${name}: the tour has steps (${count})`, total > 0, count);
  await shot(`guide-${name}`);
  for (let i = 0; i < total; i += 1) {
    const ring = await page.locator('.guide-ring').boundingBox();
    const said = (await bubble.locator('.guide-bubble__say').innerText()).trim();
    check(`${name} ${i + 1}/${total}: the ring is on something, and it says "${said.slice(0, 40)}…"`, ring !== null && ring.width > 10 && said.length > 5);
    const btn = bubble.getByRole('button', { name: i === total - 1 ? 'Samajh gaya' : 'Aage' });
    await btn.click();
    await page.waitForTimeout(450);
  }
  check(`${name}: the tour closes at the end`, !(await page.locator('.guide-bubble').isVisible()));
}

try {
  console.log('\n1. An owner with a bill and a customer');
  await signInByPhone(page, BASE);
  await fillProfile(page, BASE, { name: 'Kumar Repairs', city: 'Pune' });
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  await walkTour('home');

  console.log('\n2. Kiska bill -> Naya customer -> the bill, with voice\'s hands');
  await page.getByTestId('task-bill').click();
  await page.waitForURL('**/bills/start');
  await walkTour('bill-start');
  await page.locator('.person--new').click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}$/);
  await page.waitForTimeout(1000);
  await walkTour('bill');

  const snap = await page.evaluate(() => window.__ekbillGuide.snapshot());
  const idOf = (re) => snap.find((i) => re.test(i.id) || re.test(i.label))?.id;
  const customerId = idOf(/bill-customer/);
  const whatId = idOf(/^what-/);
  const rateId = idOf(/^rate-/);
  check('voice sees the fields on the bill', Boolean(customerId && whatId && rateId), JSON.stringify(snap.slice(0, 8)));
  const f1 = await page.evaluate(([id]) => window.__ekbillGuide.fill(id, 'Mehta Traders'), [customerId]);
  const f2 = await page.evaluate(([id]) => window.__ekbillGuide.fill(id, 'AMC visit'), [whatId]);
  const f3 = await page.evaluate(([id]) => window.__ekbillGuide.fill(id, '3500'), [rateId]);
  await page.waitForTimeout(500);
  check('fill types into the fields', f1.ok && f2.ok && f3.ok);
  check('and the form hears it: the total follows', (await page.locator('.bill-total').innerText()).trim() === '₹3,500');
  await shot('guide-bill-filled');

  const make = snap.find((i) => /Bill banao/.test(i.label));
  check('Bill banao is marked owner-only', make?.ownerOnly === true, JSON.stringify(make));
  const refused = await page.evaluate(([id]) => window.__ekbillGuide.tap(id), [make.id]);
  await page.waitForTimeout(500);
  check('voice cannot press Bill banao', refused.ok === false && /owner/.test(refused.reason ?? ''));
  check('it puts the ring round it for the owner instead', (await page.locator('.guide-ring').boundingBox()) !== null);
  check('and no bill was made', !page.url().includes('done=1'));
  const more = snap.find((i) => /Aur kuch/.test(i.label));
  const tapped = await page.evaluate(([id]) => window.__ekbillGuide.tap(id), [more.id]);
  await page.waitForTimeout(500);
  check('voice can press "+ Aur kuch": a second line appears', tapped.ok && (await page.locator('input[id^="what-"]').count()) === 2);

  console.log('\n3. The owner makes it, then the tour of a sent bill');
  await page.getByRole('button', { name: 'Bill banao' }).click();
  await page.getByText('Bill ban gaya!').waitFor({ timeout: 25000 });
  await page.goto(page.url().replace('?done=1', ''), { waitUntil: 'networkidle' });
  await walkTour('bill-sent');
  await page.getByRole('link', { name: 'Yaad dilao' }).first().click();
  await page.waitForURL(/\/remind$/);
  await page.waitForTimeout(800);
  await walkTour('remind');

  console.log('\n4. Back goes where you came from');
  await page.locator('.topbar__back').click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}$/, { timeout: 10000 });
  check('from the reminder, back to the bill', true);
  await page.goto(`${BASE}/dues`, { waitUntil: 'networkidle' });
  await page.locator('.due-row__who').first().click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}$/);
  await page.locator('.topbar__back').click();
  await page.waitForURL('**/dues', { timeout: 10000 });
  check('from a bill opened in "Kiske paise aane hain", back to it (not to the bills list)', page.url().endsWith('/dues'));

  console.log('\n5. Every other screen has a tour');
  for (const [name, path] of [['dues', '/dues'], ['bills', '/bills'], ['customers', '/customers'], ['ask', '/ask'], ['you', '/you']]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await walkTour(name);
  }
  await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle' });
  await page.locator('main .row-line').first().click();
  await page.waitForURL(/\/customers\/[0-9a-f-]{36}$/);
  await page.waitForTimeout(700);
  await walkTour('customer');

  console.log('\n6. The tabs');
  const tabs = (await page.locator('.tabbar__item').allInnerTexts()).map((t) => t.trim()).join(' / ');
  check('Ghar / Bills / Customers / Aap', tabs === 'Ghar / Bills / Customers / Aap', tabs);

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  console.error('\nCRASH', e);
  failures.push('crash');
  await shot('guide-crash').catch(() => undefined);
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} failed: ${failures.join(', ')}` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
