// Values the composer may emit. Anything outside these lists is dropped when the
// message is serialized, so pasted or crafted content cannot reach the wire.

/** Stored font names mapped to email-safe stacks. */
export const FONT_STACKS: Record<string, string> = {
  Arial: 'Arial, Helvetica, sans-serif',
  Georgia: 'Georgia, serif',
  'Times New Roman': '"Times New Roman", Times, serif',
  'Courier New': '"Courier New", Courier, monospace',
  Verdana: 'Verdana, Geneva, sans-serif',
  Tahoma: 'Tahoma, Geneva, sans-serif',
  'Trebuchet MS': '"Trebuchet MS", Helvetica, sans-serif',
};

/** Menu labels, Gmail style. Value '' means the message default (Arial). */
export const FONT_MENU: { label: string; value: string }[] = [
  { label: 'Sans Serif', value: '' },
  { label: 'Serif', value: 'Times New Roman' },
  { label: 'Fixed width', value: 'Courier New' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Tahoma', value: 'Tahoma' },
  { label: 'Trebuchet MS', value: 'Trebuchet MS' },
  { label: 'Verdana', value: 'Verdana' },
];

export const DEFAULT_FONT = FONT_STACKS.Arial;
export const DEFAULT_SIZE = '14px';
export const FONT_SIZES = ['12px', '14px', '16px', '20px', '24px'];
/** Gmail-style size menu. Value '' means the default size. */
export const SIZE_MENU: { label: string; value: string }[] = [
  { label: 'Small', value: '12px' },
  { label: 'Normal', value: '' },
  { label: 'Large', value: '20px' },
  { label: 'Huge', value: '24px' },
];

/** Palette offered in the colour menu (text and background). Output accepts any safe colour. */
export const COLORS = [
  '#000000', '#444444', '#666666', '#999999', '#cccccc', '#eeeeee', '#f3f3f3', '#ffffff',
  '#d93025', '#e37400', '#f9ab00', '#188038', '#12a4af', '#1a73e8', '#9334e6', '#c5221f',
  '#fad2cf', '#feefc3', '#fef7e0', '#ceead6', '#cbf0f8', '#d2e3fc', '#e9d2fd', '#fde7e9',
];

export const MAX_INDENT = 4;
export const INDENT_PX = 40;

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

export function isSafeColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value) ||
      /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(value) ||
      // Named colours such as "yellow" (Word highlights): letters only, so no url() or escapes.
      /^[a-z]{3,20}$/i.test(value))
  );
}

/** Maps a stored or pasted font-family value to an allowed stack, or null. */
export function fontStack(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const first = value.split(',')[0].trim().replace(/^["']|["']$/g, '');
  return FONT_STACKS[first] ?? null;
}

export function fontSize(value: unknown): string | null {
  return typeof value === 'string' && FONT_SIZES.includes(value) ? value : null;
}

/**
 * Strict check used on output. A bare host such as "example.com" gets https://.
 * Returns the normalized href, or null when the link must be dropped.
 */
export function safeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
  if (!raw || /[\u0000-\u001f\s]/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    return SAFE_PROTOCOLS.includes(url.protocol) ? withScheme : null;
  } catch {
    return null;
  }
}

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_CHAR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

/** Direction of the first strongly directional character, like dir="auto". */
export function detectDir(text: string): 'rtl' | 'ltr' | null {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return 'rtl';
    if (LTR_CHAR.test(ch)) return 'ltr';
  }
  return null;
}
