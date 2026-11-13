import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './icons';

/** Either `onSelect`, or a `value` handed to the menu's `onPick`. */
export interface MenuItem { label: string; icon?: ReactNode; onSelect?: () => void; value?: string; disabled?: boolean; danger?: boolean }

/** Toolbar button that opens a small menu (WAI-ARIA menu button: arrows, Escape, outside click). */
/** `compact`: an icon-only button (for folder rows); `align="end"` opens the list towards the left. */
export function Menu({ label, icon, items, disabled, tip, compact, align, onPick }: {
  /** A function is called only when the menu opens (for lists built from live data). */
  label: string; icon: ReactNode; items: MenuItem[] | (() => MenuItem[]); disabled?: boolean; tip?: string; compact?: boolean; align?: 'start' | 'end';
  onPick?: (item: MenuItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const entries = typeof items === 'function' ? (open ? items() : []) : items;

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  };

  return (
    <div className="menu" ref={root} onKeyDown={onKey}>
      <button
        type="button"
        className={compact ? 'icon-btn menu-trigger' : 'tool-btn'}
        aria-label={compact ? label : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        data-tip={tip ?? label}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {!compact && <span className="tool-label">{label}<span className="caret">{Icon.chevronDown}</span></span>}
      </button>
      {open && (
        <ul role="menu" id={id} ref={list} className={`menu-list ${align === 'end' ? 'end' : ''}`} aria-label={label}>
          {entries.map((it) => (
            <li role="none" key={it.label}>
              <button
                type="button"
                role="menuitem"
                className={it.danger ? 'danger-text' : undefined}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  if (it.onSelect) it.onSelect();
                  else onPick?.(it);
                }}
              >
                {it.icon}
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
