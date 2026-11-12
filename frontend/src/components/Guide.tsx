import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, Logo } from '../ui/icons';

interface Step { target?: string; title: string; body: string }

// Plain words, one idea per step. Targets are elements with a matching data-guide attribute.
const STEPS: Step[] = [
  { title: 'Welcome to Foxalora Mail', body: 'This short tour shows you around. It takes about a minute. You can skip it and open it again from Help.' },
  { target: 'compose', title: 'Write an email', body: 'Press Compose to start a new message. If you close it before sending, it is kept safe in Drafts.' },
  { target: 'folders', title: 'Your folders', body: 'New mail arrives in Inbox. Sent, Drafts, Junk and Trash are below it. A number shows how many messages are unread.' },
  { target: 'search', title: 'Find a message', body: 'Type a name, an address or words from the subject, then press Enter.' },
  { target: 'toolbar', title: 'Reply, forward or delete', body: 'Open a message, then use these buttons. Point at any button, or move to it with the Tab key, to see what it does.' },
  { target: 'contacts', title: 'People you write to', body: 'Keep your contacts here. When you type a name in the To box, Foxalora suggests the address for you.' },
  { target: 'settings', title: 'Make it yours', body: 'Add your name and a signature, switch to dark mode, and more.' },
];

interface Box { left: number; top: number; width: number; height: number }

/** First-run guide with a highlight on each part of the screen. Escape or Skip ends it. */
export default function Guide({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const [spot, setSpot] = useState<Box | null>(null);
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useLayoutEffect(() => {
    const place = () => {
      const el = step.target ? document.querySelector<HTMLElement>(`[data-guide="${step.target}"]`) : null;
      const r = el?.getBoundingClientRect();
      // Hidden targets (for example the folder list on a phone) get a centred card instead.
      const visible = r && r.width > 0 && r.height > 0 && el!.offsetParent !== null;
      const box = visible ? { left: r!.left - 6, top: r!.top - 6, width: r!.width + 12, height: r!.height + 12 } : null;
      setSpot(box);
      const c = card.current;
      if (!c) return;
      const w = c.offsetWidth, h = c.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
      if (!box || vw < 640) {
        setCardPos({ left: (vw - w) / 2, top: box && box.top > vh / 2 ? Math.max(12, box.top - h - 16) : Math.max(12, (vh - h) / 2) });
        return;
      }
      const right = box.left + box.width + 16;
      const left = right + w < vw ? right : box.left - w - 16 > 0 ? box.left - w - 16 : (vw - w) / 2;
      const top = Math.min(Math.max(12, box.top), vh - h - 12);
      setCardPos({ left, top: left === (vw - w) / 2 ? Math.min(box.top + box.height + 16, vh - h - 12) : top });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [step]);

  useEffect(() => {
    card.current?.querySelector<HTMLButtonElement>('[data-next]')?.focus();
  }, [i]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onDone();
    } else if (e.key === 'Tab') {
      const buttons = [...(card.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      const k = buttons.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      buttons[(k + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  };

  return (
    <div className="guide-layer" onKeyDown={onKey}>
      {spot ? <div className="guide-spot" style={spot} aria-hidden="true" /> : <div className="guide-dim" aria-hidden="true" />}
      <div
        ref={card}
        className="guide-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        aria-describedby="guide-body"
        style={cardPos ?? { left: -9999, top: 0 }}
      >
        {i === 0 && <Logo size={40} className="brand" />}
        <p className="guide-count">Step {i + 1} of {STEPS.length}</p>
        <h2 id="guide-title">{step.title}</h2>
        <p id="guide-body">{step.body}</p>
        <div className="guide-dots" aria-hidden="true">
          {STEPS.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}
        </div>
        <div className="guide-actions">
          <button type="button" className="link" onClick={onDone}>{last ? 'Close' : 'Skip tour'}</button>
          <span className="grow" />
          {i > 0 && <button type="button" className="ghost" onClick={() => setI(i - 1)}>{Icon.chevronLeft} Back</button>}
          <button type="button" className="primary" data-next onClick={() => (last ? onDone() : setI(i + 1))}>
            {last ? 'Start using Foxalora' : i === 0 ? 'Show me around' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
