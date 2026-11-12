# Foxalora Mail: developer handoff

Welcome to the team. This page gets you from zero to your first pull request, and tells you what we expect. Read it once fully; it takes about fifteen minutes.

Date: 2026-11-12. Repository: https://github.com/ravis-farooq/foxalora

## 1. What we are building

Foxalora Mail is a free, open-source webmail app for hosting companies. It connects to a hosting company's **existing** IMAP and SMTP servers; it does not store mailboxes. People sign in with their normal email address and password (later also from cPanel through single sign-on).

A hosting company adopts it only if three things are true, so these drive every decision:

1. **Install in 15 minutes** on a Linux server with Docker.
2. **People like using it:** fast, good on phones, and simpler than Gmail, so that someone who has never used webmail can manage without help.
3. **Trust:** security with evidence. Email is sensitive; a security shortcut costs more than a missing feature.

**Source of truth:** the PRD (`docs/PRD-v1.0.pdf`) decides *what* we build (requirement ids like AUTH-001, MAIL-012). `CLAUDE.md` holds the build plan and the security rules. `docs/DECISIONS.md` records every decision. If documents disagree, the PRD wins on scope; raise the conflict instead of picking silently.

## 2. Run it on your machine (about 10 minutes)

You need: macOS or Linux, Docker (Docker Desktop, Colima or plain Docker on Linux), Node.js 22, and free ports 143, 993, 587, 465, 3000, 5173, 6379 and 55432.

```bash
git clone git@github.com:ravis-farooq/foxalora.git
cd foxalora
dev/up.sh
```

That one command starts a real mail server (Postfix + Dovecot with TLS), PostgreSQL and Valkey, prepares the database, fills two test mailboxes with sample mail, and starts the app. Open http://localhost:5173 and sign in with a test account below. Ctrl+C stops the app; `dev/down.sh` stops the containers (`--purge` also deletes their data).

Useful variants:

| Command | What it does |
|---|---|
| `dev/up.sh --services-only` | Services and sample data only; run the API or tests yourself |
| `. dev/env.sh` | Sets the database, Valkey and test-certificate variables in your shell |
| `dev/up.sh --with-greenmail` | Also starts GreenMail, a quick test server without TLS |
| `dev/mailservers/exim.sh` | Swaps in an Exim + Dovecot server, to test a second server type |
| `node backend/dist/cli.js help` | Operator commands: tenants, mail servers, domains, sample mail |

## 3. Test accounts

These exist **only in the local test servers** on your own machine. They are fake, safe to share, and do not work anywhere else. Never use a real mailbox for development.

The test servers **never deliver to the internet**: mail to any address outside the test domains comes straight back with "mail to outside addresses is not delivered". Send test mail between the accounts below. To try delivery to real mailboxes, see D-009 in `docs/DECISIONS.md`.

| Server | Address | Password | Notes |
|---|---|---|---|
| Postfix + Dovecot (default) | `carol@dovecot.test` | `carol-pass-1` | Has sample messages: formatting, attachments, a hostile newsletter, Arabic text |
| Postfix + Dovecot (default) | `dave@dovecot.test` | `dave-pass-1` | Use it to send mail to carol and back |
| Exim + Dovecot (`dev/mailservers/exim.sh`) | `erin@exim.test` | `erin-pass-1` | Second server type |
| Exim + Dovecot | `frank@exim.test` | `frank-pass-1` | |
| GreenMail (`--with-greenmail`) | `alice@example.com` | `alice123` | No TLS; for quick automated tests only |
| GreenMail | `bob@example.com` | `bob123` | |

Dev database (port 55432): owner `foxalora` / `foxalora-dev-owner`, app role `foxalora_app` / `foxalora-dev-app`. Dev Valkey password: `foxalora-dev-valkey`. Production installs generate their own secrets; these values must never appear in a deployment.

## 4. How the code is organised

```
backend/                NestJS API (TypeScript), one deployable
  src/auth/             sign-in, session vault (encrypted, in Valkey), login throttling
  src/mail/             the ONLY code that talks to mail servers: IMAP, SMTP, drafts, search
  src/security/         SSRF guard, HTML sanitizer, filename rules
  src/registry/         tenants, mail servers, domain-to-server mapping
  src/contacts/         address book, vCard import/export, recipient history
  src/preferences/      user settings and signatures
  src/database/         schema, migrations, TenantDb (row-level security)
  src/cli.ts            operator commands
  test/                 unit, integration and end-to-end tests (Vitest)
frontend/               React 19 + Vite (TypeScript), plain CSS with design tokens
  src/components/       screens: Mailbox, Contacts, Settings, Compose, Guide ...
  src/editor/           the email editor (Tiptap), made email-safe
  src/ui/               shared pieces: icons, toasts, confirm dialog, tooltips, theme
dev/                    one-command dev stack, test mail servers, test certificates
deploy/                 production install draft (Docker Compose, Nginx) - not finished
docs/                   PRD, decisions, backlog, progress notes, this page
```

