import { BackButton } from './BackButton';
import { GuideButton } from './guide/GuideButton';

/**
 * The one header every screen but Ghar wears: back to where you came from,
 * what this screen is (and a line under it when that helps), and "?" for the
 * screen's guided tour. Nothing else, so it reads the same everywhere.
 */
export function TopBar({
  title,
  wideTitle,
  sub,
  back,
  action,
}: {
  title: string;
  /** What the title says once the side rail is showing the business name. */
  wideTitle?: string;
  /** One quiet line under the title: a bill number, a customer. */
  sub?: React.ReactNode;
  back?: { href: string; label?: string };
  action?: React.ReactNode;
  /** @deprecated The settings gear is gone; Aap holds the owner's details. */
  showProfile?: boolean;
}) {
  return (
    <header className="topbar">
      {back && <BackButton fallback={back.href} label={back.label} />}
      <div className="topbar__head">
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
        {sub ? <div className="topbar__sub">{sub}</div> : null}
      </div>
      {action}
      <GuideButton />
    </header>
  );
}
