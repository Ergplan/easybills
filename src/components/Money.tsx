import { formatMoneyIndian } from '@/lib/money';

/**
 * One component for every rupee amount on screen, so grouping, the symbol and
 * tabular alignment are identical everywhere.
 */
export function Money({
  paise,
  big = false,
  symbol = true,
  className = '',
}: {
  paise: number;
  big?: boolean;
  symbol?: boolean;
  className?: string;
}) {
  return (
    <span className={`amount${big ? ' amount--big' : ''}${className ? ` ${className}` : ''}`}>
      {formatMoneyIndian(paise, { withSymbol: symbol })}
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
