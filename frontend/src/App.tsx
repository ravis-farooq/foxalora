import { useEffect, useState } from 'react';
import { api } from './api';
import Login from './components/Login';
import Shell from './components/Shell';
import SetupWizard from './setup/SetupWizard';
import { ConfirmProvider } from './ui/ConfirmProvider';
import { ToastProvider } from './ui/Toasts';
import { TooltipLayer } from './ui/TooltipLayer';

export default function App() {
  // First-run setup (FOX-099): its own page, outside the mailbox session.
  if (window.location.pathname === '/setup') return <SetupWizard />;
  return <MailApp />;
}

function MailApp() {
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api.me().then((m) => setEmail(m.email)).catch(() => setEmail(null)).finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="center muted">Loading…</div>;
  return (
    <ToastProvider>
      <ConfirmProvider>
      {email ? (
        <Shell
          email={email}
          onLogout={async () => {
            await api.logout().catch(() => undefined);
            setEmail(null);
          }}
        />
      ) : (
        <Login onLogin={setEmail} />
      )}
      </ConfirmProvider>
      <TooltipLayer />
    </ToastProvider>
  );
}
