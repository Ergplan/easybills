import Link from 'next/link';

import { Icon } from './Icon';

export function TopBar({
  title,
  wideTitle,
  back,
  action,
  showProfile = true,
}: {
  title: string;
  /**
   * What the title says once the side rail is showing the business name.
   *
   * On a phone the top bar is the only place identity can live, so Home puts
   * the business name there. On a desktop the rail already says it, and
   * repeating it twice across the top of the same screen tells the owner
   * nothing they did not know a moment ago. Both are rendered; CSS shows one.
   */
  wideTitle?: string;
  back?: { href: string; label?: string };
  action?: React.ReactNode;
  showProfile?: boolean;
}) {
  return (
    <header className="topbar">
      {back && (
        <Link href={back.href} className="btn btn--ghost" aria-label={back.label ?? 'Go back'} style={{ paddingInline: 8 }}>
          <Icon name="back" size={20} />
        </Link>
      )}
      <h1 className="topbar__title truncate">
        {wideTitle && wideTitle !== title ? (
          <>
            <span className="only-compact">{title}</span>
            <span className="only-wide">{wideTitle}</span>
          </>
        ) : (
          title
        )}
      </h1>
      {action}
      {showProfile && (
        <Link href="/settings" className="btn btn--ghost" aria-label="Business settings" style={{ paddingInline: 10 }}>
          <Icon name="settings" size={20} />
          <span className="only-wide">Settings</span>
        </Link>
      )}
    </header>
  );
}
