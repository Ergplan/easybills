# EkBill design pack

The UI source of truth for EkBill: a billing app for someone who raises about one bill a week, to the same dozen people, from a phone, on WhatsApp, in Hinglish.

Drop this folder into the repo as `design/`. Agents and humans build screens from it; nobody invents colours, radii, copy or layouts outside it.

## Two themes, one app

| | **Narangi** (default, light) | **Harmony** (dark) |
|---|---|---|
| Feel | Warm paper, orange gradient hero, lavender money panel | Charcoal, green glass folders, green glow |
| Ground | `#EEEEEA` + 9px dot grid | `#0B0E0D` + 14px dot grid + top-right glow |
| Accent | Saffron `#FFB020`, ink text on it | Harmony Green `#68E78E`, ink text on it |
| Hero component | Gradient card with wave lines | Folder: back plate, peeking glass bills, tabbed front |
| Primary CTA | Saffron pill with ink arrow disc | Glow pill (dark centre → green rim) |
| Status | Paid `#1E6B3A` / Due `#B3261E` on tints | Paid `#68E78E` / Due `#FF8A80` on 14% tints |

Both themes share layout, spacing, radii, type and copy. Only tokens and the hero/CTA treatment change.

**Switching.** The theme lives on the user profile (`profile.theme`: `"narangi" | "harmony" | "system"`), set from Aap → Theme. Apply it with `data-theme` on `<html>`; with no attribute, the OS decides (light = Narangi, dark = Harmony).

```ts
import { applyTheme } from "@/design/tokens/tokens";
applyTheme(profile.theme ?? "system");
```

```css
/* app entry */
@import "../design/tokens/fonts.css";
@import "../design/tokens/themes.css";
.card { background: var(--eb-surface); border-radius: var(--eb-radius-card); box-shadow: var(--eb-shadow-card); }
.hero { background: var(--eb-g-hero); color: var(--eb-on-hero); }
```

The invoice/PDF is **theme-independent**: always white paper, ink text, formal English.

## What's in here

```
design/
├── README.md            ← you are here
├── CLAUDE.md            ← rules for coding agents (read first)
├── components.md        ← every component, its tokens, and how it differs per theme
├── tokens/
│   ├── tokens.json      ← SOURCE OF TRUTH (edit this)
│   ├── build.py         ← regenerates themes.css + tokens.ts
│   ├── themes.css       ← generated CSS variables for both themes
│   ├── tokens.ts        ← generated typed tokens + applyTheme()
│   └── fonts.css        ← self-hosted Urbanist @font-face
├── fonts/               ← Urbanist woff2 300–700, Latin + Latin-ext (₹), OFL licence
├── copy/
│   ├── strings.json     ← one dictionary, both registers, keyed
│   ├── hi-Latn.json     ← default app voice (Hinglish, Latin script)
│   └── en.json          ← English toggle
├── fixtures/demo.json   ← the data every mock uses (money in paise)
├── screens/
│   ├── narangi/*.html|png   ← reference screens, theme 1
│   └── harmony/*.html|png   ← reference screens, theme 2
└── source/canvas/       ← editable design-canvas source (.dc.html + canvas.json)
```

## Screen map

| Route | Narangi reference | Harmony reference |
|---|---|---|
| `/login` (phone + OTP) | `01-login` | `01-welcome` (onboarding hero) + Narangi OTP layout in Harmony tokens |
| `/` home | `02-home` | `02-home` |
| `/customers/:id` | build from Harmony layout in Narangi tokens | `03-customer` |
| `/bills/new?customer=` | `03-new-bill` | Narangi layout in Harmony tokens |
| `/bills/:id/done` | `04-bill-done` | Narangi layout; hero becomes a folder |
| `/bills/:id/remind` | `05-remind` | `05-remind` |
| `/gst` (only if GSTIN set) | `06-gst` | Narangi layout; teal folder (`--eb-g-gst`) |
| `/me` | `07-profile` | Narangi layout in Harmony tokens |
| Kits | `00-kit` | `00-kit` |

Where a screen exists in only one theme, the layout is the same; swap tokens and apply the theme's hero/CTA rule from `components.md`.

## Product rules the design encodes

1. **Home = three questions, nothing else.** Kiska bill (client chips) · Bheje hue bills · Kiske paise aane hain.
2. **Two registers.** App speaks Hinglish (`copy/hi-Latn.json`). The bill speaks formal English. Never mix.
3. **WhatsApp is the door.** Every bill ends in `action.whatsapp`; every reminder is a WhatsApp message. `#25D366` appears only on that button.
4. **No new concepts.** Bill, customer, paise aane hain, GST number. No schedules, periods or returns.
5. **GST tab appears only when a GSTIN exists.**
6. **Money:** integer paise in data; display with Indian grouping (`₹1,12,400`), tabular figures, regular Urbanist (no dot-matrix or display numerals). Hero amounts: figures 500, ₹ 300 at ~55% size.

## Open decisions (carry into the build)

- The bill preview is titled "Tax Invoice" for a GST-registered seller but shows no CGST/SGST lines (total ₹6,200). The tax engine must decide whether that bill shows tax lines; the design leaves room for them under the items table.
- GST demo figures were corrected from the concept doc: GST total is ₹19,392 (not ₹20,232); B2B = 6 bills, B2C = 8.
- Hinglish-first excludes non-Hindi-belt users in v1. Every string is keyed, so adding a language is a new JSON file, not a rewrite.

## Regenerating tokens

```bash
python3 design/tokens/build.py   # after editing tokens.json
```

Fonts: Urbanist by Corey Hu, SIL Open Font License 1.1 (`fonts/OFL-LICENSE.txt`), self-hosted from the Fontsource package.
