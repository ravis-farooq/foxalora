# Competitive benchmark: Roundcube and SnappyMail vs Foxalora

Date: 2026-11-12. Sources read: Roundcube master (1.7.x, `roundcubemail-master.zip`) and SnappyMail master (3.x, `snappymail-master.zip`), both supplied by the product owner. This comes from reading their code, config defaults and changelogs. Nothing was run.

Goal set by the product owner: Foxalora should have the most advanced features, security and integrity of the three. This document lists what the other two do, where Foxalora stands, and what to add. Items marked **[scope]** go beyond PRD v1.0 and need product-owner approval before they enter the backlog (CLAUDE.md section 8: no silent scope changes).

## 1. Licences: what we may reuse

| Project | Licence | Reuse in Foxalora (GPL-3.0-or-later) |
| --- | --- | --- |
| Roundcube | GPL-3.0-or-later + skins/plugins exception | Code may be ported. Keep Roundcube copyright notices and say where the code came from. |
| SnappyMail core | **AGPL-3.0** | **Ideas only.** Porting AGPL code would bring AGPL's network clause into Foxalora: every hosting company would have to offer source, including their private changes, to all webmail users. That cancels the reason we chose GPL. |
| SnappyMail plugins | Several are **MIT** (e.g. `login-cpanel`, `two-factor-auth`, `haveibeenpwned`) | MIT code may be reused with its copyright notice. Check each plugin's own `LICENSE`/header before reusing. |

## 2. Finding for OPEN-1 (how SSO gets mailbox access)

SnappyMail's cPanel integration shows how cPanel itself does webmail SSO:
- A webmail app is registered with a YAML file in `/var/cpanel/webmail/` and runs **inside** cPanel's web server.
- cPanel gives it `REMOTE_USER` and `REMOTE_PASSWORD`. The password is a **temporary cPanel session credential** (contains `[::cpses::]`), not the user's real password. The app logs into IMAP/SMTP as `user/REMOTE_TEMP_USER` with it, and cPanel's Dovecot accepts it.

What this means for Foxalora, which runs outside cPanel in Docker:
- The best path avoids the real password entirely: a small cPanel-side launcher gets the temporary session credential and passes it to Foxalora in a signed, encrypted, short-lived assertion sent by POST, never in the URL (PRD Module 1 Mode B).
- **Unknowns for the spike:** how long the temporary credential lives; whether Dovecot accepts it from a remote host or only locally; whether it can be renewed; what happens on cPanel logout. Test these on a real cPanel server before asking for approval, as CLAUDE.md OPEN-1 requires.

## 3. Security controls

Status key for Foxalora: ✅ in prototype, ◐ partial, ✗ missing. Target phase follows CLAUDE.md section 7.

