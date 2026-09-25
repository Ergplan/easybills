import 'server-only';

import type { BusinessRecord } from '@/lib/domain/types';

/**
 * Whether to show the GST returns module at all.
 *
 * Hidden entirely for unregistered businesses: an owner who does not file
 * returns should never see a returns card, a returns menu item, or a tax table.
 * The three main navigation destinations do not change either way.
 */
export interface GstVisibility {
  visible: boolean;
  /** Short plain-language line for the Home card. Never a fabricated deadline. */
  homeCardLine: string;
  /** Whether return setup still needs completing. */
  needsSetup: boolean;
}

export function gstModuleVisibility(business: BusinessRecord): GstVisibility {
  if (business.registrationType !== 'regular') {
    return { visible: false, homeCardLine: '', needsSetup: false };
  }
  if (!business.gstReturns) {
    return {
      visible: true,
      homeCardLine: 'Set up GST returns once, and we will help you prepare them each period.',
      needsSetup: true,
    };
  }
  return {
    visible: true,
    homeCardLine: 'Check your sales and purchases, then prepare this period’s return.',
    needsSetup: false,
  };
}
