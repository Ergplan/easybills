/**
 * How a bill looks when it leaves the shop: the design, the paper, the
 * colour, the logo, and whether WhatsApp gets a PDF or a photo.
 *
 * None of this changes what a bill says -- the numbers, the GST, the parties
 * all come from the issued snapshot. It is presentation, chosen once under
 * Aap and used for every bill, with a different size a tap away when a
 * counter printer needs a receipt. Pure.
 */
import { t } from '@/lib/copy';

export const BILL_DESIGNS = ['classic', 'modern', 'simple'] as const;
export type BillDesign = (typeof BILL_DESIGNS)[number];

export const BILL_PAPERS = ['a4', 'a5', '80mm', '58mm'] as const;
export type BillPaper = (typeof BILL_PAPERS)[number];

export const BILL_SHARE = ['pdf', 'jpg'] as const;
export type BillShareAs = (typeof BILL_SHARE)[number];

/** Colours that print well and read on a phone. The first is the default. */
export const BILL_ACCENTS = ['#2f4a9e', '#0f766e', '#b45309', '#be123c', '#6d28d9', '#1f2937'] as const;

export interface PaperSpec {
  /** Page width in millimetres. */
  widthMm: number;
  /** Page height, or null for a roll that is as long as the bill. */
  heightMm: number | null;
  /** A narrow roll: one column, no table, as a counter printer prints it. */
  receipt: boolean;
  /** CSS pixels across, for the photo version (96 per inch). */
  widthPx: number;
}

export const PAPER: Record<BillPaper, PaperSpec> = {
  a4: { widthMm: 210, heightMm: 297, receipt: false, widthPx: 794 },
  a5: { widthMm: 148, heightMm: 210, receipt: false, widthPx: 559 },
  '80mm': { widthMm: 80, heightMm: null, receipt: true, widthPx: 302 },
  '58mm': { widthMm: 58, heightMm: null, receipt: true, widthPx: 219 },
};

export interface BillLook {
  design: BillDesign;
  paper: BillPaper;
  shareAs: BillShareAs;
  accent: string;
}

export const DEFAULT_LOOK: BillLook = { design: 'classic', paper: 'a4', shareAs: 'pdf', accent: BILL_ACCENTS[0] };

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  (list as readonly unknown[]).includes(v) ? (v as T) : fallback;

/** The look saved on a business, with defaults for anything never chosen. */
export function lookOf(b: { billDesign?: unknown; billPaper?: unknown; billShareAs?: unknown; accentColour?: unknown }): BillLook {
  return {
    design: oneOf(BILL_DESIGNS, b.billDesign, DEFAULT_LOOK.design),
    paper: oneOf(BILL_PAPERS, b.billPaper, DEFAULT_LOOK.paper),
    shareAs: oneOf(BILL_SHARE, b.billShareAs, DEFAULT_LOOK.shareAs),
    accent: isHex(b.accentColour) ? b.accentColour : DEFAULT_LOOK.accent,
  };
}

/**
 * What a download link asked for, over the saved look. Anything unknown in
 * the query falls back to the saved choice rather than failing the download.
 */
export function lookFromQuery(query: URLSearchParams, saved: BillLook): { look: BillLook; format: BillShareAs } {
  return {
    look: {
      ...saved,
      design: oneOf(BILL_DESIGNS, query.get('design'), saved.design),
      paper: oneOf(BILL_PAPERS, query.get('paper'), saved.paper),
    },
    format: oneOf(BILL_SHARE, query.get('format'), saved.shareAs),
  };
}

/** Names the owner sees. */
export function designName(d: BillDesign): string {
  return t(({ classic: 'look.design.classic', modern: 'look.design.modern', simple: 'look.design.simple' } as const)[d]);
}
export function paperName(p: BillPaper): string {
  return t(({ a4: 'look.paper.a4', a5: 'look.paper.a5', '80mm': 'look.paper.80mm', '58mm': 'look.paper.58mm' } as const)[p]);
}

/** Largest logo kept, as a data URL. The browser shrinks the picture well below this. */
export const LOGO_MAX_CHARS = 300_000;

/**
 * A logo is a small picture the owner uploaded, kept as a data URL. Only
 * PNG, JPEG and WebP get through, and nothing that could be markup or a
 * link to somewhere else.
 */
export function checkLogo(dataUrl: string | null | undefined): { ok: true; value: string | null } | { ok: false; message: string } {
  if (!dataUrl) return { ok: true, value: null };
  if (dataUrl.length > LOGO_MAX_CHARS) return { ok: false, message: t('look.logo.tooBig') };
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) return { ok: false, message: t('look.logo.bad') };
  return { ok: true, value: dataUrl };
}

/** Parse a posted look, strictly: this is what gets saved. */
export function parseLook(input: Partial<Record<keyof BillLook, unknown>>): BillLook {
  return lookOf({ billDesign: input.design, billPaper: input.paper, billShareAs: input.shareAs, accentColour: input.accent });
}
