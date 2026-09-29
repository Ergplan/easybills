import 'server-only';

import { doclingConfig } from '@/lib/env';
import { markdownToPages, PAGE_BREAK } from '@/lib/import/markdown-lines';

export class DoclingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DoclingUnavailableError';
  }
}

export interface DoclingReading {
  pages: string[];
  /** Seconds the server spent, as it reports it. */
  seconds: number | null;
  /** 'success', or 'partial_success' when some pages could not be read. */
  status: string;
}

export const doclingAvailable = (): boolean => doclingConfig().url !== null;

/**
 * Read one file with the docling-serve container: layout, tables and, for a
 * photo or a scan, OCR. `POST /v1/convert/file` (docling-serve 1.x) with the
 * options as form fields; one file per request so the answer is JSON, not a
 * zip. The file goes to the container on the same machine and nowhere else.
 */
export async function readWithDocling(
  filename: string,
  bytes: Uint8Array,
  opts: { forceOcr?: boolean } = {},
): Promise<DoclingReading> {
  const config = doclingConfig();
  if (!config.url) throw new DoclingUnavailableError('DOCLING_URL is not set.');

  const form = new FormData();
  form.append('files', new Blob([bytes as BlobPart]), filename);
  form.append('to_formats', 'md');
  form.append('do_ocr', 'true');
  form.append('force_ocr', opts.forceOcr ? 'true' : 'false');
  for (const lang of config.ocrLanguages) form.append('ocr_lang', lang);
  form.append('image_export_mode', 'placeholder');
  form.append('md_page_break_placeholder', PAGE_BREAK);
  form.append('do_table_structure', 'true');
  form.append('abort_on_error', 'false');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${config.url.replace(/\/$/, '')}/v1/convert/file`, {
      method: 'POST',
      body: form,
      headers: config.apiKey ? { 'X-Api-Key': config.apiKey } : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw new DoclingUnavailableError(
      (error as Error).name === 'AbortError' ? 'Docling took too long.' : `Docling is not answering: ${(error as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new DoclingUnavailableError(`Docling answered ${res.status}.`);

  const body = (await res.json()) as {
    document?: { md_content?: string | null };
    status?: string;
    processing_time?: number;
  };
  return {
    pages: markdownToPages(body.document?.md_content ?? ''),
    seconds: typeof body.processing_time === 'number' ? Math.round(body.processing_time * 10) / 10 : null,
    status: body.status ?? 'unknown',
  };
}

/** Whether the container is up. Used by /api/health. */
export async function doclingHealth(): Promise<'ok' | 'off' | 'FAILED'> {
  const { url } = doclingConfig();
  if (!url) return 'off';
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? 'ok' : 'FAILED';
  } catch {
    return 'FAILED';
  }
}
