import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './icons';

interface MenuButtonProps {
  label: string;
  icon: ReactNode;
  /** Text shown next to the icon (e.g. current font). */
  text?: string;
  chevron?: boolean;
  active?: boolean;
  /** Where the panel opens. The Gmail-style bar sits at the bottom, so 'up' by default. */
  placement?: 'up' | 'down';
  role?: 'menu' | 'dialog';
  children: (close: () => void) => ReactNode;
}

/**
 * Toolbar button with a panel. The panel is fixed-positioned from the button's
 * rectangle, so it is not clipped when the toolbar scrolls sideways on phones.
 * mousedown is prevented on the trigger so the editor keeps its selection.
 */
export function MenuButton({ label, icon, text, chevron, active, placement = 'up', role = 'menu', children }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const [byKeyboard, setByKeyboard] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Closing from inside the panel leaves focus where the chosen action put it.
  const closePanel = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 8 - (panel.current?.offsetWidth ?? 240)));
    setPos(placement === 'up' ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape is the one case that returns focus to the trigger button.
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    };
    const onMove = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    // Keyboard users get focus moved into the panel. Mouse users keep focus (and the
    // selection) in the editor; moving it away and back races ProseMirror's selection.
    if (byKeyboard) requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus());
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
    };
  }, [open, byKeyboard]);

  return (
    <span className="fx-menu">
      <button
        ref={btn}
        type="button"
        data-tb
        className={`fx-btn${text ? ' fx-btn-text' : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup={role === 'menu' ? 'menu' : 'dialog'}
        aria-expanded={open}
        aria-pressed={active || undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          setByKeyboard(e.detail === 0); // detail is 0 for Enter/Space activation
          setOpen((o) => !o);
        }}
      >
        {icon}
        {text && <span className="fx-btn-label">{text}</span>}
        {chevron && Icon.chevron}
      </button>
      {open && (
        <div
          ref={panel}
          className="fx-pop"
          role={role}
          aria-label={label}
          style={{ position: 'fixed', ...pos }}
          onKeyDown={(e) => {
            // Arrow keys move between menu options (WAI-ARIA menu pattern).
            if (role !== 'menu' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
            const items = [...(panel.current?.querySelectorAll<HTMLElement>('button') ?? [])];
            const i = items.indexOf(document.activeElement as HTMLElement);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            e.preventDefault();
            items[next]?.focus();
          }}
        >
          {children(closePanel)}
        </div>
      )}
    </span>
  );
}

/** One option in a menu panel. */
export function MenuItem(props: { label: string; checked?: boolean; onSelect: () => void; style?: CSSProperties; icon?: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={!!props.checked}
      className="fx-menuitem"
      style={props.style}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onSelect}
    >
      <span className="fx-check" aria-hidden="true">{props.checked ? '✓' : ''}</span>
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}
