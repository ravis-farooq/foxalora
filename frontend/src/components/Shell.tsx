import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Preferences, type SignatureRecord } from '../api';
import { setDisplayTimeZone } from '../mail/format';
import { Icon, Logo } from '../ui/icons';
import { DEFAULT_PREFS, PrefsContext } from '../ui/prefs-context';
import { applyTheme, effectiveTheme } from '../ui/theme';
import { useToast } from '../ui/toast-context';
import About from './About';
import Compose, { type ComposeInit } from './Compose';
import Contacts from './Contacts';
import Mailbox from './Mailbox';
import Settings from './Settings';

export type View = 'mail' | 'contacts' | 'settings';

/** Signed-in app: the rail, the current view, and the compose window shared by all views. */
export default function Shell({ email, onLogout }: { email: string; onLogout: () => void }) {
  const toast = useToast();
  const [view, setView] = useState<View>('mail');
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [signatures, setSignatures] = useState<SignatureRecord[]>([]);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const [about, setAbout] = useState(false);

  const apply = useCallback((p: Preferences) => {
    applyTheme(p.theme);
    setDisplayTimeZone(p.timeZone);
    setPrefs(p);
  }, []);

  const loadSignatures = useCallback(() => {
    api.signatures().then(setSignatures, () => undefined);
  }, []);

  useEffect(() => {
    api.preferences().then(apply, (e: Error) => toast('error', e.message));
    loadSignatures();
  }, [toast, loadSignatures, apply]);

  const prefsState = useMemo(
    () => ({
      prefs,
      save: async (change: Partial<Preferences>) => apply(await api.savePreferences(change)),
      reset: async () => {
        await api.resetPreferences();
        apply(await api.preferences());
      },
    }),
    [prefs, apply],
  );

  async function toggleTheme() {
    try {
      await prefsState.save({ theme: effectiveTheme() === 'dark' ? 'light' : 'dark' });
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }

  const composerSignatures = useMemo(
    () => Object.fromEntries(signatures.map((s) => [s.id, { label: s.name, content: s.content }])),
    [signatures],
  );
  const dark = (prefs.theme === 'system' ? effectiveTheme() : prefs.theme) === 'dark';

  const nav = (id: View, label: string, icon: ReactNode) => (
    <button type="button" className={`rail-btn ${view === id ? 'active' : ''}`} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
      <span className="rail-icon">{icon}</span>
      {label}
    </button>
  );

  return (
    <PrefsContext.Provider value={prefsState}>
      <div className={`app ${prefs.density === 'compact' ? 'compact' : ''}`}>
        <nav className="rail" aria-label="Main">
          <div className="rail-logo"><Logo size={34} /></div>
          <button type="button" className="rail-btn compose" onClick={() => setCompose({})}>
            <span className="rail-icon">{Icon.compose}</span>Compose
          </button>
          {nav('mail', 'Mail', Icon.mail)}
          {nav('contacts', 'Contacts', Icon.contacts)}
          {nav('settings', 'Settings', Icon.settings)}
          <span className="grow" />
          <button type="button" className="rail-btn secondary" onClick={toggleTheme}>
            <span className="rail-icon">{dark ? Icon.sun : Icon.moon}</span>
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
          <button type="button" className="rail-btn secondary" onClick={() => setAbout(true)}>
            <span className="rail-icon">{Icon.info}</span>About
          </button>
          <button type="button" className="rail-btn danger" onClick={onLogout}>
            <span className="rail-icon">{Icon.power}</span>Sign out
          </button>
        </nav>

        {view === 'mail' && <Mailbox email={email} onCompose={setCompose} />}
        {view === 'contacts' && <Contacts onCompose={setCompose} />}
        {view === 'settings' && <Settings email={email} signatures={signatures} onSignaturesChanged={loadSignatures} onAbout={() => setAbout(true)} />}

        {compose && (
          <Compose
            init={compose}
            signatures={composerSignatures}
            defaultSignatureId={signatures.find((s) => s.isDefault)?.id}
            onClose={() => setCompose(null)}
            onSent={() => toast('success', 'Message sent.')}
          />
        )}
        {about && <About onClose={() => setAbout(false)} />}
      </div>
    </PrefsContext.Provider>
  );
}
