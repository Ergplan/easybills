/**
 * The WhatsApp door.
 *
 * `wa.me` opens a chat with the number and the message typed in; the owner
 * presses send. With no number, it opens WhatsApp's chat picker with the
 * message ready, which is still one step better than typing it.
 */
import { toE164 } from '@/lib/domain/profile';

export function whatsappLink(phone: string | null | undefined, text: string): string {
  const e164 = phone ? toE164(phone) : null;
  const number = e164 ? e164.replace('+', '') : '';
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
