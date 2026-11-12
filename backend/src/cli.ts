/* Operator CLI. The admin console (Phase 3) will cover the same operations. */
import 'reflect-metadata';
import { AuditService } from './audit/audit.service';
import { requireEnv } from './common/tokens';
import { createDb, migrateToLatest } from './database/database';
import type { TlsPolicy } from './database/schema';
import { TenantDb } from './database/tenant-db';
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
`;

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
    default:
      out(USAGE);
      if (cmd && cmd !== 'help') process.exitCode = 2;
  }
}

main(process.argv.slice(2)).catch((e: Error) => {
  process.stderr.write(`error: ${e.message}\n`); // eslint-disable-line no-restricted-properties
  process.exitCode = 1;
});
