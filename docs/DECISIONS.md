# Decisions

Short records of project decisions, including deviations from the PRD or SAD (CLAUDE.md section 8).

## D-001 Licence: GPL-3.0-or-later with a skins and plugins exception

- **Date:** 2026-11-12
- **Decided by:** product owner
- **PRD reference:** section 15 listed "Apache-2.0 under consideration"; backlog story FOX-002 assumed Apache-2.0.
- **Decision:** Use the same terms as Roundcube Webmail: GNU GPL version 3 or later, plus an exception so that skins and plugins which only call Foxalora's interfaces are not treated as modifications. SPDX id in `package.json`: `GPL-3.0-or-later`. Full text in `LICENSE.md`; the exception wording is in `README.md`.

**Justification**
- Matches the licence of the main product Foxalora replaces, so hosting companies already know these terms.
- Copyleft keeps improvements to the core open when people redistribute it.
- The skins and plugins exception lets hosting companies keep their own branding and panel plugins private, which matters for adoption.
- Roundcube code (GPL-3.0-or-later) can now legally be ported into Foxalora, provided its copyright notices are kept. With Apache-2.0 this was not possible.

**Security impact**
- None directly.

**Operational impact**
- Hosting companies can run and modify Foxalora for their own customers without publishing their changes. Plain GPL-3.0 does not treat network use as distribution; AGPL would, and it was not chosen.
- Anyone who redistributes Foxalora, modified or not, must provide the source under the same licence.
- Dependencies must be GPL-3.0 compatible. The planned stack (NestJS, React, imapflow, nodemailer, mailparser: MIT or MIT-0; DOMPurify: MPL-2.0 or Apache-2.0) is believed compatible. Confirm during the licence inventory (FOX-126) once dependencies are installed.
- Every source file ported from Roundcube must keep the Roundcube copyright notice and say where it came from.
- Contributions need a clear inbound rule (for example DCO sign-off) under FOX-002.

## D-002 Scope additions from the competitive benchmark

- **Date:** 2026-11-12
- **Decided by:** product owner ("add only possible jobs; leave S9 and the separate render domain for now")
- **Source:** `docs/COMPETITIVE_BENCHMARK.md` sections 6 and 7
- **Decision:** Add proposals S1 to S8 and the low-risk security hardening items to the backlog as FOX-134 to FOX-147. Extend FOX-014 with a growing login delay instead of long account lockouts.

| Story | Item | Release |
| --- | --- | --- |
| FOX-134 | S1 Admin TOTP two-step | MVP |
| FOX-135 | S2 Mailbox-user TOTP two-step, opt-in | V1.1 |
| FOX-136 | S3 Sender trust indicator | MVP |
| FOX-137 | S4 Quota display | MVP |
| FOX-138 | S5 Out-of-office auto-reply | V1.1 |
| FOX-139 | S6 Signed images, SBOM, provenance | MVP |
| FOX-140 | S7 Tamper-evident audit log | MVP |
| FOX-141 | S8 Breached-password check, off by default | V1.1 |
| FOX-142 | Fetch Metadata request filtering | MVP |
| FOX-143 | Trusted proxy and host lists | MVP |
| FOX-144 | Secret type that cannot be logged | MVP |
| FOX-145 | fail2ban-compatible auth log | MVP |
| FOX-146 | Load shedding and connection caps | MVP |
| FOX-147 | Extra security policies (IP-bound sessions, no permanent delete) | MVP |

**Not changed**
- S9 real-time inbox stays as it was: FOX-030, Should, MVP. Not started now.
- Separate render domain stays as it was: FOX-045, Must, MVP. Not started now. PRD 5.4 and 17.2 and CLAUDE.md rule 5 still make it a **release blocker**; deferring the work does not remove that.
- cPanel SSO stays behind the OPEN-1 spike (FOX-110).

**Justification**
- Every added item was rated possible with the current stack (benchmark section 6). The MVP items are small (45 points across all 14 stories).
- S1, S6, S7 and the hardening items strengthen security and integrity; S3 helps against phishing; S4 and S5 target common hosting support tickets.

**Security impact**
- Positive overall. S8 sends a 5-character hash prefix to a third-party service, so it is off by default and an admin opt-in. S2 protects only webmail, which the docs must state.

**Operational impact**
- MVP grows by 11 stories (30 points); V1.1 by 3 stories (15 points).
- S6 needs a git repository, CI and a container registry before it can start.
- S5 on cPanel needs a check on a real cPanel host.

## D-004 Data layer choices (Phase 1)

- **Date:** 2026-11-12
- **Decided by:** development (no SAD available to check against; see note below)
- **Decision:**
  - **PostgreSQL 18** with **Kysely** (typed SQL query builder and migrations) and **pg**. Both MIT, actively maintained. Chosen over ORMs because row-level security needs explicit control of each transaction (`set_config('app.tenant_id', …, true)`).
  - **Valkey 9** (BSD-3, Linux Foundation fork of Redis) instead of Redis 7.4+ (no longer under an OSI licence), with the **ioredis** client (MIT). Any Redis-protocol server works.
  - **Mail server registry moved from `mail-servers.json` to the database**, with separate IMAP and SMTP TLS settings (fixes D23). Managed with the operator CLI (`node dist/cli.js …`) until the admin console exists (Phase 3).
  - Dev database on port **55432** (5432 is often taken by a local PostgreSQL).

**Security impact**
- Positive. Runtime role `foxalora_app` does not own tables and cannot bypass RLS; the only cross-tenant path is the `resolve_mail_domain()` function used by login.
- Session ids are hashed before use as Valkey keys.

**Operational impact**
- The installer must create two database roles (owner for migrations, runtime role for the API) and run `node dist/cli.js migrate`. In production the owner role must not be a superuser.
- FOX-017 asks for "tenant-prefixed keys". Session keys are `fx:s:<sha256(session id)>` with a per-tenant index set `fx:t:<tenant>:sessions`, because the cookie carries only the random id (no tenant id in the cookie). Ending all sessions of a tenant works through the index.
- **SAD missing:** `docs/SAD.md` still does not exist, so these choices could not be checked against the architecture document. If the SAD specifies different libraries, report the conflict and decide.

## D-003 Rich-text editor: Tiptap, made email-specific (OPEN-3)

- **Date:** 2026-11-12
- **Decided by:** product owner
- **Deviation:** CLAUDE.md OPEN-3 asked for at least three editors to be tested before choosing. The product owner chose Tiptap directly. Spike FOX-051 now proves Tiptap's risky parts instead of comparing three editors.
- **Decision:** Use Tiptap (ProseMirror-based, MIT). Only its free MIT packages are used, no paid "Pro" extensions. **Squire** (MIT, built for email by Fastmail) is the fallback if the spike fails. TinyMCE 7 (GPL-2.0-or-later) stays the reference for paste quality.

**Justification**
- Built for React and TypeScript, which matches the frontend.
- The document schema can be limited to content email apps display, and the output step is ours to write, so the HTML can be tuned for Outlook and Gmail.
- Actively maintained, with good right-to-left support.

**Security impact**
- Editor output is still untrusted. The server cleans outgoing HTML with rules made for sending (fixes D10) before SMTP.
- The editor must not load remote content: inline images are local previews that become `cid:` attachments.

**Operational impact**
- Paste cleanup for Word and Google Docs is our own code, and weaker out of the box than TinyMCE's paid PowerPaste. Test it with real clipboard samples.
- Open risks the spike cannot fully settle on a Mac without those apps: Outlook desktop rendering, Android keyboards, iOS Safari. They need real-device and real-client checks before the composer ships.
