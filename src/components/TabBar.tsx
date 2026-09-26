'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { t } from '@/lib/copy';

import { Icon, type IconName } from './Icon';

/**
 * Ghar, GST, Aap. And GST only once there is a GST number to speak of.
 *
 * Most owners this app is for are not registered and cannot charge GST; a GST
 * tab in front of them says "you should be doing something here", and the
 * something is not allowed. So the tab is earned by entering a number under
 * Aap, and until then there are two.
 *
 * One list, rendered twice: along the bottom on a phone, down the side on a
 * desktop. Only one is ever visible -- CSS decides which -- so the two cannot
 * drift apart or offer a destination the other does not have.
 */
export interface Tab {
  href: string;
  label: string;
  icon: IconName;
}

export function tabsFor(showGst: boolean): Tab[] {
  const tabs: Tab[] = [{ href: '/home', label: t('tab.home'), icon: 'home' }];
  if (showGst) tabs.push({ href: '/gst', label: t('tab.gst'), icon: 'gst' });
  tabs.push({ href: '/you', label: t('tab.you'), icon: 'person' });
  return tabs;
}

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

export function TabBar({ showGst }: { showGst: boolean }) {
  const isActive = useActive();
  return (
    <nav className="tabbar" aria-label="Main" data-nav="compact">
      {tabsFor(showGst).map((tab) => (
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

/** The same destinations, down the side, for a window wide enough. */
export function SideNav({ businessName, showGst }: { businessName: string; showGst: boolean }) {
  const isActive = useActive();
  return (
    <div className="sidenav" data-nav="wide">
      <div className="sidenav__brand">
        <span className="sidenav__name" title={businessName}>
          {businessName}
        </span>
      </div>
      <nav className="sidenav__links" aria-label="Main">
        {tabsFor(showGst).map((tab) => (
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
