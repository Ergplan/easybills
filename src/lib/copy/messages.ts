/**
 * What the CUSTOMER reads: the reminder on WhatsApp, the note that goes with a
 * bill. A different audience from the dictionary, and a different language
 * decision -- the owner's app is in Hinglish; the message goes in whatever the
 * customer speaks, which the customer record says and which, in time, a model
 * will suggest from their name and their city.
 *
 * Each template is keyed by language: Hinglish, six Indian languages in
 * their own script, and English. Which one a customer gets is on their
 * record, chosen by the owner or suggested from the name and the place.
 *
 * These are the highest-value strings in the product. People delay a reminder
 * because every draft they write reads wrong; a good one written for them, in
 * their voice, is the feature they will tell a friend about. Read
 * docs/voice.md before changing a word.
 */
import { formatDateShort, daysBetween, type CivilDate } from '@/lib/dates';
import { formatMoneyIndian } from '@/lib/money';

import { fill, type CustomerLanguage } from './index';

export type ReminderTone = 'gentle' | 'direct' | 'second';

interface Templates {
  billSent: string;
  reminder: Record<ReminderTone, string>;
}

/**
 * `{salutation}` is the greeting line for this customer, worked out below --
 * "Patil ji" for a person, the shop name for a shop. `{business}` is the
 * owner's, and signs every message so the customer knows who is asking.
 *
 * Every language keeps the same shape: a greeting, the bill and the amount,
 * the ask, the UPI line if there is one, the attachment, the sign-off. The
 * Indian-language ones are in their own script, because that is what people
 * actually send on WhatsApp; Hinglish is the one that is typed in Latin
 * letters. Written by a model that speaks these languages well enough for a
 * polite reminder and not well enough to be sure of every idiom -- a native
 * reader should look them over before they go to a Chennai customer.
 */
