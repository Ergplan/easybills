import { describe, expect, it } from 'vitest';

import { whatsappLink } from '@/lib/domain/whatsapp';

describe('the WhatsApp link', () => {
  it('opens the customer chat with the message typed in', () => {
    expect(whatsappLink('98765 43210', 'Namaste Patil ji 🙏')).toBe('https://wa.me/919876543210?text=Namaste%20Patil%20ji%20%F0%9F%99%8F');
    expect(whatsappLink('+91 98765-43210', 'hi')).toBe('https://wa.me/919876543210?text=hi');
  });

  it('falls back to the chat picker without a usable number', () => {
    expect(whatsappLink(null, 'hi')).toBe('https://wa.me/?text=hi');
    expect(whatsappLink('12345', 'hi')).toBe('https://wa.me/?text=hi');
  });
});
