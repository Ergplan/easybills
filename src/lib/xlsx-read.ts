/**
 * Read the cells of an .xlsx, without a library.
 *
 * A workbook is a zip of XML: `xl/sharedStrings.xml` holds the text cells,
 * `xl/worksheets/sheet1.xml` holds the grid with each cell's reference and
 * either an inline value or an index into the shared strings. Deflate is in
 * Node's zlib. Enough for a party list; not a spreadsheet engine -- formulas
 * come back as their last computed value, dates as Excel's serial numbers.
 */
import { inflateRawSync } from 'node:zlib';

interface Entry {
  name: string;
  data: Uint8Array;
}

function readZip(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: search back for its signature.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 70000); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: Entry[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Bad central directory');
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = dec.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(start, start + compressed);
    const data = method === 8 ? new Uint8Array(inflateRawSync(raw)) : method === 0 ? raw : null;
    if (data) entries.push({ name, data });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function unescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The first sheet, as rows of strings. Empty cells are ''. */
export function readXlsx(bytes: Uint8Array): string[][] {
  const entries = readZip(bytes);
  const dec = new TextDecoder();
  const file = (name: string) => entries.find((e) => e.name === name);
  const shared: string[] = [];
  const ss = file('xl/sharedStrings.xml');
  if (ss) {
    const xml = dec.decode(ss.data);
    for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push([...si[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1]!)).join(''));
    }
  }
  const sheet =
    file('xl/worksheets/sheet1.xml') ?? entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
  if (!sheet) throw new Error('No worksheet');
  const xml = dec.decode(sheet.data);
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1]!.matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '';
      const type = /t="(\w+)"/.exec(attrs)?.[1] ?? '';
      const body = c[2] ?? '';
      let value = '';
      if (type === 's') {
        const idx = Number(/<v>(\d+)<\/v>/.exec(body)?.[1] ?? '-1');
        value = shared[idx] ?? '';
      } else if (type === 'inlineStr') {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1]!)).join('');
      } else {
        value = unescape(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      }
      const col = ref ? columnIndex(ref) : cells.length;
      while (cells.length < col) cells.push('');
      cells[col] = value;
    }
    rows.push(cells);
  }
  return rows;
}
