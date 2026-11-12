import { FormEvent, useState } from 'react';
import { api } from '../api';
import { Icon, Logo } from '../ui/icons';

export default function Login({ onLogin }: { onLogin: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.login(email, password);
      setPassword(''); // do not keep the password in component state
      onLogin(r.email);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login" onSubmit={submit}>
        <div className="login-brand">
          <Logo size={44} className="brand" />
          <h1>Foxalora Mail</h1>
          <p className="muted">Sign in with your email address and password.</p>
        </div>
        <label>
          Email address
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="you@example.com" />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="notice error" role="alert">{Icon.alert}<span>{error}</span></div>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">Forgot your password? Contact your hosting provider.</p>
      </form>
    </main>
  );
}
