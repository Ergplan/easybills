'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Exactly three destinations. Business settings live behind the profile icon in
 * the top bar, not here -- adding a fourth tab is the first step towards the
 * crowded app this product is trying not to be.
 */
const TABS = [
  { href: '/home', label: 'Home', icon: '⌂' },
  { href: '/bills', label: 'Bills', icon: '\u{1F9FE}' },
  { href: '/customers', label: 'Customers', icon: '\u{1F465}' },
] as const;

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link key={tab.href} href={tab.href} className="tabbar__item" aria-current={active ? 'page' : undefined}>
            <span className="tabbar__icon" aria-hidden="true">{tab.icon}</span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