const TEMPLATES: Record<CustomerLanguage, Templates> = {
  hi: {
    billSent:
      'Namaste {salutation} 🙏 Aapka bill no. {number} ({amount}) bhej raha hoon. ' +
      '{payLine}Dhanyavaad! — {business}',
    reminder: {
      gentle:
        'Namaste {salutation} 🙏 Bill no. {number} ({amount}, {date}) ka payment abhi baaki hai. ' +
        '{payLine}Bill saath laga hai. Dhanyavaad! — {business}',
      direct:
        'Namaste {salutation}, bill no. {number} ka {amount} {days} din se baaki hai. ' +
        'Kripya aaj bhej dein. {payLine}Bill saath laga hai. — {business}',
      second:
        'Namaste {salutation}, yeh doosra reminder hai. Bill no. {number} ({amount}) {days} din se pending hai. ' +
        'Kripya jald se jald bhej dein. {payLine}Koi dikkat ho toh bata dein. — {business}',
    },
  },
  mr: {
    billSent: 'नमस्कार {salutation} 🙏 तुमचे बिल क्र. {number} ({amount}) पाठवत आहे. {payLine}धन्यवाद! — {business}',
    reminder: {
      gentle:
        'नमस्कार {salutation} 🙏 बिल क्र. {number} ({amount}, {date}) चे पेमेंट अजून बाकी आहे. ' +
        '{payLine}बिल सोबत जोडले आहे. धन्यवाद! — {business}',
      direct:
        'नमस्कार {salutation}, बिल क्र. {number} चे {amount} {days} दिवसांपासून बाकी आहेत. ' +
        'कृपया आज पाठवा. {payLine}बिल सोबत जोडले आहे. — {business}',
      second:
        'नमस्कार {salutation}, ही दुसरी आठवण आहे. बिल क्र. {number} ({amount}) {days} दिवसांपासून प्रलंबित आहे. ' +
        'कृपया लवकरात लवकर पाठवा. {payLine}काही अडचण असेल तर कळवा. — {business}',
    },
  },
  gu: {
    billSent: 'નમસ્તે {salutation} 🙏 તમારું બિલ નં. {number} ({amount}) મોકલું છું. {payLine}આભાર! — {business}',
    reminder: {
      gentle:
        'નમસ્તે {salutation} 🙏 બિલ નં. {number} ({amount}, {date}) નું પેમેન્ટ હજી બાકી છે. ' +
        '{payLine}બિલ સાથે જોડેલું છે. આભાર! — {business}',
      direct:
        'નમસ્તે {salutation}, બિલ નં. {number} ના {amount} {days} દિવસથી બાકી છે. ' +
        'કૃપા કરીને આજે મોકલી આપો. {payLine}બિલ સાથે જોડેલું છે. — {business}',
      second:
        'નમસ્તે {salutation}, આ બીજી યાદ છે. બિલ નં. {number} ({amount}) {days} દિવસથી બાકી છે. ' +
        'કૃપા કરીને બને તેટલું જલદી મોકલો. {payLine}કોઈ મુશ્કેલી હોય તો જણાવશો. — {business}',
    },
  },
  ta: {
    billSent: 'வணக்கம் {salutation} 🙏 உங்கள் பில் எண் {number} ({amount}) அனுப்புகிறேன். {payLine}நன்றி! — {business}',
    reminder: {
      gentle:
        'வணக்கம் {salutation} 🙏 பில் எண் {number} ({amount}, {date}) க்கான பணம் இன்னும் வரவில்லை. ' +
        '{payLine}பில் இணைக்கப்பட்டுள்ளது. நன்றி! — {business}',
      direct:
        'வணக்கம் {salutation}, பில் எண் {number} இன் {amount} {days} நாட்களாக நிலுவையில் உள்ளது. ' +
        'தயவுசெய்து இன்று அனுப்பவும். {payLine}பில் இணைக்கப்பட்டுள்ளது. — {business}',
      second:
        'வணக்கம் {salutation}, இது இரண்டாவது நினைவூட்டல். பில் எண் {number} ({amount}) {days} நாட்களாக நிலுவையில் உள்ளது. ' +
        'தயவுசெய்து விரைவில் அனுப்பவும். {payLine}ஏதேனும் சிக்கல் இருந்தால் தெரிவிக்கவும். — {business}',
    },
  },
  te: {
    billSent: 'నమస్కారం {salutation} 🙏 మీ బిల్ నం. {number} ({amount}) పంపుతున్నాను. {payLine}ధన్యవాదాలు! — {business}',
    reminder: {
      gentle:
        'నమస్కారం {salutation} 🙏 బిల్ నం. {number} ({amount}, {date}) చెల్లింపు ఇంకా బాకీ ఉంది. ' +
        '{payLine}బిల్ జతచేయబడింది. ధన్యవాదాలు! — {business}',
      direct:
        'నమస్కారం {salutation}, బిల్ నం. {number} కు {amount} {days} రోజులుగా బాకీ ఉంది. ' +
        'దయచేసి ఈరోజు పంపండి. {payLine}బిల్ జతచేయబడింది. — {business}',
      second:
        'నమస్కారం {salutation}, ఇది రెండవ రిమైండర్. బిల్ నం. {number} ({amount}) {days} రోజులుగా బాకీ ఉంది. ' +
        'దయచేసి వీలైనంత త్వరగా పంపండి. {payLine}ఏదైనా సమస్య ఉంటే తెలియజేయండి. — {business}',
    },
  },
  kn: {
    billSent: 'ನಮಸ್ಕಾರ {salutation} 🙏 ನಿಮ್ಮ ಬಿಲ್ ಸಂ. {number} ({amount}) ಕಳುಹಿಸುತ್ತಿದ್ದೇನೆ. {payLine}ಧನ್ಯವಾದಗಳು! — {business}',
    reminder: {
      gentle:
        'ನಮಸ್ಕಾರ {salutation} 🙏 ಬಿಲ್ ಸಂ. {number} ({amount}, {date}) ಪಾವತಿ ಇನ್ನೂ ಬಾಕಿ ಇದೆ. ' +
        '{payLine}ಬಿಲ್ ಲಗತ್ತಿಸಲಾಗಿದೆ. ಧನ್ಯವಾದಗಳು! — {business}',
      direct:
        'ನಮಸ್ಕಾರ {salutation}, ಬಿಲ್ ಸಂ. {number} ರ {amount} {days} ದಿನಗಳಿಂದ ಬಾಕಿ ಇದೆ. ' +
        'ದಯವಿಟ್ಟು ಇಂದು ಕಳುಹಿಸಿ. {payLine}ಬಿಲ್ ಲಗತ್ತಿಸಲಾಗಿದೆ. — {business}',
      second:
        'ನಮಸ್ಕಾರ {salutation}, ಇದು ಎರಡನೇ ನೆನಪಿಸುವಿಕೆ. ಬಿಲ್ ಸಂ. {number} ({amount}) {days} ದಿನಗಳಿಂದ ಬಾಕಿ ಇದೆ. ' +
        'ದಯವಿಟ್ಟು ಆದಷ್ಟು ಬೇಗ ಕಳುಹಿಸಿ. {payLine}ಏನಾದರೂ ತೊಂದರೆ ಇದ್ದರೆ ತಿಳಿಸಿ. — {business}',
    },
  },
  bn: {
    billSent: 'নমস্কার {salutation} 🙏 আপনার বিল নং {number} ({amount}) পাঠাচ্ছি। {payLine}ধন্যবাদ! — {business}',
    reminder: {
      gentle:
        'নমস্কার {salutation} 🙏 বিল নং {number} ({amount}, {date}) এর পেমেন্ট এখনও বাকি আছে। ' +
        '{payLine}বিল সঙ্গে দেওয়া আছে। ধন্যবাদ! — {business}',
      direct:
        'নমস্কার {salutation}, বিল নং {number} এর {amount} {days} দিন ধরে বাকি আছে। ' +
        'অনুগ্রহ করে আজই পাঠান। {payLine}বিল সঙ্গে দেওয়া আছে। — {business}',
      second:
        'নমস্কার {salutation}, এটি দ্বিতীয় রিমাইন্ডার। বিল নং {number} ({amount}) {days} দিন ধরে বাকি আছে। ' +
        'অনুগ্রহ করে যত তাড়াতাড়ি সম্ভব পাঠান। {payLine}কোনো অসুবিধা থাকলে জানাবেন। — {business}',
    },
  },
  en: {
    billSent: 'Hello {salutation} 🙏 Sending your bill no. {number} ({amount}). {payLine}Thank you! — {business}',
    reminder: {
      gentle:
        'Hello {salutation} 🙏 Payment for bill no. {number} ({amount}, {date}) is still pending. ' +
        '{payLine}The bill is attached. Thank you! — {business}',
      direct:
        'Hello {salutation}, {amount} for bill no. {number} has been pending for {days} days. ' +
        'Please send it today. {payLine}The bill is attached. — {business}',
      second:
        'Hello {salutation}, this is a second reminder. Bill no. {number} ({amount}) has been pending for {days} days. ' +
        'Please send it at the earliest. {payLine}Do let me know if there is any problem. — {business}',
    },
  },
};

