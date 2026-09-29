import 'server-only';

import { parse as parseCsv } from 'csv-parse/sync';

import { readBill, type Owner } from '@/lib/import/bill-text';
import { readTable } from '@/lib/import/table';
import type { ImportedCustomer } from '@/lib/import/types';
import { readXlsx } from '@/lib/xlsx-read';

import { doclingAvailable, readWithDocling } from './docling';

export interface FileReading {
  filename: string;
  kind: 'pdf' | 'csv' | 'xlsx' | 'image' | 'unknown';
  customers: ImportedCustomer[];
  /** Why nothing, or less than expected, came out. Plain words for the screen. */
  problem: 'no-text' | 'scanned' | 'unrecognised' | 'unsupported' | 'too-big' | 'ocr-failed' | null;
  pages: number;
  /** How the text was got: the PDF's own text, Docling's reading (OCR for photos and scans), or a sheet. */
  reader: 'text' | 'docling' | 'sheet' | null;
  /** The text read, page by page, for search later. Never the file itself. */
  text: string[];
}

export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * One uploaded file, read. A PDF's text layer is read page by page and each
 * page that looks like a bill yields a customer; a spreadsheet's header row
 * decides the columns.
 *
 * A photo, a scan, or a PDF whose text layer yields nobody goes to Docling
 * when it is running: it reads the layout and, for images, does OCR, and its
 * text goes through the same bill reader. Without Docling the screen says a
 * photo cannot be read here rather than guessing.
 */
export async function readFile(filename: string, bytes: Uint8Array, owner: Owner): Promise<FileReading> {
  const kind = kindOf(filename, bytes);
  const base: FileReading = { filename, kind, customers: [], problem: null, pages: 0, reader: null, text: [] };
  if (bytes.length > MAX_FILE_BYTES) return { ...base, problem: 'too-big' };

  switch (kind) {
    case 'pdf': {
      const pages = await pdfPages(bytes);
      const textChars = pages.join('').replace(/\s/g, '').length;
      const customers = billsIn(pages, owner);
      if (customers.length || !doclingAvailable()) {
        return {
          ...base,
          pages: pages.length,
          reader: 'text',
          text: pages,
          customers,
          problem: customers.length ? null : textChars < 40 ? 'scanned' : 'unrecognised',
        };
      }
      // Nobody in the text layer: a scan (no text) is OCR'd; a typed PDF with
      // an odd layout gets Docling's layout reading, which keeps table cells apart.
      return viaDocling(base, filename, bytes, owner, { forceOcr: textChars < 40, fallbackPages: pages });
    }
    case 'image':
      if (!doclingAvailable()) return { ...base, problem: 'scanned' };
      return viaDocling(base, filename, bytes, owner, { forceOcr: true, fallbackPages: [] });
    case 'csv': {
      const rows = parseCsv(Buffer.from(bytes), { relax_column_count: true, skip_empty_lines: true, bom: true, trim: true }) as string[][];
      const { customers, unrecognised } = readTable(rows);
      return { ...base, pages: 1, reader: 'sheet', customers, problem: unrecognised ? 'unrecognised' : null };
    }
    case 'xlsx': {
      const rows = readXlsx(bytes);
      const { customers, unrecognised } = readTable(rows);
      return { ...base, pages: 1, reader: 'sheet', customers, problem: unrecognised ? 'unrecognised' : null };
    }
    default:
      return { ...base, problem: 'unsupported' };
  }
}

async function viaDocling(
  base: FileReading,
  filename: string,
  bytes: Uint8Array,
  owner: Owner,
  opts: { forceOcr: boolean; fallbackPages: string[] },
): Promise<FileReading> {
  try {
    const { pages } = await readWithDocling(filename, bytes, { forceOcr: opts.forceOcr });
    const customers = billsIn(pages, owner);
    const empty = pages.join('').replace(/\s/g, '').length < 20;
    return {
      ...base,
      pages: pages.length,
      reader: 'docling',
      text: pages,
      customers,
      problem: customers.length ? null : empty ? 'no-text' : 'unrecognised',
    };
  } catch {
    // Docling down or too slow: say so, and keep whatever the text layer had.
    return { ...base, pages: opts.fallbackPages.length, reader: 'text', text: opts.fallbackPages, problem: 'ocr-failed' };
  }
}

