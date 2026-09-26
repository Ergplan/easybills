import 'server-only';

import { existsSync } from 'node:fs';

import { chromium, type Browser } from 'playwright-core';

import { pdfConfig } from '@/lib/env';
import type { InvoiceRecord } from '@/lib/domain/types';

import { renderInvoiceHtml } from './template';

/**
 * Server-side PDF rendering.
 *
 * Rendering is deliberately decoupled from issuance: an issued invoice exists
 * whether or not a PDF was ever produced, and a failed render is retried against
 * the SAME issued document. There is no path in which a rendering problem causes
 * a second invoice to be issued.
 *
 * The browser is launched with no network access to the page (the HTML is set
 * directly, never fetched) and all assets inlined, so rendering cannot reach out
 * to a third party or leak invoice contents.
 */

const BASE_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

/**
 * The serverless Chromium build, if this installation has it.
 *
 * Loading the module is a few milliseconds of JavaScript and unpacks nothing --
 * the 70MB binary is only written to /tmp when `executablePath()` is called. So
 * both the capability check and the launch path can ask for it freely.
 */
type ServerlessChromium = { executablePath: () => Promise<string>; args: string[] };

let serverless: Promise<ServerlessChromium | null> | null = null;

function serverlessChromium(): Promise<ServerlessChromium | null> {
  serverless ??= import('@sparticuz/chromium').then(
    (m) => m.default as ServerlessChromium,
    () => null,
  );
  return serverless;
}

/**
 * Where the browser comes from, in the order a deployment is likely to have one.
 *
 * Managed Node hosts -- Firebase App Hosting, Cloud Run's Node buildpack, and
 * every platform-as-a-service -- give you Node and nothing else. There is no
 * Chromium on the image and no way to apt-get one. `@sparticuz/chromium` exists
 * for exactly that: a Chromium built to run there, shipped as a dependency and
 * unpacked to /tmp on first use. It costs a few seconds on the first PDF of a
 * cold instance and nothing after.
 *
 * A container image that installs its own Chromium is faster and preferable
 * where it is an option, so an explicitly configured path always wins.
 */
async function resolveBrowser(): Promise<{ executablePath?: string; args: string[] }> {
  const configured = pdfConfig().chromiumExecutablePath;
  if (configured) return { executablePath: configured, args: BASE_ARGS };

  const bundled = await serverlessChromium();
  if (bundled) return { executablePath: await bundled.executablePath(), args: bundled.args };

  // Local development after `npx playwright install chromium`.
  return { args: BASE_ARGS };
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = resolveBrowser()
      .then(({ executablePath, args }) =>
        chromium.launch({ ...(executablePath ? { executablePath } : {}), args }),
      )
      .catch((error) => {
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
}

export class PdfRenderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PdfRenderError';
  }
}

export async function renderInvoicePdf(
  invoice: InvoiceRecord,
  opts: { upiQrDataUrl?: string | null } = {},
): Promise<Buffer> {
  const html = renderInvoiceHtml(invoice, opts);
  let context;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({ javaScriptEnabled: false });
    // Nothing in the template needs the network; block it so a crafted data
    // field can never turn a render into an outbound request.
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url === 'about:blank') return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#888;text-align:center;padding:0 12mm;">' +
        '<span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });
    return Buffer.from(pdf);
  } catch (error) {
    throw new PdfRenderError(
      'We could not produce the PDF just now. Your bill is safe — please try again.',
      error,
    );
  } finally {
    await context?.close().catch(() => undefined);
  }
}

/**
 * Can this deployment actually produce a PDF?
 *
 * PDFs need a real Chromium, and no managed Node host ships one. A deployment
 * without it looks completely healthy until an owner taps Download on a bill
 * they have already sent their customer -- which is the worst moment to find
 * out. So Business details says up front whether this installation can.
 *
 * This asks the cheap question -- is a browser available to us -- and never
 * launches one. A page an owner opens to change their address must not wait on
 * a browser starting, nor hang for the launch timeout when there is none.
 */
export interface PdfCapability {
  ok: boolean;
  /** Plain enough for the owner, specific enough for whoever deploys this. */
  detail: string;
}

export async function pdfCapability(): Promise<PdfCapability> {
  const configured = pdfConfig().chromiumExecutablePath;
  if (configured) {
    return existsSync(configured)
      ? { ok: true, detail: 'ready' }
      : { ok: false, detail: `no browser at ${configured}` };
  }

  // The serverless build is a dependency, so on a managed host this is the
  // normal answer. Loading the module does not unpack the binary and does not
  // start anything: opening Business details must not pay for a browser.
  if (await serverlessChromium()) return { ok: true, detail: 'ready' };

  // Nothing configured and nothing bundled: ask playwright-core where it would
  // look. It throws rather than returning a path when nothing is installed.
  let fallback: string;
  try {
    fallback = chromium.executablePath();
  } catch {
    return { ok: false, detail: 'no browser installed — see docs/deployment.md' };
  }
  return existsSync(fallback)
    ? { ok: true, detail: 'ready' }
    : { ok: false, detail: 'no browser installed — see docs/deployment.md' };
}

/** Release the shared browser, for graceful shutdown and tests. */
export async function closePdfRenderer(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close().catch(() => undefined);
}