/** The line that says how to pay, or nothing if the owner has not said. */
const PAY_LINE: Record<CustomerLanguage, string> = {
  hi: 'UPI se bhej sakte hain: {upi}. ',
  mr: 'UPI ने पाठवू शकता: {upi}. ',
  gu: 'UPI થી મોકલી શકો છો: {upi}. ',
  ta: 'UPI மூலம் அனுப்பலாம்: {upi}. ',
  te: 'UPI ద్వారా పంపవచ్చు: {upi}. ',
  kn: 'UPI ಮೂಲಕ ಕಳುಹಿಸಬಹುದು: {upi}. ',
  bn: 'UPI-তে পাঠাতে পারেন: {upi}. ',
  en: 'You can pay by UPI: {upi}. ',
};

/** For the tests and the screen: which languages are actually written. */
export const WRITTEN_LANGUAGES = Object.keys(TEMPLATES) as CustomerLanguage[];
export function templateFor(language: CustomerLanguage, tone: ReminderTone | 'billSent'): string {
  return tone === 'billSent' ? TEMPLATES[language].billSent : TEMPLATES[language].reminder[tone];
}

export interface MessageCustomer {
  /** The name on the record: a person or a shop. */
  name: string;
  /** The person the owner actually talks to, for a shop. Null for a person. */
  contactPerson?: string | null;
  /** The language this customer should be spoken to in. Null means the owner's. */
  language?: CustomerLanguage | null;
}

export interface MessageBusiness {
  name: string;
  upiId?: string | null;
}

export interface MessageBill {
  number: string;
  /** In paise. */
  amountDuePaise: number;
  issueDate: CivilDate;
}

/**
 * Who to greet, and how.
 *
 * A person gets their first name and the honorific their language uses:
 * "Patil ji", "Reddy garu", "Gowda avare". A shop gets the shop's name as it
 * is, because "Mehta Traders ji" is not a thing anyone says -- unless the
 * owner told us who they talk to there, in which case that person, with the
 * honorific. It is not optional politeness in these registers; leaving it off
 * reads curt. English gets the first name alone, which is how a WhatsApp
 * message in English to a customer actually reads.
 */
