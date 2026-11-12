import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ConfirmContext, type ConfirmOptions } from './confirm-context';
import { Icon } from './icons';

interface Pending extends ConfirmOptions { resolve: (ok: boolean) => void }

/**
 * One confirmation dialog for the whole app (role="alertdialog"): focus moves into it and
 * stays there, Escape cancels, and focus returns to where it was afterwards.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        returnTo.current = document.activeElement as HTMLElement | null;
        setPending({ ...o, resolve });
      }),
    [],
  );

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
    returnTo.current?.focus?.();
  };

  useEffect(() => {
    if (!pending) return;
    const target = box.current?.querySelector<HTMLButtonElement>(pending.danger ? '[data-cancel]' : '[data-confirm]');
    target?.focus();
  }, [pending]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(false);
    } else if (e.key === 'Tab') {
      const buttons = [...(box.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div className="modal confirm-layer" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div ref={box} className="dialog confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={pending.message ? `${id}-m` : undefined} onKeyDown={onKeyDown}>
            <div className={`confirm-icon ${pending.danger ? 'danger' : ''}`} aria-hidden="true">{pending.danger ? Icon.alert : Icon.info}</div>
            <h2 id={`${id}-t`}>{pending.title}</h2>
            {pending.message && <p id={`${id}-m`} className="muted">{pending.message}</p>}
            <div className="form-actions">
              <button type="button" className="ghost" data-cancel onClick={() => close(false)}>{pending.cancelLabel ?? 'Cancel'}</button>
              <button type="button" className={pending.danger ? 'primary danger' : 'primary'} data-confirm onClick={() => close(true)}>{pending.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
