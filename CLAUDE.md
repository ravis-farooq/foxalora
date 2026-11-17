# Foxalora Mail: Claude Code handoff

You are building **Foxalora Mail**, a free and open-source webmail client for hosting companies. It is a secure email access platform, not just a webmail UI. Read this whole file before writing code, then follow the build plan in section 7.

Dates in this file are from 2026-11-11. Nothing described as "drafted" below has been run yet.

## 1. What the product is

- A web client that connects to a hosting company's **existing** IMAP and SMTP servers. It does not host mail, store mailboxes, filter spam or manage DNS.
- Users log in with their normal email address and password (Mode A), or arrive from a hosting panel through signed SSO (Mode B, cPanel first).
- Hosting companies install it themselves (Docker on Linux), brand it, and map their email domains to their mail servers.
- Licence: GPL-3.0-or-later with an exception for skins and plugins (same terms as Roundcube; decided 2026-11-12, see `docs/DECISIONS.md`). Full text in `LICENSE.md`.

### Adoption targets that shape the build

A hosting company adopts this only if three things hold, so treat them as product requirements:

1. **Install in 15 minutes** from a fresh Linux server with Docker to a working login. Time it in every pilot; if the installer or docs make it slower, fix that before adding features.
2. **Customers are happy:** modern, fast, good on phones, fewer webmail support tickets. Do not claim ticket reduction until a pilot host measures it.
3. **Trust:** security with evidence (separate render origin, independent penetration test, vulnerability policy, tested-servers list). Email is sensitive; a security shortcut costs more than a missing feature.

## 2. Documents in this repo

| File | Use it for |
| --- | --- |
| `docs/PRD-v1.0.pdf` | What the product must do. Requirement IDs (AUTH-001, MAIL-012, COMP-005 ...) are the source of truth for scope. |
| `docs/SAD.md` | How it is built (architecture, data, API, security, deployment, ADRs). If missing, export the SAD from the Docs artifact as Markdown into this path. |
| `docs/Foxalora-Development-Backlog.xlsx` | 147 stories in 23 epics (FOX-134 to FOX-147 added 2026-11-12, see `docs/DECISIONS.md` D-002) with acceptance criteria, PRD refs, priority, release, first-estimate points. |
| `docs/Foxalora-Jira-Import.csv` | Same backlog for Jira import. |
| `README.md` | How to run the prototype. |
| `docs/DEVELOPER_HANDOFF.md` | Onboarding for team developers: setup, test accounts, security and UX rules, decisions, how to contribute. Keep it current. |
| `deploy/`, `backend/Dockerfile`, `frontend/Dockerfile` | Production install for test and pilot servers (`deploy/install.sh`, `deploy/cli.sh`, Compose with Nginx, API, PostgreSQL, Valkey; guide in `docs/runbooks/install.md`). Images built and the stack tested in production mode with plain docker on 2026-11-16; `install.sh` with Compose and the setup wizard run on a fresh Ubuntu 24.04 machine on 2026-11-17 (bare machine to setup link in 178 s, self-signed); Let's Encrypt on a public server not yet tested. |
| `docs/LAUNCH_KIT.md` | Go-to-market drafts. Do not publish claims marked [after v1.0] before they are true. |

If two documents disagree, the PRD wins on scope and the SAD wins on design. Report the conflict instead of picking silently.

## 3. Current state

`backend/` (NestJS 12) and `frontend/` (React 19 + Vite 8). **Phase 0 finished** (results: `docs/PROTOTYPE_RESULTS.md`). **Phase 1 exit criteria met** (`docs/PHASE1_PROGRESS.md`; CI green on GitHub): PostgreSQL 18 with row-level security and a least-privilege runtime role (Kysely + pg), database-backed mail server registry with separate IMAP/SMTP TLS and an operator CLI (`backend/src/cli.ts`), encrypted session vault and login throttling in Valkey, envelope encryption, opaque message ids with UIDVALIDITY checks, normalized mail errors, CI workflow, and 72 backend tests including cross-tenant, SSRF, TLS and canary suites. Open in Phase 1: connection pool (FOX-029), JSON logs (FOX-119), registry update/delete. Data-layer choices: `docs/DECISIONS.md` D-004. The Tiptap composer (D-003) is the app's editor in `frontend/src/editor/`, with inline images sent as validated `cid:` attachments; `spikes/tiptap-email/` is the original spike.

