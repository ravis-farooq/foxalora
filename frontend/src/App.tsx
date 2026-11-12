import { useEffect, useState } from 'react';
import { api } from './api';
import Login from './components/Login';
import Mailbox from './components/Mailbox';

export default function App() {
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api.me().then((m) => setEmail(m.email)).catch(() => setEmail(null)).finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="center muted">Loading…</div>;
  if (!email) return <Login onLogin={setEmail} />;
  return (
    <Mailbox
      email={email}
      onLogout={async () => {
        await api.logout().catch(() => undefined);
        setEmail(null);
      }}
    />
  );
}
