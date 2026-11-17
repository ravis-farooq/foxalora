import type { ColumnType, Generated } from 'kysely';

export type TlsPolicy = 'tls' | 'starttls' | 'none-dev-only';
type CreatedAt = ColumnType<Date, never, never>;
type UpdatedAt = ColumnType<Date, never, Date>;

export interface TenantsTable {
  id: Generated<string>;
  name: string;
  status: ColumnType<'active' | 'suspended', 'active' | 'suspended' | undefined, 'active' | 'suspended'>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface MailServersTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  imap_host: string;
  imap_port: number;
  imap_tls: TlsPolicy;
  smtp_host: string;
  smtp_port: number;
  smtp_tls: TlsPolicy;
  allow_private: boolean;
  saves_sent: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface DomainMappingsTable {
  id: Generated<string>;
  tenant_id: string;
  domain: string;
  mail_server_id: string;
  created_at: CreatedAt;
}

export interface MailboxOwned {
  id: Generated<string>;
  tenant_id: string;
  mailbox: string;
}

export interface UserPreferencesTable extends MailboxOwned {
  preferences: ColumnType<Record<string, unknown>, string | undefined, string>;
  updated_at: UpdatedAt;
}

export interface SignaturesTable extends MailboxOwned {
  name: string;
  content: ColumnType<unknown, string, string>;
  is_default: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface ContactsTable extends MailboxOwned {
  display_name: ColumnType<string, string | undefined, string>;
  company: ColumnType<string, string | undefined, string>;
  phone: ColumnType<string, string | undefined, string>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface ContactAddressesTable extends MailboxOwned {
  contact_id: string;
  email: string;
  label: ColumnType<string, string | undefined, string>;
  position: ColumnType<number, number | undefined, number>;
}

export interface RecentRecipientsTable extends MailboxOwned {
  email: string;
  use_count: ColumnType<number, number | undefined, number>;
  last_used: ColumnType<Date, Date | undefined, Date>;
}

export interface SystemSettingsTable {
  id: Generated<string>;
  tenant_id: string;
  key: string;
  value: ColumnType<unknown, string, string>;
  updated_at: UpdatedAt;
}

export interface AuditEventsTable {
  id: Generated<string>;
  tenant_id: string;
  occurred_at: CreatedAt;
  event_type: string;
  actor: string;
  details: ColumnType<Record<string, unknown>, string | undefined, never>;
  prev_hash: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  hash: ColumnType<Buffer | null, Buffer | null | undefined, never>;
}

export interface AdminUsersTable {
  id: Generated<string>;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: ColumnType<'owner' | 'admin', 'owner' | 'admin' | undefined, 'owner' | 'admin'>;
  totp_secret: ColumnType<unknown | null, string | null | undefined, string | null>;
  last_login_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface Database {
  tenants: TenantsTable;
  mail_servers: MailServersTable;
  domain_mappings: DomainMappingsTable;
  user_preferences: UserPreferencesTable;
  signatures: SignaturesTable;
  contacts: ContactsTable;
  contact_addresses: ContactAddressesTable;
  recent_recipients: RecentRecipientsTable;
  system_settings: SystemSettingsTable;
  audit_events: AuditEventsTable;
  admin_users: AdminUsersTable;
}
