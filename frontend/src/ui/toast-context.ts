import { createContext, useContext } from 'react';

export type ToastKind = 'success' | 'error' | 'info';
export interface ToastAction { label: string; run: () => void }
export type ShowToast = (kind: ToastKind, text: string, action?: ToastAction) => void;

export const ToastContext = createContext<ShowToast>(() => undefined);

/** Short status messages in the corner (sent, deleted, errors), optionally with one action such as Undo. */
export const useToast = () => useContext(ToastContext);
