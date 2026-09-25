'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Icon, type IconName } from './Icon';

/**
 * Exactly three destinations. Business settings live behind the profile icon in
 * the top bar, not here -- adding a fourth tab is the first step towards the
 * crowded app this product is trying not to be.
 *
 * One list, rendered twice: along the bottom on a phone, down the side on a
 * desktop. Only one is ever visible -- CSS decides which -- so the two cannot
 * drift apart or offer a destination the other does not have. The hidden one is
 * `display: none`, which takes it out of the accessibility tree as well as the
 * picture, so a keyboard or a screen reader meets three destinations, not six.
 */
const TABS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/home', label: 'Home', icon: 'home' },
  { href: '/bills', label: 'Bills', icon: 'bills' },
  { href: '/customers', label: 'Customers', icon: 'customers' },
];

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

export function TabBar() {
  const isActive = useActive();
  return (
    <nav className="tabbar" aria-label="Main" data-nav="compact">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className="tabbar__item"
          aria-current={isActive(tab.href) ? 'page' : undefined}
        >
          <Icon name={tab.icon} size={22} className="tabbar__icon" />
          <span>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * The same three destinations, down the side, for a window wide enough that a
 * bar across the bottom would be a long way from where the eye already is.
 */
export function SideNav({ businessName }: { businessName: string }) {
  const isActive = useActive();
  return (
    <div className="sidenav" data-nav="wide">
      <div className="sidenav__brand">
        <span className="sidenav__name" title={businessName}>
          {businessName}
        </span>
      </div>
      <nav className="sidenav__links" aria-label="Main">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="sidenav__item"
            aria-current={isActive(tab.href) ? 'page' : undefined}
          >
            <Icon name={tab.icon} size={20} />
            <span>{tab.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
