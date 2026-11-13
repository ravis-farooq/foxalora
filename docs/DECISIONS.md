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

## D-005 Interface styling: plain CSS with design tokens, own icons

- **Date:** 2026-11-12
- **Decided by:** development, when the interface work started (CLAUDE.md section 5 asked for this decision then)
- **Deviation:** the PRD suggests Tailwind CSS. The app keeps plain CSS.
- **Decision:** One stylesheet (`frontend/src/styles.css`) with colour tokens on `:root`, a dark set under `prefers-color-scheme` and `[data-theme="dark"]`, and component classes. Icons are inline SVGs drawn for Foxalora (`frontend/src/ui/icons.tsx`), in the same style as the editor icons. No CSS framework or icon library is added.

**Justification**
- The composer (D-003) already uses plain CSS with its own tokens; one approach is simpler to maintain.
- Hosting companies will brand the app (E12). Tokens are a small, documented surface for that, without a build step on their side.
- No new dependencies (CLAUDE.md section 9), and the stylesheet stays small (5.6 KB gzipped for all of the app's CSS, editor included).

**Security impact**
- None for mail content. The light/dark choice is the only value kept in browser storage (`localStorage`, key `fx-theme`); the lint rule that bans browser storage is relaxed for those two lines only, with a comment. It moves to account preferences with FOX-077.

**Operational impact**
- Contributors write CSS rather than utility classes. Colours must come from tokens so both themes and later branding keep working.
- The compose window stays light in dark mode, like the editor it contains, until the editor gets dark tokens.

## D-006 Contacts, preferences and signatures ahead of Phase 2

- **Date:** 2026-11-12
- **Decided by:** product owner ("Yes, build them"), after the interface redesign
- **Deviation:** CLAUDE.md section 7 puts contacts and settings in Phase 3, after the Phase 2 exit criteria. The product owner asked for them now. Phase 2 stories stay open (move, bulk actions, drafts, attachments upload, render origin).
- **Decision:**
  - Contacts (FOX-072), recipient suggestions from contacts (FOX-073, without frequently used addresses yet), vCard 2.1/3.0/4.0 import and 3.0 export (FOX-075). CSV import (FOX-074) is not built.
  - Preferences hold only settings the app applies today: display name, theme (system, light, dark), list density and time zone. Language, date format, reply format, remote images and notifications are added with the features that use them.
  - Signatures are stored as editor documents and cleaned on the server against an allowlist (nodes, marks, attribute values, link schemes http/https/mailto/tel). Images are not allowed in signatures until they can be stored safely.
  - The display name is used in the From header; the address is always the session's. Names with `<`, `>` or `"` are refused so a name cannot pose as another address.
  - Migration `0002`: address order for contacts, and at most one default signature per mailbox (unique partial index).

**Security impact**
- All three use the existing row-level-security path (`TenantDb`); tenant and mailbox come from the session only. An end-to-end test (`backend/test/contacts.e2e.test.ts`) checks that another mailbox or tenant cannot list, read, change, delete, suggest or export them, and that body fields such as `tenantId` are ignored.
- Search text in contacts is matched literally (LIKE wildcards escaped). vCard imports are limited to 2 MB and 5,000 cards; an address book holds at most 10,000 contacts.

**Operational impact**
- Run `node dist/cli.js migrate` when updating (adds migration 0002).
- The vCard import route accepts request bodies up to 3 MB; all other routes keep the 1 MB limit (sending keeps 15 MB).

## D-007 Never lose work, never surprise: drafts, confirmations, undo, guide, address history

- **Date:** 2026-11-12
- **Decided by:** product owner (request for history suggestions, confirmation dialogs, save-on-close, guides, tooltips and accessibility); details by development
- **Decision:**
  - **Closing the composer saves a draft** to the server's Drafts folder (IMAP APPEND), also every 30 seconds while writing (FOX-055). A saved draft replaces the previous version: the new one is stored first, then the old one removed. Opening a draft offers "Continue writing"; sending removes it. Only **Discard** throws a message away, after a confirmation.
  - **Confirmation dialogs** (one accessible `alertdialog`, focus starts on the safe button) for actions that cannot be undone: delete for good from Trash, discard a message, delete a contact or signature, reset settings, clear address history.
  - **Moving a message to Trash** asks first ("Move this message to Trash? You can restore it from Trash later.") and the toast still offers Undo. *Changed the same day at the product owner's request; the first version had Undo only.*
  - **Restore in Trash:** opening a message in Trash shows Restore, which moves it back to the folder it was deleted from when that is known (messages deleted in the current session), otherwise to the Inbox, because IMAP does not record where a message came from. Delete in Trash reads "Delete for good" and asks first.
  - **Address history** (`recent_recipients`, migration 0003): after a successful send, the recipient addresses (address only, use count, last use) are kept for suggestions, at most 500 per mailbox. On by default; Settings can turn it off and clear it.
  - **First-run guide** (7 short steps with a highlight), shown once (`onboarded` preference) and available from Help and Settings. **Tooltips** on hover and keyboard focus for every button, in plain words.
  - **Accessibility:** no sound is used anywhere, so nothing depends on hearing; every status is on-screen text and announced to screen readers; error messages stay until dismissed and other messages pause while pointed at; skip link and `main` landmarks.

**Security impact**
- Drafts go through the same validation as sending (header-injection guard, HTML sanitizer, inline-image checks) and are built with file and URL access turned off. Only messages in the Drafts folder can be replaced or deleted through the draft routes.
- **Conflict to note:** CLAUDE.md rule 10 says no local copy of mail in the database. Address history stores recipient addresses only, never content, under row-level security, with opt-out and clearing. If the product owner reads rule 10 as covering addresses too, turn the default off (one line in `preferences.ts`).

**Operational impact**
- Run migrations (0003). The Drafts folder must exist with the SPECIAL-USE \Drafts flag (Dovecot and Exim test servers have it); without it, saving a draft reports that there is no Drafts folder.
- Drafts lose inline images when reopened (the viewer cannot show cid: images yet) and do not keep original attachments.

## D-008 Images in signatures

- **Date:** 2026-11-12
- **Decided by:** product owner (asked for images in signatures, as in Roundcube); details by development
- **Decision:** Signatures may contain up to 3 images (a logo or photo), PNG, JPEG or GIF, at most 64 KB each. As in Roundcube (`identity_image_size`, default 64 KB, images stored as data URIs and turned into inline attachments on send by `extract_inline_images`), the image is kept inside the signature document. When a message is written, each signature image goes into the composer's image store and is sent as an inline `cid:` attachment through the same validated path as other inline images. Our own implementation, no Roundcube code copied.
- **Deviation from D-003/D-006:** signatures were text, formatting and links only.

**Security impact**
- The server accepts only `data:` URIs whose bytes really are PNG, JPEG or GIF (magic-byte check, declared type must match); remote images, SVG (can carry scripts) and WebP (missing in Outlook) are dropped. Images over 64 KB or more than 3 are refused with a clear message. Editor-only attributes are removed; alt text, width and height are kept within limits.
- Recipients never load anything remote: the image travels with each message.
- The draft production Content-Security-Policy (`deploy/nginx.conf.template`) now allows `blob:` images. The composer shows inline-image previews as `blob:` URLs, which only point at data the page itself created; without this, inline and signature images would not show in production. The message frame keeps its own stricter policy (images from `data:` only).

**Operational impact**
- Signatures with images are larger (up to about 270 KB of JSON); request bodies stay within the 1 MB limit.
- Pasting an image into the signature editor does not add it; the image button checks type and size first.

## D-009 Development mail servers never deliver to the internet

- **Date:** 2026-11-12
- **Decided by:** development, after a test message from `carol@dovecot.test` reached Gmail and bounced
- **Decision:** The local Postfix + Dovecot server delivers only to its own test domain. Mail to any other address is returned at once with "Foxalora development server - mail to outside addresses is not delivered" (`dev/mailservers/postfix-main.cf`, mounted by `docker-compose.yml` and `dev/up.sh`; `dev/up.sh` recreates an older container automatically, keeping its mail). The Exim test server already routes its own domain only. Unnamed message parts get names by type (`delivery-report.txt`, `attached-message.eml`), so bounces read clearly.

**Security impact**
- Test mail cannot reach real people, and a developer's machine cannot be used to send mail from fake domains to the internet.

**Operational impact**
- To test delivery to real mailboxes, map a real domain to a real mail server with the operator CLI (`server:add`, `domain:map`) on your own machine. Never commit those settings or credentials.

## D-010 Folders, archive, junk, bulk actions and storage, simpler than Roundcube

- **Date:** 2026-11-13
- **Decided by:** product owner (Roundcube comparison: nested folders, Archive, Junk, Select, quota); details by development
- **Decision:**
  - **Folder tree** with subfolders (for example Inbox > Work), collapsible; New folder, New folder inside, Rename and Delete from a folder's ⋮ menu. The server's own hierarchy delimiter is used (Dovecot here uses "."). Folders with a role and the Inbox cannot be renamed or deleted; deleting a folder with subfolders is refused; deleting asks first and says how many messages go with it.
  - **Archive** and **Junk / Not junk** buttons. If there is no Archive folder, the first Archive creates one and says so.
  - **Move** menu (every other folder, indented like the sidebar) and **drag and drop** of one or several messages onto a folder; dropping on Trash counts as Delete (with its confirmation).
  - **Selection:** the sender picture turns into a tick box on hover, keyboard focus or while selecting (tap it on phones); Select all on the page; Shift-click selects a range. A bulk bar offers read/unread, star, archive, junk, move, delete and restore (in Trash). One request handles up to 500 messages of one folder in a single IMAP connection (`POST /messages/bulk`), and moves return new ids so every move offers Undo.
  - **Hover actions** on each row: archive, delete, read/unread (hidden on touch screens, where the bulk bar and toolbar do the same).
  - **Storage** at the bottom of the folder list from IMAP QUOTA (FOX-137): "26 KB of 1 GB used", red above 90%; usage only when the server has no limit; hidden when the server does not report quota. Test accounts get a 1 GB quota (`dev/mailservers/dovecot-quotas.cf`).
- **Not built: conversation threads (FOX-041, a Should).** The IMAP library has no THREAD command and threads across pages need their own design (server THREAD=REFERENCES where available, our own grouping by References/In-Reply-To otherwise). Planned as a separate story.

**Security impact**
- Folder names are validated on the server: no control characters, IMAP wildcards, "/" or the server delimiter, at most 100 characters, "INBOX" reserved, so a name cannot reach another part of the tree. Bulk ids must all decode to one folder and UIDVALIDITY; mixed or forged ids are refused.

**Operational impact**
- `dev/up.sh` recreates an older mail-server container to pick up the quota file (mail is kept).

## D-011 Sent mail is saved by Foxalora through IMAP (OPEN-4 decided)

- **Date:** 2026-11-13
- **Decided by:** product owner ("Yes, build it"), after tests on the target servers
- **Test results (2026-11-12):** after sending, the Sent folder stayed empty on Postfix + Dovecot and on Exim + Dovecot; GreenMail has no Sent folder. Ordinary mail servers only deliver; keeping a copy is the client's job (Roundcube, Thunderbird and Outlook do the same). Gmail and Microsoft 365 save sent mail themselves.
- **Decision:**
  - The message is built once (`buildSendMime`): sent over SMTP without the Bcc header, and the identical message (same Message-ID and Date) with Bcc kept is appended to the folder marked \Sent, flagged as read.
  - Per mail server, the administrator can mark "the server saves sent mail itself" (`mail_servers.saves_sent`, migration 0004; CLI `server:add --saves-sent` or `server:saves-sent <tenant> <server> on|off`, audited). Then Foxalora adds no copy, so there are no duplicates (use it for Gmail).
  - A failed copy never fails or repeats the send. The response says what happened (`sentCopy`: saved, server, no_folder, failed) and the user sees "Message sent, but a copy could not be saved in Sent" when the copy failed. A missing Sent folder is reported, not created.
  - Sent and Drafts lists show the recipient ("To: dave@... +1") instead of the user's own name.

**Security impact**
- The copy is the message that was validated and sent; no new input is accepted. The Bcc list is only in the sender's own copy, never in what recipients receive (covered by a test).

**Operational impact**
- Run migrations (0004). When mapping Gmail or Microsoft 365, add `--saves-sent`.
