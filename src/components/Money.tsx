import { formatMoneyIndian } from '@/lib/money';

/**
 * One component for every rupee amount on screen, so grouping, the symbol and
 * tabular alignment are identical everywhere.
 */
export function Money({
  paise,
  big = false,
  symbol = true,
  whole = false,
  className = '',
}: {
  paise: number;
  big?: boolean;
  symbol?: boolean;
  /**
   * Drop the ".00" when there are no paise. Right on Home, where the figure
   * is read at a glance; wrong on a bill or a ledger, where the paise column
   * lining up is the point.
   */
  whole?: boolean;
  className?: string;
}) {
  const text = formatMoneyIndian(paise, { withSymbol: symbol });
  return (
    <span className={`amount${big ? ' amount--big' : ''}${className ? ` ${className}` : ''}`}>
      {whole && text.endsWith('.00') ? text.slice(0, -3) : text}
    </span>
  );
}

export function StatusPill({ status }: { status: 'draft' | 'unpaid' | 'partly-paid' | 'paid' | 'cancelled' }) {
  const map = {
    draft: { cls: 'pill--draft', label: 'Draft' },
    unpaid: { cls: 'pill--unpaid', label: 'Unpaid' },
    'partly-paid': { cls: 'pill--partly', label: 'Part paid' },
    paid: { cls: 'pill--paid', label: 'Paid' },
    cancelled: { cls: 'pill--draft', label: 'Cancelled' },
  } as const;
  const { cls, label } = map[status];
  return <span className={`pill ${cls}`}>{label}</span>;
}
