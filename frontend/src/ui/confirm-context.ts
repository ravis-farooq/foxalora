import { createContext, useContext } from 'react';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive actions get a red button, and Cancel keeps the focus. */
  danger?: boolean;
}

export const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

/** Asks the user with a modal dialog; resolves true only when they confirm. */
export const useConfirm = () => useContext(ConfirmContext);
