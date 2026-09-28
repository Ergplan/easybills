'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { createCustomerAction } from '@/app/actions/customers';
import { prepareProjectBillAction, saveProjectAction } from '@/app/actions/projects';
import { t } from '@/lib/copy';
import { moneyForMessage } from '@/lib/copy/messages';
import {
  billedCumulativeBp,
  checkTerms,
  milestoneStatus,
  parseAmount,
  pctText,
  planMilestoneBill,
  planProgressBill,
  PRESETS,
  type BilledEntry,
  type ContractTerms,
  type ParsedContract,
} from '@/lib/domain/contract';

export interface ProjectSummary {
  id: string;
  name: string;
  totalPaise: number;
  billedPaise: number;
}

interface Props {
  businessId: string;
  customers: Array<{ id: string; name: string }>;
  customer: { id: string; name: string } | null;
  projects: ProjectSummary[];
  project: (ContractTerms & { id: string }) | null;
  entries: BilledEntry[];
  fromDraftId: string | null;
  chargesGst: boolean;
  ratesBp: number[];
  defaultRateBp: number | null;
  modelReader: boolean;
}

type Step =
  | 'customer'
  | 'project'
  | 'how'
  | 'text'
  | 'pdf'
  | 'total'
  | 'gst'
  | 'rate'
  | 'billing'
  | 'milestones'
  | 'retention'
  | 'name'
  | 'review'
  | 'bill';

interface Turn {
  who: 'app' | 'you';
  text: string;
}

let seq = 0;
const newMsId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * "Mera bill thoda complex hai, help karo."
 *
 * A short conversation that captures the deal once -- the contract value,
 * whether GST is on top or inside, instalments or running bills, retention
 * -- either one question at a time or read from what the owner types or
 * the contract PDF, and then works out each bill: the percentage, what was
 * billed before, what is left. The bill opens on the ordinary bill form and
 * is made only by the owner's own tap on Bill banao.
 */
