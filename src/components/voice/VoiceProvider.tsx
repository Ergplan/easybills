'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { askAction } from '@/app/actions/ask';
import { startBillForCustomerAction } from '@/app/actions/invoices';
import { voiceContextAction, type VoiceContext } from '@/app/actions/voice';
import { resolveTarget, useGuide } from '@/components/guide/GuideProvider';
import { Icon } from '@/components/Icon';
import { t } from '@/lib/copy';
import { SCREEN_PURPOSE, screenOf, tourFor } from '@/lib/guide/tours';
import { linesFromSpeech, matchCustomer, PREFILL_KEY, whoOwesReply } from '@/lib/voice/intents';

type State = 'idle' | 'connecting' | 'live' | 'off' | 'error';

interface Turn {
  who: 'you' | 'app';
  text: string;
}

interface VoiceApi {
  state: State;
  enabled: boolean;
  note: string | null;
  turns: Turn[];
  start: () => void;
  stop: () => void;
}

const VoiceContextReact = createContext<VoiceApi | null>(null);
export const useVoice = () => useContext(VoiceContextReact);

const AUTO_KEY = 'ekbill.voice.auto';
const OFFERED_KEY = 'ekbill.voice.offered';

const SCREENS: Record<string, string> = {
  home: '/home',
  new_bill: '/bills/start',
  bills: '/bills',
  dues: '/dues',
  customers: '/customers',
  ask: '/ask',
  help: '/bills/help',
  you: '/you',
  gst: '/gst',
  upload: '/customers',
};

