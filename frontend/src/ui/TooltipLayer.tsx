import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

const SELECTOR = '[data-tip], button.icon-btn[aria-label], a.icon-btn[aria-label]';
const HOVER_DELAY = 450;

interface Tip { text: string; x: number; top: number; bottom: number }

/**
 * One tooltip for the whole app. Shown for elements with data-tip (or icon-only buttons,
 * using their accessible name) on mouse hover after a short delay, and at once on keyboard
 * focus. WCAG 1.4.13: Escape dismisses it, the pointer can move onto it, and it stays until
 * the pointer or focus leaves. Touch screens do not get hover tips; labels stay visible there.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const target = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const textOf = (el: HTMLElement) => el.dataset.tip || el.getAttribute('aria-label') || '';
    const hide = () => {
      window.clearTimeout(timer.current);
      if (target.current?.getAttribute('aria-describedby') === id) target.current.removeAttribute('aria-describedby');
      target.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement, delay: number) => {
      const text = textOf(el);
      if (!text || (el as HTMLButtonElement).disabled) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (!el.isConnected) return;
        const r = el.getBoundingClientRect();
        target.current = el;
        // Only describe when the tip adds something the accessible name does not say.
        if (el.getAttribute('aria-label') !== text && !el.hasAttribute('aria-describedby')) el.setAttribute('aria-describedby', id);
        setTip({ text, x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
      }, delay);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const t = e.target as Element;
      if (box.current?.contains(t)) return; // hoverable: moving onto the tip keeps it
      const el = t.closest?.(SELECTOR) as HTMLElement | null;
      if (el === target.current) return;
      if (el) show(el, HOVER_DELAY);
      else hide();
    };
    const focusIn = (e: FocusEvent) => {
      const el = (e.target as Element).closest?.(SELECTOR) as HTMLElement | null;
      if (el && el.matches(':focus-visible')) show(el, 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [id]);

  // Place below the element (above when there is no room), kept inside the window.
  useLayoutEffect(() => {
    if (!tip || !box.current) {
      setPos(null);
      return;
    }
    const w = box.current.offsetWidth;
    const h = box.current.offsetHeight;
    const below = tip.bottom + 8 + h < window.innerHeight;
    setPos({
      left: Math.min(Math.max(8, tip.x - w / 2), window.innerWidth - w - 8),
      top: below ? tip.bottom + 8 : tip.top - 8 - h,
    });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={box}
      id={id}
      role="tooltip"
      className="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
      onPointerLeave={() => setTip(null)}
    >
      {tip.text}
    </div>
  );
}