| Control | Roundcube | SnappyMail | Foxalora now | Foxalora target |
| --- | --- | --- | --- | --- |
| Email HTML shown on a **separate origin** | ✗ same-origin iframe `messagecontframe` (53 changelog lines mention XSS) | ✗ cleaned in the browser, then inserted into the app page with `innerHTML` (`dev/Model/Message.js:441`) | ✗ planned | **Phase 2, release blocker.** Our main security advantage |
| Server-side sanitizer + sandboxed frame + no-network CSP | washtml, frame | own cleaner, CSP | ✅ | Keep; add test corpus built from both projects' CVE classes (SVG SMIL, CSS escapes, at-rules, TNEF, data-URI header injection) |
| Remote images: ask / from contacts / trusted senders | ✅ 4 levels | ✅ ask / allow-list / always | ◐ blocked, no opt-in | Phase 2 |
| Image/CSS proxy | ✅ (repeated SSRF bypass CVEs) | — | none | **Do not build one.** If ever needed, route it through the same pinned SSRF guard |
| SSRF guard on mail connections with IP pinning | host typed by admin only (newly enforced) | admin domains | ✅ | Add NAT64/6to4/Teredo ranges (D18) and SSRF test suite (Phase 1) |
| Login throttling | 3 failures/min per user, 60 s lock | fixed 5 s delay on failure + syslog | ◐ 15 min lock (lockout DoS, D5) | Phase 1: progressive delay per (account, IP) in Redis; short lock only per IP |
| fail2ban-ready auth-failure log line | — | ✅ ships filter + jail | ✗ | Phase 5: structured `auth_failed ip=… user_hash=…` line + sample filter |
| **TOTP 2-step for the admin console** | ✗ | ✅ admin TOTP | ✗ | **[scope] Phase 3, recommend MVP** |
| TOTP 2-step for mailbox users, backup codes, current code needed to turn it off | 3rd-party plugin | ✅ plugin | ✗ | **[scope] v1.1, opt-in per tenant** |
| Admin console separate from webmail | separate config | separate host/key option | ✗ | Phase 3 (PRD requires): own session, own path or port, not public by default |
| Fetch Metadata (`Sec-Fetch-*`) request filtering | ✗ | ✅ | ✗ | Phase 1: reject cross-site requests to the API; cheap extra layer on top of SameSite + CSRF header |
| Trusted-proxy list for client IP | ✅ `proxy_whitelist` | ✅ plugin | ✗ (D6) | Phase 1 |
| Trusted Host header list | ✅ `trusted_host_patterns` | — | ✗ | Phase 1 (stops Host-header poisoning in links and redirects) |
| Secret wrapper type that never prints | — | ✅ `SensitiveString` | ✗ | **Phase 0/1:** `Secret` class whose `toString`, `toJSON` and `util.inspect` return `[redacted]`; vault returns only this type. Backs rule 1 and D4 |
| Vault encryption | 3DES with default key (configurable) | random cipher per install | ✅ AES-256-GCM, required key | Phase 1: Redis + key rotation + canary test |
| Session bound to client IP (option) | ✅ `ip_check` | — | ✗ | Phase 3 admin policy, off by default (mobile networks change IP) |
| Installer that locks itself | ✅ `enable_installer` | ✅ | ✗ | Phase 5 (PRD 7.2) |
| Admin switch to disallow permanent delete | — | ✅ `dangerous_actions` | ✗ | Phase 3 policy |
| Load shedding when overloaded (503 + Retry-After) | — | ✅ load-average check | ✗ | Phase 5: cap concurrent IMAP connections per user and per node |
| Password breach check (HIBP k-anonymity) | ✅ password plugin | ✅ plugin | ✗ | **[scope] v1.1, opt-in.** Sends a hash prefix to a third party, so off by default |
| Look-alike domain (IDN homograph) warning | ✅ `rcube_spoofchecker` | — | ✗ | Phase 2 with the suspicious-link warning (PRD Module 3) |
| SPF/DKIM/DMARC result shown to user | — | ✅ parses `Authentication-Results` | ✗ | **[scope] Phase 2, recommend MVP.** Strong phishing signal, cheap to build |
| Display-name spoof warning ("PayPal <x@evil.tld>") | — | — | ✗ | **[scope] Phase 2.** Neither competitor does this well |
| OpenPGP / S/MIME | ✅ Enigma (GnuPG) | ✅ OpenPGP.js + GnuPG + S/MIME | ✗ | Roadmap E22 (PRD V2.1). Keep out of MVP |
| Vulnerability policy with encrypted reporting | ✅ | ✅ SECURITY.md + PGP key | ✗ | Phase 6 (PRD) |

### Integrity (beyond the PRD)

Neither competitor covers these well; they are where Foxalora can lead on "integrity".

| Area | What to build | Phase |
| --- | --- | --- |
| Supply chain | Committed lockfiles and `npm ci`; dependency and secret scanning in CI; **SBOM (CycloneDX) per release; signed container images (cosign) with build provenance**; signed release tags | **[scope]** Phase 1 (CI) and Phase 5 (images) |
| Update integrity | Updater checks image signatures before applying; documented rollback | Phase 5 |
| Audit log integrity | Hash-chained audit entries so deletions or edits are detectable; admin can export | **[scope]** Phase 3 |
| Mailbox data integrity | UIDVALIDITY enforced on every action (D2); CONDSTORE/QRESYNC to detect concurrent changes; flag updates use `UNCHANGEDSINCE` where supported | Phase 1-2 |
| Send integrity | Idempotency key on send so a network retry never sends twice; append to Sent with the same Message-ID (OPEN-4) | Phase 2 |
| Draft integrity | Autosave with version check so two tabs cannot overwrite each other silently | Phase 2 |
| Message integrity for users | SPF/DKIM/DMARC indicator (above); PGP/S/MIME signature check later | Phase 2 / roadmap |

## 4. Features

