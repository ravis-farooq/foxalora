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
import Guide from './Guide';
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
  const [mailVersion, setMailVersion] = useState(0);
  const [guide, setGuide] = useState(false);

  const apply = useCallback((p: Preferences) => {
    applyTheme(p.theme);
    setDisplayTimeZone(p.timeZone);
    setPrefs(p);
  }, []);

  const loadSignatures = useCallback(() => {
    api.signatures().then(setSignatures, () => undefined);
  }, []);

  useEffect(() => {
    api.preferences().then(
      (p) => {
        apply(p);
        if (!p.onboarded) setGuide(true); // first sign-in: show the welcome guide
      },
      (e: Error) => toast('error', e.message),
    );
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

  const startGuide = () => {
    setView('mail');
    setGuide(true);
  };
  const endGuide = () => {
    setGuide(false);
    if (!prefs.onboarded) prefsState.save({ onboarded: true }).catch(() => undefined);
  };

  const nav = (id: View, label: string, icon: ReactNode, tip: string) => (
    <button type="button" className={`rail-btn ${view === id ? 'active' : ''}`} aria-current={view === id ? 'page' : undefined} data-guide={id} data-tip={tip} onClick={() => setView(id)}>
      <span className="rail-icon">{icon}</span>
      {label}
    </button>
  );

  return (
    <PrefsContext.Provider value={prefsState}>
      <div className={`app ${prefs.density === 'compact' ? 'compact' : ''}`}>
        <a className="skip-link" href="#main">Skip to main content</a>
        <nav className="rail" aria-label="Main">
          <div className="rail-logo"><Logo size={34} /></div>
          <button type="button" className="rail-btn compose" data-guide="compose" data-tip="Write a new email" onClick={() => setCompose({})}>
            <span className="rail-icon">{Icon.compose}</span>Compose
          </button>
          {nav('mail', 'Mail', Icon.mail, 'Your inbox and folders')}
          {nav('contacts', 'Contacts', Icon.contacts, 'People you write to')}
          {nav('settings', 'Settings', Icon.settings, 'Your name, signature, theme and more')}
          <span className="grow" />
          <button type="button" className="rail-btn secondary" data-tip="Show a short tour of Foxalora Mail" onClick={startGuide}>
            <span className="rail-icon">{Icon.help}</span>Help
          </button>
          <button type="button" className="rail-btn secondary" data-tip={dark ? 'Switch to a light background' : 'Switch to a dark background, easier on the eyes at night'} onClick={toggleTheme}>
            <span className="rail-icon">{dark ? Icon.sun : Icon.moon}</span>
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
          <button type="button" className="rail-btn secondary" data-tip="Version, licence and privacy" onClick={() => setAbout(true)}>
            <span className="rail-icon">{Icon.info}</span>About
          </button>
          <button type="button" className="rail-btn danger" data-tip="Sign out of your mailbox on this device" onClick={onLogout}>
            <span className="rail-icon">{Icon.power}</span>Sign out
          </button>
        </nav>

        {view === 'mail' && <Mailbox email={email} onCompose={setCompose} version={mailVersion} />}
        {view === 'contacts' && <Contacts onCompose={setCompose} />}
        {view === 'settings' && <Settings email={email} signatures={signatures} onSignaturesChanged={loadSignatures} onAbout={() => setAbout(true)} onGuide={startGuide} />}

        {compose && (
          <Compose
            init={compose}
            signatures={composerSignatures}
            defaultSignatureId={signatures.find((s) => s.isDefault)?.id}
            onClose={() => {
              setCompose(null);
              setMailVersion((v) => v + 1); // a draft may have been saved or discarded
            }}
            onSent={() => {
              toast('success', 'Message sent.');
              setMailVersion((v) => v + 1);
            }}
            onDraftSaved={() => setMailVersion((v) => v + 1)}
          />
        )}
        {about && <About onClose={() => setAbout(false)} />}
        {guide && <Guide onDone={endGuide} />}
      </div>
    </PrefsContext.Provider>
  );
}
