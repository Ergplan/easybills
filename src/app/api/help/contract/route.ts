import { NextResponse } from 'next/server';

import { DEFAULT_RULE_PACK } from '@/lib/gst/ruleset';
import { requireBusiness } from '@/server/auth/guard';
import { readContract } from '@/server/help/read-contract';
import { documentText, MAX_FILE_BYTES } from '@/server/import/read-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Read contract terms from typed text, a contract PDF, or a photo of one. Nothing is stored:
 * the result goes back to the helper for the owner to check.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  try {
    await requireBusiness(String(form.get('b') ?? ''));
    let text = String(form.get('text') ?? '').slice(0, 20000);
    const file = form.get('file');
    if (file instanceof File) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > MAX_FILE_BYTES) return NextResponse.json({ problem: 'too-big' });
      // A typed PDF is read from its text; a scan or a photo goes to Docling.
      const read = await documentText(file.name, bytes);
      if (!read) return NextResponse.json({ problem: 'no-text' });
      text = read.text;
    }
    if (!text.trim()) return NextResponse.json({ problem: 'no-text' });
    const result = await readContract(text, [...DEFAULT_RULE_PACK.selectableRates.value]);
    return NextResponse.json(result);
  } catch (error) {
    const status = (error as Error)?.name === 'NotAuthorisedError' ? 403 : 500;
    return NextResponse.json({ error: status === 403 ? 'No access.' : 'Could not read it.' }, { status });
  }
}
