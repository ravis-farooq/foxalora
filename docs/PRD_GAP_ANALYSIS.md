# PRD v1.0 vs prototype v0.1: gap analysis

Date: 2026-11-12. Source: `docs/PRD-v1.0.pdf` (30 pages, same file as the one supplied as "Foxalora-mail (1).pdf").
Method: every requirement in the PRD was checked against every file in `backend/`, `frontend/`, `deploy/`, the root files and `docs/`. This was a code reading only: nothing was installed, compiled or run, so "Met" means "the code is there", not "it works".

Status key: **Met** = implemented in code. **Partial** = some of it is there, or backend only, or UI only. **Missing** = no code. **N/A** = not applicable yet.

## 1. Summary

| PRD area | Met | Partial | Missing | Notes |
| --- | --- | --- | --- | --- |
| Module 1 Authentication (12 IDs) | 9 | 1 | 2 | No SSO, no password change; rate limits hard-coded |
| Module 2 Mailbox (18 IDs) | 8 | 5 | 5 | No move, no folder create/delete, no star/unread UI |
| Module 3 Viewing (14 IDs) | 6 | 3 | 5 | No reply-all/forward, no separate render origin |
| Module 4 Composition (16 IDs) | 3 | 2 | 11 | Plain-text only; no attachments, drafts, signatures |
| Module 5 Attachments | download only | | upload side all missing | |
| Module 6 Search | | | all missing | |
| Module 7 Contacts | | | all missing | |
| Module 8 Preferences | | | all missing | Dark mode follows OS only |
| Module 9 Admin config | mail-server mapping (JSON file) | | everything else | No admin UI, no panel adapters |
| NFR-001 to NFR-014 | 1 | 7 | 2 | 4 more (NFR-001, 002, 004, 013) not measured or tested yet |
| Security section 5 | about half of 5.2, 5.3, 5.5, 5.6 | | 5.7 DB, 5.8 uploads, 5.9 tenants, 5.11 tests | |
| Section 6 architecture/API | 7 of 17 endpoints | | no DB, Redis, OpenAPI, error shape | |
| Section 7 deployment | draft Docker/Nginx | | wizard, updates | Images never built |
| Section 8 UI | 3-pane layout | mobile | search bar, i18n/RTL, themes | |
| Section 10 testing | | | no tests at all | |

The prototype covers what the PRD asks for in its own "build a prototype first" step (section 19): login, read, send, folder listing and sanitized HTML. It is far from the MVP scope in section 11. More important than the missing features are the **defects in the code that does exist**, listed next.

## Status after Phase 0 (2026-11-12)

See `docs/PROTOTYPE_RESULTS.md`. **Fixed:** D3, D4 (error filter and safe logging; adapter error normalization still Phase 1), D7 (SSRF errors now map to a logged 502), D9, D12, D18, D19, D20. **Verified working:** D8. **Still open:** D1, D2, D5, D6, D10, D11, D13, D14, D15, D16, D17.
New findings from running it:

