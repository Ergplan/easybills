# How EkBill talks

EkBill speaks Hinglish to the owner: Hindi words, Latin letters, the way
everyone actually types on WhatsApp. It is the voice of a friend who happens to
do the paperwork. Not a form, not a bank, not a government portal.

Every string the owner sees lives in `src/lib/copy/dictionary.ts`. Every
message a customer receives lives in `src/lib/copy/messages.ts`. Nothing is
written inline in a screen. `tests/unit/copy.test.ts` enforces the rules below
that can be enforced; the rest is judgement, and this page is the judgement.

## Two audiences, two registers

**The owner** reads Hinglish. Warm, direct, a little playful.
**The customer** reads whatever the customer speaks, and the bill itself is
always formal English. A bill is a document that lands on somebody's desk.
"Chalo" does not belong on it.

A reminder sent to a customer is written in the customer's language, which the
customer record carries: Hinglish by default, or Marathi, Gujarati, Tamil,
Telugu, Kannada, Bengali or English, in their own script, the way people
actually type on WhatsApp. The app suggests one from the name and the place
(`src/lib/domain/language-guess.ts`) and never applies it on its own: a wrong
language is the mistake a customer remembers. The honorific follows the
language -- *Patil ji*, *Reddy garu*, *Gowda avare*, *Patelbhai*, *Das babu*.

The Indian-language templates were written by a model. They are simple and
polite by design; a native reader should look them over before a business
relies on them.

## Rules

**Use their words.** The owner arrives knowing *bill*, *customer*, *paise aane
hain*, *GST number*, *UPI*, *WhatsApp*, *CA*. Use exactly those. Never
*invoice*, *receivable*, *outstanding*, *adjustment*, *schedule*, *ledger*,
*submit*, *configure*. If a word would make them ask "matlab?", it is wrong.

**Say what to do, not what the system is doing.** *Bill banao*, not
"Generate invoice". *Yaad dilao*, not "Send payment reminder". *Likh lo*, not
"Record payment". The verb is the owner's, in the imperative, the way you would
say it across a counter.

**Chalo and dekho.** The three cards begin with an invitation, not a label.
*Chalo, bill banate hain. Bheje hue bills. Kiske paise aane hain.* A heading
that reads like a question the owner was already asking is a heading that does
not need explaining.

**"ji" is not optional.** Any time a customer is named in a message, it is
*Patil ji*, never *Patil*. A shop is its name as written, *Mehta Traders*,
because nobody says "Mehta Traders ji". If the owner has told us who they
talk to at a shop, that person gets the ji.

**Good news gets an exclamation. Bad news gets a next step.** *Bill ban gaya!*
*Sab paise aa gaye. Badhiya!* And when something fails: what went wrong, that
nothing was lost, what to do. *Kuch gadbad ho gayi. Dobara try karo.* Never
"An error occurred."

**Numbers are Indian.** ₹1,12,400, never ₹112,400. Dates are *12 Sep*, and
the year only when it matters. In a chat message about money, drop the paise
when there are none: *₹9,450*, not *₹9,450.00*.

**English words are fine when they are the word.** *Bill, GST, UPI, PDF,
WhatsApp, OTP, CA, Excel, email, rate, total, save.* These are Hinglish now.
Forcing *bijak* for bill or *kar* for tax would be more Hindi and less
understood.

**Short.** A heading is four words. A hint is one line. A button is one or two
words. If it needs a paragraph, the design is wrong, not the copy.

**No mannered English.** No em-dash asides, no "not X but Y", no "please note".
The Hinglish is plain because the person is busy.

## Examples

| Do not write | Write |
|---|---|
| Create invoice | Chalo, bill banate hain |
| Outstanding receivables | Kiske paise aane hain |
| Send payment reminder | Yaad dilao |
| Record payment | Likh lo · Paise aa gaye ✓ |
| Invoice generated successfully | Bill ban gaya! |
| Please configure your GST settings | GST number nahi hai? Koi baat nahi, khali chhodo. |
| An error occurred | Kuch gadbad ho gayi. Dobara try karo. |
| Dear Sir, this is to remind you that… | Namaste Patil ji 🙏 Bill no. INV-040 (₹9,450) ka payment abhi baaki hai. |

## The reminder

The reminder is the most important text in the product. It is the message the
owner was too awkward to write. Three tones, and the app picks the first one:

- **Pyaar se** (gentle) for the first reminder inside two weeks. A namaste, the
  bill, "jab suvidha ho", the UPI, a thank you.
- **Seedha** (direct) after two weeks. Still polite, but "aaj bhej dein" and
  how many days it has been.
- **Doosri baar** (second reminder) once one has gone. Names that it is the
  second, asks "jald se jald", and opens the door: "koi dikkat ho toh bata dein."

Every one signs off with the owner's business name, attaches the bill, and
gives the UPI ID if there is one. None of them threatens, and none of them
apologises for asking.

## Adding a language

Add a column to the dictionary for the owner's interface, or a template set to
`messages.ts` for what customers receive, plus its honorific and its UPI line.
The test suite will tell you which keys are missing and which placeholders do
not match. Do not translate literally; write what the
friend-who-does-the-paperwork would say in that language.
