# Phase 1 progress: foundations

Date: 2026-11-12. Everything marked "verified" was run locally: backend `npm run lint`, `typecheck`, `test` (72 tests, 8 files, integration tests required) and `build`; frontend lint, typecheck and build; and the API against PostgreSQL 18, Valkey 9, GreenMail and Exim + Dovecot.

## Exit criteria (CLAUDE.md Phase 1)

| Criterion | Status |
| --- | --- |
| Cross-tenant test suite passes in CI | **Passes locally** with the same commands and service containers CI uses (`test/tenant-isolation.int.test.ts`, 13 tests). Not yet run on GitHub: the repository has no remote and no commits. |
| SSRF test suite passes in CI | **Passes locally** (`test/security.test.ts`, `test/tls.test.ts`). Same caveat. |
| No password reachable outside the vault (canary test) | **Passes locally** (`test/canary.e2e.test.ts`). Checked that it fails when a leak is planted. |

Phase 1 is therefore complete except for a first green CI run on GitHub, the connection pool (FOX-029) and structured JSON logs (FOX-119), listed below.

## Stories

| Story | What was built | Status |
| --- | --- | --- |
| FOX-002 Repository, licence, contribution rules | `git init` (branch `main`), LICENSE, CONTRIBUTING (DCO sign-off), SECURITY.md, CODE_OF_CONDUCT.md | In review: security and conduct contacts are placeholders; branch protection needs a GitHub repository |
| FOX-003 CI | `.github/workflows/ci.yml`: lint, typecheck, tests with PostgreSQL + Valkey, build, dependency audit (runtime ≥ moderate, dev ≥ high), gitleaks history scan, CodeQL; actions pinned to SHAs. Every job simulated locally from clean installs | In review: not run on GitHub yet |
| FOX-009 Tenant model | `TenantDb.run()` is the only path to tenant data, sets `app.tenant_id`/`app.mailbox` per transaction, refuses missing/invalid tenants; tenant id comes from the session | Done (admin roles: Phase 3) |
| FOX-010 Row-level security | RLS on all tenant tables; runtime role cannot bypass it; query without context returns nothing | Done, verified |
| FOX-011 Schema, migrations, seed | Migration `0001_initial`, idempotent; least-privilege runtime role; `seed:dev` | Done, verified |
| FOX-006 Mail server registry | Create, list, validation (standard ports per TLS mode, unencrypted refused in production), audit entries; per-protocol TLS (D23) | In progress: update and delete not built yet |
| FOX-007 Domain mapping | Globally unique domains, mapping to another tenant's server impossible (composite foreign key), login only via mapping | Done, verified |
| FOX-008 Generic failure | Same message and status class; failures padded to ≥ 1.2 s with jitter (measured 1.22 s vs 1.47 s) | Done, verified |
| FOX-012 Envelope encryption | Per-value data key wrapped by master key, context-bound, rewrap for rotation, runbook | Done (no encrypted columns exist yet) |
| FOX-014 Login rate limits | Valkey counters shared across instances, growing delay per account+IP, hard block only per IP, failures audited | In review: limits come from environment variables until the admin console (Phase 3) |
| FOX-016/017/018 Vault | AES-256-GCM in Valkey, hashed session ids, idle + absolute expiry, survives API restart (verified), two keys during rotation, runbook | Done, verified |
| FOX-019 Cookies and CSRF | HttpOnly + Secure (prod) + SameSite=Strict, new id at login, old session destroyed, custom header + cross-site refusal | Done, verified (e2e) |
| FOX-025 SSRF guard | All addresses checked, IPv4-first fallback, pinned IP with hostname-verified TLS, rebinding test, `SSRF_BLOCKED` reason in audit | Done, verified |
| FOX-026 TLS enforcement | TLS 1.2 minimum, verification always on, STARTTLS failure is an error; tests with expired, wrong-name and untrusted certificates | Done, verified |
| FOX-027 UID and UIDVALIDITY | Opaque ids (folder + UIDVALIDITY + UID); changed UIDVALIDITY returns `409 folder_reset` | In review: the UI shows the error but does not yet reload the list automatically |
| FOX-028 Normalized errors | Stable codes for auth, unavailable, timeout, TLS, folder, recipient, protocol errors | In review: "cached view during outages" needs UI work |
| D1 fetch policy | Opening a message downloads only text parts (≈2.6 KB IMAP traffic vs 4.3 MB before for a 3 MB attachment); attachments streamed per part | Done, verified |
| FOX-076 Data isolation tests | Cross-mailbox and cross-tenant tests for contacts at database level | Done |
| FOX-090 Canary test | Canary password through login, errors, logs, responses, Valkey and audit | Done, verified |
| FOX-092 Security suites | SSRF, CSRF and cross-tenant tests automated | In review: needs a CI run |
| FOX-142 Fetch Metadata | Cross-site requests refused | Done |
| FOX-143 Trusted proxy and hosts | `TRUST_PROXY` (default loopback + private networks), `ALLOWED_HOSTS` | Done |
| FOX-029 Connection pool | — | **Not started** |
| FOX-119 Structured logs | Request ids in error responses and logs; no JSON log format yet | **In progress** |
| FOX-144 Secret value type | — | **Not started** |

## Other findings fixed on the way

- **Valkey connection race:** with the offline queue disabled, the first request after start-up failed with a 500. The app now connects at start-up and fails fast if Valkey is unreachable. Found by the end-to-end test.
- A local PostgreSQL already used port 5432 on this machine; the dev database uses 55432.
- `minimatch` advisory (moderate) in lint tooling only; CI blocks on high for dev dependencies until ESLint and typescript-eslint ship the fixed version.

## How to run locally

```bash
docker compose up -d postgres valkey greenmail      # or the docker run equivalents
cd backend
export DATABASE_OWNER_URL=postgres://foxalora:foxalora-dev-owner@127.0.0.1:55432/foxalora
export DATABASE_URL=postgres://foxalora_app:foxalora-dev-app@127.0.0.1:55432/foxalora
export VALKEY_URL=redis://:foxalora-dev-valkey@127.0.0.1:6379
export FOXALORA_VAULT_KEYS=dev1:$(openssl rand -base64 32)
npm run build && npm run migrate && npm run seed:dev
npm run start:dev

# tests (integration tests need the two URLs below)
FOXALORA_TEST_PG_OWNER_URL=$DATABASE_OWNER_URL FOXALORA_TEST_VALKEY_URL=$VALKEY_URL npm test
```
