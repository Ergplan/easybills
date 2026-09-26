'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { startBillForCustomerAction } from '@/app/actions/invoices';
import { t } from '@/lib/copy';
import { linesFromSpeech, matchCustomer, PREFILL_KEY, whoOwesReply } from '@/lib/voice/intents';
import type { VoiceCustomer, VoiceDue } from '@/lib/voice/session';

interface Props {
  businessId: string;
  enabled: boolean;
  customers: VoiceCustomer[];
  /** Unpaid bills, for "kiske paise aane hain" and for "yaad dilao". */
  due: Array<VoiceDue & { invoiceId: string; customerId: string | null }>;
}

type State = 'idle' | 'connecting' | 'listening' | 'off' | 'error';

interface Turn {
  who: 'you' | 'app';
  text: string;
}

/**
 * "Bolke karo." One button; hold a conversation with the app.
 *
 * The browser opens a WebRTC connection straight to OpenAI's Realtime API
 * with a ten-minute secret the server minted, sends the microphone, and
 * plays the reply. The model's tool calls come back on a data channel and
 * are carried out here: a bill opens with its lines filled in, the due list
 * is read out, a reminder opens. Nothing is issued or sent by voice; the
 * owner's tap does that, on a screen they can see.
 */
export function VoiceButton({ businessId, enabled, customers, due }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>(enabled ? 'idle' : 'off');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  const pc = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => stop(), []);

  function stop() {
    channel.current?.close();
    pc.current?.getSenders().forEach((s) => s.track?.stop());
    pc.current?.close();
    channel.current = null;
    pc.current = null;
    setState((s) => (s === 'off' ? 'off' : 'idle'));
  }

  function send(event: unknown) {
    if (channel.current?.readyState === 'open') channel.current.send(JSON.stringify(event));
  }

  async function runTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (name) {
      case 'who_owes':
        return { reply: whoOwesReply(due) };
      case 'start_bill': {
        const said = String(args.customer_name ?? '').trim();
        const customer = said ? matchCustomer(said, customers) : null;
        if (said && !customer) return { ok: false, reply: t('voice.unknownCustomer', { name: said }) + '. Naya customer bana doon?' };
        const lines = linesFromSpeech(args.lines, () => crypto.randomUUID());
        setNote(t('voice.opening'));
        const r = await startBillForCustomerAction(customer?.id ?? null);
        if (!r.ok) return { ok: false, reply: r.error };
        try {
          sessionStorage.setItem(PREFILL_KEY(r.data.invoiceId), JSON.stringify({ lines, customerName: customer ? '' : said }));
        } catch {
          // No storage: the bill still opens, empty.
        }
        stop();
        router.push(`/bills/${r.data.invoiceId}`);
        return { ok: true, reply: `${customer?.name ?? (said || 'Naya customer')} ka bill khul gaya, ${lines.length} line ke saath. Dekh ke Bill banao dabao.` };
      }
      case 'remind': {
        const said = String(args.customer_name ?? '');
        const customer = matchCustomer(said, customers);
        const row = due.find((d) => (customer ? d.customerId === customer.id : matchCustomer(said, [{ id: 'x', name: d.customerName }])));
        if (!row) return { ok: false, reply: `${customer?.name ?? said} ke koi paise baaki nahi.` };
        stop();
        router.push(`/bills/${row.invoiceId}/remind`);
        return { ok: true, reply: `${row.customerName} ka reminder khul gaya. WhatsApp kholo dabao.` };
      }
      case 'open_screen': {
        const screen = String(args.screen ?? 'home');
        const href = { home: '/home', gst: '/gst', customers: '/customers', bills: '/bills' }[screen] ?? '/home';
        stop();
        router.push(href);
        return { ok: true };
      }
      default:
        return { ok: false, reply: 'Yeh nahi kar sakta.' };
    }
  }

  async function onEvent(raw: string) {
    let ev: { type?: string; transcript?: string; name?: string; call_id?: string; arguments?: string; delta?: string; error?: { message?: string } };
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    switch (ev.type) {
      case 'conversation.item.input_audio_transcription.completed':
        if (ev.transcript) setTurns((ts) => [...ts, { who: 'you' as const, text: ev.transcript! }].slice(-6));
        break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (ev.transcript) setTurns((ts) => [...ts, { who: 'app' as const, text: ev.transcript! }].slice(-6));
        break;
      case 'response.function_call_arguments.done': {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(ev.arguments ?? '{}');
        } catch {
          // The model sent something that is not JSON; treat as no arguments.
        }
        const output = await runTool(ev.name ?? '', args);
        send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: JSON.stringify(output) } });
        send({ type: 'response.create' });
        break;
      }
      case 'error':
        setNote(ev.error?.message ?? t('voice.failed'));
        break;
      default:
        break;
    }
  }

  async function start() {
    setNote(null);
    setState('connecting');
    try {
      const res = await fetch('/api/voice/session', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setNote(body.error ?? t('voice.failed'));
        setState(res.status === 503 ? 'off' : 'error');
        return;
      }
      const { secret, model, baseUrl } = (await res.json()) as { secret: string; model: string; baseUrl: string };

      let mic: MediaStream;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setNote(t('voice.noMic'));
        setState('error');
        return;
      }

      const peer = new RTCPeerConnection();
      pc.current = peer;
      if (!audio.current) {
        audio.current = document.createElement('audio');
        audio.current.autoplay = true;
      }
      peer.ontrack = (e) => {
        if (audio.current) audio.current.srcObject = e.streams[0] ?? null;
      };
      mic.getTracks().forEach((track) => peer.addTrack(track, mic));
      const dc = peer.createDataChannel('oai-events');
      channel.current = dc;
      dc.onmessage = (e) => void onEvent(String(e.data));
      dc.onopen = () => setState('listening');
      dc.onclose = () => setState((s) => (s === 'off' ? 'off' : 'idle'));

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const answer = await fetch(`${baseUrl}/v1/realtime/calls?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/sdp' },
        body: offer.sdp,
      });
      if (!answer.ok) throw new Error(t('voice.failed'));
      await peer.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
    } catch (e) {
      stop();
      setNote(e instanceof Error ? e.message : t('voice.failed'));
      setState('error');
    }
  }

  const live = state === 'listening' || state === 'connecting';

  return (
    <div className="voice">
      <div className="row row--tight">
        <button
          type="button"
          className={`btn ${live ? 'btn--danger' : 'btn--secondary'} voice__btn`}
          data-state={state}
          disabled={state === 'connecting'}
          onClick={() => {
            if (live) return stop();
            if (state === 'off') {
              setNote(t('voice.off'));
              return;
            }
            if (!consented) {
              setConsented(true);
              setNote(t('voice.consent'));
              return;
            }
            void start();
          }}
        >
          <span className={`voice__dot${state === 'listening' ? ' voice__dot--live' : ''}`} aria-hidden="true" />
          {state === 'listening' ? t('voice.stop') : state === 'connecting' ? t('voice.connecting') : t('voice.button')}
        </button>
        {state === 'listening' && <span className="faint">{t('voice.listening')}</span>}
        {consented && state === 'idle' && !note && <span className="faint">{t('voice.hint')}</span>}
      </div>
      {note && (
        <p className="small" style={{ color: state === 'error' ? 'var(--danger)' : 'var(--ink-soft)' }}>
          {note}
          {consented && state === 'idle' && note === t('voice.consent') && (
            <>
              {' '}
              <button type="button" className="btn btn--ghost btn--small" onClick={() => void start()}>{t('common.ok')}</button>
            </>
          )}
        </p>
      )}
      {turns.length > 0 && (
        <div className="voice__log">
          {turns.map((turn, i) => (
            <div key={i} className={`msg voice__turn voice__turn--${turn.who}`}>
              <span className="faint">{turn.who === 'you' ? t('voice.you') : t('voice.app')}: </span>
              {turn.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
