/**
 * `t('home.bill.title')` -> "Chalo, bill banate hain"
 *
 * The only way a string reaches the screen. Keys are typed, so a key that does
 * not exist is a compile error rather than a blank label, and placeholders are
 * checked at runtime so `{name}` is never shown to anyone.
 *
 * There is one owner language today. The function still takes a locale, so
 * the day there is a second one, nothing that calls this has to change.
 */
import { DICTIONARY, type CopyKey } from './dictionary';

/**
 * Languages the OWNER'S interface can be in. Hinglish only for now.
 * `en` exists in the dictionary as the meaning of each key, not as a choice.
 */
export type OwnerLocale = 'hi';
export const OWNER_LOCALE: OwnerLocale = 'hi';

/**
 * Languages a CUSTOMER can be spoken to in -- the reminder that goes on
 * WhatsApp, the note on a bill. A different question from the one above: the
 * owner may work in Hinglish and have a customer in Chennai who should not be
 * reminded in it.
 *
 * Today only Hinglish is written. The type is here so a customer record can
 * carry a preference from the first day, and so the model-suggested language
 * (from a name and a city) has somewhere to land when it arrives.
 */
export type CustomerLanguage = 'hi' | 'mr' | 'gu' | 'ta' | 'te' | 'kn' | 'bn' | 'en';

export const CUSTOMER_LANGUAGE_NAMES: Record<CustomerLanguage, { en: string; hi: string }> = {
  hi: { en: 'Hinglish', hi: 'Hinglish' },
  mr: { en: 'Marathi', hi: 'Marathi' },
  gu: { en: 'Gujarati', hi: 'Gujarati' },
  ta: { en: 'Tamil', hi: 'Tamil' },
  te: { en: 'Telugu', hi: 'Telugu' },
  kn: { en: 'Kannada', hi: 'Kannada' },
  bn: { en: 'Bengali', hi: 'Bengali' },
  en: { en: 'English', hi: 'English' },
};

/** The languages a customer can actually be messaged in today. */
export const CUSTOMER_LANGUAGES_AVAILABLE: readonly CustomerLanguage[] = ['hi'];

type Params = Record<string, string | number>;

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

export function fill(template: string, params: Params = {}): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) {
      // A placeholder shown to an owner is a bug; make it loud in development
      // and harmless in production.
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(`Copy is missing a value for {${name}} in "${template}"`);
      }
      return '';
    }
    return String(value);
  });
}

/** The string the owner sees for a key, with its placeholders filled. */
export function t(key: CopyKey, params?: Params, locale: OwnerLocale = OWNER_LOCALE): string {
  return fill(DICTIONARY[key][locale], params);
}

/**
 * Choose between the singular, plural and empty forms of a count.
 *
 * Hinglish does not inflect nouns for number the way English does ("2 bills"
 * and "1 bill" both read fine), but zero usually wants its own sentence -- "no
 * bills yet" is a different thought from "0 bills". So the shapes are named
 * rather than derived.
 */
export function tCount(
  n: number,
  keys: { zero?: CopyKey; one?: CopyKey; many: CopyKey },
  params: Params = {},
  locale: OwnerLocale = OWNER_LOCALE,
): string {
  if (n === 0 && keys.zero) return t(keys.zero, params, locale);
  if (n === 1 && keys.one) return t(keys.one, params, locale);
  return t(keys.many, { n, ...params }, locale);
}

export { DICTIONARY, type CopyKey } from './dictionary';
