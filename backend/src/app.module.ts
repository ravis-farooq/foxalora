import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { LoginThrottleService } from './auth/login-throttle.service';
import { VaultService } from './auth/vault.service';
import { DB, requireEnv, VALKEY } from './common/tokens';
import { createDb } from './database/database';
import type { Database } from './database/schema';
import { TenantDb } from './database/tenant-db';
import { MailController } from './mail/mail.controller';
import { MailService } from './mail/mail.service';
import { RegistryService } from './registry/registry.service';

/** Connects at start-up and fails fast if Valkey is unreachable, so the first request never races the connection. */
async function createValkey(): Promise<Redis> {
  const url = requireEnv('VALKEY_URL');
  // FOX-017: the vault holds encrypted mailbox credentials; never run it without a password in production.
  if (process.env.NODE_ENV === 'production' && !new URL(url).password) {
    throw new Error('VALKEY_URL must include a password in production');
  }
  const client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
  await client.connect();
  return client;
}

class Shutdown implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(VALKEY) private readonly valkey: Redis,
  ) {}

  async onApplicationShutdown() {
    await this.db.destroy();
    this.valkey.disconnect();
  }
}

@Module({
  controllers: [AuthController, MailController],
  providers: [
    // Runtime role (foxalora_app): always subject to row-level security.
    { provide: DB, useFactory: () => createDb(requireEnv('DATABASE_URL')) },
    { provide: VALKEY, useFactory: createValkey },
    { provide: TenantDb, useFactory: (db: Kysely<Database>) => new TenantDb(db), inject: [DB] },
    AuditService,
    RegistryService,
    VaultService,
    LoginThrottleService,
    AuthGuard,
    MailService,
    Shutdown,
  ],
})
export class AppModule {}
