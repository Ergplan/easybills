'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Icon, type IconName } from './Icon';

/**
 * Exactly three destinations. Business settings live behind the profile icon in
 * the top bar, not here -- adding a fourth tab is the first step towards the
 * crowded app this product is trying not to be.
 */
const TABS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/home', label: 'Home', icon: 'home' },
  { href: '/bills', label: 'Bills', icon: 'bills' },
  { href: '/customers', label: 'Customers', icon: 'customers' },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link key={tab.href} href={tab.href} className="tabbar__item" aria-current={active ? 'page' : undefined}>
            <Icon name={tab.icon} size={22} className="tabbar__icon" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
