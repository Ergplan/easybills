# EkBill components

Every component, the tokens it uses, and how it changes between **Narangi** (light) and **Harmony** (dark). Sizes are at 390px width. "Ref" points to the screen in `screens/` where it appears.

Shared defaults: font `--eb-font`; screen gutter `--eb-space-gutter` (12px) for cards, 22px for headings; stack gap 12–14px.

---

## Foundations

### Screen / ground
- `html, body` already get `--eb-bg`, the dot grid and `--eb-g-screen-glow` from `themes.css`.
- Harmony adds a soft green glow top-right (in the token). Narangi has none.

### Typography
| Role | Token | Notes |
|---|---|---|
| Display (greeting, screen title) | `--eb-type-display-*` | 36/300, emphasis word 600 (Narangi) or 500 + text gradient (Harmony) |
| Title (sub-screens) | `--eb-type-title-*` | 22/300, customer name 600 |
| Card title | `--eb-type-card-*` | 17/500 |
| Body / row name | `--eb-type-body-*` | 15/500 |
| Meta (INV no, date) | `--eb-type-meta-*` | 13/400, `--eb-text-muted` |
| Label | `--eb-type-label-*` | 12/600, `--eb-text-muted` |
| Money hero | `--eb-type-money-hero-*` | 48/500, tracking −0.03em; ₹ 26/300 |
| Money in rows | `--eb-type-money-row-*` | 15/600, `.eb-num` |

### Icons
24px grid, 1.6 stroke, round caps/joins, `currentColor`. Icon-only buttons need `aria-label`. Set used: home, receipt, user, folder, bell, search, back, close, plus, arrow-right, arrow-up-right, send, chat, file, download, calendar, clock, globe, lock, pen, check, coins, percent, refresh.

---

## Navigation

### TabBar
Ref: `narangi/02-home`, `harmony/02-home`
- Floating pill, 26px from bottom. Items: Ghar · GST (only with GSTIN) · Aap (Harmony mock shows Bills; use GST/Aap rule in the build).
- Tokens: `--eb-nav-bg`, `--eb-nav-fg`, `--eb-nav-active-bg`, `--eb-nav-active-fg`, `--eb-shadow-nav`, height 48px items.
- Narangi: active item is a filled accent pill. Harmony: active item is a 9% white glass pill; bar is dark glass with a 1px ring.

### TopBar
- Left: back (`IconButton`) or logo. Right: up to 3 `IconButton`s (WhatsApp chat, details, download).
- Sub-screens show a context chip on the right (e.g. `INV-040 · ₹9,450`) in `--eb-surface-2`.

### IconButton
- 44–48px circle. Narangi: white 80% fill. Harmony: `--eb-surface` + `--eb-glass-ring`.

---

## Home

### Greeting
- `home.greeting` with name in emphasis; meta line `business · city · weekday, date`.

### HeroPanel / FolderPanel — "Kiska bill" and "Kiske paise aane hain"
Ref: `narangi/02-home` (gradient card), `harmony/02-home` (folder)
- **Narangi HeroPanel:** radius `--eb-radius-hero`, background `--eb-g-hero`, text `--eb-on-hero`, shadow `--eb-shadow-hero`, 3 white wave lines at 35% behind content. Holds the client chips.
- **Harmony FolderPanel:** 
  1. Back plate: full size, radius 34, `--eb-g-hero-back`.
  2. 2–3 peeking bills: 196×128, radius 22, white 30%→8% glass with 38% ring, rotated −7°, −3°, 0°, offset right and staggered 4–8px down. Show bill no., customer, amount.
  3. Front: a tab (left 50–54% width, 58px tall, radius 34 top) joined to the body by an S-curve (`M0 0 C32 0 26 58 60 58 L0 58 Z`), body radius `0 34 34 34`, `--eb-g-hero`.
  Content sits on the front. One folder per screen.
- Narangi puts **money owed** on `--eb-g-panel` (lavender); Harmony puts it in the folder and moves client chips above it on the ground.

### ClientChip / NewCustomerChip
- 44px pill, 32px avatar + name. Narangi: white 90% on the hero. Harmony: glass on ground.
- Avatar fill cycles `--eb-avatar-0..3` by customer index; initial in ink.
- New customer: Narangi = ink pill + accent disc with plus. Harmony = accent pill + ink disc with accent plus.
- Tap → `/bills/new?customer=` (or `/customers/:id` in Harmony flow).

### SentBillsCard
- Title, count (`04` large, regular Urbanist), 8-week bar sparkline (Narangi), list of `BillRow`, "Saare bills dekho".
- Narangi: white card, `--eb-shadow-card`. Harmony: glass card.

### BillRow
- Avatar 38 · name 15/500 + meta 13 · amount 15/600 + `StatusPill`. Rows divided by `--eb-divider`.

