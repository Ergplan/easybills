import { NextResponse } from 'next/server';

import { aiConfig } from '@/lib/env';
import { AiUnavailableError, transcribeAudio } from '@/server/ai/adapters';
import { consumeAiBudget, RateLimitedError } from '@/server/ai/rate-limit';
import { requireBusiness } from '@/server/auth/guard';

export const runtime = 'nodejs';

const ALLOWED_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a'];

/**
 * Speech to text.
 *
 * The audio never touches storage: it is streamed to the configured provider and
 * discarded. The transcript goes back to the browser for the owner to READ AND
 * EDIT before anything is done with it -- a transcript is a suggestion, not an
 * instruction the server acts on.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const businessId = String(form.get('businessId') ?? '');
    await requireBusiness(businessId);

    const file = form.get('audio');
    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: 'No recording was received.' }, { status: 400 });
    }

    const config = aiConfig();
    if (file.size === 0) {
      return NextResponse.json({ ok: false, error: 'The recording was empty.' }, { status: 400 });
    }
    if (file.size > config.maxAudioBytes) {
      return NextResponse.json({ ok: false, error: 'That recording is too long. Please record a shorter instruction.' }, { status: 413 });
    }
    const type = (file.type || '').split(';')[0]!.toLowerCase();
    if (type && !ALLOWED_TYPES.includes(type)) {
      return NextResponse.json({ ok: false, error: 'That kind of recording is not supported.' }, { status: 415 });
    }

    await consumeAiBudget(businessId, 'transcribe');
    const text = await transcribeAudio(file, type || 'audio/webm');

    return NextResponse.json({ ok: true, text });
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 429 });
    }
    if (error instanceof AiUnavailableError) {
      return NextResponse.json(
        { ok: false, error: `${error.message} You can type your instruction instead.` },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: 'We could not process that recording.' }, { status: 500 });
  }
}
