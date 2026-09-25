import Link from 'next/link';

export function TopBar({
  title,
  back,
  action,
  showProfile = true,
}: {
  title: string;
  back?: { href: string; label?: string };
  action?: React.ReactNode;
  showProfile?: boolean;
}) {
  return (
    <header className="topbar">
      {back && (
        <Link href={back.href} className="btn btn--ghost" aria-label={back.label ?? 'Go back'} style={{ paddingInline: 8 }}>
          <span aria-hidden="true">←</span>
        </Link>
      )}
      <h1 className="topbar__title truncate">{title}</h1>
      {action}
      {showProfile && (
        <Link href="/settings" className="btn btn--ghost" aria-label="Business settings" style={{ paddingInline: 8 }}>
          <span aria-hidden="true" style={{ fontSize: '1.2rem' }}>⚙</span>
        </Link>
      )}
    </header>
  );
}