function billsIn(pages: string[], owner: Owner): ImportedCustomer[] {
  const customers: ImportedCustomer[] = [];
  for (const page of pages) {
    const found = readBill(page, owner);
    if (found) customers.push(found);
  }
  return dedupeWithin(customers);
}

/**
 * The text of a document for reading contract terms: the PDF text layer, or
 * Docling's reading for a scan or a photo. Null when there is nothing to read.
 */
export async function documentText(filename: string, bytes: Uint8Array): Promise<{ text: string; reader: 'text' | 'docling' } | null> {
  const kind = kindOf(filename, bytes);
  if (kind === 'pdf') {
    const text = (await pdfPages(bytes)).join('\n');
    if (text.replace(/\s/g, '').length >= 40) return { text, reader: 'text' };
    if (!doclingAvailable()) return null;
    const { pages } = await readWithDocling(filename, bytes, { forceOcr: true }).catch(() => ({ pages: [] as string[] }));
    const ocr = pages.join('\n');
    return ocr.replace(/\s/g, '').length >= 40 ? { text: ocr, reader: 'docling' } : null;
  }
  if (kind === 'image' && doclingAvailable()) {
    const { pages } = await readWithDocling(filename, bytes, { forceOcr: true }).catch(() => ({ pages: [] as string[] }));
    const ocr = pages.join('\n');
    return ocr.replace(/\s/g, '').length >= 40 ? { text: ocr, reader: 'docling' } : null;
  }
  return null;
}

function kindOf(filename: string, bytes: Uint8Array): FileReading['kind'] {
  const head = Buffer.from(bytes.subarray(0, 8));
  if (head.subarray(0, 4).toString() === '%PDF') return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b && /\.xlsx$/i.test(filename)) return 'xlsx';
  if ((head[0] === 0xff && head[1] === 0xd8) || head.subarray(0, 4).toString('hex') === '89504e47' || /\.(jpe?g|png|webp|tiff?|bmp)$/i.test(filename)) return 'image';
  if (/\.(csv|txt|tsv)$/i.test(filename)) return 'csv';
  if (/\.pdf$/i.test(filename)) return 'pdf';
  return 'unknown';
}

/**
 * The text of each page, in reading order: items grouped into lines by
 * their y position, left to right, so "Bill to" and the name under it
 * come out on consecutive lines the way a person reads them.
 */
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
  const pages: string[] = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 40); p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = (content.items as Array<{ str?: string; transform?: number[]; width?: number }>)
        .filter((it) => typeof it.str === 'string' && Array.isArray(it.transform))
        .map((it) => ({ text: it.str!, x: it.transform![4]!, y: it.transform![5]!, w: it.width ?? 0 }))
        .filter((it) => it.text.trim());
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines: string[] = [];
      let current: typeof items = [];
      let lastY: number | null = null;
      for (const it of items) {
        if (lastY !== null && Math.abs(it.y - lastY) > 3) {
          lines.push(joinLine(current));
          current = [];
        }
        current.push(it);
        lastY = it.y;
      }
      if (current.length) lines.push(joinLine(current));
      pages.push(lines.join('\n'));
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

function joinLine(items: Array<{ text: string; x: number; w: number }>): string {
  let out = '';
  let end = -Infinity;
  for (const it of items) {
    // A wide gap between items is a column break: keep it visible as a
    // double space so a label and its value stay distinguishable.
    if (out && it.x - end > 12) out += '  ';
    else if (out && !out.endsWith(' ') && !it.text.startsWith(' ')) out += ' ';
    out += it.text;
    end = it.x + it.w;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** The same customer twice in one file (two pages of one bill) is one candidate. */
function dedupeWithin(customers: ImportedCustomer[]): ImportedCustomer[] {
  const seen = new Set<string>();
  return customers.filter((c) => {
    const key = c.gstin ?? c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