| Feature | Roundcube | SnappyMail | PRD | Foxalora now | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Threading (THREAD=REFERENCES) | ✅ | ✅ | MAIL-013 Should | ✗ | Phase 2, server-side when supported, client fallback |
| Server-side SORT, ESEARCH, fuzzy search | ✅ | ✅ | Module 6 | ✗ | Phase 2 |
| Fast resync (CONDSTORE/QRESYNC) | partial | ✅ | MAIL-018 | ✗ | Phase 2, large performance win on 100k mailboxes |
| Push updates (IDLE/NOTIFY → SSE) | ✗ (polling) | ✗ (polling) | MAIL-017 Should | ✗ | Phase 2. **Lead feature:** real-time inbox, neither competitor has it |
| Snippets via IMAP PREVIEW (RFC 8970), fallback to first text bytes | ✗ | ✅ | Inbox snippet | ✗ | Phase 2 |
| Quota display | ✅ | ✅ | not listed | ✗ | **[scope] MVP.** "Mailbox full" is a top hosting support ticket (adoption target 2) |
| Vacation / out-of-office (ManageSieve) | ✅ | ✅ | V1.2 "rules" | ✗ | **[scope] pull vacation into v1.1.** Another top ticket; full filters stay in V1.2 |
| Change password through the panel | ✅ 30+ drivers incl. cPanel, Plesk, DirectAdmin | ✅ cPanel, Hestia, ISPConfig, mailcow… | AUTH-009 Should | ✗ | v1.0 for cPanel together with SSO |
| Sender identities / aliases | ✅ | ✅ | COMP-014 Should | ✗ | V1.2 as planned |
| Download all attachments as zip | ✅ | ✅ | — | ✗ | Phase 2 (small) with archive-bomb limits |
| Attachment reminder ("you said attached") | ✅ | — | — | ✗ | v1.1 (small) |
| Mark as junk / not junk | ✅ | ✅ | Spam folder | ✗ | Phase 2 (uses move) |
| Archive button | ✅ | ✅ | Archive folder | ✗ | Phase 2 (uses move) |
| Calendar invite (.ics) viewer | ✗ | ✅ | — | ✗ | v1.1 |
| Read-receipt (MDN) handling, ask before sending | ✅ | ✅ | — | ✗ | Phase 2, default "ask" |
| Keyboard shortcuts | ✅ | ✅ | keyboard accessibility | ✗ | Phase 4 |
| Dark mode that also neutralises message colours | ◐ | ✅ | themes | ◐ OS only | Phase 3 |
| Contact sync (CardDAV) | plugin | ✅ | later | ✗ | v1.2 |
| Shared folders (ACL) | ✅ | ✅ | — | ✗ | Out of scope for MVP |
| PWA / installable, offline read | ✗ | ✗ | V2.0 | ✗ | Roadmap. Would be a lead feature later |
| Panel integrations | built into cPanel, Plesk, DirectAdmin | cPanel, CyberPanel, HestiaCP, Virtualmin, Nextcloud, Cloudron | cPanel, then Plesk, DirectAdmin | ✗ | Keep PRD order; list HestiaCP, CyberPanel, Virtualmin as v1.x candidates |
| Runs without a database | ✗ | ✅ | — | ✗ | Keep PostgreSQL (tenants, audit); hide it inside Compose so the 15-minute install still holds |
| Multi-tenant with database-enforced isolation | ✗ | ✗ | 5.9 | ✗ | Phase 1. **Lead feature** for hosting companies |
| Typed REST API with OpenAPI | ✗ | ✗ | 6.5 | ✗ | Phase 1. **Lead feature** (integrations, mobile apps later) |

## 5. Where Foxalora can be clearly ahead

1. **Separate render origin** for email HTML. Roundcube renders in a same-origin frame and SnappyMail inserts the cleaned HTML straight into its own page. Roundcube's changelog alone has 111 security entries, many of them about HTML and CSS handling.
2. **No proxy attack surface.** No image or CSS proxy, and admin-only mail hosts with IP pinning.
3. **Real-time inbox** through IMAP IDLE/NOTIFY and server-sent events.
4. **Multi-tenant isolation** enforced by PostgreSQL row-level security, with cross-tenant tests in CI.
5. **Supply-chain integrity:** signed images, SBOM, provenance and verified updates.
6. **Phishing signals:** SPF/DKIM/DMARC, look-alike domains and display-name spoofing in one sender-trust indicator.
7. **Support-ticket reducers:** quota, vacation responder and password change.

## 6. Feasibility

