# Foxalora Mail: Prototype (v0.1)

Technical prototype for the PRD's recommended "prototype before MVP" step.
It proves: **login, folders, inbox list, open message, send, safe HTML rendering,
admin-mapped mail servers, SSRF guard, encrypted session vault.**

> Status: Phase 0 done and Phase 1 (foundations) nearly done on 2026-11-12: PostgreSQL with
> row-level security, encrypted session vault in Valkey, database-backed server registry,
> security test suites. See `docs/PHASE1_PROGRESS.md`.

## Quick start (Node 22, Docker)

```bash
dev/up.sh
```

One command starts everything for development and keeps it in the foreground (Ctrl+C stops
the API and web app):

- **Postfix + Dovecot** (docker-mailserver) with real TLS from a private test CA: IMAP 993,
  SMTP 587 with STARTTLS. This is the setup most hosting companies run, so development uses it.
- PostgreSQL 18 (port 55432) and Valkey (6379); migrations, the development tenant and
  sample messages are applied automatically and only once.
- API on http://localhost:3000/api/v1 and the web app on http://localhost:5173.

Sign in as `carol@dovecot.test` / `carol-pass-1` or `dave@dovecot.test` / `dave-pass-1`.
Carol's inbox has sample messages: formatting and a table, attachments with an inline image,
a hostile newsletter (tracking pixel, CSS background, deceptive link), plain text and Arabic RTL.

| Command | What it does |
|---|---|
| `dev/up.sh --services-only` | services and seed data only (run the API or tests yourself) |
| `dev/up.sh --with-greenmail` | also start GreenMail (`alice@example.com` / `alice123`) |
| `. dev/env.sh` | database, Valkey, vault key and test CA variables for manual commands and tests |
| `dev/down.sh` | stop the containers, keep data; `--purge` also deletes the dev database and mailboxes |
| `dev/mailservers/exim.sh` | swap in the Exim + Dovecot server (`erin@exim.test` / `erin-pass-1`) |
| `node backend/dist/cli.js seed:mail --force` | add the sample messages again |

GreenMail stays in `docker-compose.yml` (profile `greenmail`) for fast automated tests; it
does not use TLS and behaves differently from production servers (`docs/PROTOTYPE_RESULTS.md`).
The API trusts the test CA through `NODE_EXTRA_CA_CERTS`; certificate verification stays on.
Ports 143, 993, 587 and 465 must be free on the machine.

New developers: start with `docs/DEVELOPER_HANDOFF.md` (setup, test accounts, rules, how to contribute).

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
| Folder roles with names and icons, paged list, labelled toolbar, toasts | `frontend/src/components/Mailbox.tsx`, `frontend/src/mail/folders.ts` |
| SRCH quick search (subject, sender, recipient) via IMAP SEARCH | `backend/src/mail/search.ts`, `mail.service.ts#listMessages` |
| COMP reply, reply all (without own address), forward | `frontend/src/mail/format.ts`, `Mailbox.tsx` |
| Light and dark themes, phone layout with drawer and back button | `frontend/src/styles.css`, `frontend/src/ui/theme.ts` |
| CONT contacts: create, edit, delete, search, several addresses; vCard import and export; suggestions while typing recipients | `backend/src/contacts/`, `frontend/src/components/Contacts.tsx`, `RecipientInput.tsx` |
| PREF display name (used in From), theme, density, time zone; reset | `backend/src/preferences/`, `frontend/src/components/Settings.tsx` |
| Signatures: rich text, default per mailbox, cleaned on save | `backend/src/preferences/signature-content.ts`, `frontend/src/components/SignatureEditor.tsx` |
| COMP drafts: saved on close and every 30 s, continue, discard with confirmation, removed after send | `backend/src/mail/outgoing.ts`, `mail.service.ts#saveDraft`, `frontend/src/components/Compose.tsx` |
| Delete with Undo; confirmation dialogs for actions that cannot be undone | `frontend/src/ui/ConfirmProvider.tsx`, `Mailbox.tsx` |
| Recipient suggestions from contacts and address history (opt-out, clear) | `backend/src/contacts/recipients.service.ts`, `RecipientInput.tsx` |
| First-run guide, tooltips on hover and focus, skip link, visual-only feedback | `frontend/src/components/Guide.tsx`, `frontend/src/ui/TooltipLayer.tsx` |

## Deliberately NOT in the prototype

CSV contact import, filtered and cross-folder search, attachments on send,
moving messages with a folder picker, bulk actions, threading, IMAP IDLE/connection pooling, admin UI,
installer wizard, i18n/RTL, SSO adapters, separate-origin email rendering,
Docker image for the app, most tests (only backend security unit tests exist).
All are in the Development Backlog.

## Known gaps to fix before anything beyond a demo

1. One IMAP connection per request: slow on big mailboxes. Needs pooling.
2. Email iframe uses `sandbox` + CSP but is same-origin parent. Move to a dedicated
   sandbox origin (PRD 5.4).
3. Inline (`cid:`) images in received mail are shown as attachments, not in the body.
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
