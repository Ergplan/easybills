import 'server-only';

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

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath = pdfConfig().chromiumExecutablePath ?? undefined;
    browserPromise = chromium
      .launch({
        ...(executablePath ? { executablePath } : {}),
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      })
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

/** Release the shared browser, for graceful shutdown and tests. */
export async function closePdfRenderer(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close().catch(() => undefined);
}
