/* Operator CLI. The admin console (Phase 3) will cover the same operations. */
import 'reflect-metadata';
import { AuditService } from './audit/audit.service';
import { requireEnv } from './common/tokens';
import { createDb, migrateToLatest } from './database/database';
import type { TlsPolicy } from './database/schema';
import { TenantDb } from './database/tenant-db';
import { openImap, withSmtp } from './mail/connections';
import { RegistryService } from './registry/registry.service';
import type { ServerInput } from './registry/server-validation';

const USAGE = `Usage: node dist/cli.js <command>

  migrate                                   run database migrations (DATABASE_OWNER_URL)
  tenant:create <name>                      create a tenant, print its id (DATABASE_OWNER_URL)
  tenant:list                               list tenants (DATABASE_OWNER_URL)
  server:add <tenantId> <name> --imap host:port:tls --smtp host:port:tls [--allow-private]
                                            tls is one of tls | starttls | none-dev-only (DATABASE_URL)
  domain:map <tenantId> <domain> <serverName>   map an email domain to a server (DATABASE_URL)
  server:list <tenantId>                    show a tenant's servers and domains (DATABASE_URL)
  seed:dev                                  development tenant for the local test servers (both URLs)
  seed:mail [--force]                       sample messages for carol@ and dave@dovecot.test (DATABASE_URL,
                                            NODE_EXTRA_CA_CERTS=dev/mailservers/certs/ca.pem); skipped if mail exists
`;

// Test accounts of the local Postfix + Dovecot server (dev/mailservers/postfix-accounts.cf).
const DEV_MAILBOXES: Record<string, string> = { 'carol@dovecot.test': 'carol-pass-1', 'dave@dovecot.test': 'dave-pass-1' };
// 1x1 PNG, used as an inline logo and an attachment in the samples.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function sampleMessages(): Array<{ from: string; to: string; subject: string; text: string; html?: string; attachments?: object[] }> {
  const carol = 'carol@dovecot.test', dave = 'dave@dovecot.test';
  return [
    {
      from: dave, to: carol, subject: 'Welcome to the Foxalora dev mailbox',
      text: 'Hi Carol,\n\nThis mailbox is seeded for development.\n\n- Formatting\n- Tables\n- Attachments\n\nDave',
      html: '<p>Hi Carol,</p><p>This mailbox is seeded for <b>development</b>. It shows:</p><ul><li><i>Formatting</i></li><li>Tables</li><li>Attachments</li></ul>' +
        '<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Month</th><th>Visits</th></tr><tr><td>Oct</td><td>1200</td></tr><tr><td>Nov</td><td>1350</td></tr></table><p>Dave</p>',
    },
    {
      from: dave, to: carol, subject: 'Quarterly report (attachments and an inline image)',
      text: 'Report attached. The logo is an inline image.',
      html: '<p><img src="cid:logo@seed.foxalora" alt="Logo" width="16" height="16"> Report attached.</p>',
      attachments: [
        { filename: 'logo.png', content: PNG, contentType: 'image/png', cid: 'logo@seed.foxalora' },
        { filename: 'q3-report.pdf', content: Buffer.from('%PDF-1.4\n% Foxalora sample\n'), contentType: 'application/pdf' },
        { filename: 'chart.png', content: PNG, contentType: 'image/png' },
      ],
    },
    {
      from: dave, to: carol, subject: 'Newsletter: remote images and a suspicious link',
      text: 'This newsletter tries to load tracking images. Visit paypal.com (the link goes elsewhere).',
      html: '<p>Tracking pixel below should be blocked:</p><img src="https://tracker.example/pixel.gif" width="1" height="1">' +
        '<p style="background:url(https://tracker.example/bg.gif)">Styled background should be stripped.</p>' +
        '<p>Visit <a href="https://evil.example/login">paypal.com</a> to confirm your account.</p>',
    },
    { from: dave, to: carol, subject: 'Plain text note', text: 'Lunch at 12:30?\n\nThis message has no HTML part.' },
    {
      from: dave, to: carol, subject: 'رسالة تجريبية باللغة العربية',
      text: 'مرحباً كارول،\n\nهذه رسالة لاختبار الاتجاه من اليمين إلى اليسار.\n\nديف',
      html: '<div dir="rtl"><p>مرحباً كارول،</p><p>هذه رسالة لاختبار <b>الاتجاه من اليمين إلى اليسار</b>.</p><p>ديف</p></div>',
    },
    { from: carol, to: dave, subject: 'Re: Lunch at 12:30?', text: 'Sounds good, see you then.\n\nCarol' },
  ];
}

const out = (s: string) => process.stdout.write(`${s}\n`); // eslint-disable-line no-restricted-properties
const ACTOR = `cli:${process.env.USER ?? 'operator'}`;

function endpoint(value: string | undefined, flag: string): [string, number, TlsPolicy] {
  const m = /^([^:]+):(\d+):(tls|starttls|none-dev-only)$/.exec(value ?? '');
  if (!m) throw new Error(`${flag} must look like host:port:tls`);
  return [m[1], Number(m[2]), m[3] as TlsPolicy];
}

function registry() {
  const db = createDb(requireEnv('DATABASE_URL'), 2);
  const tenantDb = new TenantDb(db);
  return { db, reg: new RegistryService(db, tenantDb, new AuditService(tenantDb)) };
}

