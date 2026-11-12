# Foxalora Mail: Prototype (v0.1)

Technical prototype for the PRD's recommended "prototype before MVP" step.
It proves: **login, folders, inbox list, open message, send, safe HTML rendering,
admin-mapped mail servers, SSRF guard, encrypted session vault.**

> Status: Phase 0 done and Phase 1 (foundations) nearly done on 2026-11-12: PostgreSQL with
> row-level security, encrypted session vault in Valkey, database-backed server registry,
> security test suites. See `docs/PHASE1_PROGRESS.md`.

## Quick start (Node 22, Docker)

```bash
# 1. Dev services: PostgreSQL (port 55432), Valkey (6379), GreenMail test mail server
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env            # then fill in the CHANGE_ME values, or export them
npm install
npm run build
npm run migrate                 # schema owner connection (DATABASE_OWNER_URL)
npm run seed:dev                # development tenant: example.com, dovecot.test, exim.test
npm run start:dev               # http://localhost:3000/api/v1

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

Login with `alice@example.com` / `alice123` (GreenMail). Real-TLS test servers
(Postfix + Dovecot, Exim + Dovecot) with a private test CA are in `dev/mailservers/`;
start the API with `NODE_EXTRA_CA_CERTS=dev/mailservers/certs/ca.pem` so certificate
verification stays on.

Mail servers and domains are managed with the operator CLI: `node dist/cli.js help`.
Progress and test status: `docs/PROTOTYPE_RESULTS.md` (Phase 0), `docs/PHASE1_PROGRESS.md` (Phase 1).

## What is implemented (PRD mapping)

| PRD item | Where |
|---|---|
| AUTH-001/002/003 login + IMAP + SMTP verify | `auth/auth.controller.ts`, `mail/mail.service.ts#verifyLogin` |
| AUTH-004/005 admin-configured hosts/ports (separate IMAP/SMTP TLS) | `registry/`, `database/`, operator CLI `src/cli.ts` |
| AUTH-006 TLS/STARTTLS, no silent fallback | `mail/connections.ts` |
| AUTH-007/008 logout + idle/absolute expiry | `auth/vault.service.ts` (Valkey) |
| AUTH-011/012 throttling + generic errors | `auth/login-throttle.service.ts`, `auth.controller.ts` |
| MAIL-001..008, 010, 012 list/read/flags/delete (to Trash)/paginate; folders are listed but cannot be created, and messages cannot be moved yet | `mail/mail.service.ts` |
| Folder roles via IMAP SPECIAL-USE | `listFolders` |
| UID + UIDVALIDITY in opaque message ids | `mail/message-id.ts` |
| HTML sanitize, remote images blocked | `security/sanitize.ts` |
| Sandboxed iframe + CSP | `frontend/src/components/MessageView.tsx` |
| SSRF: DNS validation + IP pinning + private-range block | `security/ssrf.ts` |
| Password never in DB/logs/localStorage/URL; encrypted vault | `auth/vault.service.ts`, canary test |
| CSRF (SameSite=Strict + custom header) | `auth.guard.ts`, `frontend/src/api.ts` |
| Attachment download, forced download, nosniff | `mail.controller.ts` |
| Responsive 3-pane UI | `frontend/src/styles.css` |

## Deliberately NOT in the prototype

Contacts, signatures, preferences, search, drafts, attachments on send, threading,
IMAP IDLE/connection pooling, admin UI,
installer wizard, i18n/RTL, SSO adapters, separate-origin email rendering,
Docker image for the app, most tests (only backend security unit tests exist).
All are in the Development Backlog.

## Known gaps to fix before anything beyond a demo

1. One IMAP connection per request: slow on big mailboxes. Needs pooling.
2. Email iframe uses `sandbox` + CSP but is same-origin parent. Move to a dedicated
   sandbox origin (PRD 5.4).
3. Mobile: no "back to list" button when a message is open.
4. Run `npm audit`, SAST and pen-test before real use (PRD 5.11).

## Licence

Foxalora Mail is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License (**with an exception for skins and plugins**)
as published by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version. See [LICENSE.md](LICENSE.md).

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.

Exception: skins and plugins that only call Foxalora Mail's documented interfaces,
and include it by reference for that purpose, are not considered modifications of
Foxalora Mail and may be licensed separately.
