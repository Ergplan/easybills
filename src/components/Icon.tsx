/**
 * Line icons, drawn inline.
 *
 * Emoji were doing this job before. They render as a different typeface on
 * every platform, sit on their own baseline, and carry a consumer-app tone
 * that a document people send to their customers should not have. These are
 * one stroke weight, inherit `currentColor`, and scale with the text.
 */
export type IconName =
  | 'home' | 'bills' | 'customers' | 'settings' | 'mic' | 'back' | 'plus' | 'person' | 'gst'
  | 'bill-new' | 'rupee' | 'ask' | 'upload' | 'help' | 'search' | 'chevron';

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M3 10.2 12 3l9 7.2M5.5 8.8V20h13V8.8M9.8 20v-5.6h4.4V20" />,
  bills: (
    <>
      <path d="M6 2.8h12v18.4l-2.4-1.6-2.4 1.6-2.4-1.6L8.4 21.2 6 19.6V2.8Z" />
      <path d="M9.2 8h5.6M9.2 12h5.6M9.2 16h3.2" />
    </>
  ),
  customers: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 20c0-3.4 2.8-5.6 6.2-5.6s6.2 2.2 6.2 5.6" />
      <path d="M16.2 5.2a3.2 3.2 0 0 1 0 5.9M17.6 14.8c2.2.5 3.6 2.4 3.6 5.2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.6v2.6M12 18.8v2.6M21.4 12h-2.6M5.2 12H2.6M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8M18.6 18.6l-1.8-1.8M7.2 7.2 5.4 5.4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2.6" width="6" height="11" rx="3" />
      <path d="M5.4 11.2a6.6 6.6 0 0 0 13.2 0M12 17.8v3.6" />
    </>
  ),
  back: <path d="M15 4.5 7.5 12l7.5 7.5" />,
  person: (
    <>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M4.6 20.4c0-3.8 3.3-6.4 7.4-6.4s7.4 2.6 7.4 6.4" />
    </>
  ),
  gst: (
    <>
      <rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2" />
      <path d="M3.4 9.6h17.2M9.2 9.6v10M3.4 14.6h17.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  'bill-new': (
    <>
      <path d="M6 2.8h9.2L18 5.6v6.2M6 2.8v18.4l2.4-1.6 2.4 1.6 1.4-.9" />
      <path d="M9.2 8h5.6M9.2 12h4" />
      <path d="M18 14.6v6M15 17.6h6" />
    </>
  ),
  rupee: (
    <>
      <path d="M7 4.5h10M7 8.5h10" />
      <path d="M7 4.5h3.5a4 4 0 0 1 0 8H7l7.5 7" />
    </>
  ),
  ask: (
    <>
      <path d="M4 5.6c0-1.3 1-2.2 2.2-2.2h11.6c1.2 0 2.2.9 2.2 2.2v8.6c0 1.2-1 2.2-2.2 2.2H10l-4.6 3.8v-3.8h-.4c-.6 0-1-.4-1-1V5.6Z" />
      <path d="M9.8 8.2a2.2 2.2 0 1 1 3 2c-.5.2-.8.7-.8 1.2v.3M12 14.1v.1" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4.5 14.5v4a1.6 1.6 0 0 0 1.6 1.6h11.8a1.6 1.6 0 0 0 1.6-1.6v-4" />
    </>
  ),
  help: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8 8h3M9.5 6.5v3M13.5 8h3M8 15.5h3M13.5 14h3M13.5 17h3" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  chevron: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
};

export function Icon({
  name,
  size = 22,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
