import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { api, type Suggestion } from '../api';
import { avatarOf } from '../mail/format';

/** Last address being typed in a comma- or semicolon-separated list. */
const currentToken = (v: string) => v.split(/[,;]/).pop()!.trim();

/**
 * Recipient field with suggestions from the address book (FOX-073), as a WAI-ARIA combobox:
 * arrows move, Enter or Tab picks, Escape closes.
 */
export default function RecipientInput({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const id = useId();
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function update(v: string) {
    onChange(v);
    window.clearTimeout(timer.current);
    const token = currentToken(v);
    const n = ++seq.current;
    if (token.length < 2) {
      setOpen(false);
      return;
    }
    timer.current = window.setTimeout(() => {
      api.suggest(token).then(
        (r) => {
          if (n !== seq.current) return;
          setItems(r);
          setActive(0);
          setOpen(r.length > 0);
        },
        () => undefined, // suggestions are optional; typing still works
      );
    }, 150);
  }

  function pick(s: Suggestion) {
    const before = value.split(/[,;]/).slice(0, -1).map((p) => p.trim()).filter(Boolean);
    onChange([...before, s.email].join(', ') + ', ');
    seq.current++;
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // close the list, not the compose window
      setOpen(false);
    }
  }

  return (
    <span className="recipient">
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        value={value}
        onChange={(e) => update(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
      />
      {open && (
        <ul role="listbox" id={id} className="suggestions" aria-label={`${label} suggestions`}>
          {items.map((s, i) => {
            const av = avatarOf({ name: s.name, address: s.email });
            return (
              <li
                key={s.email}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown, so the input does not lose focus before the pick
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
              >
                <span className="avatar small" style={{ '--h': av.hue } as CSSProperties} aria-hidden="true">{av.letter}</span>
                <span className="suggestion-text">
                  <strong className="ellipsis">{s.name || s.email}</strong>
                  {s.name && <small className="ellipsis">{s.email}</small>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </span>
  );
}
