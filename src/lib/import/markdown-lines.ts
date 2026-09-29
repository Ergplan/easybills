/**
 * Docling hands back Markdown. The bill reader (bill-text.ts) reads lines of
 * text the way the PDF text layer produces them: one printed line per line,
 * columns kept apart by a double space. This turns one into the other.
 *
 * Pure, so it is tested without a Docling server.
 */
export const PAGE_BREAK = '<!-- page-break -->';

export function markdownToPages(md: string): string[] {
  return md
    .split(PAGE_BREAK)
    .map((page) => markdownToLines(page).join('\n'))
    .filter((page) => page.trim().length > 0);
}

export function markdownToLines(md: string): string[] {
  const out: string[] = [];
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    if (/^<!--.*-->$/.test(line)) continue; // image and other placeholders
    if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line)) continue; // table rule |---|---|
    if (line.startsWith('|')) {
      // A table row: its cells, apart, the way the text layer keeps columns.
      const cells = line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => clean(c))
        .filter(Boolean);
      // Docling repeats a merged cell into every column it covers.
      const unique = cells.filter((c, i) => c !== cells[i - 1]);
      if (unique.length) out.push(unique.join('  '));
      continue;
    }
    line = line.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+(?=\D)/, '');
    line = clean(line);
    if (line) out.push(line);
  }
  return out;
}

function clean(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/(^|\s)[*_](\S.*?\S|\S)[*_](?=\s|$)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
