/**
 * Photos and scans of old bills go through Docling. Its Markdown is turned
 * back into the lines the bill reader expects, and the importer copes with
 * Docling being up, down, or not set up at all.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { readBill } from '@/lib/import/bill-text';
import { markdownToLines, markdownToPages } from '@/lib/import/markdown-lines';
import { readFile } from '@/server/import/read-file';

const md = readFileSync(new URL('../fixtures/import/tally-invoice.docling.md', import.meta.url)).toString();
const owner = { gstin: '27AAPFU0939F1ZV', phone: '9822012345', name: 'Sharma Electricals' };
// The first bytes of a JPEG are enough for the importer to call it a photo.
const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe('Docling Markdown to lines', () => {
  it('keeps table cells apart the way the text layer keeps columns', () => {
    expect(markdownToLines('| Invoice No. | INV-7 | Dated | 1-Jan-2026 |\n|---|---|---|---|')).toEqual([
      'Invoice No.  INV-7  Dated  1-Jan-2026',
    ]);
  });

  it('drops headings marks, bold, image placeholders and table rules', () => {
    expect(markdownToLines('## TAX INVOICE\n\n**Buyer (Bill to)**\n<!-- image -->\n|---|---|')).toEqual([
      'TAX INVOICE',
      'Buyer (Bill to)',
    ]);
  });

  it('collapses a merged cell Docling repeated across columns', () => {
    expect(markdownToLines('| Grand Total | Grand Total | 7,316.00 |')).toEqual(['Grand Total  7,316.00']);
  });

  it('splits pages on the placeholder and drops empty ones', () => {
    expect(markdownToPages('a\n<!-- page-break -->\n\n<!-- page-break -->\nb')).toEqual(['a', 'b']);
  });

  it('gives the bill reader what it needs from a photographed Tally invoice', () => {
    const [first] = markdownToPages(md);
    const c = readBill(first!, owner)!;
    expect(c.name).toBe('Green Park Co-operative Housing Society');
    expect(c.gstin).toBe('27AABCG1234H1ZZ');
    expect(c.phone).toBe('9876543210');
    expect(c.bill).toEqual({ number: 'INV/2025-26/042', date: '2025-09-12', totalPaise: 731600 });
  });
});

describe('reading a photo', () => {
  let server: Server;
  let url = '';
  let answer: (res: import('node:http').ServerResponse, form: string) => void = () => undefined;
  const seen: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push(`${req.method} ${req.url}`);
        answer(res, body);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  afterEach(() => {
    delete process.env.DOCLING_URL;
    seen.length = 0;
  });

  it('is refused with a sentence when Docling is not set up', async () => {
    const r = await readFile('bill.jpg', photo, owner);
    expect(r.problem).toBe('scanned');
    expect(r.customers).toHaveLength(0);
  });

  it('goes to Docling with OCR forced, and the customer comes back', async () => {
    process.env.DOCLING_URL = url;
    let form = '';
    answer = (res, body) => {
      form = body;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ document: { filename: 'bill.jpg', md_content: md }, status: 'success', processing_time: 4.2 }));
    };
    const r = await readFile('bill.jpg', photo, owner);
    expect(seen).toEqual(['POST /v1/convert/file']);
    expect(form).toMatch(/name="force_ocr"\r\n\r\ntrue/);
    expect(form).toMatch(/name="md_page_break_placeholder"\r\n\r\n<!-- page-break -->/);
    expect(r.reader).toBe('docling');
    expect(r.problem).toBeNull();
    expect(r.customers.map((c) => c.name)).toEqual(['Green Park Co-operative Housing Society']);
    expect(r.text[0]).toContain('Green Park');
  });

  it('says so when Docling fails, rather than claiming there was nobody', async () => {
    process.env.DOCLING_URL = url;
    answer = (res) => {
      res.statusCode = 500;
      res.end('boom');
    };
    const r = await readFile('bill.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), owner);
    expect(r.problem).toBe('ocr-failed');
  });

  it('says so when Docling read the photo but it held no bill', async () => {
    process.env.DOCLING_URL = url;
    answer = (res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ document: { md_content: '## Menu\n\nChai 10\n\nSamosa 15\n\nThank you, visit again' }, status: 'success' }));
    };
    const r = await readFile('menu.jpg', photo, owner);
    expect(r.reader).toBe('docling');
    expect(r.problem).toBe('unrecognised');
  });
});
