import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';
import { ToastContext, type ToastKind } from './toast-context';

interface Toast { id: number; kind: ToastKind; text: string }

const ICON = { success: Icon.check, error: Icon.alert, info: Icon.info };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (kind: ToastKind, text: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-2), { id, kind, text }]);
      window.setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {ICON[t.kind]}
            <span>{t.text}</span>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>{Icon.x}</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