const HONORIFIC: Record<CustomerLanguage, string> = {
  hi: ' ji',
  mr: ' ji',
  gu: 'bhai',
  ta: ' sir',
  te: ' garu',
  kn: ' avare',
  bn: ' babu',
  en: '',
};

export function salutationFor(customer: MessageCustomer, language: CustomerLanguage = 'hi'): string {
  const honorific = HONORIFIC[language];
  const person = customer.contactPerson?.trim();
  if (person) return `${firstWord(person)}${honorific}`;
  if (looksLikeShop(customer.name)) return customer.name.trim();
  return `${firstWord(customer.name)}${honorific}`;
}

function firstWord(name: string): string {
  const cleaned = name.trim().replace(/^(mr|mrs|ms|dr|shri|smt|sri)\.?\s+/i, '');
  return cleaned.split(/\s+/)[0] ?? cleaned;
}

/**
 * Names that are businesses, not people. Conservative on purpose: a person
 * wrongly treated as a shop loses their "ji", which is the worse mistake.
 *
 * The ampersand is checked on its own because it is not a word character, so
 * a word-boundary pattern never sees "Sharma & Sons" as anything but a name.
 */
const SHOP_WORDS =
  /\b(traders?|enterprises?|stores?|industries|pvt|ltd|llp|society|associates|agencies|agency|solutions|services|works|mart|boutique|electricals?|hardware|motors|textiles?|and\s+sons|brothers|bros|co\.?|company|corp|centre|center|clinic|hospital|school|academy|institute|shop|hotel|restaurant|cafe|bakery|studio|infotech|technologies|tech|systems|repairs?|appliances?|consulting|consultants|kitchen|designs?|classes|tuitions?|caterers|foods?|sweets|garments|fashions?|furniture|interiors|builders|constructions?|developers|printers|photography|events|sample)\b/i;

export function looksLikeShop(name: string): boolean {
  return name.includes('&') || SHOP_WORDS.test(name);
}

/** "₹9,450" -- Indian grouping, no paise when there are none. This is a chat, not a ledger. */
export function moneyForMessage(paise: number): string {
  const s = formatMoneyIndian(paise, { withSymbol: false });
  return `₹${s.endsWith('.00') ? s.slice(0, -3) : s}`;
}

/** The message that goes with a bill when it is first sent. */
export function billSentMessage(args: { customer: MessageCustomer; business: MessageBusiness; bill: MessageBill }): string {
  const lang = pick(args.customer.language);
  return fill(TEMPLATES[lang].billSent, {
    salutation: salutationFor(args.customer, lang),
    number: args.bill.number,
    amount: moneyForMessage(args.bill.amountDuePaise),
    payLine: payLine(lang, args.business),
    business: args.business.name,
  });
}

/** The nudge. Three tones, chosen by the owner; the rest is written for them. */
export function reminderMessage(args: {
  customer: MessageCustomer;
  business: MessageBusiness;
  bill: MessageBill;
  tone: ReminderTone;
  today: CivilDate;
}): string {
  const lang = pick(args.customer.language);
  const days = Math.max(0, daysBetween(args.bill.issueDate, args.today));
  return fill(TEMPLATES[lang].reminder[args.tone], {
    salutation: salutationFor(args.customer, lang),
    number: args.bill.number,
    amount: moneyForMessage(args.bill.amountDuePaise),
    date: shortDayMonth(args.bill.issueDate),
    days,
    payLine: payLine(lang, args.business),
    business: args.business.name,
  });
}

/**
 * The tone the app should offer first, so the owner is not asked to choose
 * before they have to. Gentle to begin with, direct after a couple of weeks,
 * and "second reminder" once one has already gone.
 */
export function suggestedTone(args: { issueDate: CivilDate; today: CivilDate; remindersSent: number }): ReminderTone {
  if (args.remindersSent > 0) return 'second';
  return daysBetween(args.issueDate, args.today) >= 14 ? 'direct' : 'gentle';
}

function payLine(lang: CustomerLanguage, business: MessageBusiness): string {
  const upi = business.upiId?.trim();
  if (!upi) return '';
  return fill(PAY_LINE[lang], { upi });
}

/** No language on the record means the owner's own. */
function pick(language: CustomerLanguage | null | undefined): CustomerLanguage {
  return language && TEMPLATES[language] ? language : 'hi';
}

/** "12 Sep" -- the year is noise inside a message about last month's bill. */
function shortDayMonth(date: CivilDate): string {
  return formatDateShort(date).replace(/\s\d{4}$/, '');
}