function store(kind: 'local' | 'session', key: string, value?: string): string | null {
  try {
    const s = kind === 'local' ? localStorage : sessionStorage;
    if (value !== undefined) s.setItem(key, value);
    return s.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Voice for the whole app, not one button on Home.
 *
 * One connection that survives moving between screens, so the owner can say
 * "Mehta ka bill banao", watch it open, and carry on talking. It is also the
 * guide: when a screen opens it is told what is on it, and it moves the ring
 * (GuideProvider) round each thing as it talks, fills fields from what the
 * owner says, and presses the safe buttons. Final actions stay the owner's tap.
 *
 * It starts by itself for an owner who has switched it on before; the first
 * time, a friendly one-tap offer, because browsers let a page use the
 * microphone and play sound only after a tap.
 */
export function VoiceProvider({ businessId, enabled, children }: { businessId: string; enabled: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const guide = useGuide();
  const [state, setState] = useState<State>(enabled ? 'idle' : 'off');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [offer, setOffer] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const pc = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const ctx = useRef<VoiceContext | null>(null);
  const speaking = useRef('');
  const openedByVoice = useRef<string | null>(null);
  const guideRef = useRef(guide);
  guideRef.current = guide;

  const send = useCallback((event: unknown) => {
    if (channel.current?.readyState === 'open') channel.current.send(JSON.stringify(event));
  }, []);

  const stop = useCallback(() => {
    channel.current?.close();
    pc.current?.getSenders().forEach((s) => s.track?.stop());
    pc.current?.close();
    channel.current = null;
    pc.current = null;
    delete document.documentElement.dataset.voice;
    guideRef.current?.setCaption(null);
    setNeedsTap(false);
    setState((s) => (s === 'off' ? 'off' : 'idle'));
  }, []);

  useEffect(() => () => stop(), [stop]);

  /** Tell the model what is on the screen now. */
  const describeScreen = useCallback(
    (reason: 'opened-by-owner' | 'opened-by-voice' | 'start') => {
      const g = guideRef.current;
      if (!g) return;
      const screen = screenOf(window.location.pathname);
      const items = g
        .snapshot()
        .slice(0, 45)
        .map((i) => `${i.id} | ${i.kind} | ${i.label}${i.value ? ` | value: ${i.value}` : ''}${i.ownerOnly ? ' | OWNER-ONLY' : ''}`)
        .join('\n');
      send({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: `[screen] ${screen} (${reason}). ${SCREEN_PURPOSE[screen]}\nItems (id | kind | label):\n${items || '(nothing to press)'}`,
            },
          ],
        },
      });
      return screen;
    },
    [send],
  );

  const refreshContext = useCallback(async () => {
    const r = await voiceContextAction(businessId);
    if (r.ok) ctx.current = r.data;
    return ctx.current;
  }, [businessId]);

  const navigate = useCallback(
    (href: string) => {
      openedByVoice.current = href.split('?')[0]!;
      router.push(href);
    },
    [router],
  );

  const runTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const g = guideRef.current;
      switch (name) {
        case 'who_owes': {
          const c = await refreshContext();
          return { reply: whoOwesReply(c?.due ?? []) };
        }
        case 'start_bill': {
          const c = ctx.current ?? (await refreshContext());
          const said = String(args.customer_name ?? '').trim();
          const customer = said ? matchCustomer(said, c?.customers ?? []) : null;
          if (said && !customer) return { ok: false, reply: t('voice.unknownCustomer', { name: said }) + '. Naya customer bana doon?' };
          const lines = linesFromSpeech(args.lines, () => crypto.randomUUID());
          const r = await startBillForCustomerAction(customer?.id ?? null);
          if (!r.ok) return { ok: false, reply: r.error };
          store('session', PREFILL_KEY(r.data.invoiceId), JSON.stringify({ lines, customerName: customer ? '' : said }));
          navigate(`/bills/${r.data.invoiceId}`);
          return { ok: true, reply: `${customer?.name ?? (said || 'Naya customer')} ka bill khul raha hai, ${lines.length} line ke saath. Screen aane pe check karwao, phir owner Bill banao dabaye.` };
        }
        case 'remind': {
          const c = await refreshContext();
          const said = String(args.customer_name ?? '');
          const customer = matchCustomer(said, c?.customers ?? []);
          const row = (c?.due ?? []).find((d) => (customer ? d.customerId === customer.id : matchCustomer(said, [{ id: 'x', name: d.customerName }])));
          if (!row) return { ok: false, reply: `${customer?.name ?? said} ke koi paise baaki nahi.` };
          navigate(`/bills/${row.invoiceId}/remind`);
          return { ok: true, reply: `${row.customerName} ka reminder khul raha hai. WhatsApp kholo owner dabayega.` };
        }
        case 'ask_records': {
          const question = String(args.question ?? '').trim();
          if (!question) return { ok: false, reply: 'Kya poochna hai?' };
          const r = await askAction(businessId, question);
          if (!r.ok) return { ok: false, reply: r.error };
          if (r.data.answer) return { ok: true, reply: r.data.answer.replace(/\s*\[\d+\]/g, '') };
          if (!r.data.sources.length) return { ok: true, reply: 'Records mein yeh nahi mila.' };
          navigate(`/ask?q=${encodeURIComponent(question)}`);
          return { ok: true, reply: 'Jo mila, screen pe dikha raha hoon.' };
        }
        case 'go_to':
        case 'open_screen': {
          const href = SCREENS[String(args.screen ?? 'home')] ?? '/home';
          if (href === window.location.pathname) return { ok: true, note: 'already on this screen' };
          navigate(href);
          return { ok: true, note: 'opening; the screen list follows' };
        }
        case 'show':
          return { ok: g ? g.showItem(String(args.item_id ?? ''), String(args.say ?? '')) : false };
        case 'fill':
          return g ? g.fill(String(args.item_id ?? ''), String(args.value ?? '')) : { ok: false };
        case 'tap':
          return g ? g.tap(String(args.item_id ?? '')) : { ok: false };
        case 'guide_steps': {
          const screen = screenOf(window.location.pathname);
          const steps = tourFor(screen).filter((s) => resolveTarget(s.target)).map((s) => s.say);
          return { steps };
        }
        default:
          return { ok: false, reply: 'Yeh nahi kar sakta.' };
      }
    },
    [businessId, navigate, refreshContext],
  );

  const onEvent = useCallback(
    async (raw: string) => {
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
        case 'response.output_audio_transcript.delta':
          speaking.current += ev.delta ?? '';
          guideRef.current?.setCaption(speaking.current);
          break;
        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done':
          speaking.current = '';
          if (ev.transcript) {
            setTurns((ts) => [...ts, { who: 'app' as const, text: ev.transcript! }].slice(-6));
            guideRef.current?.setCaption(ev.transcript);
          }
          break;
        case 'response.function_call_arguments.done': {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(ev.arguments ?? '{}');
          } catch {
            // Not JSON: no arguments.
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
    },
    [runTool, send],
  );

  const start = useCallback(async () => {
    if (!enabled) {
      setNote(t('voice.off'));
      return;
    }
    if (pc.current) return;
    setOffer(false);
    setNote(null);
    setState('connecting');
    try {
      void refreshContext();
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
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
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
        if (!audio.current) return;
        audio.current.srcObject = e.streams[0] ?? null;
        // Started without a tap (automatic on arrival): the browser may hold the sound back.
        audio.current.play().catch(() => setNeedsTap(true));
      };
      mic.getTracks().forEach((track) => peer.addTrack(track, mic));
      const dc = peer.createDataChannel('oai-events');
      channel.current = dc;
      dc.onmessage = (e) => void onEvent(String(e.data));
      dc.onopen = () => {
        setState('live');
        document.documentElement.dataset.voice = 'live';
        store('local', AUTO_KEY, 'on');
        store('session', OFFERED_KEY, '1');
        const screen = describeScreen('start');
        const name = ctx.current?.businessName ?? '';
        send({
          type: 'response.create',
          response: {
            instructions:
              screen === 'home'
                ? `Greet the owner warmly and briefly by name if it is a person's name (${name}), e.g. "Namaste ji! Haan ji, kaise help karein? Bill banana hai, paise dekhne hain, ya kuch poochna hai?" Then wait.`
                : 'Greet the owner in a few words, say in one sentence what this screen is for, and show() the first useful thing.',
          },
        });
      };
      dc.onclose = () => stop();

      const sdp = await peer.createOffer();
      await peer.setLocalDescription(sdp);
      const answer = await fetch(`${baseUrl}/v1/realtime/calls?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/sdp' },
        body: sdp.sdp,
      });
      if (!answer.ok) throw new Error(t('voice.failed'));
      await peer.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
    } catch (e) {
      stop();
      setNote(e instanceof Error ? e.message : t('voice.failed'));
      setState('error');
    }
  }, [enabled, describeScreen, onEvent, refreshContext, send, stop]);

  // Arrival: start by itself for an owner who switched voice on before;
  // offer it once per visit otherwise. Never in a browser driven by tests.
  useEffect(() => {
    if (!enabled || navigator.webdriver) return;
    if (store('session', OFFERED_KEY)) return;
    store('session', OFFERED_KEY, '1');
    if (store('local', AUTO_KEY) === 'on') void start();
    else if (store('local', AUTO_KEY) !== 'never') setOffer(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new screen while talking: tell the model what is on it.
  useEffect(() => {
    if (state !== 'live') return;
    const id = window.setTimeout(() => {
      const byVoice = openedByVoice.current === window.location.pathname;
      openedByVoice.current = null;
      describeScreen(byVoice ? 'opened-by-voice' : 'opened-by-owner');
      send({
        type: 'response.create',
        response: {
          instructions: byVoice
            ? 'The screen you opened is ready. Carry on with what the owner asked: show() the next thing to fill or tap and ask for it in one short question.'
            : 'The owner opened this screen. In one short sentence say what they can do here and show() the first useful thing.',
        },
      });
    }, 900);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const api: VoiceApi = { state, enabled, note, turns, start: () => void start(), stop };

  return (
    <VoiceContextReact.Provider value={api}>
      {children}
      <VoiceDock
        api={api}
        offer={offer}
        needsTap={needsTap}
        onAccept={() => void start()}
        onDecline={() => {
          setOffer(false);
          store('session', OFFERED_KEY, '1');
        }}
        onNever={() => {
          setOffer(false);
          store('local', AUTO_KEY, 'never');
        }}
        onUnmute={() => {
          audio.current?.play().then(() => setNeedsTap(false)).catch(() => undefined);
        }}
      />
    </VoiceContextReact.Provider>
  );
}

/** The voice, always within reach: a mic button, or while talking, what it is saying and "Bas". */
function VoiceDock({
  api,
  offer,
  needsTap,
  onAccept,
  onDecline,
  onNever,
  onUnmute,
}: {
  api: VoiceApi;
  offer: boolean;
  needsTap: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onNever: () => void;
  onUnmute: () => void;
}) {
  if (!api.enabled) return null;
  if (offer) {
    return (
      <div className="voice-offer" role="dialog" aria-label={t('voice.offer.title')}>
        <div className="voice-offer__icon" aria-hidden="true">
          <Icon name="mic" size={26} />
        </div>
        <div className="voice-offer__text">
          <strong>{t('voice.offer.title')}</strong>
          <span>{t('voice.offer.sub')}</span>
        </div>
        <div className="voice-offer__row">
          <button type="button" className="btn btn--primary" onClick={onAccept} data-testid="voice-accept">
            {t('voice.offer.yes')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onDecline}>
            {t('voice.offer.later')}
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={onNever}>
            {t('voice.offer.never')}
          </button>
        </div>
        <p className="voice-offer__note">{t('voice.consent')}</p>
      </div>
    );
  }
  const live = api.state === 'live';
  return (
    <div className={`voice-dock${live ? ' voice-dock--live' : ''}`}>
      {needsTap && (
        <button type="button" className="btn btn--primary btn--small" onClick={onUnmute}>
          {t('voice.unmute')}
        </button>
      )}
      {api.note && !live && <span className="voice-dock__note">{api.note}</span>}
      <button
        type="button"
        className="voice-dock__btn"
        aria-label={live ? t('voice.stop') : t('voice.button')}
        data-state={api.state}
        disabled={api.state === 'connecting'}
        onClick={() => (live ? api.stop() : api.start())}
      >
        {live ? (
          <span className="voice-dock__bars" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <Icon name="mic" size={24} />
        )}
        <span className="voice-dock__label">{live ? t('voice.stop') : api.state === 'connecting' ? t('voice.connecting') : t('voice.button')}</span>
      </button>
    </div>
  );
}
