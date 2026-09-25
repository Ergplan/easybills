'use client';

import { useState } from 'react';

import { interpretInstructionAction } from '@/app/actions/ai';

import { emptyLine, type LineDraft } from './types';

export interface AiProposal {
  customer?: { name: string; customerId: string | null };
  lines: LineDraft[];
}

/**
 * "Speak or type your bill", inside the editor.
 *
 * This is an input shortcut, not a chatbot: there is no conversation, no message
 * history, and the ordinary form stays exactly where it was. The request only
 * fires when the owner submits -- never on a keystroke -- and if it fails, times
 * out or returns something unusable, the form is untouched and the owner simply
 * carries on typing.
 */
export function AiInstructionBox({
  businessId,
  invoiceId,
  onProposal,
}: {
  businessId: string;
  invoiceId: string;
  onProposal: (proposal: AiProposal) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [customerChoices, setCustomerChoices] = useState<Array<{ id: string; name: string }>>([]);
  const [recording, setRecording] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);

  async function submit(instruction: string, chosenCustomerId?: string) {
    if (!instruction.trim()) return;
    setBusy(true);
    setError(null);
    setQuestions([]);
    setCustomerChoices([]);
    try {
      const result = await interpretInstructionAction(businessId, {
        intent: 'create-draft',
        instruction: instruction.trim(),
        invoiceId,
        chosenCustomerId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const data = result.data;
      if (data.customerChoices.length > 1) {
        setCustomerChoices(data.customerChoices);
        setQuestions(['Which customer did you mean?']);
        return;
      }
      setQuestions(data.questions);
      onProposal({
        customer: data.customer ?? undefined,
        lines: data.lines.map((l: { description: string; quantity: string; unitPrice: string; taxRate: string | null }) => ({
          ...emptyLine(),
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate ?? '',
        })),
      });
      if (data.lines.length) setText('');
    } catch {
      setError('We could not read that just now. Please type the bill instead — nothing has been lost.');
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: mr.mimeType });
        setBusy(true);
        try {
          const form = new FormData();
          form.append('audio', blob, 'instruction.webm');
          form.append('businessId', businessId);
          const res = await fetch('/api/ai/transcribe', { method: 'POST', body: form });
          const body = (await res.json()) as { ok: boolean; text?: string; error?: string };
          if (body.ok && body.text) {
            // The transcript is always shown for review before it is used.
            setTranscript(body.text);
            setText(body.text);
          } else {
            setError(body.error ?? 'We could not hear that clearly. Please type instead.');
          }
        } catch {
          setError('We could not send the recording. Please type instead.');
        } finally {
          setBusy(false);
        }
      };
      mr.start();
      setRecorder(mr);
      setRecording(true);
    } catch {
      // Permission denied or unsupported: typing must keep working.
      setError('We could not use the microphone. You can type your bill instead.');
      setRecording(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn--secondary btn--block" onClick={() => setOpen(true)}>
        🎤 Speak or type your bill
      </button>
    );
  }

  return (
    <section className="card stack" aria-labelledby="ai-heading">
      <div className="row row--between">
        <h2 id="ai-heading" style={{ fontSize: '1rem' }}>Speak or type your bill</h2>
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>Close</button>
      </div>

      <p className="field__hint">
        For example: “Bill Sharma Electricals for two repair visits at 800 each and spare parts of 450.”
        We will fill in the form for you to check — nothing is sent to your customer.
      </p>

      <div className="field">
        <label className="field__label" htmlFor="ai-text">Your instruction</label>
        <textarea
          id="ai-text"
          className="textarea"
          value={text}
          maxLength={1200}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type what you want to bill"
        />
      </div>

      {transcript && (
        <div className="notice notice--info">
          <span className="notice__icon" aria-hidden="true">i</span>
          <span className="small">
            We heard this. Please check it and correct anything before using it.
          </span>
        </div>
      )}

      <div className="row row--tight">
        {!recording ? (
          <button type="button" className="btn btn--secondary" onClick={() => void startRecording()} disabled={busy}>
            🎤 Record
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              recorder?.stop();
            }}
          >
            ■ Stop recording
          </button>
        )}
        <button
          type="button"
          className="btn btn--primary grow"
          disabled={busy || !text.trim() || recording}
          onClick={() => void submit(text)}
        >
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          Fill in the form
        </button>
      </div>

      {recording && (
        <p className="small" role="status" style={{ color: 'var(--danger)', fontWeight: 650 }}>
          ● Recording — press stop when you are done
        </p>
      )}

      {customerChoices.length > 0 && (
        <div className="stack stack--tight">
          <span className="field__label">Which customer did you mean?</span>
          {customerChoices.map((c) => (
            <button key={c.id} type="button" className="btn btn--secondary" onClick={() => void submit(text, c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {questions.length > 0 && customerChoices.length === 0 && (
        <div className="notice notice--warn">
          <span className="notice__icon" aria-hidden="true">?</span>
          <div className="stack" style={{ gap: 4 }}>
            {questions.map((q) => <span key={q} className="small">{q}</span>)}
          </div>
        </div>
      )}

      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span className="small">{error}</span>
        </div>
      )}
    </section>
  );
}
