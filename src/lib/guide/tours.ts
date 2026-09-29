/**
 * The guided tour of each screen: what to point at, in order, and what to
 * say about it. The ring goes round each target in turn; a step whose
 * target is not on the screen right now (a field that only shows for a new
 * customer, a button that only shows while money is due) is skipped.
 *
 * Voice uses the same steps as its script for the screen; without voice,
 * "Dikhao kaise" walks them tap by tap. Pure, so it is tested without a DOM.
 */
export type GuideTarget = string | { sel: string; text: string };

export interface TourStep {
  target: GuideTarget;
  say: string;
}

export type ScreenKey =
  | 'home'
  | 'bill-start'
  | 'bill'
  | 'bill-remind'
  | 'bills'
  | 'dues'
  | 'customers'
  | 'customer'
  | 'ask'
  | 'help'
  | 'you'
  | 'gst'
  | 'start'
  | 'signin'
  | 'other';

export function screenOf(pathname: string): ScreenKey {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/home' || p === '/') return 'home';
  if (p === '/bills/start' || p === '/bills/new') return 'bill-start';
  if (p === '/bills/help') return 'help';
  if (/^\/bills\/[^/]+\/remind$/.test(p)) return 'bill-remind';
  if (/^\/bills\/[^/]+$/.test(p)) return 'bill';
  if (p === '/bills') return 'bills';
  if (p === '/dues') return 'dues';
  if (p === '/customers') return 'customers';
  if (/^\/customers\/[^/]+$/.test(p)) return 'customer';
  if (p === '/ask') return 'ask';
  if (p === '/you') return 'you';
  if (p === '/gst') return 'gst';
  if (p === '/start') return 'start';
  if (p === '/signin') return 'signin';
  return 'other';
}

/** What each screen is for, in one line. Voice is told this when the screen changes. */
export const SCREEN_PURPOSE: Record<ScreenKey, string> = {
  home: 'Ghar: the front desk. Cards for a new bill, sent bills, who owes money, voice, and questions; the customer list with search.',
  'bill-start': 'Choosing whose bill to make: search, tap a name, or Naya customer.',
  bill: 'A bill. If it is being made: customer name, lines of what was done (kya kiya, kitna, rate), total, and the Bill banao button. If it is sent: amount due, Likh lo for money received, Yaad dilao, WhatsApp, and fixing a mistake.',
  'bill-remind': 'A payment reminder: pick a tone, edit the message, WhatsApp kholo.',
  bills: 'Every bill sent, newest first, and drafts not finished.',
  dues: 'Who owes money: the total, then each unpaid bill with Yaad dilao and Paise aa gaye.',
  customers: 'All customers, and uploading old bills to add customers from them.',
  customer: "One customer's details, their bills and contracts, and Inka bill banao.",
  ask: 'Poocho: ask a question about past bills, rates and contracts.',
  help: 'The helper for a bill that is part of a contract or project.',
  you: "The owner's own details, bill numbering, and customers.",
  gst: "The quarter's GST summary and sending it to the CA.",
  start: 'First-time setup of the business details.',
  signin: 'Signing in with a phone number and OTP.',
  other: 'A screen of the app.',
};