| # | Severity | Problem | Status |
| --- | --- | --- | --- |
| D21 | Critical | SSRF guard blocked every public IPv4 address (IPv4-mapped rule in Node's `BlockList`) | Fixed, regression tests |
| D22 | High | Only the first resolved address was tried; IPv6-first hosts fail on Docker's IPv4-only network | Fixed: IPv4 first, safe fallback |
| D23 | Medium | One TLS policy for both IMAP and SMTP: cannot express IMAP 993 TLS + SMTP 587 STARTTLS | Open, FOX-006 |
| D24 | Medium | Attachment names kept path parts and bidi-override characters | Fixed, tests |

## 2. Defects and risks in existing code (fix before building on it)

Ordered by severity. File references are relative to the repo root.

| # | Severity | Problem | Where | PRD / rule |
| --- | --- | --- | --- | --- |
| D1 | High | Opening a message downloads the **whole raw message, including every attachment**, into memory (`source: true`). The same happens again for each attachment download. No size cap, so one large email can exhaust memory. | `backend/src/mail/mail.service.ts:120`, `:159` | Section 9 "fetch attachments only when requested", "avoid loading large emails into memory"; CLAUDE.md rule 10 |
| D2 | High | UIDVALIDITY is returned to the client but **never checked** on read, flag or delete. Routes take only `folder` + `uid`. If the server resets UIDVALIDITY, delete can hit a different message. | `backend/src/mail/mail.service.ts:112-206`, `backend/src/mail/mail.controller.ts` | Section 6.3; CLAUDE.md rule 9 |
| D3 | High | `.gitignore` covers `backend/mail-servers.json` but **not `deploy/mail-servers.json` or `deploy/certs/`** (which holds the TLS private key the installer writes). | `.gitignore:4`, `deploy/install.sh:44,55` | Section 7.3 secrets; CLAUDE.md section 9 |
| D4 | Medium | Unknown errors (for example from imapflow) fall through to NestJS's default handler, which returns `{statusCode,message}` instead of the agreed `{error:{code,message,requestId}}` and **logs the full error object and stack**. That text can include IMAP server responses and folder names. | `backend/src/main.ts` (no exception filter) | 5.10 never-log list; 6.5 consistent errors; CLAUDE.md rule 8 |
| D5 | Medium | Per-account login limit is keyed only on the email address: anyone can **lock any user out** for 15 minutes with 5 wrong passwords. Limits are hard-coded, not configurable. | `backend/src/auth/auth.controller.ts:29-30,50` | AUTH-011 ("configurable") |
| D6 | Medium | `trust proxy 1` is always on. When the API is reached without Nginx (dev, or a misconfigured install), a client can set `X-Forwarded-For` and bypass the per-IP limit. | `backend/src/main.ts:15` | 5.6 brute-force protection |
| D7 | Medium | SSRF rejections are not logged as such: `SsrfError` has no code or name, so login logs `(error)`; on other routes the error becomes a 500. | `backend/src/security/ssrf.ts:34`, `auth.controller.ts:65` | 5.5 item 10 "log rejected connection attempts" |
| D8 | Medium | **Hostname verification needs checking.** The code connects to the pinned IP and passes `tls.servername`. imapflow also has its own top-level `servername` option; if it overrides the `tls` one, verification may fail or check the wrong name. | `backend/src/mail/connections.ts:23-33` | 5.3; CLAUDE.md rules 3-4. Verify in Phase 0 |
| D9 | Medium | No IMAP `connectionTimeout`/`greetingTimeout` (imapflow defaults are long), so an unreachable server can make login hang far beyond the 3-second target. | `backend/src/mail/connections.ts:35` | NFR-001, section 9 timeouts |
| D10 | Medium | The DOMPurify hook is global, so it **also rewrites outgoing mail**: remote images in the user's own HTML would be stripped and links forced to `target=_blank`. Latent today because the composer only sends plain text. | `backend/src/security/sanitize.ts:15`, `mail.service.ts:232` | COMP-007 |
| D11 | Medium | Delete has no confirmation. In Trash, or on a server with no `\Trash` folder, it **deletes permanently**. | `frontend/src/components/MessageView.tsx:46`, `mail.service.ts:197-200` | MAIL-010 |
| D12 | Low | `POST /messages/send` does not check body types: `to: "a@b.com"` (string instead of array) throws a TypeError and returns 500. No global `ValidationPipe`/DTOs. | `mail.service.ts:213` | 6.5 input validation |
| D13 | Low | Logging in does not destroy an existing session from the old cookie, so encrypted credentials linger until expiry. Logout needs a valid session, so after expiry the cookie is never cleared. | `auth.controller.ts:70,84` | 5.2 item 7 |
| D14 | Low | Frontend has no 401 handling: after idle expiry the user sees error text instead of being returned to the login screen. | `frontend/src/api.ts:26`, `App.tsx` | AUTH-008 UX |
| D15 | Low | Paging uses sequence-number windows; new mail arriving between "Load more" clicks shifts the window, causing duplicates (duplicate React keys) or skipped messages. | `mail.service.ts:81-87` | MAIL-012 |
| D16 | Low | `backend/Dockerfile` healthcheck relies on GNU wget exit code 8. Alpine's busybox wget likely returns 1 on HTTP 401, so the container will probably always report unhealthy. There is no `/health` endpoint. | `backend/Dockerfile:21-22` | NFR-012 (verify when image is built) |
| D17 | Low | No `.dockerignore`. Build context is the repo root, so `node_modules`, `.env` and `mail-servers.json` are sent to the Docker daemon, and `COPY frontend/ ./` would copy a local `node_modules` into the image. | `frontend/Dockerfile:7` | Section 7 |
| D18 | Medium | SSRF blocklist misses NAT64 `64:ff9b::/96`, 6to4 `2002::/16` and Teredo `2001::/32`, which can map to internal IPv4 on some networks. Roundcube shipped CVE fixes for exactly the NAT64 and 6to4 bypasses (its `CHANGELOG.md`), so this is a known attack path, not a theory. | `backend/src/security/ssrf.ts:28-32` | 5.5 item 4 |
| D20 | Low | The inline-style filter only matches a literal `url(`. CSS escapes (for example `u\72l(`) get past it; Roundcube has fixed several remote-content bypasses of this kind. Today the frame CSP (`img-src data:`) still blocks the request, so the CSP is the real control. Keep it mandatory and add escaped-CSS cases to the sanitizer test corpus. | `backend/src/security/sanitize.ts:37-40` | 5.4 remote-image blocking |
| D19 | Info | **README overclaims**: it lists MAIL-009 (move) and MAIL-014 as implemented. There is no move endpoint; delete-to-Trash is the only move. Folders can be browsed but not created or deleted. | `README.md:43` | |

## 3. Module-by-module check

### Module 1: Authentication and login

| ID | Pri | Status | Evidence / gap |
| --- | --- | --- | --- |
| AUTH-001 | Must | Met | `auth.controller.ts:38-80`, `Login.tsx` |
| AUTH-002 | Must | Met | `mail.service.ts:47-48` IMAP auth |
| AUTH-003 | Must | Met | `mail.service.ts:49-54` SMTP `verify()` |
| AUTH-004 | Must | Met | `config/mail-servers.ts`, JSON file (no admin UI yet) |
| AUTH-005 | Must | Met | same |
| AUTH-006 | Must | Met | `connections.ts`: implicit TLS, forced STARTTLS, TLS 1.2 min (see D8) |
| AUTH-007 | Must | Met | `session.service.ts:67-72`, cookie cleared (see D13) |
| AUTH-008 | Must | Met | idle 30 min, absolute 12 h, sweeper (see D14 for UI) |
| AUTH-009 | Should | Missing | |
| AUTH-010 | Should | Missing | No SSO; OPEN-1 spike not done |
| AUTH-011 | Must | Partial | Login-only, in-memory, hard-coded 20/IP and 5/account (D5, D6) |
| AUTH-012 | Must | Met | One generic message for all failure reasons |

Login screen: email, password, button, forgot-password text present. **Missing:** hosting logo, support contact, optional remember-me. Mode A present; Mode B (panel SSO) missing.

### Module 2: Inbox and mailbox management

| ID | Pri | Status | Evidence / gap |
| --- | --- | --- | --- |
| MAIL-001 | Must | Met | `listMessages`, `Mailbox.tsx` |
| MAIL-002 | Must | Partial | List shows name **or** address, not both (`Mailbox.tsx:77`) |
| MAIL-003 | Must | Met | |
| MAIL-004 | Must | Met | |
| MAIL-005 | Must | Met | from BODYSTRUCTURE `disposition=attachment` only; misses attachments without a disposition |
| MAIL-006 | Must | Met | bold unread |
| MAIL-007 | Must | Partial | API supports it; UI only marks read on open, no "mark unread" control |
| MAIL-008 | Must | Partial | API supports `\Flagged`; no star control, star not shown in list |
| MAIL-009 | Must | Missing | No move endpoint or UI (README claims otherwise, D19) |
| MAIL-010 | Must | Met | Moves to `\Trash`; see D11 |
| MAIL-011 | Should | Missing | No selection checkboxes or bulk endpoints |
| MAIL-012 | Must | Met | Page size 25, "Load more" (see D15) |
| MAIL-013 | Should | Missing | |
| MAIL-014 | Must | Partial | Custom folders are listed and browsable only |
| MAIL-015 | Must | Missing | No create/delete folder |
| MAIL-016 | Should | Met | API returns total and unseen; UI shows unseen badge |
| MAIL-017 | Should | Missing | No IDLE, no WebSocket/SSE |
| MAIL-018 | Must | Partial | Actions write to the server, but the list never refreshes (no polling or IDLE) |

Default folders: role from SPECIAL-USE (`mail.service.ts:64`). **Missing:** admin name-map fallback, standard ordering, icons. Inbox interface **missing:** snippet/preview, star status, compact/comfortable switch.

### Module 3: Email viewing

| ID | Pri | Status | Evidence / gap |
| --- | --- | --- | --- |
| VIEW-001 | Must | Met | `<pre>` text view |
| VIEW-002 | Must | Met | sanitized HTML in sandboxed iframe |
| VIEW-003 | Must | Met | From/To |
| VIEW-004 | Must | Partial | CC shown; BCC not returned (relevant for Sent items) |
| VIEW-005 | Must | Met | |
| VIEW-006 | Must | Met | name and size |
| VIEW-007 | Must | Met | forced download, octet-stream, nosniff (see D1) |
| VIEW-008 | Must | Partial | `data:` images only; `cid:` inline images are not resolved and the frame CSP blocks them |
| VIEW-009 | Must | Partial | Plain-text quoted reply; no `In-Reply-To`/`References` headers |
| VIEW-010 | Must | Missing | No reply-all |
| VIEW-011 | Must | Missing | No forward |
| VIEW-012 | Should | Missing | |
| VIEW-013 | Should | Missing | |
| VIEW-014 | Should | Missing | |

HTML security list: sanitize **Met**; block scripts **Met** (DOMPurify plus iframe without `allow-scripts`); forms **Met** (forbidden tags); dangerous URI schemes **Met**; remote images blocked by default **Met**, but no "load images" opt-in; isolation from app origin **Partial** (opaque origin via sandbox, but not the separate origin that PRD 5.4/17.2 and CLAUDE.md require; release blocker); suspicious-link warning **Missing**; malicious SVG **Met** (svg forbidden).

### Module 4: Composition

| ID | Pri | Status | Evidence / gap |
| --- | --- | --- | --- |
| COMP-001 | Must | Met | plain text |
| COMP-002 | Must | Partial | as VIEW-009 |
| COMP-003 | Must | Missing | |
| COMP-004 | Must | Missing | |
| COMP-005 | Must | Partial | UI has To and Cc; Bcc in API only |
| COMP-006 | Must | Met | comma/space separated |
| COMP-007 | Must | Missing | API accepts `html`, UI has no editor (OPEN-3); see D10 |
| COMP-008 | Must | Met | |
| COMP-009 | Must | Missing | |
| COMP-010 | Must | Missing | |
| COMP-011 | Should | Missing | |
| COMP-012 | Must | Missing | No drafts endpoint |
| COMP-013 | Must | Missing | |
| COMP-014 | Should | Missing | From is always the login address (deliberate) |
| COMP-015 | Should | Missing | |
| COMP-016 | Must | Missing | "Discard" closes without asking; no `beforeunload` |

Editor features (bold, lists, links, alignment, inline images): all missing. Save to Sent: missing (OPEN-4).

### Module 5: Attachments

Met: download, safe disposition headers, `nosniff`, sandbox CSP on the download. Missing: upload, multiple, drag-and-drop, inline, PDF/image preview, size validation, removal before send, configurable max size, server-side MIME/extension validation, random temp names, temp cleanup, path-traversal protection, malware scan hook, archive-bomb protection.

### Module 6: Search

All missing (no `GET /search`, no IMAP SEARCH call, no UI).

### Module 7: Contacts

All missing (needs PostgreSQL).

### Module 8: Preferences

All 11 settings missing. Dark theme follows the OS (`styles.css:5`) with no user toggle.

### Module 9: Hosting administrator configuration

Met: mail-server mappings and allowed domains (via `mail-servers.json`), session timeout (env), "works without a panel". Missing: application name, logo, branding, default language/theme, support email, login page customization, security policies, upload limits, admin UI, separate admin login, cPanel/Plesk/DirectAdmin adapters.

## 4. Non-functional requirements

| ID | Status | Notes |
| --- | --- | --- |
| NFR-001 login < 3 s | Not measured | 2 connections per login, no connect timeout (D9) |
| NFR-002 inbox < 2 s | Not measured | New IMAP connection on every request; STATUS on every folder |
| NFR-003 multi-domain | Partial | Many domains yes; no tenants |
| NFR-004 browsers | Not tested | |
| NFR-005 responsive | Partial | Single column under 800 px; no back button |
| NFR-006 recovers from mail-server failure | Partial | Errors bubble up as 500; no retry |
| NFR-007 modular, documented API | Partial | One Nest module; no OpenAPI |
| NFR-008 Docker | Partial | Dockerfiles and Compose drafted, never built |
| NFR-009 Linux | Met (draft) | |
| NFR-010 WCAG 2.2 AA | Partial | Buttons, focus ring, `role=alert`; not audited |
| NFR-011 i18n/RTL | Missing | Strings hard-coded; CSS uses physical left/right |
| NFR-012 health and logs | Missing | No health endpoint, unstructured console logs (D16) |
| NFR-013 IMAP/SMTP compatibility | Not tested | GreenMail only, not yet run |
| NFR-014 OWASP | Partial | Good intent; no ASVS mapping or tests |

## 5. Security requirements (section 5)

| Section | Status | Detail |
| --- | --- | --- |
| 5.2 Password handling | Mostly met | AES-256-GCM in-memory vault, idle/absolute expiry, wipe on logout, never returned by API. Gaps: in-memory only (no Redis, no key rotation), D13 |
| 5.3 Transport | Mostly met | TLS 1.2 min, cert and hostname verification, no fallback, HSTS in Nginx. Gaps: D8 to verify; no certificate-expiry monitoring |
| 5.4 HTML | Partial | DOMPurify, iframe sandbox, frame CSP. Missing: separate origin, link warning, remote-image opt-in |
| 5.5 SSRF | Mostly met | Items 1-7 present (admin mapping, hostname check, ports, private-range block, DNS validation, IP pinning, validation at each connect). Missing: 9 (outbound firewall, deployment), 10 (D7); D18 |
| 5.6 Sessions | Mostly met | Secure/HttpOnly/SameSite=Strict, custom CSRF header, 256-bit ids, new id at login, expiry, CSP, HSTS. Gaps: rate limit only on login, D5, D6 |
| 5.7 Database | N/A | No database yet |
| 5.8 Attachments | Partial | Download side only |
| 5.9 Tenants | Missing | No tenant model |
| 5.10 Logging | Partial | Login ok/fail logged without secrets. Missing: audit store, session termination events, D4 |
| 5.11 Testing | Missing | No SAST, DAST, dependency or secret scanning, no tests |

## 6. Architecture and API (section 6)

IMAP service interface: connect, authenticate, list folders, fetch, delete, flags **present**; search, move, manage folders, monitor updates **missing**. SMTP: send, HTML + text, syntax-checked recipients **present**; attachments and delivery-error normalization **missing**. UID used correctly; UIDVALIDITY not enforced (D2).

| PRD endpoint | Status |
| --- | --- |
| POST /auth/login | Met |
| POST /auth/logout | Met |
| GET /mailboxes | Met |
| GET /messages | Met |
| GET /messages/:id | Met, but `:uid` + `?folder=` instead of an opaque id |
| POST /messages/send | Met |
| PATCH /messages/:id | Met (seen, flagged) |
| DELETE /messages/:id | Met |
| POST /messages/draft | Missing |
| POST /messages/:id/reply | Missing (client-side only) |
| POST /messages/:id/forward | Missing |
| GET /search | Missing |
| GET, POST /contacts | Missing |
| GET, PUT /preferences | Missing |
| GET /admin/settings | Missing |

Extra endpoints not in PRD: `GET /auth/me`, `GET /messages/:uid/attachments/:index`.
API extras: versioning **Met**, request size limit **Met** (1 MB JSON), auth middleware **Met**; input validation **Partial** (D12); consistent errors **Missing** (D4); authorization/roles **Missing**; OpenAPI **Missing**; rate limiting **Partial**.
Stack: PostgreSQL, Redis, Tailwind, WebSocket/SSE and Prometheus metrics are all absent.

## 7. Deployment (section 7)

Met (draft, unbuilt): Docker images, Compose stack, Nginx with TLS 1.2/1.3 and security headers, `install.sh` generating secrets, read-only API container. Externalized config: mail servers, ports, TLS policy, domain, session duration **Met**; upload limits, branding, logging level **Missing**.
Missing: installation wizard (and its self-lock), admin credentials, update/rollback procedure, release notes. Issues: D3, D16, D17; `install.sh:48` waits for Enter, so it cannot run unattended.

## 8. UI and UX (section 8)

Desktop: left sidebar, list, reading pane **Met**; top search and action toolbar **Missing**. Mobile: full-screen reading **Met**; folder nav is a horizontal strip rather than collapsible; compose button sits in that strip; **no back button**; touch sizing and responsive previews not checked. Design: dark mode via OS only, no theme switch, keyboard shortcuts missing, no i18n or Arabic RTL.

## 9. Testing (section 10) and deliverables (section 13)

No unit, integration, API, UI, security or performance tests exist, and there are no `test` or `lint` scripts in either `package.json`. Only GreenMail is configured; Postfix+Dovecot, Exim, cPanel, Plesk and DirectAdmin environments are not set up.
Of the 20 deliverables, partial versions exist of: source, frontend, backend, IMAP module, SMTP module, Docker config. Missing: DB schema, hosting integration framework, cPanel integration, wizard, API docs, admin and end-user docs, test suite, security and performance reports, deployment guide, upgrade docs, dependency inventory, vulnerability policy.

## 10. Folder-by-folder view

| Folder / file | Verdict |
| --- | --- |
| `backend/src/auth/` | Solid start: vault, guard, CSRF, generic errors. Fix D5, D6, D13. |
| `backend/src/config/` | Admin mapping and startup validation work as designed. Needs DB-backed registry and tenants (Phase 1). |
| `backend/src/mail/` | Core read/send present. Fix D1, D2, D9, D11, D12, D15; add move, folders, search, drafts, attachments, pooling. |
| `backend/src/security/` | SSRF and sanitizer are well thought out. Fix D7, D10, D18; verify D8; add test corpus. |
| `backend/src/main.ts` | Add exception filter with the agreed error shape (D4), `ValidationPipe`, health endpoint, configurable proxy trust. |
| `backend/` config | No lockfile, no lint/test scripts, no `@nestjs/schematics` (only needed for `nest generate`). |
| `frontend/src/components/` | Minimal 3-pane UI. Missing star/unread/move/bulk controls, reply-all, forward, Bcc, editor, attachments, search, settings, back button, delete confirmation. |
| `frontend/src/api.ts` | Fine for the prototype; add 401 handling (D14) and switch to the agreed error shape. |
| `frontend/src/styles.css` | Plain CSS (PRD suggests Tailwind; decision pending). Physical left/right properties will need rework for RTL. |
| `deploy/` | Reasonable draft, never built. D3, D16, D17; render-host service missing. |
| `docker-compose.yml` | GreenMail only. Needs Dovecot and Exim services for Phase 0. |
| `docs/` | PRD, backlog, Jira CSV, launch kit present. **`SAD.md` missing**, `PROTOTYPE_RESULTS.md` not yet written. Backlog not cross-checked here. |
| `README.md` | Overclaims MAIL-009/014 (D19). |
| Project root (`/Desktop/Foxalora`) | Extra copies of `CLAUDE.md` and `LAUNCH_KIT.md` outside `foxalora/`; not a git repository. |

## 11. Document conflicts noticed

- PRD API table uses opaque `/messages/:id` and server-side `/reply`, `/forward`; the prototype uses `uid` + `folder`. CLAUDE.md already flags this for production.
- PRD section 1 lists "shared and multi-server deployments" and objective 8 "suitable for shared hosting", while section 7.1 defers non-Docker shared hosting. CLAUDE.md OPEN-2 assumes Docker-only; consistent with 7.1.
- PRD MVP includes "Sent: Yes", which depends on OPEN-4 (append to Sent or rely on the server).
- PRD section 10 names Courier in compatibility testing; CLAUDE.md Phase 0 names Postfix+Dovecot and Exim only.

## 12. Recommended order

1. Phase 0 as planned in CLAUDE.md: install, compile, run against GreenMail, then Dovecot and Exim. Verify D8 and D16 while doing so.
2. During Phase 0, fix the defects that affect correctness or safety of existing features: D1, D2, D3, D4, D9, D11, D12, D19. These are small and do not add features.
3. Leave D5, D6, D7, D10, D13 to D18 for Phase 1, when Redis rate limits, error normalization and SSRF tests are built.
