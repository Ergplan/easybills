'use client';

import { useState } from 'react';

import type { SavedItemRecord } from '@/lib/domain/types';
import { formatMoneyIndian, formatPercentPlain } from '@/lib/money';

import { emptyLine, type LineDraft } from './types';

/**
 * Item entry.
 *
 * Deliberate choices here:
 *  - quantity defaults to 1, so the common case is one tap less;
 *  - amount fields open a numeric keypad (inputMode="decimal");
 *  - saved items appear as one-tap chips above the first empty line;
 *  - an item is only added to the catalogue through an explicit
 *    "Save for next time" tick, and reusing a saved price is shown, not hidden;
 *  - discount, unit and HSN live behind the line's own "More" toggle, because
 *    most bills never need them.
 */
export function LineItems({
  lines,
  savedItems,
  chargesGst,
  selectableRatesBp,
  defaultTaxRateBp,
  onChange,
}: {
  lines: LineDraft[];
  savedItems: SavedItemRecord[];
  chargesGst: boolean;
  selectableRatesBp: number[];
  defaultTaxRateBp: number | null;
  onChange: (lines: LineDraft[]) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Any edit by the owner means the line is theirs now, not a proposal.
  const update = (id: string, patch: Partial<LineDraft>) =>
    onChange(lines.map((l) => (l.id === id ? { ...l, ...patch, proposed: false } : l)));

  const remove = (id: string) => {
    const next = lines.filter((l) => l.id !== id);
    onChange(next.length ? next : [emptyLine(defaultTaxRateBp ? formatPercentPlain(defaultTaxRateBp) : '')]);
  };

  const addSaved = (item: SavedItemRecord) => {
    const fresh: LineDraft = {
      ...emptyLine(),
      description: item.description,
      unitPrice: (item.unitPricePaise / 100).toFixed(2),
      unit: item.unit ?? '',
      hsnCode: item.hsnCode ?? '',
      taxRate: item.taxRateBp !== null ? formatPercentPlain(item.taxRateBp) : '',
      savedItemId: item.id,
    };
    // Fill the first blank line rather than appending below it.
    const blankIndex = lines.findIndex((l) => !l.description.trim() && !l.unitPrice.trim());
    if (blankIndex >= 0) {
      const next = [...lines];
      next[blankIndex] = { ...fresh, id: lines[blankIndex]!.id };
      onChange(next);
    } else {
      onChange([...lines, fresh]);
    }
  };

  const lineTotal = (l: LineDraft): number => {
    const qty = Number(l.quantity || '1');
    const price = Number(l.unitPrice || '0');
    const disc = Number(l.discount || '0');
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0;
    return Math.round(Math.max(0, qty * price - (Number.isFinite(disc) ? disc : 0)) * 100);
  };

  return (
    <div className="stack">
      {savedItems.length > 0 && (
        <div className="stack stack--tight">
          <span className="field__label">Your saved items</span>
          <div className="row row--tight" style={{ overflowX: 'auto', paddingBottom: 4 }}>
            {savedItems.slice(0, 8).map((item) => (
              <button
                key={item.id}
                type="button"
                className="btn btn--secondary"
                style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}
                onClick={() => addSaved(item)}
              >
                {item.description} · {formatMoneyIndian(item.unitPricePaise, { withSymbol: true })}
              </button>
            ))}
          </div>
        </div>
      )}

      {lines.map((l, index) => (
        <div key={l.id} className={`line-item stack stack--tight${l.proposed ? ' line-item--proposed' : ''}`}>
          {l.proposed && (
            <span className="pill pill--info" style={{ alignSelf: 'flex-start' }}>
              We filled this in — please check it
            </span>
          )}
          <div className="field">
            <label className="field__label" htmlFor={`desc-${l.id}`}>
              Item {index + 1}
            </label>
            <input
              id={`desc-${l.id}`}
              className="input"
              value={l.description}
              onChange={(e) => update(l.id, { description: e.target.value, savedItemId: null })}
              placeholder="What are you billing for?"
              autoComplete="off"
            />
          </div>

          <div className="line-item__grid">
            <div className="field">
              <label className="field__label" htmlFor={`qty-${l.id}`}>Quantity</label>
              <input
                id={`qty-${l.id}`}
                className="input input--numeric"
                inputMode="decimal"
                value={l.quantity}
                onChange={(e) => update(l.id, { quantity: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor={`price-${l.id}`}>Price each (₹)</label>
              <input
                id={`price-${l.id}`}
                className="input input--numeric"
                inputMode="decimal"
                value={l.unitPrice}
                onChange={(e) => update(l.id, { unitPrice: e.target.value, savedItemId: null })}
                placeholder="0.00"
                aria-invalid={l.priceMissing && !l.unitPrice ? true : undefined}
              />
              {l.priceMissing && !l.unitPrice && (
                <span className="field__error">You did not say a price for this — please add it.</span>
              )}
            </div>
          </div>

          {chargesGst && (
            <div className="field">
              <label className="field__label" htmlFor={`rate-${l.id}`}>GST rate</label>
              <select
                id={`rate-${l.id}`}
                className="select"
                value={l.taxRate}
                onChange={(e) => update(l.id, { taxRate: e.target.value })}
              >
                <option value="">Choose a rate</option>
                {selectableRatesBp.map((bp) => (
                  <option key={bp} value={formatPercentPlain(bp)}>{formatPercentPlain(bp)}%</option>
                ))}
              </select>
              {!l.taxRate && (
                <span className="field__hint">
                  We do not guess the rate. Please choose the one that applies to this item.
                </span>
              )}
            </div>
          )}

          {l.savedItemId && (
            <p className="tiny muted">Using your saved price. Changing it here will not change the saved item.</p>
          )}

          <div className="line-item__total">
            <button
              type="button"
              className="btn btn--ghost"
              style={{ paddingInline: 8, fontSize: '0.875rem' }}
              aria-expanded={Boolean(expanded[l.id])}
              onClick={() => setExpanded((p) => ({ ...p, [l.id]: !p[l.id] }))}
            >
              {expanded[l.id] ? 'Fewer options' : 'More'}
            </button>
            <span className="amount">{formatMoneyIndian(lineTotal(l), { withSymbol: true })}</span>
          </div>

          {expanded[l.id] && (
            <div className="stack stack--tight" style={{ paddingTop: 8, borderTop: '1px dashed var(--line)' }}>
              <div className="line-item__grid">
                <div className="field">
                  <label className="field__label" htmlFor={`disc-${l.id}`}>Discount (₹)</label>
                  <input
                    id={`disc-${l.id}`}
                    className="input input--numeric"
                    inputMode="decimal"
                    value={l.discount}
                    onChange={(e) => update(l.id, { discount: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`unit-${l.id}`}>Unit</label>
                  <input
                    id={`unit-${l.id}`}
                    className="input"
                    value={l.unit}
                    onChange={(e) => update(l.id, { unit: e.target.value })}
                    placeholder="hour, kg, visit"
                  />
                </div>
              </div>

              {chargesGst && (
                <>
                  <div className="field">
                    <label className="field__label" htmlFor={`hsn-${l.id}`}>HSN / SAC code</label>
                    <input
                      id={`hsn-${l.id}`}
                      className="input"
                      value={l.hsnCode}
                      maxLength={10}
                      inputMode="numeric"
                      onChange={(e) => update(l.id, { hsnCode: e.target.value })}
                    />
                  </div>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={l.priceIncludesTax}
                      onChange={(e) => update(l.id, { priceIncludesTax: e.target.checked })}
                    />
                    <span className="small">The price above already includes GST</span>
                  </label>
                </>
              )}

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={l.saveForNextTime}
                  onChange={(e) => update(l.id, { saveForNextTime: e.target.checked })}
                />
                <span className="small">Save this item for next time</span>
              </label>

              {lines.length > 1 && (
                <button type="button" className="btn btn--danger" onClick={() => remove(l.id)}>
                  Remove this item
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        className="btn btn--secondary btn--block"
        onClick={() => onChange([...lines, emptyLine(defaultTaxRateBp ? formatPercentPlain(defaultTaxRateBp) : '')])}
      >
        + Add another item
      </button>
    </div>
  );
}
