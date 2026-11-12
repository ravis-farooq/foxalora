import { createContext, useContext } from 'react';
import type { Preferences } from '../api';

export const DEFAULT_PREFS: Preferences = { displayName: '', theme: 'system', density: 'comfortable', timeZone: 'auto' };

export interface PrefsState {
  prefs: Preferences;
  /** Saves a change and applies it at once; rejects with the server's message. */
  save: (change: Partial<Preferences>) => Promise<void>;
  reset: () => Promise<void>;
}

export const PrefsContext = createContext<PrefsState>({ prefs: DEFAULT_PREFS, save: async () => undefined, reset: async () => undefined });
export const usePrefs = () => useContext(PrefsContext);
