import { createContext, useContext } from 'react';

export type ToastKind = 'success' | 'error' | 'info';
export type ShowToast = (kind: ToastKind, text: string) => void;

export const ToastContext = createContext<ShowToast>(() => undefined);

/** Short status messages in the corner (sent, deleted, errors). */
export const useToast = () => useContext(ToastContext);
