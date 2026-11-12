import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';
import { ToastContext, type ToastAction, type ToastKind } from './toast-context';

interface Toast { id: number; kind: ToastKind; text: string; action?: ToastAction }

const ICON = { success: Icon.check, error: Icon.alert, info: Icon.info };
// Messages with an action stay longer; errors stay until dismissed (WCAG 2.2.1: enough time).
const LIFETIME = { success: 5000, info: 6000, action: 10000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const schedule = useCallback(
    (t: Toast) => {
      if (t.kind === 'error') return;
      timers.current.set(t.id, window.setTimeout(() => dismiss(t.id), t.action ? LIFETIME.action : LIFETIME[t.kind]));
    },
    [dismiss],
  );

  const show = useCallback(
    (kind: ToastKind, text: string, action?: ToastAction) => {
      const t = { id: nextId.current++, kind, text, action };
      setToasts((list) => [...list.slice(-2), t]);
      schedule(t);
    },
    [schedule],
  );

  // Hovering or focusing a message pauses its timer, so it can be read and acted on.
  const pause = (id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  };

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind}`}
            role={t.kind === 'error' ? 'alert' : 'status'}
            onMouseEnter={() => pause(t.id)}
            onFocus={() => pause(t.id)}
            onMouseLeave={() => schedule(t)}
          >
            {ICON[t.kind]}
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(t.id);
                  t.action!.run();
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="icon-btn" aria-label="Dismiss message" onClick={() => dismiss(t.id)}>{Icon.x}</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
