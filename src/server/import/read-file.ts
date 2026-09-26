import 'server-only';

import { parse as parseCsv } from 'csv-parse/sync';

import { readBill, type Owner } from '@/lib/import/bill-text';
import { readTable } from '@/lib/import/table';
import type { ImportedCustomer } from '@/lib/import/types';
import { readXlsx } from '@/lib/xlsx-read';

export interface FileReading {
  filename: string;
  kind: 'pdf' | 'csv' | 'xlsx' | 'image' | 'unknown';
  customers: ImportedCustomer[];
  /** Why nothing, or less than expected, came out. Plain words for the screen. */
  problem: 'no-text' | 'scanned' | 'unrecognised' | 'unsupported' | 'too-big' | null;
  pages: number;
}

export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * One uploaded file, read. A PDF's text layer is read page by page and each
 * page that looks like a bill yields a customer; a spreadsheet's header row
 * decides the columns. A photo or a scan has no text to read -- until a
 * model that reads images is configured, the screen says so rather than
 * guessing.
 */
export async function readFile(filename: string, bytes: Uint8Array, owner: Owner): Promise<FileReading> {
  const kind = kindOf(filename, bytes);
  const base = { filename, kind, customers: [] as ImportedCustomer[], problem: null as FileReading['problem'], pages: 0 };
  if (bytes.length > MAX_FILE_BYTES) return { ...base, problem: 'too-big' };

  switch (kind) {
    case 'pdf': {
      const pages = await pdfPages(bytes);
      const customers: ImportedCustomer[] = [];
      let textChars = 0;
      for (const page of pages) {
        textChars += page.replace(/\s/g, '').length;
        const found = readBill(page, owner);
        if (found) customers.push(found);
      }
      return {
        ...base,
        pages: pages.length,
        customers: dedupeWithin(customers),
        problem: customers.length ? null : textChars < 40 ? 'scanned' : 'unrecognised',
      };
    }
    case 'csv': {
      const rows = parseCsv(Buffer.from(bytes), { relax_column_count: true, skip_empty_lines: true, bom: true, trim: true }) as string[][];
      const { customers, unrecognised } = readTable(rows);
      return { ...base, pages: 1, customers, problem: unrecognised ? 'unrecognised' : null };
    }
    case 'xlsx': {
      const rows = readXlsx(bytes);
      const { customers, unrecognised } = readTable(rows);
      return { ...base, pages: 1, customers, problem: unrecognised ? 'unrecognised' : null };
    }
    case 'image':
      return { ...base, problem: 'scanned' };
    default:
      return { ...base, problem: 'unsupported' };
  }
}

function kindOf(filename: string, bytes: Uint8Array): FileReading['kind'] {
  const head = Buffer.from(bytes.subarray(0, 8));
  if (head.subarray(0, 4).toString() === '%PDF') return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b && /\.xlsx$/i.test(filename)) return 'xlsx';
  if ((head[0] === 0xff && head[1] === 0xd8) || head.subarray(0, 4).toString('hex') === '89504e47' || /\.(jpe?g|png|webp|heic)$/i.test(filename)) return 'image';
  if (/\.(csv|txt|tsv)$/i.test(filename)) return 'csv';
  if (/\.pdf$/i.test(filename)) return 'pdf';
  return 'unknown';
}

/**
 * The text of each page, in reading order: items grouped into lines by
 * their y position, left to right, so "Bill to" and the name under it
 * come out on consecutive lines the way a person reads them.
 */
async function pdfPages(bytes: Uint8Array): Promise<string[]> {
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