What exists in draft form: direct login with IMAP and SMTP verification, encrypted in-memory session vault, admin-mapped mail servers, SSRF guard with IP pinning, folder list, paged message list, message read with server-side HTML sanitization, sandboxed iframe viewer, send, flags, delete, attachment download, quick search (subject, sender, recipient), reply, reply all, forward, mark read/unread and star; contacts with search, recipient suggestions and vCard import/export; settings for display name (used in From), theme, density and time zone; rich-text signatures with up to 3 images (D-008), cleaned on save (`docs/DECISIONS.md` D-006, built ahead of Phase 2 at the product owner's request); drafts saved on close and every 30 s, delete with confirmation and Undo, Restore from Trash, confirmation dialogs, address history for suggestions, first-run guide and tooltips (D-007); folder tree with subfolders, Archive and Junk, move by menu or drag and drop, bulk actions, storage indicator (D-010); sent mail saved to Sent (D-011); browser setup wizard at `/setup` with a one-time token from `install.sh`: environment checks, first administrator, mail server with a connection test, domains, locks itself after finishing (FOX-099, FOX-100, D-012). Interface: icon rail, folder pane with role names and icons, paged list, labelled message toolbar, toasts, light and dark themes, phone layout with folder drawer and back button (plain CSS with tokens, `docs/DECISIONS.md` D-005). Development runs against Postfix + Dovecot with real TLS (`dev/up.sh`); GreenMail is kept for fast automated tests only.

What does not exist: CSV contact import, language and other preferences beyond the four above, filtered or cross-folder search, attachment upload, threading, IDLE, connection pooling, admin UI (the setup wizard creates the first administrator, but there is no admin login or console yet), administrator two-step verification, i18n/RTL, SSO, separate render origin, frontend tests.

## 4. Non-negotiable rules

These come from the PRD security section and the SAD. Never break them to make something work. If a task seems to require breaking one, stop and ask.

1. **Mailbox passwords** exist only inside the session vault, encrypted (AES-256-GCM), with idle and absolute expiry, destroyed on logout. Never in PostgreSQL, localStorage, sessionStorage, URLs, logs, error reports, analytics or API responses.
2. **Users never supply a mail server.** Host and port come only from the admin-managed server registry, selected by the email domain.
3. **SSRF:** resolve the host, check every address against loopback/private/link-local/metadata ranges (unless the server has the explicit allow-private flag), connect to the validated IP, keep TLS hostname verification on the original name. Allowed ports are the standard mail ports.
4. **TLS:** minimum 1.2, certificate and hostname verification always on, no silent downgrade, STARTTLS failure is an error. `none-dev-only` exists for local test servers and must be refused when `NODE_ENV=production`.
5. **Incoming HTML is hostile.** Three layers are required: server-side DOMPurify, sandboxed iframe with no scripts and a no-network CSP, and a **separate origin** for the render frame. Remote images are blocked by default. The prototype still lacks the separate origin; it is a release blocker.
6. **Generic login failures.** Unknown domain, wrong password, unreachable server and blocked destination all return the same message.
7. **Tenant isolation is enforced on the server.** Tenant id comes from the session, never from the request. Repositories cannot query without it; PostgreSQL row-level security backs this up.
8. **Logging:** never log passwords, session tokens, SSO assertions, message bodies, attachment contents or auth headers. IMAP/SMTP protocol logging stays off.
9. **Message identity:** folder + UIDVALIDITY + UID, never sequence numbers as identifiers.
10. **Fetch policy:** list views fetch headers only; bodies only on open; attachments only on request; no local copy of mail in the database.
11. **Uploads/downloads:** validate size, extension and sniffed MIME on the server; random temp names; no execution; downloads use a generic content type, forced attachment disposition and `nosniff`.
12. **Sessions:** 256-bit random ids, new id at login, `HttpOnly` + `Secure` + `SameSite=Strict`, plus the custom CSRF header on state-changing requests.

## 5. Tech stack and commands

| Layer | Choice |
| --- | --- |
| Frontend | React + TypeScript, Vite. Plain CSS with design tokens and own SVG icons, not Tailwind (decided 2026-11-12, `docs/DECISIONS.md` D-005). |
| Backend | Node.js 20+ and NestJS, modular monolith |
| Mail libraries | `imapflow`, `nodemailer`, `mailparser` |
| Sanitizer | `isomorphic-dompurify` (server) |
| Data | PostgreSQL (config, contacts, preferences, audit), Redis (vault, SSO replay cache, rate limits) |
| Tests | Jest or Vitest for unit, Playwright for end-to-end |
| Deploy | Docker Compose behind Nginx on Linux |

```bash
dev/up.sh                       # Postfix + Dovecot (IMAP 993 TLS, SMTP 587 STARTTLS), PostgreSQL 55432, Valkey,
                                # migrations, dev tenant, sample mail, API :3000/api/v1, UI :5173 (Ctrl+C stops)
dev/up.sh --services-only       # services and seed data only
. dev/env.sh                    # dev environment variables for manual commands and tests
dev/down.sh                     # stop containers (--purge deletes dev data)
```

Test users: `carol@dovecot.test` / `carol-pass-1`, `dave@dovecot.test` / `dave-pass-1` (Postfix + Dovecot, default). `erin@exim.test` / `erin-pass-1` after `dev/mailservers/exim.sh`. GreenMail (`dev/up.sh --with-greenmail`): `alice@example.com` / `alice123`, for automated tests only. Do not use port 5432 for dev: a local PostgreSQL already runs there.

## 6. Architecture in brief

One NestJS deployable. Request pipeline: validation, auth guard (session + CSRF header), tenant resolution, authorization, handler.

| Module | Responsibility |
| --- | --- |
| Auth | login, logout, SSO exchange, rate limits |
| Session Vault | encrypted credentials, expiry (Redis in production) |
| Server Registry | tenants, mail servers, domain mappings, TLS policy |
| Email Adapter | the **only** code that opens connections to mail servers: `ImapService`, `SmtpService`, SSRF guard, UID handling |
| Mailbox, Message Rendering, Composer, Search, Contacts, Preferences | feature modules calling the adapter or the database |
| Admin, Panel Integrations, Audit and Health | configuration, cPanel/Plesk/DirectAdmin adapters, events and metrics |

Two structural rules: only the adapter touches mail servers; only the vault holds mailbox passwords. API is REST under `/api/v1`, documented in OpenAPI, with one error shape `{ error: { code, message, requestId } }`. Folder roles come from IMAP SPECIAL-USE first, an admin name map second.

## 7. Build plan

Work phase by phase. Each phase maps to backlog epics (IDs E01 to E23 in the spreadsheet). Do not start a phase until the previous exit criteria are met, unless the user says otherwise.

### Phase 0: make the prototype real (epic E01 spike)

- Install dependencies, fix compile and runtime errors, run against GreenMail, then against Postfix+Dovecot and an Exim-based server in Docker.
- Write down what broke and what each server does differently in `docs/PROTOTYPE_RESULTS.md`.
- **Exit:** login, folders, list, read, send work on at least two mail servers; sanitizer and iframe verified with a few hostile sample emails; results file written.

First prompt to give yourself: "Install deps, get `npm run typecheck` and `npm run build` passing in backend and frontend, then run the README flow against GreenMail and fix what fails. Do not add features."

### Phase 1: foundations (E01 rest, E02, E03, E04)

- CI with lint, tests, dependency and secret scanning; dev environment with seeded mailboxes.
- PostgreSQL schema, migrations, tenant model, repository layer, row-level security.
- Server registry CRUD, domain mapping, envelope encryption for sensitive config.
- Vault in Redis with key rotation; configurable rate limits; cookies and CSRF.
- Adapter hardening: error normalization, UIDVALIDITY handling, connection pool, SSRF and TLS tests.
- **Exit:** cross-tenant and SSRF test suites pass in CI; no password reachable outside the vault (canary test).

### Phase 2: core mail experience (E05, E06, E07, E08, E09)

- Folder roles, paging, flags, move, delete, custom folders, bulk actions, threading (Should).
- Viewer: sanitizer test corpus, **separate-origin render host with one-time token**, remote-image opt-in, inline images, link warning.
- Composer: run the editor selection spike first, then compose, reply, forward, autosave drafts, signatures, save to Sent (decided, D-011).
- Attachments: validated upload, drag-and-drop, preview, scan hook, archive limits.
- Search: filters mapped to IMAP SEARCH, cross-folder, limits and timeouts.
- **Exit:** every Must story in these epics meets its acceptance criteria with automated tests where practical.

### Phase 3: data features and administration (E10, E11, E12)

- Contacts with import and export, preferences, themes, administrator console, branding, policies, audit viewer.
- **Exit:** admin and mailbox sessions are separate; audit entries contain no secrets or content.

### Phase 4: interface quality (E15)

- Responsive layouts including a "back to list" control on mobile, WCAG 2.2 AA fixes, English and Arabic RTL, cross-browser Playwright runs. May run alongside phases 2 and 3.

### Phase 5: hosting integration and deployment (E16, E14, E17)

- Do the SSO spike (OPEN-1) before building the cPanel adapter; only then build the signed-assertion exchange with replay protection.
- Application Docker image, Compose stack with Nginx, PostgreSQL, Redis and render host; installer wizard that locks itself after setup; migrations, update and rollback procedure.
- Metrics, health checks, structured logs, load tests (100/10,000/100,000-message mailboxes, 100 and 500 users).

### Phase 6: verification and release (E13, E18)

- ASVS Level 2 mapping, security test suites, independent penetration test and remediation, vulnerability policy, documentation, licence inventory, release checklist.
- **Exit:** the definition of done in PRD section 14.

Roadmap epics E19 to E23 (rules, scheduling, multi-account, OpenPGP, AI) are out of scope for the MVP.

## 8. Decisions you must not make silently

| ID | Question | What to do |
| --- | --- | --- |
| OPEN-1 | How SSO obtains mailbox access (OAuth2, master auth, panel credential) | Run the spike on a real cPanel and Dovecot setup, then ask for approval |
| OPEN-2 | Shared hosting without Docker | Assume Docker-only for v1.0 unless told otherwise |
| OPEN-3 | Rich-text editor | **Decided 2026-11-12: Tiptap**, made email-specific; Squire is the fallback (`docs/DECISIONS.md` D-003). Spike FOX-051 proves the risky parts |
| OPEN-4 | Append to Sent through IMAP or rely on the server | **Decided 2026-11-13: Foxalora appends the sent message to Sent through IMAP**, except on servers marked "saves sent mail itself" (Gmail) (`docs/DECISIONS.md` D-011) |

Any deviation from the PRD or SAD needs a short written note: justification, security impact, operational impact.

## 9. How to work

- Pick one backlog story at a time. State which story and acceptance criteria you are addressing before editing.
- Write the test first for security-relevant behavior (SSRF, tenant isolation, sanitizer, vault, CSRF).
- Keep changes small and reviewable; run lint, typecheck and tests before saying a task is done.
- Do not claim something works unless you ran it. Say what you ran and what you did not.
- Do not add dependencies lightly; note licence and maintenance status when you do.
- Never commit secrets, real mailbox credentials or `mail-servers.json`.
- When requirements are ambiguous, ask one specific question and offer your recommended default.
- Update the backlog status column and `docs/` when behavior or design changes.

## 10. Known rough edges in the prototype

- One IMAP connection per request; slow on large mailboxes.
- The viewer iframe is sandboxed with a CSP but served by the same origin as the app.
- Sending does not yet attach files.
- Conversation threads are not built yet; the interface shows only working features.
- Inline (`cid:`) images in received mail are not displayed yet; they appear as attachments.

## 11. Definition of done (per story)

Acceptance criteria met; tests added or updated and passing; no secrets in logs or responses; tenant scoping verified where data is stored; accessibility checked for UI changes; docs and backlog updated; no new high-severity scanner findings.