How a request flows: browser -> `/api/v1/...` -> auth guard (session cookie + CSRF header) -> controller -> service -> either `TenantDb` (PostgreSQL with row-level security) or the mail adapter (IMAP/SMTP through the SSRF guard with TLS verification).

## 5. Security rules nobody may break

These come from the PRD and `CLAUDE.md` section 4. If a task seems to need breaking one, stop and ask in the group first.

1. **Mailbox passwords** live only in the encrypted session vault. Never in the database, browser storage, URLs, logs, error messages or API responses.
2. **Users never choose a mail server.** It comes from the admin's server list, picked by the email domain.
3. **Every mail connection** goes through the SSRF guard, and TLS certificate checks stay on.
4. **Incoming email HTML is hostile:** server-side sanitizing, a sandboxed frame with no scripts and no network, and (still to build) a separate origin. Remote images are blocked by default.
5. **Login failures look the same** whatever the reason.
6. **Tenant and mailbox always come from the session**, never from the request. All tenant data goes through `TenantDb`; PostgreSQL row-level security backs it up.
7. **Logs never contain** passwords, session tokens, message bodies, attachments or auth headers.
8. **Messages are identified** by folder + UIDVALIDITY + UID, never by sequence number.
9. **List views fetch headers only;** bodies are fetched when opened, attachments when asked for. No copy of mail is stored in our database.
10. **Uploads and downloads** are checked for size, type and content; downloads always force "save as".
11. **Sessions:** random 256-bit ids, a new id at every sign-in, HttpOnly + Secure + SameSite=Strict cookies, plus a custom header on every change request.
12. **Only the mail adapter** (`backend/src/mail/`) opens connections to mail servers; only the vault holds passwords.

How we keep them: tests for SSRF, TLS, tenant isolation, CSRF and a "canary" password that must never appear anywhere (`backend/test/`). CI runs these plus secret scanning, dependency audit and CodeQL on every push. Report security problems privately (see `SECURITY.md`), never in a public issue.

## 6. Decisions so far

Full reasons, security and operational impact are in `docs/DECISIONS.md`.

| Id | Decision |
|---|---|
| D-001 | Licence: GPL-3.0-or-later with a skins and plugins exception (same terms as Roundcube). Roundcube code may be ported with its notices; SnappyMail core (AGPL) must not be copied. |
| D-002 | Extra features from the competitor review added as FOX-134 to FOX-147. Real-time inbox (IDLE) and the separate render domain wait. |
| D-003 | Editor: Tiptap, limited to email-safe content, with our own email output. Squire is the fallback. |
| D-004 | Data layer: PostgreSQL 18 with row-level security (Kysely), Valkey for sessions and throttling, least-privilege database role. |
| D-005 | Styling: plain CSS with design tokens and our own SVG icons; no CSS framework. |
| D-006 | Contacts, settings and signatures built before the rest of Phase 2, at the product owner's request. |
| D-007 | Never lose work, never surprise: drafts saved on close, confirmation before deleting, Undo and Restore from Trash, recipient history (address only, can be switched off), first-run guide, tooltips, no sound-only feedback. |
| D-008 | Signatures can hold up to 3 images (PNG, JPEG, GIF, 64 KB each), stored in the signature and sent as inline attachments, like Roundcube. |
| D-009 | The local test mail servers deliver only to their own test domains; mail to outside addresses bounces at once. |

**Open decisions; do not decide these alone:**

| Id | Question | Status |
|---|---|---|
| OPEN-1 | How single sign-on from cPanel gets mailbox access | Needs a spike on a real cPanel + Dovecot, then product-owner approval |
| OPEN-2 | Shared hosting without Docker | Docker-only for v1.0 unless told otherwise |
| OPEN-4 | Save sent mail to Sent through IMAP, or rely on the server | Test on the target servers, then ask |
| D-007 note | Does "no copy of mail in the database" also forbid storing recipient addresses? | Product owner to confirm; switching history off by default is a one-line change |

## 7. Where we are and what is next

| Phase | State |
|---|---|
| 0. Make the prototype real | Done (`docs/PROTOTYPE_RESULTS.md`) |
| 1. Foundations (database, vault, security tests, CI) | Done; open: connection pool (FOX-029), JSON logs (FOX-119), server registry edit/delete |
| 2. Core mail (folders, viewer, composer, attachments, search) | In progress |
| 3. Contacts, settings, admin console | Contacts and settings done early; admin console not started |
| 4. Interface quality (mobile, WCAG, Arabic RTL) | Partly done |
| 5. SSO, Docker image, installer, monitoring | Not started |
| 6. Security verification and release | Not started |

Working today: sign-in, folders with roles and counts, paged list, search (subject, sender, recipient), reading with safe HTML, reply / reply all / forward, delete with confirmation and Undo, restore from Trash, mark read/unread/star, drafts (save on close, autosave, continue, discard), contacts with suggestions and vCard, settings (name, theme, density, time zone, address history), signatures with images, first-run guide, tooltips, phone layout, light and dark themes.

**Good next stories** (ids are in `docs/Foxalora-Development-Backlog.xlsx`, also importable to Jira from `docs/Foxalora-Jira-Import.csv`):

