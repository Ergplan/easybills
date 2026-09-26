/**
 * Which language to write to a customer in, guessed from their name and
 * where they are.
 *
 * A guess, offered, never applied on its own: a reminder in the wrong
 * language is the one mistake a customer remembers. The rules are the ones
 * anyone from here would use -- a Patil is probably happier in Marathi, a
 * Reddy in Telugu, a business in Coimbatore in Tamil -- and they are
 * deliberately narrow. Mumbai suggests nothing, because Mumbai is everyone.
 * A name that matches wins over a place: a Patel in Chennai is still a Patel.
 *
 * Where a language model is configured, `suggestLanguage` on the server can
 * ask it the same question and fall back to these rules; the screen does not
 * know or care which answered.
 */
import type { CustomerLanguage } from '@/lib/copy';

export interface LanguageGuess {
  language: CustomerLanguage;
  /** What the guess rests on, so the screen can say so. */
  reason: 'name' | 'place';
  /** The name or the place that decided it. */
  because: string;
}

const SURNAMES: Array<[RegExp, CustomerLanguage]> = [
  [/\b(patil|deshmukh|kulkarni|jadhav|joshi|pawar|shinde|more|bhosale|chavan|gaikwad|sawant|kadam|salunkhe|mane|deshpande|thakre|thackeray|wagh|naik|sathe|bhatt?e|phadke|gokhale|apte|kale|kamble|gawade|ghorpade|nikam|raut|tambe|jagtap|shirke|mohite|dhumal|vartak|marathe)\b/i, 'mr'],
  [/\b(patel|shah|mehta|desai|modi|trivedi|parikh|parekh|jani|bhatt|thakkar|thakker|gandhi|solanki|chaudhari|vyas|dave|joshipura|rana|kothari|doshi|sanghvi|sanghavi|amin|gajjar|panchal|prajapati|vaghela|jadeja|rathod|makwana|chauhan|pandya|raval|bhavsar|soni|nayak)\b/i, 'gu'],
  [/\b(iyer|iyengar|subramanian|subramaniam|murugan|murugesan|ramasamy|ramaswamy|krishnan|raman|natarajan|sundaram|venkatesan|ganesan|selvam|selvan|pillai|nadar|chettiar|gounder|thevar|mudaliar|balasubramanian|rajan|sekar|shekar|kannan|palani|karthik|arumugam|annamalai|sivakumar)\b/i, 'ta'],
  [/\b(reddy|naidu|chowdary|choudary|raju|prasad|srinivas|venkat|venkata|goud|yadav\s+garu|varma|sastry|sarma|rao)\b/i, 'te'],
  [/\b(gowda|gouda|shetty|hegde|kamath|bhat|acharya|nayak|pai|shenoy|prabhu|rai|poojary|poojari|hebbar|kulkarni\s+kn|devaraj|byregowda|siddaramaiah|deve)\b/i, 'kn'],
  [/\b(banerjee|bandyopadhyay|chatterjee|chattopadhyay|mukherjee|mukhopadhyay|bhattacharya|bhattacharjee|ganguly|gangopadhyay|das|dutta|datta|sen|ghosh|bose|basu|roy\s*chowdhury|sarkar|majumdar|mazumdar|chakraborty|chakrabarti|dey|de|pal|halder|mondal|mandal|saha|kundu|biswas|nath|lahiri|sinha)\b/i, 'bn'],
];

const CITIES: Array<[RegExp, CustomerLanguage]> = [
  [/\b(pune|nagpur|nashik|nasik|kolhapur|aurangabad|sambhaji\s*nagar|solapur|satara|sangli|ahmednagar|ahilyanagar|jalgaon|latur|amravati|akola|ratnagiri|chandrapur|nanded|dhule)\b/i, 'mr'],
  [/\b(ahmedabad|amdavad|surat|vadodara|baroda|rajkot|bhavnagar|jamnagar|gandhinagar|junagadh|anand|nadiad|navsari|bharuch|mehsana|morbi|vapi|valsad|gandhidham|bhuj)\b/i, 'gu'],
  [/\b(chennai|madras|coimbatore|kovai|madurai|tiruchirappalli|trichy|salem|tirunelveli|tiruppur|tirupur|erode|vellore|thoothukudi|tuticorin|thanjavur|dindigul|kanchipuram|hosur|karur|nagercoil)\b/i, 'ta'],
  [/\b(hyderabad|secunderabad|warangal|nizamabad|karimnagar|khammam|vijayawada|visakhapatnam|vizag|guntur|nellore|tirupati|kurnool|rajahmundry|kakinada|kadapa|anantapur|eluru|ongole)\b/i, 'te'],
  [/\b(bengaluru|bangalore|mysuru|mysore|mangaluru|mangalore|hubballi|hubli|dharwad|belagavi|belgaum|davangere|davanagere|ballari|bellary|tumakuru|tumkur|shivamogga|shimoga|udupi|hassan|bidar|kalaburagi|gulbarga)\b/i, 'kn'],
  [/\b(kolkata|calcutta|howrah|siliguri|durgapur|asansol|bardhaman|burdwan|kharagpur|haldia|malda|barasat|serampore|hooghly|krishnanagar|jalpaiguri)\b/i, 'bn'],
];

/** GST state codes where the local language is the language of business. */
const STATES: Record<string, CustomerLanguage> = {
  '24': 'gu',
  '33': 'ta',
  '36': 'te',
  '37': 'te',
  '29': 'kn',
  '19': 'bn',
};

export function guessLanguage(args: {
  name: string;
  contactPerson?: string | null;
  city?: string | null;
  stateCode?: string | null;
}): LanguageGuess | null {
  for (const who of [args.contactPerson, args.name]) {
    const text = (who ?? '').trim();
    if (!text) continue;
    for (const [re, language] of SURNAMES) {
      const m = re.exec(text);
      if (m) return { language, reason: 'name', because: m[0] };
    }
  }
  const city = (args.city ?? '').trim();
  if (city) {
    for (const [re, language] of CITIES) {
      const m = re.exec(city);
      if (m) return { language, reason: 'place', because: city };
    }
  }
  const state = (args.stateCode ?? '').trim();
  if (state && STATES[state]) return { language: STATES[state]!, reason: 'place', because: state };
  return null;
}