export function HelpAgent(props: Props) {
  const router = useRouter();
  const blankTerms: ContractTerms = {
    name: '',
    totalPaise: 0,
    gstMode: props.chargesGst ? 'extra' : 'none',
    gstRateBp: props.chargesGst ? props.defaultRateBp : null,
    billing: 'milestones',
    milestones: [],
    retentionBp: 0,
  };
  const [terms, setTerms] = useState<ContractTerms>(props.project ?? blankTerms);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [source, setSource] = useState<'guided' | 'text' | 'pdf'>('guided');
  const [readBy, setReadBy] = useState<'model' | 'rules' | null>(null);
  const [step, setStep] = useState<Step>(
    props.project ? 'bill' : !props.customer ? 'customer' : props.projects.length ? 'project' : 'how',
  );
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [returnToReview, setReturnToReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-step inputs.
  const [newCustomer, setNewCustomer] = useState('');
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [otherPct, setOtherPct] = useState('');
  const [progressPct, setProgressPct] = useState('');
  const [chosenMs, setChosenMs] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [step, transcript.length]);

  const order: Step[] = ['total', ...(props.chargesGst ? (['gst', 'rate'] as Step[]) : []), 'billing', 'milestones', 'retention', 'name', 'review'];

  function questionFor(s: Step): string {
    switch (s) {
      case 'customer': return t('help.ask.customer');
      case 'project': return t('help.ask.project');
      case 'how': return t('help.ask.how');
      case 'text': return t('help.how.text');
      case 'pdf': return t('help.how.pdf');
      case 'total': return t('help.ask.total');
      case 'gst': return t('help.ask.gst');
      case 'rate': return t('help.ask.rate');
      case 'billing': return t('help.ask.billing');
      case 'milestones': return t('help.ask.milestones');
      case 'retention': return t('help.ask.retention');
      case 'name': return t('help.ask.name');
      case 'review': return t('help.review.title');
      case 'bill': return terms.billing === 'milestones' ? t('help.ask.which') : t('help.ask.progress');
    }
  }

  function nextAfter(s: Step, current: ContractTerms): Step {
    if (returnToReview) return 'review';
    let i = order.indexOf(s) + 1;
    while (i < order.length) {
      const candidate = order[i]!;
      if (candidate === 'milestones' && current.billing !== 'milestones') {
        i += 1;
        continue;
      }
      return candidate;
    }
    return 'review';
  }

  function answer(s: Step, said: string, next: Step) {
    setTranscript((ts) => [...ts, { who: 'app', text: questionFor(s) }, { who: 'you', text: said }]);
    setError(null);
    setStep(next);
  }

  function update(patch: Partial<ContractTerms>): ContractTerms {
    const nextTerms = { ...terms, ...patch };
    setTerms(nextTerms);
    return nextTerms;
  }

  function goToCustomer(id: string) {
    const q = new URLSearchParams({ customer: id });
    if (props.fromDraftId) q.set('from', props.fromDraftId);
    router.replace(`/bills/help?${q.toString()}`);
  }

  function goToProject(id: string) {
    const q = new URLSearchParams({ customer: props.customer!.id, project: id });
    if (props.fromDraftId) q.set('from', props.fromDraftId);
    router.replace(`/bills/help?${q.toString()}`);
  }

  // After reading typed terms or a PDF, fill what was found and ask the rest.
  function applyParsed(p: ParsedContract, by: 'model' | 'rules', from: 'text' | 'pdf') {
    setSource(from);
    setReadBy(by);
    if (!p.totalPaise) {
      setTranscript((ts) => [...ts, { who: 'app', text: t('help.notUnderstood') }]);
      setStep('total');
      return;
    }
    const filled: ContractTerms = {
      ...terms,
      name: p.name ?? terms.name,
      totalPaise: p.totalPaise,
      gstMode: props.chargesGst ? (p.gstMode === 'included' ? 'included' : p.gstMode === 'extra' ? 'extra' : terms.gstMode) : 'none',
      gstRateBp: props.chargesGst ? p.gstRateBp ?? terms.gstRateBp : null,
      billing: p.billing ?? terms.billing,
      milestones: p.milestones.map((m) => ({ id: newMsId(), label: m.label, pctBp: m.pctBp })),
      retentionBp: p.retentionBp ?? 0,
    };
    setTerms(filled);
    setTranscript((ts) => [...ts, { who: 'app', text: t('help.understood') }]);
    setReturnToReview(true);
    // Anything essential still missing is asked; the rest goes to review.
    if (props.chargesGst && p.gstMode !== 'extra' && p.gstMode !== 'included') setStep('gst');
    else if (!p.billing) setStep('billing');
    else if (filled.billing === 'milestones' && filled.milestones.reduce((s, m) => s + m.pctBp, 0) !== 10000) setStep('milestones');
    else if (!filled.name) setStep('name');
    else setStep('review');
  }

  async function readTerms(form: FormData, from: 'text' | 'pdf') {
    setBusy(true);
    setError(null);
    try {
      form.set('b', props.businessId);
      const res = await fetch('/api/help/contract', { method: 'POST', body: form });
      const body = (await res.json()) as { parsed?: ParsedContract; source?: 'model' | 'rules'; problem?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? t('error.generic'));
      if (body.problem || !body.parsed) {
        setError(t('help.pdf.none'));
        setStep('text');
        return;
      }
      applyParsed(body.parsed, body.source ?? 'rules', from);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  const sumBp = terms.milestones.reduce((s, m) => s + m.pctBp, 0);
  const plan = useMemo(() => {
    if (step !== 'bill' || !props.project) return null;
    if (terms.billing === 'milestones') return chosenMs ? planMilestoneBill(terms, chosenMs, props.entries) : null;
    const pct = Math.round(Number(progressPct) * 100);
    return pct > 0 ? planProgressBill(terms, pct, props.entries.filter((e) => e.status === 'issued')) : null;
  }, [step, terms, chosenMs, progressPct, props.entries, props.project]);

  const statuses = props.project && terms.billing === 'milestones' ? milestoneStatus(terms, props.entries) : [];
  useEffect(() => {
    if (step === 'bill' && terms.billing === 'milestones' && !chosenMs) {
      const first = statuses.find((s) => s.state !== 'billed');
      if (first) setChosenMs(first.milestone.id);
    }
  }, [step, terms.billing, chosenMs, statuses]);

  async function saveDeal() {
    const checked = checkTerms(terms, { chargesGst: props.chargesGst, allowedRatesBp: props.ratesBp });
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await saveProjectAction(props.businessId, {
      projectId: editingId ?? props.project?.id ?? null,
      customerId: props.customer!.id,
      terms: checked.terms,
      source,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    goToProject(r.data.projectId);
    setTranscript((ts) => [...ts, { who: 'app', text: t('help.saved') }]);
    setStep('bill');
  }

  async function prepareBill() {
    if (!plan || !plan.ok || !props.project) return;
    setBusy(true);
    setError(null);
    const r = await prepareProjectBillAction(props.businessId, {
      projectId: props.project.id,
      milestoneId: plan.bill.milestoneId,
      cumulativeBp: plan.bill.cumulativeBp,
      replaceDraftId: props.fromDraftId,
    });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    router.push(`/bills/${r.data.invoiceId}`);
  }

  const reviewRows: Array<{ step: Step; text: string }> = [
    { step: 'total', text: t('help.review.total', { amount: moneyForMessage(terms.totalPaise) }) },
    ...(props.chargesGst
      ? [
          {
            step: 'gst' as Step,
            text:
              terms.gstMode === 'included'
                ? t('help.review.gstIncluded', { rate: pctText(terms.gstRateBp ?? 0) })
                : t('help.review.gstExtra', { rate: pctText(terms.gstRateBp ?? 0) }),
          },
        ]
      : [{ step: 'total' as Step, text: t('help.review.noGst') }]),
    {
      step: terms.billing === 'milestones' ? 'milestones' : 'billing',
      text:
        terms.billing === 'milestones'
          ? terms.milestones.map((m) => `${m.label} ${pctText(m.pctBp)}%`).join(' · ')
          : t('help.review.progress'),
    },
    {
      step: 'retention',
      text: terms.retentionBp ? t('help.review.retention', { pct: pctText(terms.retentionBp) }) : t('help.review.noRetention'),
    },
    { step: 'name', text: terms.name || '—' },
  ];

  return (
    <div className="help stack">
      <div className="help__log">
        <div className="help__bubble help__bubble--app">{t('help.intro')}</div>
        {transcript.map((turn, i) => (
          <div key={i} className={`help__bubble help__bubble--${turn.who}`}>
            {turn.text}
          </div>
        ))}
        <div className="help__bubble help__bubble--app help__bubble--now">{questionFor(step)}</div>
      </div>

      <section className="card stack help__answer" aria-live="polite">
        {step === 'customer' && (
          <>
            <div className="chips">
              {props.customers.map((c) => (
                <button key={c.id} type="button" className="chip" onClick={() => goToCustomer(c.id)}>
                  <span className="chip__name">{c.name}</span>
                </button>
              ))}
            </div>
            <div className="row row--tight">
              <input
                id="help-new-customer"
                className="input grow"
                value={newCustomer}
                placeholder={t('home.bill.newCustomer')}
                onChange={(e) => setNewCustomer(e.target.value)}
                maxLength={200}
              />
              <button
                type="button"
                className="btn btn--secondary"
                disabled={busy || !newCustomer.trim()}
                onClick={async () => {
                  setBusy(true);
                  const r = await createCustomerAction(props.businessId, {
                    name: newCustomer,
                    phone: null,
                    email: null,
                    addressLine1: null,
                    addressLine2: null,
                    city: null,
                    pincode: null,
                    stateCode: null,
                    gstin: null,
                    pan: null,
                    notes: null,
                    contactPerson: null,
                    language: null,
                    languageSource: null,
                  });
                  setBusy(false);
                  if (!r.ok) return setError(r.error);
                  goToCustomer(r.data.id);
                }}
              >
                {t('common.next')}
              </button>
            </div>
          </>
        )}

        {step === 'project' && (
          <div className="chips">
            {props.projects.map((p) => (
              <button key={p.id} type="button" className="chip" onClick={() => goToProject(p.id)}>
                <span className="chip__name">
                  {p.name} · {t('help.progressLine', { billed: moneyForMessage(p.billedPaise), total: moneyForMessage(p.totalPaise) })}
                </span>
              </button>
            ))}
            <button type="button" className="chip chip--new" onClick={() => answer('project', t('help.newProject'), 'how')}>
              <span className="chip__initial" aria-hidden="true">+</span>
              <span className="chip__name">{t('help.newProject')}</span>
            </button>
          </div>
        )}

        {step === 'how' && (
          <div className="chips">
            <button type="button" className="chip" onClick={() => answer('how', t('help.how.guided'), 'total')}>
              <span className="chip__name">{t('help.how.guided')}</span>
            </button>
            <button type="button" className="chip" onClick={() => answer('how', t('help.how.text'), 'text')}>
              <span className="chip__name">{t('help.how.text')}</span>
            </button>
            <button type="button" className="chip" onClick={() => answer('how', t('help.how.pdf'), 'pdf')}>
              <span className="chip__name">{t('help.how.pdf')}</span>
            </button>
          </div>
        )}

        {step === 'text' && (
          <>
            <textarea
              id="help-text"
              className="textarea"
              rows={5}
              value={text}
              placeholder={t('help.text.placeholder')}
              onChange={(e) => setText(e.target.value)}
              maxLength={20000}
            />
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !text.trim()}
              onClick={() => {
                setTranscript((ts) => [...ts, { who: 'you', text: text.trim().slice(0, 400) }]);
                const form = new FormData();
                form.set('text', text);
                void readTerms(form, 'text');
              }}
            >
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {busy ? t('help.reading') : t('help.text.read')}
            </button>
          </>
        )}

        {step === 'pdf' && (
          <>
            <input
              ref={fileRef}
              id="help-pdf"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setTranscript((ts) => [...ts, { who: 'you', text: file.name }]);
                const form = new FormData();
                form.set('file', file);
                void readTerms(form, 'pdf');
              }}
            />
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {busy ? t('help.reading') : t('help.pdf.pick')}
            </button>
          </>
        )}

        {step === 'total' && (
          <form
            className="stack stack--tight"
            onSubmit={(e) => {
              e.preventDefault();
              const paise = parseAmount(amount);
              if (!paise) return setError(t('help.error.total'));
              const next = update({ totalPaise: paise });
              answer('total', moneyForMessage(paise), nextAfter('total', next));
            }}
          >
            <input
              id="help-total"
              className="input"
              value={amount}
              autoFocus
              inputMode="text"
              placeholder="5 lakh"
              onChange={(e) => setAmount(e.target.value)}
            />
            <span className="field__hint">
              {parseAmount(amount) ? `= ${moneyForMessage(parseAmount(amount)!)}` : t('help.total.hint')}
            </span>
            <button type="submit" className="btn btn--primary" disabled={!amount.trim()}>{t('common.next')}</button>
          </form>
        )}

        {step === 'gst' && (
          <div className="chips">
            {(['extra', 'included'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className="chip"
                onClick={() => {
                  const next = update({ gstMode: mode });
                  answer('gst', mode === 'extra' ? t('help.gst.extra') : t('help.gst.included'), next.gstRateBp && returnToReview ? 'review' : nextAfter('gst', next));
                }}
              >
                <span className="chip__name">{mode === 'extra' ? t('help.gst.extra') : t('help.gst.included')}</span>
              </button>
            ))}
          </div>
        )}

        {step === 'rate' && (
          <div className="chips">
            {props.ratesBp.filter((r) => r > 0).map((r) => (
              <button
                key={r}
                type="button"
                className="chip"
                aria-pressed={terms.gstRateBp === r}
                onClick={() => {
                  const next = update({ gstRateBp: r });
                  answer('rate', `${pctText(r)}%`, nextAfter('rate', next));
                }}
              >
                <span className="chip__name">{pctText(r)}%</span>
              </button>
            ))}
          </div>
        )}

        {step === 'billing' && (
          <div className="stack stack--tight">
            {(['milestones', 'progress'] as const).map((b) => (
              <button
                key={b}
                type="button"
                className="btn btn--secondary help__choice"
                onClick={() => {
                  const next = update({ billing: b });
                  const target = b === 'milestones' && (!returnToReview || next.milestones.length === 0) ? 'milestones' : nextAfter('billing', next);
                  answer('billing', b === 'milestones' ? t('help.billing.milestones') : t('help.billing.progress'), target);
                }}
              >
                <strong>{b === 'milestones' ? t('help.billing.milestones') : t('help.billing.progress')}</strong>
                <span className="faint">{b === 'milestones' ? t('help.billing.milestonesHint') : t('help.billing.progressHint')}</span>
              </button>
            ))}
          </div>
        )}

        {step === 'milestones' && (
          <>
            <div className="chips">
              {Object.entries(PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  className="chip"
                  onClick={() => update({ milestones: preset.map((m) => ({ id: newMsId(), ...m })) })}
                >
                  <span className="chip__name">{key.replace(/-/g, ' · ')}</span>
                </button>
              ))}
              <button type="button" className="chip" onClick={() => update({ milestones: [{ id: newMsId(), label: '', pctBp: 0 }] })}>
                <span className="chip__name">{t('help.preset.custom')}</span>
              </button>
            </div>
            {terms.milestones.map((m, i) => (
              <div key={m.id} className="help__ms">
                <input
                  className="input"
                  aria-label={`${t('help.ms.label')} ${i + 1}`}
                  id={`ms-label-${i}`}
                  value={m.label}
                  placeholder={`${t('help.ms.label')} ${i + 1}`}
                  onChange={(e) => update({ milestones: terms.milestones.map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)) })}
                  maxLength={80}
                />
                <input
                  className="input input--numeric"
                  aria-label={t('help.ms.pct')}
                  id={`ms-pct-${i}`}
                  inputMode="decimal"
                  value={m.pctBp ? pctText(m.pctBp) : ''}
                  placeholder="%"
                  onChange={(e) => {
                    const v = Math.round(Number(e.target.value.replace(/[^\d.]/g, '')) * 100);
                    update({ milestones: terms.milestones.map((x) => (x.id === m.id ? { ...x, pctBp: Number.isFinite(v) ? v : 0 } : x)) });
                  }}
                />
                <button
                  type="button"
                  className="btn btn--ghost"
                  aria-label={t('common.remove')}
                  onClick={() => update({ milestones: terms.milestones.filter((x) => x.id !== m.id) })}
                >
                  ×
                </button>
              </div>
            ))}
            {terms.milestones.length > 0 && (
              <div className="row row--between">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => update({ milestones: [...terms.milestones, { id: newMsId(), label: '', pctBp: Math.max(0, 10000 - sumBp) }] })}
                >
                  {t('help.ms.add')}
                </button>
                <span className={sumBp === 10000 ? 'faint' : 'field__error'}>{t('help.ms.sum', { sum: pctText(sumBp) })}</span>
              </div>
            )}
            <button
              type="button"
              className="btn btn--primary"
              disabled={sumBp !== 10000 || terms.milestones.some((m) => !m.label.trim())}
              onClick={() => answer('milestones', terms.milestones.map((m) => `${m.label} ${pctText(m.pctBp)}%`).join(', '), nextAfter('milestones', terms))}
            >
              {t('help.ms.continue')}
            </button>
          </>
        )}

        {step === 'retention' && (
          <>
            <div className="chips">
              {[0, 500, 1000].map((bp) => (
                <button
                  key={bp}
                  type="button"
                  className="chip"
                  onClick={() => {
                    const next = update({ retentionBp: bp });
                    answer('retention', bp ? `${pctText(bp)}%` : t('help.retention.none'), nextAfter('retention', next));
                  }}
                >
                  <span className="chip__name">{bp ? `${pctText(bp)}%` : t('help.retention.none')}</span>
                </button>
              ))}
            </div>
            <div className="row row--tight">
              <input
                id="help-retention"
                className="input input--numeric grow"
                inputMode="decimal"
                placeholder={t('help.retention.other')}
                value={otherPct}
                onChange={(e) => setOtherPct(e.target.value.replace(/[^\d.]/g, ''))}
              />
              <button
                type="button"
                className="btn btn--secondary"
                disabled={!otherPct}
                onClick={() => {
                  const bp = Math.round(Number(otherPct) * 100);
                  if (!(bp > 0 && bp <= 2500)) return setError(t('help.error.pct'));
                  const next = update({ retentionBp: bp });
                  answer('retention', `${pctText(bp)}%`, nextAfter('retention', next));
                }}
              >
                {t('common.next')}
              </button>
            </div>
          </>
        )}

        {step === 'name' && (
          <form
            className="stack stack--tight"
            onSubmit={(e) => {
              e.preventDefault();
              if (!terms.name.trim()) return setError(t('error.required'));
              answer('name', terms.name.trim(), 'review');
            }}
          >
            <input
              id="help-name"
              className="input"
              value={terms.name}
              autoFocus
              placeholder="Lift renovation"
              onChange={(e) => update({ name: e.target.value })}
              maxLength={120}
            />
            <span className="field__hint">{t('help.name.hint')}</span>
            <button type="submit" className="btn btn--primary" disabled={!terms.name.trim()}>{t('common.next')}</button>
          </form>
        )}

        {step === 'review' && (
          <>
            {readBy && <span className="faint">{readBy === 'model' ? t('help.source.model') : t('help.source.rules')}</span>}
            <div className="rows">
              {reviewRows.map((row, i) => (
                <div key={i} className="row-line">
                  <div className="row-line__link">
                    <div className="row-line__name">{row.text}</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => {
                      setReturnToReview(true);
                      if (row.step === 'total') setAmount(terms.totalPaise ? String(terms.totalPaise / 100) : '');
                      setStep(row.step);
                    }}
                  >
                    {t('help.change')}
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn--primary btn--block btn--large" disabled={busy} onClick={() => void saveDeal()}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {t('help.saveDeal')}
            </button>
          </>
        )}

        {step === 'bill' && props.project && (
          <>
            {terms.billing === 'milestones' ? (
              statuses.every((s) => s.state === 'billed') ? (
                <p className="muted">{t('help.allBilled')}</p>
              ) : (
                <div className="rows">
                  {statuses.map((s) => (
                    <label key={s.milestone.id} className="row-line help__ms-row">
                      <input
                        type="radio"
                        name="help-ms"
                        disabled={s.state === 'billed'}
                        checked={chosenMs === s.milestone.id}
                        onChange={() => setChosenMs(s.milestone.id)}
                      />
                      <div className="row-line__link">
                        <div className="row-line__name">
                          {s.milestone.label} · {pctText(s.milestone.pctBp)}%
                        </div>
                        <div className="row-line__meta">
                          {s.state === 'billed'
                            ? t('help.ms.billed', { number: s.entry?.number ?? '' })
                            : s.state === 'draft'
                              ? t('help.ms.inDraft')
                              : t('help.ms.pending')}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )
            ) : (
              <div className="field">
                <input
                  id="help-progress"
                  className="input input--numeric"
                  inputMode="decimal"
                  value={progressPct}
                  placeholder="%"
                  onChange={(e) => setProgressPct(e.target.value.replace(/[^\d.]/g, ''))}
                />
                <span className="field__hint">{t('help.progress.hint', { pct: pctText(billedCumulativeBp(terms, props.entries)) })}</span>
              </div>
            )}

            {plan && !plan.ok && <span className="field__error" role="alert">{plan.message}</span>}
            {plan && plan.ok && (
              <div className="help__working">
                <span className="field__label">{t('help.calc.title')}</span>
                {plan.bill.working.map((line, i) => (
                  <div key={i} className={i === 0 ? 'help__working-main' : 'small'}>{line}</div>
                ))}
              </div>
            )}

            <button type="button" className="btn btn--primary btn--block btn--large" disabled={busy || !plan || !plan.ok} onClick={() => void prepareBill()}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {t('help.makeBill')}
            </button>
            <p className="faint" style={{ textAlign: 'center' }}>{t('help.makeBillNote')}</p>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              style={{ alignSelf: 'center' }}
              onClick={() => {
                setEditingId(props.project!.id);
                setReturnToReview(true);
                setStep('review');
              }}
            >
              {t('help.change')}: {t('help.review.title')}
            </button>
          </>
        )}

        {error && (
          <div className="notice notice--danger" role="alert">
            <span className="notice__icon" aria-hidden="true">!</span>
            <span className="small">{error}</span>
          </div>
        )}
        {props.modelReader && (step === 'text' || step === 'pdf') && <span className="faint">{t('help.source.model')}</span>}
      </section>
      <div ref={endRef} />
    </div>
  );
}
