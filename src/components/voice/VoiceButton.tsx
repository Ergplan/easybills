'use client';

import { t } from '@/lib/copy';

import { useVoice } from './VoiceProvider';

/** Home's "Bolke batana hai" card button: starts (or stops) the app-wide voice. */
export function VoiceButton() {
  const voice = useVoice();
  if (!voice) return null;
  const live = voice.state === 'live';
  return (
    <div className="voice">
      <div className="row row--tight">
        <button
          type="button"
          className={`btn ${live ? 'btn--danger' : 'btn--secondary'} voice__btn`}
          data-state={voice.state}
          disabled={voice.state === 'connecting'}
          onClick={() => (live ? voice.stop() : voice.start())}
        >
          <span className={`voice__dot${live ? ' voice__dot--live' : ''}`} aria-hidden="true" />
          {live ? t('voice.stop') : voice.state === 'connecting' ? t('voice.connecting') : t('voice.button')}
        </button>
        {live && <span className="faint">{t('voice.listening')}</span>}
      </div>
      {voice.note && voice.state !== 'live' && (
        <p className="small" style={{ color: voice.state === 'error' ? 'var(--danger)' : 'var(--ink-soft)' }}>{voice.note}</p>
      )}
      {voice.turns.length > 0 && (
        <div className="voice__log">
          {voice.turns.map((turn, i) => (
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