### StatusPill
| State | Key | fg / bg |
|---|---|---|
| Sent | `status.sent` | `--eb-sent` / `--eb-sent-bg` |
| Paid | `status.paid` | `--eb-paid` / `--eb-paid-bg` (+ check icon) |
| Due | `status.due` | `--eb-due` / `--eb-due-bg` |
Always a word, 11/600, pill radius.

### OwedRow
- Name, age ("24 din ho gaye" in `--eb-due` when > 14 days), amount, `Yaad dilao` button (accent for the oldest, outline for others).
- Narangi: `--eb-panel-row` on lavender. Harmony: 7–12% white glass inside the folder; oldest row expanded with age chip + accent button.

### AgeingIndicator
- Narangi: dotted baseline, arcs between bills, red dot for oldest, accent dots, ink dot "Aaj".
- Harmony: solid white line to "now", ▼ marker, dotted remainder; labels above.

---

## Bill flow

### RepeatCard — "Pichle jaisa hi?"
Ref: `narangi/03-new-bill`
- Lavender panel (Narangi) / glass row (Harmony). Summary of last bill + `bill.repeat.fill` (accent) and `bill.repeat.fresh` (ghost). After fill, the primary becomes a white "✓ Bhar diya".

### LineItemCard
- Label `KAAM 01`, remove button, `Kya kiya?` field, then 3-column grid: Kitna · Rate (₹) · Rakam (computed, right-aligned).
- Fields: 48–50px, `--eb-radius-field`, `--eb-surface-2`, focus ring `--eb-focus`.

### TotalCard
- `Total` + money hero, item count, note `bill.english.note` with globe icon.

### PrimaryCTA
- Sticky at bottom (24px), full width minus gutters, 62–64px.
- Narangi: `--eb-accent` pill, label left, 48px ink disc with accent arrow right, `--eb-shadow-cta`.
- Harmony: `--eb-g-cta` glow pill, centred white label, `--eb-shadow-cta`.

### WhatsAppButton
- Same shape as PrimaryCTA in both themes, `--eb-whatsapp` fill, `--eb-on-whatsapp` text, dark disc with send icon. Only place the WhatsApp green appears.

### InvoicePaper (theme-independent)
Ref: `narangi/04-bill-done`
- White, radius 22, ink text, English only: TAX INVOICE / seller + GSTIN / Bill to / items table / Total / UPI QR + ID. Tax lines go under the items table when the engine supplies them.

### SuccessHeader
- Accent disc 76px with check + two halo rings (accent at 25% / 12%). `bill.done` headline on the hero.

---

## Reminders

### ToneSegmented
Ref: `*/05-remind`
- 3 options: Pyaar se · Seedha · Doosri baar. 44px segments.
- Narangi: glass track on the hero, selected = white with ink text. Harmony: glass track on ground, selected = accent with ink text.

### MessagePreview
- Narangi: white speech bubble (radius 28 28 28 8) on the green/orange hero.
- Harmony: message inside a FolderPanel; peeking cards show the attachment and last reminder date.
- Attachment row: PDF thumb · file name · `remind.attach` / UPI · edit button.
- Text from `remind.msg.*` with placeholders; `white-space: pre-line`.

---

## Customer folder (Harmony ref, build in both)
Ref: `harmony/03-customer`
- FolderPanel with the customer's last three bills peeking.
- Period total + due on one line; `AgeingIndicator` as paid-vs-billed slider.
- **Timeline:** 38px file icon, dashed tick rail, entries per bill. Latest entry expands to a glass card: WhatsApp status (sent / read) + time chip, bill thumbnail, `Yaad dilao`. Paid entries show an accent check + "Aa gaye · UPI".
- Bottom CTA `bill.again`.

---

## GST
Ref: `narangi/06-gst`
- Only when `profile.gstin` exists.
- Hero uses `--eb-g-gst` (teal in both themes; Harmony renders it as a folder).
- Two stat tiles (Bills, GST), rate split bar + table (Rate / Bikri / CGST / SGST / Total), B2B list, B2C note, `gst.send` primary CTA.

---

## Profile (Aap)
Ref: `narangi/07-profile`
- Identity header (avatar ring), fields: name, phone (locked, `profile.phone.hint`), GSTIN (optional; helper switches between `profile.gst.none` / `profile.gst.on`), UPI, city.
- **Language** segmented: Hinglish / English.
- **Theme** segmented: Narangi / Harmony (with a swatch dot each). Optional third option `theme.system`. Saving sets `profile.theme` and calls `applyTheme()`.
- `action.save` ink button.

---

## Auth
- Narangi `01-login`: gradient hero with a floating mini-bill, phone field with +91, 6 OTP boxes (filled, active with 2px ink ring, empty), resend timer, ink CTA with accent disc.
- Harmony `01-welcome`: dotted ground, floating white file tiles linked by thin lines to a green folder, prompt box, headline with gradient word, glow CTA. Follow with the OTP step in Harmony tokens.