async function main(argv: string[]) {
  const [cmd, ...args] = argv;
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };

  switch (cmd) {
    case 'migrate': {
      const owner = createDb(requireEnv('DATABASE_OWNER_URL'), 1);
      const r = await migrateToLatest(owner);
      for (const m of r.results ?? []) out(`${m.status}: ${m.migrationName}`);
      await owner.destroy();
      if (r.error) throw r.error;
      if (!r.results?.length) out('database is up to date');
      return;
    }
    case 'tenant:create': {
      if (!args[0]) throw new Error('tenant name required');
      const owner = createDb(requireEnv('DATABASE_OWNER_URL'), 1);
      const t = await owner.insertInto('tenants').values({ name: args[0] }).returning('id').executeTakeFirstOrThrow();
      await owner.destroy();
      out(t.id);
      return;
    }
    case 'tenant:list': {
      const owner = createDb(requireEnv('DATABASE_OWNER_URL'), 1);
      for (const t of await owner.selectFrom('tenants').select(['id', 'name', 'status']).orderBy('name').execute()) out(`${t.id}  ${t.status.padEnd(9)}  ${t.name}`);
      await owner.destroy();
      return;
    }
    case 'server:add': {
      const [tenantId, name] = args;
      const [imapHost, imapPort, imapTls] = endpoint(flag('--imap'), '--imap');
      const [smtpHost, smtpPort, smtpTls] = endpoint(flag('--smtp'), '--smtp');
      const { db, reg } = registry();
      const s = await reg.createServer(tenantId, { name, imapHost, imapPort, imapTls, smtpHost, smtpPort, smtpTls, allowPrivate: args.includes('--allow-private') }, ACTOR);
      await db.destroy();
      out(s.id);
      return;
    }
    case 'domain:map': {
      const [tenantId, domain, serverName] = args;
      const { db, reg } = registry();
      await reg.mapDomain(tenantId, domain, serverName, ACTOR);
      await db.destroy();
      out(`mapped ${domain} -> ${serverName}`);
      return;
    }
    case 'server:list': {
      const { db, reg } = registry();
      const { servers, domains } = await reg.listServers(args[0]);
      for (const s of servers) {
        out(`${s.name}: IMAP ${s.imap_host}:${s.imap_port}/${s.imap_tls}, SMTP ${s.smtp_host}:${s.smtp_port}/${s.smtp_tls}${s.allow_private ? ', private allowed' : ''}`);
        for (const d of domains.filter((x) => x.mail_server_id === s.id)) out(`    ${d.domain}`);
      }
      await db.destroy();
      return;
    }
    case 'seed:dev': {
      if (process.env.NODE_ENV === 'production') throw new Error('seed:dev is for development only');
      const owner = createDb(requireEnv('DATABASE_OWNER_URL'), 1);
      const existing = await owner.selectFrom('tenants').select('id').where('name', '=', 'Development').executeTakeFirst();
      const tenantId = existing?.id ?? (await owner.insertInto('tenants').values({ name: 'Development' }).returning('id').executeTakeFirstOrThrow()).id;
      await owner.destroy();
      const { db, reg } = registry();
      const have = new Set((await reg.listServers(tenantId)).servers.map((s) => s.name));
      const servers: ServerInput[] = [
        { name: 'greenmail', imapHost: '127.0.0.1', imapPort: 3143, imapTls: 'none-dev-only', smtpHost: '127.0.0.1', smtpPort: 3025, smtpTls: 'none-dev-only', allowPrivate: true },
        // Real TLS test servers (dev/mailservers/): IMAP 993 TLS + SMTP 587 STARTTLS, the common hosting setup.
        { name: 'dovecot-postfix', imapHost: 'localhost', imapPort: 993, imapTls: 'tls', smtpHost: 'localhost', smtpPort: 587, smtpTls: 'starttls', allowPrivate: true },
        { name: 'exim', imapHost: 'localhost', imapPort: 993, imapTls: 'tls', smtpHost: 'localhost', smtpPort: 587, smtpTls: 'starttls', allowPrivate: true },
      ];
      for (const s of servers) if (!have.has(s.name)) await reg.createServer(tenantId, s, ACTOR);
      const mapped = new Set((await reg.listServers(tenantId)).domains.map((d) => d.domain));
      for (const [domain, server] of [['example.com', 'greenmail'], ['dovecot.test', 'dovecot-postfix'], ['exim.test', 'exim']]) {
        if (!mapped.has(domain)) await reg.mapDomain(tenantId, domain, server, ACTOR);
      }
      await db.destroy();
      out(`development tenant ${tenantId} ready (example.com, dovecot.test, exim.test)`);
      return;
    }
    case 'seed:mail': {
      if (process.env.NODE_ENV === 'production') throw new Error('seed:mail is for development only');
      const { db, reg } = registry();
      const creds = async (email: string) => {
        const server = await reg.resolveEmail(email);
        if (!server) throw new Error(`${email} is not mapped; run seed:dev first`);
        return { email, password: DEV_MAILBOXES[email], server };
      };
      // Only the mail adapter talks to mail servers (SSRF guard, TLS policy).
      const carol = await creds('carol@dovecot.test');
      const inbox = await openImap(carol);
      const status = await inbox.status('INBOX', { messages: true });
      const existing = status ? status.messages ?? 0 : 0;
      await inbox.logout();
      if (existing > 0 && !args.includes('--force')) {
        out(`carol@dovecot.test already has ${existing} message(s); use --force to add the samples again`);
        await db.destroy();
        return;
      }
      for (const m of sampleMessages()) {
        await withSmtp(await creds(m.from), (t) => t.sendMail(m));
        out(`sent: ${m.subject}`);
      }
      await db.destroy();
      return;
    }
    default:
      out(USAGE);
      if (cmd && cmd !== 'help') process.exitCode = 2;
  }
}

main(process.argv.slice(2)).catch((e: Error) => {
  process.stderr.write(`error: ${e.message}\n`);
  process.exitCode = 1;
});