None of this has been built or tested yet. These ratings come from how the protocols and libraries work. "Depends on server" means it works only where the hosting company's mail server supports it; Foxalora must detect support and hide the feature otherwise.

| Item | Possible? | Effort | Condition or caveat |
| --- | --- | --- | --- |
| S1 Admin TOTP | Yes | Small | Standard RFC 6238; small MIT libraries exist |
| S2 User TOTP | Yes | Medium | Protects webmail only. The same password still works in Outlook or on a phone over IMAP, so say this plainly in docs. Skipped for SSO logins |
| S3 Sender trust | Partly | Medium | Display-name and look-alike warnings: fully possible, done locally. SPF/DKIM/DMARC: only where the receiving server adds an `Authentication-Results` header, and only trusted when it carries the hosting company's own server id (admin setting), otherwise an attacker can forge it. Re-checking DKIM ourselves is possible; SPF is not reliable after delivery |
| S4 Quota | Yes, depends on server | Small | IMAP QUOTA extension. Dovecot with quota (cPanel uses this) supports it; hide when absent |
| S5 Out-of-office | Yes, depends on server | Medium | ManageSieve works on Dovecot with Pigeonhole. cPanel autoresponders are managed through cPanel's own API instead, so cPanel needs its own adapter. Needs a check on a real cPanel server |
| S6 SBOM and signed images | Yes | Small to medium | Free tools (CycloneDX, cosign with keyless signing). Needs a git repository, CI and a container registry first |
| S7 Hash-chained audit log | Yes | Small | Shows edits or deletions in the middle of the log. Someone with full database access could rebuild the whole chain, unless the latest hash is also copied outside the database regularly |
| S8 Breach check | Yes | Small | Pwned Passwords range API needs no key and only receives the first 5 characters of a SHA-1 hash. The app sees the password only at login or password change, so it checks then. Off by default |
| S9 Real-time inbox | Yes | Large | Needs a persistent IMAP connection per active user (IDLE), or one per user for all folders where NOTIFY is supported (Dovecot). Makes the backend stateful: needs the Phase 1 connection pool, connection caps, and sticky sessions when running more than one instance. Every connection comes from Foxalora's single IP, so the mail server's per-IP limits and brute-force blockers (for example cPHulk) need allow-listing; installer docs must cover this |
| Separate render origin | Yes | Medium | Needs a second hostname and certificate (for example `render.mail.example.com`). The installer must handle that, or it threatens the 15-minute install target |
| cPanel SSO via temporary session credential | **Unknown** | Medium | Works for apps running inside cPanel. Not yet known whether a credential obtained by a small cPanel-side launcher can be handed to Foxalora on another server, or how long it lasts. This is the OPEN-1 spike |
| Fetch Metadata, trusted proxies and hosts, secret type, progressive login delay | Yes | Small each | Plain application code |
| Installer lock, fail2ban line, load shedding | Yes | Small each | |
| Fast resync (CONDSTORE/QRESYNC), PREVIEW snippets, server threading and sort | Yes, depends on server | Medium | `imapflow` supports CONDSTORE/QRESYNC; others need fallbacks when the server lacks them |

## 7. Decisions (product owner, 2026-11-12)

Recorded in `docs/DECISIONS.md` D-002.

| # | Proposal | Release | Status |
| --- | --- | --- | --- |
| S1 | TOTP 2-step verification for the admin console | MVP | Approved: FOX-134 |
| S2 | TOTP 2-step for mailbox users (opt-in per tenant) | V1.1 | Approved: FOX-135 |
| S3 | SPF/DKIM/DMARC and display-name spoof indicator | MVP | Approved: FOX-136 |
| S4 | Quota display | MVP | Approved: FOX-137 |
| S5 | Out-of-office auto-reply | V1.1 | Approved: FOX-138 |
| S6 | Supply-chain integrity: SBOM, signed images, provenance | MVP | Approved: FOX-139 |
| S7 | Hash-chained audit log | MVP | Approved: FOX-140 |
| S8 | Password breach check, off by default | V1.1 | Approved: FOX-141 |
| S9 | Real-time inbox (IDLE → SSE) | — | Deferred for now; existing FOX-030 unchanged |
| — | Separate render domain | — | Deferred for now; existing FOX-045 unchanged and still a release blocker |
| — | Hardening: Fetch Metadata, trusted proxy/host, secret type, fail2ban log, load shedding, extra policies | MVP | Approved: FOX-142 to FOX-147; growing login delay added to FOX-014 |
