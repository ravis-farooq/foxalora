import type { Addr, MessageFull } from '../api';

// Display time zone from preferences; undefined means the browser's own.
let timeZone: string | undefined;
export function setDisplayTimeZone(tz: string) {
  timeZone = tz && tz !== 'auto' ? tz : undefined;
}

const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone }); // YYYY-MM-DD in the display zone

/** Today: time. This year: day and month. Older: with the year. */
export function shortDate(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (dayKey(d) === dayKey(now)) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone });
  if (dayKey(d).slice(0, 4) === dayKey(now).slice(0, 4)) return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone });
}

export const fullDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }) : '';

export const formatAddr = (a: Addr) => (a.name ? `${a.name} <${a.address}>` : a.address);
export const displayName = (a: Addr | undefined) => a?.name || a?.address || '(unknown sender)';

/** Letter for the sender avatar, and a stable hue from the address. */
export function avatarOf(a: Addr | undefined): { letter: string; hue: number } {
  const text = a?.name || a?.address || '?';
  const letter = [...text.trim()][0]?.toUpperCase() ?? '?';
  let h = 0;
  for (const ch of (a?.address || text).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { letter, hue: h % 360 };
}

/**
 * Reply all: the sender and the other To recipients go to To, Cc stays Cc, and the
 * user's own address is left out. Replying to a message you sent goes to its recipients.
 */
export function replyAllRecipients(m: Pick<MessageFull, 'from' | 'to' | 'cc'>, me: string): { to: string[]; cc: string[] } {
  const seen = new Set([me.toLowerCase()]);
  const take = (list: Addr[]) =>
    list
      .map((a) => a.address)
      .filter((addr) => {
        const key = addr?.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  const to = take([...m.from, ...m.to]);
  const cc = take(m.cc);
  if (!to.length && !cc.length && m.from[0]?.address) to.push(m.from[0].address); // a note to yourself
  return { to, cc };
}

export const replySubject = (s: string) => (/^re:/i.test(s) ? s : `Re: ${s}`);
export const forwardSubject = (s: string) => (/^(fwd?|fw):/i.test(s) ? s : `Fwd: ${s}`);
