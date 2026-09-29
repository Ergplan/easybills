import Link from 'next/link';

import { Icon, type IconName } from '@/components/Icon';

/**
 * One thing the owner came to do, as a big card: an icon, what it is in their
 * words, and one line of where things stand. The whole card is the button.
 */
export function TaskCard({
  href,
  icon,
  title,
  sub,
  primary = false,
  testId,
}: {
  href: string;
  icon: IconName;
  title: string;
  sub?: React.ReactNode;
  primary?: boolean;
  testId?: string;
}) {
  return (
    <Link href={href} className={`task${primary ? ' task--primary' : ''}`} data-testid={testId}>
      <span className="task__icon" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <span className="task__text">
        <span className="task__title">{title}</span>
        {sub ? <span className="task__sub">{sub}</span> : null}
      </span>
      <Icon name="chevron" size={20} className="task__go" />
    </Link>
  );
}