- **Release blocker:** separate-origin render host for email HTML (viewer epic E06).
- Attachments upload and forwarding original attachments (E08); inline `cid:` images in the viewer (E06).
- Move messages with a folder picker, bulk selection and actions (FOX-035, FOX-037); custom folders (FOX-038).
- Search filters and cross-folder search (FOX-068, FOX-069, FOX-071).
- Save to Sent (needs OPEN-4 first, FOX-059); send error handling (FOX-060).
- CSV contact import (FOX-074).
- Connection pooling (FOX-029) and structured JSON logs (FOX-119).
- Arabic right-to-left interface and translations (FOX-108); WCAG 2.2 AA audit (FOX-107); Playwright browser tests (FOX-109).
- Application Docker image and installer (E14), then the SSO spike (OPEN-1).

Before picking one, say which story you take in the team group so two people do not build the same thing.

## 8. User experience rules

Our users include people who have never used webmail. Every screen should pass this test: **could a first-time user do this without asking anyone?**

- **Plain words.** "Move to Trash", not "Expunge". No jargon in labels, messages or errors. Say what happened and what to do next.
- **Every icon explains itself.** Icon buttons carry an `aria-label` and a `data-tip` description; the shared tooltip shows it on hover and on keyboard focus. Main buttons also show a text label.
- **Never lose the user's work.** Closing the composer saves a draft. Deleting asks first with the shared dialog (`useConfirm`): moving to Trash says it can be restored, and the toast also offers Undo; deleting for good is marked as permanent. Trash has a Restore button.
- **Always confirm what happened** with a short toast ("Message sent", "Saved to Drafts").
- **Show only what works.** No buttons for features that do not exist yet.
- **Guide newcomers.** The first-run guide (`frontend/src/components/Guide.tsx`) must stay short; update it when the main screen changes.
- **Phones are first-class.** Check every change at 375 px wide: one pane at a time, a back button, touch targets at least 24 px (WCAG 2.2), 40 px or more for main actions.

## 9. Accessibility rules (WCAG 2.2 AA)

The app must work for people who use a keyboard only, screen-reader users, people with low vision, and deaf and hard-of-hearing users.

- **Deaf and hard-of-hearing users:** never use sound as the only signal. Every event (new mail, sent, error) must be visible as text. Any future help video needs captions and a transcript. Write instructions as text, not audio.
- **Keyboard:** everything works with Tab, Enter, Space, arrow keys and Escape; focus is always visible; dialogs keep focus inside and return it afterwards. A "Skip to main content" link is the first stop.
- **Screen readers:** real buttons and links, labels on every control, `role="alert"` for errors, `aria-live` for status, landmarks (`nav`, `main`).
- **Vision:** text contrast at least 4.5:1 in both themes; do not rely on colour alone; layouts must survive 200% zoom; respect "reduce motion".
- **Time:** error messages stay until dismissed; other messages pause while the pointer or focus is on them.

## 10. How we work together

1. **One story per branch and pull request.** Branch from `main` as `fox-123-short-name`; put the story id in the PR title (`FOX-123: ...`).
2. **Tests first** for anything security-related (SSRF, tenant isolation, sanitizer, vault, CSRF). Add or update tests for everything else.
3. **Run the checks before you push:**
   ```bash
   dev/up.sh --services-only && . dev/env.sh
   cd backend && npm run lint && npm run typecheck && npm test && npm run build
   cd ../frontend && npm run lint && npm run typecheck && npx vitest run && npm run build
   ```
4. **Sign off every commit** (`git commit -s`, Developer Certificate of Origin).
5. **CI must be green** and one reviewer must approve. Changes to `backend/src/security/`, `backend/src/auth/`, the vault, row-level-security policies or `deploy/` need a review from someone responsible for security.
6. **Never commit** secrets, real mailbox credentials, `.env` files, `mail-servers.json`, TLS keys or `dev/.vault-key`. CI scans for secrets and fails the build.
7. **New dependencies** need a reason in the PR, a GPL-3.0-compatible licence, an active maintainer and an exact pinned version.
8. **Decisions:** anything that changes scope or design gets a short entry in `docs/DECISIONS.md` (reason, security impact, operational impact). Update the backlog status column when you start and finish a story.
9. **Say what you tested.** "Works" means you ran it; write in the PR what you ran and what you could not test.

### Pull request checklist

- [ ] Story id in the title; acceptance criteria met
- [ ] Tests added or updated; all checks pass locally and in CI
- [ ] No secrets, passwords or message content in logs, errors or responses
- [ ] Tenant and mailbox come from the session for any stored data
- [ ] UI: plain words, tooltips on icon buttons, confirm or Undo for destructive actions, works on a phone
- [ ] Accessibility: keyboard only, screen-reader labels, contrast in light and dark
- [ ] Docs and backlog status updated

## 11. Help

- Read first: `CLAUDE.md`, `docs/DECISIONS.md`, `CONTRIBUTING.md`, `SECURITY.md`.
- Ask in the team group before large changes, and for any open decision above.
- Security issues: report privately to the maintainers, never in a public issue or chat group.