const TOURS: Record<ScreenKey, TourStep[]> = {
  home: [
    { target: '[data-testid=task-bill]', say: 'Naya bill yahan se banta hai. Tap karo, customer chuno, kaam likho, bas.' },
    { target: '[data-testid=task-sent]', say: 'Jo bills bhej diye, sab yahan. Kaun sa paid hai, kaun sa baaki.' },
    { target: '[data-testid=task-due]', say: 'Kiske paise aane hain: total, aur har ek ko ek tap mein yaad dilao.' },
    { target: '.task--voice', say: 'Likhna nahi hai? Yeh dabao aur bolo, jaise "Mehta ka bill, AMC visit teen hazaar".' },
    { target: '[data-testid=task-ask]', say: 'Kuch bhi poocho: "Sharma ko pichli baar kya rate diya tha?"' },
    { target: '.people .picker__search', say: 'Aapke customers yahan hain. Naam likh ke dhoondho, tap karke unka page kholo.' },
  ],
  'bill-start': [
    { target: '.picker__search', say: 'Customer ka naam likho, list chhoti ho jayegi.' },
    { target: '.person--new', say: 'Naya customer hai? Yeh dabao, naam bill pe likh dena.' },
    { target: '.picker__rows .person:not(.person--new)', say: 'Ya kisi naam pe tap karo. Unka bill khul jayega, details pehle se bhari.' },
  ],
  bill: [
    { target: '#bill-customer', say: 'Pehle customer ka naam likho.' },
    { target: { sel: '.card--offer', text: 'Pichle jaisa hi' }, say: 'Pichli baar jaisa bill? Yeh dabao, wahi lines aa jayengi.' },
    { target: 'input[id^="what-"]', say: 'Kya kaam kiya? Jaise "Repair visit" ya "Fan fitting".' },
    { target: 'input[id^="qty-"]', say: 'Kitna? Kitni baar ya kitne piece. Ek hai to 1 hi rehne do.' },
    { target: 'input[id^="rate-"]', say: 'Ek ka rate, rupaye mein.' },
    { target: { sel: 'button', text: 'Aur kuch' }, say: 'Aur kuch kiya? Yahan se doosri line jodo.' },
    { target: '#bill-gst', say: 'GST kitna lagega, yahan chuno.' },
    { target: '.bill-total', say: 'Total apne aap judta hai. Check kar lo.' },
    { target: { sel: 'button', text: 'Bill banao' }, say: 'Sab theek? Bill banao dabao. Bill customer ke liye English mein banega.' },
    { target: { sel: 'button', text: 'WhatsApp pe bhejo' }, say: 'Bill ban gaya! Ab WhatsApp pe bhejo, PDF saath jayegi.' },
    { target: '#paid .home__big', say: 'Is bill ke kitne paise abhi baaki hain.' },
    { target: { sel: 'button', text: 'Paise aa gaye' }, say: 'Paise mil gaye? Yahan dabao aur likh lo, poore ya thode.' },
    { target: { sel: 'a', text: 'Yaad dilao' }, say: 'Paise nahi aaye? Yaad dilao, message taiyaar milega.' },
    { target: { sel: 'h2', text: 'Galti ho gayi' }, say: 'Bill mein galti? Yahan se theek karo. Bheja hua bill badla nahi jaata, sahi tareeke se theek hota hai.' },
  ],
  'bill-remind': [
    { target: '.chips[role=group]', say: 'Kaise bolna hai chuno: pyaar se, seedha, ya thoda sakht.' },
    { target: '#remind-text', say: 'Message yeh raha. Chaho to badal lo.' },
    { target: { sel: 'button', text: 'WhatsApp' }, say: 'Ab WhatsApp kholo, message aur bill saath jayenge. Bhejna aapke haath mein.' },
  ],
  bills: [
    { target: 'main .row-line', say: 'Har bill yahan, naya sabse upar. Tap karke kholo.' },
    { target: '.pill', say: 'Yeh batata hai: bheja, paid, thoda aaya, ya baaki.' },
  ],
  dues: [
    { target: '.dues__total', say: 'Kul kitne paise aane baaki hain.' },
    { target: '.due-row__who', say: 'Sabse purana bill sabse upar. Tap karke bill dekho.' },
    { target: { sel: 'a', text: 'Yaad dilao' }, say: 'Yaad dilao: WhatsApp message taiyaar milega.' },
    { target: { sel: 'a', text: 'Paise aa gaye' }, say: 'Paise aa gaye? Yahan se likh lo.' },
  ],
  customers: [
    { target: '.picker__search', say: 'Naam likh ke customer dhoondho.' },
    { target: '.picker__rows .person', say: 'Har customer ke saath: kitne baaki, ya sab chukta. Tap karke unka page kholo.' },
    { target: '#import-files + button', say: 'Purane bills ki PDF, photo ya Excel do. Customers hum padh lenge.' },
  ],
  customer: [
    { target: { sel: 'button', text: 'Inka bill banao' }, say: 'Inka naya bill yahan se.' },
    { target: '.customer-bills', say: 'Inke saare bills, aur kitne baaki.' },
    { target: '.customer-details > summary', say: 'Phone, GST number, pata, bhasha: yahan khol ke dekho ya badlo.' },
  ],
  ask: [
    { target: '#ask-q', say: 'Apna sawaal yahan likho, jaise "Sharma ko pichli baar kya rate diya?"' },
    { target: '.chips', say: 'Ya inme se ek dabao.' },
    { target: { sel: 'button', text: 'Poocho' }, say: 'Phir Poocho dabao. Jawab batayega kis bill se aaya.' },
  ],
  help: [
    { target: '.help, main .card', say: 'Contract ki baat ek baar batao: total, kitne hisson mein, retention. Har bill ka hisaab main karunga.' },
  ],
  you: [
    { target: '#you-name', say: 'Aapki dukaan ya business ka naam. Yahi bill pe chhapta hai.' },
    { target: '#you-gstin', say: 'GST number ho to yahan. Nahi hai to khaali chhodo.' },
    { target: '#you-upiId', say: 'UPI ID daalo, bill pe QR aayega aur paise jaldi aayenge.' },
    { target: '#num-prefix', say: 'Bill number kaise shuru ho, yahan badlo.' },
  ],
  gst: [
    { target: 'main .card', say: 'Is quarter ka GST ka hisaab, rate ke hisaab se.' },
    { target: { sel: 'button', text: 'CA ko bhejo' }, say: 'CA ko ek file mein sab bhejo: Excel aur saare bills.' },
  ],
  start: [
    { target: '#you-name', say: 'Namaste! Pehle apni dukaan ka naam likho.' },
    { target: '#you-gstin', say: 'GST number hai to daalo, nahi to khaali chhodo.' },
    { target: '#you-upiId', say: 'UPI ID, taaki customer seedha pay kar sake.' },
    { target: '#you-city', say: 'Aapka shehar.' },
  ],
  signin: [
    { target: '#phone', say: 'Apna 10 number ka mobile number likho.' },
    { target: '#otp', say: 'SMS mein aaya 6 number ka OTP yahan likho.' },
  ],
  other: [],
};

export function tourFor(screen: ScreenKey): TourStep[] {
  return TOURS[screen];
}

export const TOUR_SCREENS = Object.keys(TOURS) as ScreenKey[];
