import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Logo } from '../ui/icons';
import { explainReason, SetupError, setupApi, type ServerSettings, type SetupCheck, type TestResult } from './setup-api';
import './setup.css';

/**
 * First-run setup wizard (FOX-099), opened from the link deploy/install.sh prints:
 *   https://webmail.example.com/setup#token=...
 * The token stays in the URL fragment (never sent to the server in the URL, never in
 * access logs) and is passed in a header. Once setup finishes, the API locks the wizard.
 */

const STEPS = ['Check', 'Administrator', 'Mail server', 'Domains', 'Finish'] as const;
const IMAP_MODES = { '993-tls': 'SSL/TLS, port 993 (recommended)', '143-starttls': 'STARTTLS, port 143' } as const;
const SMTP_MODES = { '465-tls': 'SSL/TLS, port 465', '587-starttls': 'STARTTLS, port 587 (recommended)', '25-starttls': 'STARTTLS, port 25' } as const;
type ImapMode = keyof typeof IMAP_MODES;
type SmtpMode = keyof typeof SMTP_MODES;

const mode = (m: string) => { const [p, t] = m.split('-'); return { port: Number(p), tls: t as 'tls' | 'starttls' }; };
const tokenFrom = (s: string) => (/(?:^|[#&?])token=([A-Za-z0-9_-]+)/.exec(s)?.[1] ?? (/^[A-Za-z0-9_-]{32,}$/.test(s.trim()) ? s.trim() : ''));
/** Well-known providers whose outgoing server differs from IMAP, or that file sent mail themselves. Hints only. */
const PROVIDERS: { match: RegExp; name: string; smtp: string; smtpMode: SmtpMode; savesSent: boolean }[] = [
  { match: /^imap\.(gmail|googlemail)\.com$/, name: 'Gmail', smtp: 'smtp.gmail.com', smtpMode: '465-tls', savesSent: true },
  { match: /^(outlook\.office365\.com|imap-mail\.outlook\.com)$/, name: 'Microsoft 365', smtp: 'smtp.office365.com', smtpMode: '587-starttls', savesSent: true },
  { match: /^imap\.mail\.yahoo\.com$/, name: 'Yahoo Mail', smtp: 'smtp.mail.yahoo.com', smtpMode: '465-tls', savesSent: true },
  { match: /^imap\.zoho\.(com|eu|in)$/, name: 'Zoho Mail', smtp: '', smtpMode: '465-tls', savesSent: false },
];
const knownProvider = (host: string) => {
  const p = PROVIDERS.find((x) => x.match.test(host));
  if (p?.name === 'Zoho Mail') return { ...p, smtp: host.replace(/^imap\./, 'smtp.') };
  return p;
};
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export default function SetupWizard() {
  const [token, setToken] = useState(() => tokenFrom(window.location.hash));
  const [pasted, setPasted] = useState('');
  const [closed, setClosed] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // Step 1
  const [checks, setChecks] = useState<SetupCheck[] | null>(null);
  // Step 2
  const [organisation, setOrganisation] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPassword2, setAdminPassword2] = useState('');
  // Step 3
  const [imapHost, setImapHost] = useState('');
  const [imapMode, setImapMode] = useState<ImapMode>('993-tls');
  const [smtpSame, setSmtpSame] = useState(true);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpMode, setSmtpMode] = useState<SmtpMode>('587-starttls');
  const [allowPrivate, setAllowPrivate] = useState(false);
  const [savesSent, setSavesSent] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testPassword, setTestPassword] = useState('');
  const [test, setTest] = useState<{ key: string; result: TestResult } | null>(null);
  // The settings the operator agreed to continue with despite a failed test; a change needs a new test.
  const [skipKey, setSkipKey] = useState<string | null>(null);
  // Step 4
  const [domainsText, setDomainsText] = useState('');
  const [done, setDone] = useState(false);

  const server: ServerSettings = useMemo(() => {
    const i = mode(imapMode), s = mode(smtpMode);
    const host = imapHost.trim().toLowerCase();
    return { imapHost: host, imapPort: i.port, imapTls: i.tls, smtpHost: smtpSame ? host : smtpHost.trim().toLowerCase(), smtpPort: s.port, smtpTls: s.tls, allowPrivate, savesSent };
  }, [imapHost, imapMode, smtpSame, smtpHost, smtpMode, allowPrivate, savesSent]);
  // What the connection test depends on (where sent mail is filed does not change the connection).
  const serverKey = JSON.stringify({ ...server, savesSent: undefined });
  const testCurrent = test?.key === serverKey ? test.result : null; // a changed setting needs a new test
  const testPassed = !!testCurrent && testCurrent.imap.ok && testCurrent.smtp.ok;
  const skipTest = !!testCurrent && !testPassed && skipKey === serverKey;
  const failedParts = testCurrent ? (['imap', 'smtp'] as const).filter((k) => !testCurrent[k].ok) : [];
  const provider = knownProvider(server.imapHost);
  // SMTP failed on the IMAP host: the usual cause is a provider with a separate outgoing server.
  const suggestSmtp = smtpSame && !!testCurrent && testCurrent.imap.ok && !testCurrent.smtp.ok;
  const smtpGuess = provider?.smtp ?? (server.imapHost.startsWith('imap.') ? `smtp.${server.imapHost.slice(5)}` : '');
  const domains = useMemo(() => [...new Set(domainsText.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))], [domainsText]);
  const badDomains = domains.filter((d) => !DOMAIN.test(d));

  const fail = useCallback((e: unknown) => {
    if (e instanceof SetupError && e.status === 404) setClosed(true);
    else setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
  }, []);

  const loadChecks = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const r = await setupApi.checks(token);
      setChecks(r.checks);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [token, fail]);

  useEffect(() => {
    if (!token) return;
    let live = true;
    setupApi.checks(token)
      .then((r) => { if (live) setChecks(r.checks); })
      .catch((e) => { if (live) fail(e); });
    return () => { live = false; };
  }, [token, fail]);
  useEffect(() => { heading.current?.focus(); }, [step, done]);

  function go(next: number) { setError(''); setStep(next); }

  function submitAdmin(e: FormEvent) {
    e.preventDefault();
    if (adminPassword.length < 12) return setError('The password must have at least 12 characters.');
    if (adminPassword !== adminPassword2) return setError('The two passwords do not match.');
    if (adminPassword.trim().toLowerCase() === adminEmail.trim().toLowerCase()) return setError('The password must not be the email address.');
    go(2);
  }

  async function runTest() {
    setBusy(true); setError('');
    try {
      const mailbox = testEmail.trim() || testPassword ? { email: testEmail.trim(), password: testPassword } : undefined;
      const result = await setupApi.testServer(token, server, mailbox);
      setTest({ key: serverKey, result });
      if ([result.imap, result.smtp].some((r) => r.reason === 'SSRF_BLOCKED')) setAdvancedOpen(true);
      if (!domainsText && testEmail.includes('@')) setDomainsText(testEmail.split('@')[1].toLowerCase());
    } catch (e) { fail(e); } finally {
      setTestPassword(''); // the test mailbox password is used once and not kept
      setBusy(false);
    }
  }

  function submitServer(e: FormEvent) {
    e.preventDefault();
    if (!testCurrent) return setError(test ? 'Settings changed since the last test. Test the connection again.' : 'Test the connection first.');
    if (!testPassed && !skipTest) return setError('The connection test failed. Fix the settings and test again, or tick "Continue anyway".');
    if (!domainsText && imapHost.includes('.')) setDomainsText(imapHost.trim().toLowerCase().replace(/^(mail|imap|mx)\./, ''));
    go(3);
  }

  function submitDomains(e: FormEvent) {
    e.preventDefault();
    if (!domains.length) return setError('Add at least one email domain.');
    if (badDomains.length) return setError(`Not a valid domain: ${badDomains.join(', ')}`);
    go(4);
  }

  async function finish() {
    setBusy(true); setError('');
    try {
      await setupApi.complete(token, { organisation: organisation.trim(), admin: { email: adminEmail.trim(), password: adminPassword }, server, domains });
      setAdminPassword(''); setAdminPassword2('');
      history.replaceState(null, '', '/setup'); // the token is spent; drop it from the address bar
      setDone(true);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  // ---- screens ----

  const shell = (title: string, body: React.ReactNode, showSteps = true) => (
    <main className="setup-page">
      <div className="setup-card">
        <header className="setup-head">
          <Logo size={34} className="brand" />
          <div><div className="setup-product">Foxalora Mail</div><div className="muted small">Setup</div></div>
        </header>
        {showSteps && (
          <ol className="setup-steps" aria-label="Setup steps">
            {STEPS.map((s, i) => (
              <li key={s} className={i < step ? 'done' : i === step ? 'current' : ''} aria-current={i === step ? 'step' : undefined}>
                <span className="dot">{i < step ? Icon.check : i + 1}</span><span className="label">{s}</span>
              </li>
            ))}
          </ol>
        )}
        <h1 ref={heading} tabIndex={-1}>{title}</h1>
        {body}
        {error && <div className="notice error" role="alert">{Icon.alert}<span>{error}</span></div>}
      </div>
    </main>
  );

  if (closed) {
    return shell('Setup is not available', (
      <>
        <p>Either setup has already been completed, or this link is not the one for this server.</p>
        <p className="muted">To see the link again, run <code>grep SETUP_TOKEN deploy/.env</code> on the server and open <code>https://{window.location.host}/setup#token=</code> followed by the value.</p>
        <a className="button-link" href="/">Go to webmail</a>
      </>
    ), false);
  }

  if (!token) {
    return shell('Open your setup link', (
      <form className="setup-form" onSubmit={(e) => { e.preventDefault(); const t = tokenFrom(pasted); if (t) { setPasted(''); setToken(t); } else setError('That is not a setup link.'); }}>
        <p>The installer printed a setup link that ends in <code>#token=…</code>. Paste it here.</p>
        <label>Setup link<input value={pasted} onChange={(e) => setPasted(e.target.value)} autoComplete="off" spellCheck={false} placeholder={`https://${window.location.host}/setup#token=...`} required /></label>
        <div className="setup-actions"><span /><button className="primary">Continue</button></div>
      </form>
    ), false);
  }

  if (done) {
    const url = `${window.location.origin}/`;
    return shell('Foxalora is ready', (
      <>
        <div className="setup-success">{Icon.check}<span>Setup is complete and this setup page is now locked.</span></div>
        <p>Your customers can sign in with their normal email address and password at:</p>
        <p className="setup-url"><a href={url}>{url}</a></p>
        <ul className="setup-list">
          <li>Domains: {domains.join(', ')}</li>
          <li>Mail server: {server.imapHost}</li>
          <li>Administrator: {adminEmail.trim().toLowerCase()}</li>
        </ul>
        <p className="muted small">The admin console is not built yet. Until then, add servers and domains on the server with <code>./deploy/cli.sh</code> (see docs/runbooks/install.md).</p>
        <div className="setup-actions"><span /><a className="button-link primary" href="/">Open webmail</a></div>
      </>
    ), false);
  }

  if (step === 0) {
    const failed = checks?.some((c) => c.status === 'fail');
    return shell('Check the installation', (
      <>
        <p className="muted">Foxalora checks that everything the installer started is working.</p>
        {checks === null ? <p className="muted">Checking…</p> : (
          <ul className="setup-checks" aria-live="polite">
            {checks.map((c) => (
              <li key={c.id} className={c.status}>
                <span className="status" aria-label={c.status === 'ok' ? 'OK' : c.status === 'warn' ? 'Warning' : 'Problem'}>{c.status === 'ok' ? Icon.check : Icon.alert}</span>
                <div><strong>{c.label}</strong><div className="muted small">{c.detail}</div></div>
              </li>
            ))}
          </ul>
        )}
        <div className="setup-actions">
          <button type="button" className="ghost" onClick={loadChecks} disabled={busy}>Check again</button>
          <button type="button" className="primary" disabled={!checks || failed || busy} onClick={() => go(1)}>Continue</button>
        </div>
        {failed && <p className="muted small">Fix the problems marked above, then check again.</p>}
      </>
    ));
  }

  if (step === 1) {
    return shell('Your company and administrator', (
      <form className="setup-form" onSubmit={submitAdmin}>
        <label>Company name<input value={organisation} onChange={(e) => setOrganisation(e.target.value)} maxLength={200} required autoFocus placeholder="HostCo Ltd" /></label>
        <label>Administrator email<input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} autoComplete="username" required placeholder="admin@hostco.com" /></label>
        <label>Password<input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} autoComplete="new-password" minLength={12} maxLength={200} required aria-describedby="pw-hint" /></label>
        <label>Repeat password<input type="password" value={adminPassword2} onChange={(e) => setAdminPassword2(e.target.value)} autoComplete="new-password" required /></label>
        <p id="pw-hint" className="muted small">At least 12 characters. A short sentence is easy to remember and hard to guess. This account is for the admin console, not for reading mail.</p>
        <div className="setup-actions"><button type="button" className="ghost" onClick={() => go(0)}>Back</button><button className="primary">Continue</button></div>
      </form>
    ));
  }

  if (step === 2) {
    return shell('Your mail server', (
      <form className="setup-form" onSubmit={submitServer}>
        <p className="muted">The IMAP and SMTP server your customers' mailboxes are on. Foxalora connects to it; it does not store mail.</p>
        <div className="setup-row">
          <label>IMAP server (incoming)<input value={imapHost} onChange={(e) => setImapHost(e.target.value)} required autoFocus placeholder="mail.hostco.com" spellCheck={false} autoCapitalize="off" /></label>
          <label>Security<select value={imapMode} onChange={(e) => setImapMode(e.target.value as ImapMode)}>{Object.entries(IMAP_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <label className="check"><input type="checkbox" checked={smtpSame} onChange={(e) => setSmtpSame(e.target.checked)} />Outgoing mail (SMTP) uses the same server</label>
        <div className="setup-row">
          {!smtpSame && <label>SMTP server (outgoing)<input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} required placeholder="smtp.hostco.com" spellCheck={false} autoCapitalize="off" /></label>}
          <label>SMTP security<select value={smtpMode} onChange={(e) => setSmtpMode(e.target.value as SmtpMode)}>{Object.entries(SMTP_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <details className="setup-advanced" open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
          <summary>Advanced</summary>
          <label className="check"><input type="checkbox" checked={allowPrivate} onChange={(e) => setAllowPrivate(e.target.checked)} />Mail server is on a private network (10.x, 192.168.x, same machine)</label>
          <label className="check"><input type="checkbox" checked={savesSent} onChange={(e) => setSavesSent(e.target.checked)} />The server saves sent mail itself (Gmail, Microsoft 365)</label>
        </details>

        <fieldset className="setup-test">
          <legend>Test the connection</legend>
          <p className="muted small">Optional: sign in with any real mailbox on this server to test the login too. The password is used once and not saved.</p>
          <div className="setup-row">
            <label>Test mailbox<input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} autoComplete="off" placeholder="someone@hostco.com" /></label>
            <label>Its password<input type="password" value={testPassword} onChange={(e) => setTestPassword(e.target.value)} autoComplete="off" /></label>
          </div>
          <button type="button" className="ghost" onClick={runTest} disabled={busy || !imapHost.trim()}>{busy ? 'Testing…' : 'Test connection'}</button>
          {testCurrent && (
            <ul className="setup-checks" aria-live="polite">
              {(['imap', 'smtp'] as const).map((k) => {
                const r = testCurrent[k];
                const what = k === 'imap' ? `IMAP ${server.imapHost}:${server.imapPort}` : `SMTP ${server.smtpHost}:${server.smtpPort}`;
                return (
                  <li key={k} className={r.ok ? 'ok' : 'fail'}>
                    <span className="status">{r.ok ? Icon.check : Icon.alert}</span>
                    <div><strong>{what}</strong><div className="muted small">{r.ok ? (testCurrent.loginTested ? 'Connected securely and signed in.' : 'Connected securely; certificate valid.') : explainReason(r.reason)}</div></div>
                  </li>
                );
              })}
            </ul>
          )}
          {suggestSmtp && (
            <div className="notice setup-hint" role="status">
              <p>IMAP works but SMTP does not on <strong>{server.imapHost}</strong>. Many providers use a different server for outgoing mail{smtpGuess ? <>, for example <strong>{smtpGuess}</strong></> : ''}.</p>
              <button type="button" className="ghost" onClick={() => {
                setSmtpSame(false);
                if (smtpGuess) setSmtpHost(smtpGuess);
                if (provider) setSmtpMode(provider.smtpMode);
              }}>{smtpGuess ? `Use ${smtpGuess}` : 'Enter a different SMTP server'}</button>
            </div>
          )}
          {test && !testCurrent && <p className="muted small">Settings changed since the last test. Test again.</p>}
        </fieldset>
        {provider?.savesSent && !savesSent && (
          <div className="notice setup-hint" role="status">
            <p>{provider.name} saves sent mail by itself. Without this setting, every sent message appears twice in Sent.</p>
            <button type="button" className="ghost" onClick={() => setSavesSent(true)}>Turn on "server saves sent mail itself"</button>
          </div>
        )}
        {testCurrent && !testPassed && (
          <label className="check setup-skip">
            <input type="checkbox" checked={skipTest} onChange={(e) => setSkipKey(e.target.checked ? serverKey : null)} />
            <span>Continue anyway. {failedParts.includes('smtp') ? 'Customers will not be able to send mail' : 'Customers will not be able to sign in'}{failedParts.length === 2 ? ' or send mail' : ''} until this is fixed.</span>
          </label>
        )}
        <div className="setup-actions"><button type="button" className="ghost" onClick={() => go(1)}>Back</button><button className="primary">Continue</button></div>
      </form>
    ));
  }

  if (step === 3) {
    return shell('Email domains', (
      <form className="setup-form" onSubmit={submitDomains}>
        <p className="muted">Customers whose address ends in one of these domains sign in through <strong>{server.imapHost}</strong>. One per line. You can add more later.</p>
        <label>Domains<textarea rows={6} value={domainsText} onChange={(e) => setDomainsText(e.target.value)} autoFocus spellCheck={false} placeholder={'hostco.com\nclient-one.com'} /></label>
        {domains.length > 0 && <p className="muted small">{domains.length} domain{domains.length === 1 ? '' : 's'}{badDomains.length ? `; not valid: ${badDomains.join(', ')}` : ''}</p>}
        <div className="setup-actions"><button type="button" className="ghost" onClick={() => go(2)}>Back</button><button className="primary">Continue</button></div>
      </form>
    ));
  }

  return shell('Review and finish', (
    <>
      <dl className="setup-review">
        <dt>Company</dt><dd>{organisation}</dd>
        <dt>Administrator</dt><dd>{adminEmail.trim().toLowerCase()}</dd>
        <dt>IMAP</dt><dd>{server.imapHost}:{server.imapPort} ({server.imapTls === 'tls' ? 'SSL/TLS' : 'STARTTLS'})</dd>
        <dt>SMTP</dt><dd>{server.smtpHost}:{server.smtpPort} ({server.smtpTls === 'tls' ? 'SSL/TLS' : 'STARTTLS'})</dd>
        <dt>Connection test</dt><dd className={testPassed ? '' : 'setup-failed'}>{testPassed ? 'Passed' : `Failed: ${failedParts.map((k) => k.toUpperCase()).join(' and ')}${failedParts.includes('smtp') ? ' (sending will not work)' : ''}`}</dd>
        <dt>Sent mail</dt><dd>{savesSent ? 'Saved by the mail server' : 'Saved by Foxalora'}</dd>
        <dt>Domains</dt><dd>{domains.join(', ')}</dd>
      </dl>
      <p className="muted small">Finishing saves these settings and locks this setup page for good.</p>
      <div className="setup-actions">
        <button type="button" className="ghost" onClick={() => go(3)} disabled={busy}>Back</button>
        <button type="button" className="primary" onClick={finish} disabled={busy}>{busy ? 'Saving…' : 'Finish setup'}</button>
      </div>
    </>
  ));
}
