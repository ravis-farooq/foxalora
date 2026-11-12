# Phase 0 results: prototype v0.1 made real

Date: 2026-11-12. Stories: FOX-001 (run the prototype against Dovecot and Exim test servers) and part of FOX-004 (dev environment with test mail servers). Everything below was run on the machine described in section 2 unless marked "not tested".

## 1. Exit criteria (CLAUDE.md Phase 0)

| Criterion | Result |
| --- | --- |
| Login, folders, list, read and send work on at least two mail servers | **Met on three:** GreenMail, Postfix + Dovecot, Exim + Dovecot |
| Sanitizer and iframe verified with hostile sample emails | **Met:** three hostile messages, checked through the API and in the browser (section 6) |
| Results file written | This file |

## 2. Environment

macOS (Apple silicon), Node 22.23.3, npm 10.9.9, Docker 29 through Colima (aarch64 VM, started for this work).
- The Docker **Compose plugin is not installed** on this Mac, so `docker compose up` does not work; GreenMail was started with the equivalent `docker run` (section 9). The installer (`deploy/install.sh`) needs Compose v2 and was not run.
- npm 10.9.9 crashes when resolving optional peer packages ("reading 'edgesOut'"). Installs that hit it use `--legacy-peer-deps`; the frontend has an `.npmrc` for this.

## 3. Dependencies: moved to maintained major versions (deviation note)

The prototype's `package.json` asked for majors that no longer receive releases. All runtime and build packages are now pinned to exact versions, each published at least two weeks ago, except `@nestjs/cli` 12.0.12 (six days old), taken because it fixes a moderate advisory in 12.0.11.

| Package | Prototype asked for | Last release of that major | Now |
| --- | --- | --- | --- |
| `@nestjs/common`, `core`, `platform-express` | ^10.4 | January 2026 | 12.3.2 |
| `@nestjs/cli` (build only) | ^10.4 | December 2024 | 12.0.12 |
| `nodemailer` | ^6.9 | April 2025 | 10.2.1 (ships its own types) |
| `imapflow` | ^1.0 | September 2026 | 2.9.1 |
| `isomorphic-dompurify` | ^2.16 | February 2026 | 4.6.0 |
| `mailparser` | ^3.7 | current | 3.12.4 |
| `typescript` (backend) | ^5.6 | — | 6.0.3 (the version Nest CLI 12 requires) |
| `react`, `vite`, `typescript` (frontend) | 18 / 5 / 5 | — | 19.3.1 / 8.3.5 / 7.0.2 |
| `vitest` (backend tests, new) | — | — | 4.1.12 |

- **Justification:** a security product should not start on unmaintained majors.
- **Security impact:** positive; `npm audit` reports 0 vulnerabilities in backend and frontend.
- **Operational impact:** Node 20+ still required (tested on 22). No code changes were needed for the upgrades themselves; the backend type-checked and built on the first try.

## 4. Mail servers tested

| | GreenMail 2.1.2 | Postfix + Dovecot (docker-mailserver 16.0.1) | Exim 4.96 + Dovecot 2.3.19.1 (Debian bookworm, built here) |
| --- | --- | --- | --- |
| Transport | Plaintext, dev only (`none-dev-only`) | TLS 993/465 **and** STARTTLS 143/587, certificate from a private test CA | TLS 993/465; STARTTLS 587 checked with `openssl` only |
| Login / wrong password / unknown user | ✅ / ✅ generic 401 / ✅ generic 401 | ✅ / ✅ / — | ✅ / ✅ / — |
| Folder list and SPECIAL-USE roles | INBOX only, no roles | ✅ Sent, Drafts, Junk, Trash | ✅ Sent, Drafts, Junk, Trash |
| List, read (with HTML and Cc) | ✅ | ✅ | ✅ |
| Send | ✅ | ✅ both TLS modes | ✅ |
| Flags (star, unread) | ✅ | not tested | not tested |
| Delete | ⚠️ **permanent** (no Trash folder, no confirmation: D11) | not tested | ✅ moved to Trash |
| Attachments download | ✅ (section 6) | not tested | not tested |
| Through the web UI | ✅ login, list, compose and send, hostile messages, attachments | API only | API only |

Setup for the two real-TLS servers is in `dev/mailservers/` (scripts, Exim image, private CA). The API trusts the test CA through Node's standard `NODE_EXTRA_CA_CERTS`, so certificate verification stays fully on.

## 5. What broke, and what was fixed

| # | Problem found | Severity | Fix |
| --- | --- | --- | --- |
| 1 | **The SSRF guard blocked every public IPv4 address.** It had a rule for IPv4-mapped IPv6 (`::ffff:0:0/96`), and Node's `BlockList` treats IPv4 and IPv4-mapped addresses as the same, so `8.8.8.8` matched. Hidden because all local test servers use `allowPrivate`. In production every login to an IPv4 mail server would have failed. | Critical | Rule removed (IPv4 rules already cover the mapped form); regression tests for public IPv4/IPv6 and for blocked mapped addresses (`backend/test/security.test.ts`) |
| 2 | **Only the first resolved address was tried.** `localhost` resolved to `::1` first and the connection was refused. Same failure in production for any host whose IPv6 address comes first, since Docker's default network has no IPv6. | High | Guard returns every validated address, IPv4 first; the adapter tries the next one only on connection-level failures (refused, unreachable, connect timeout), never after a password failure, and never for SMTP once a send could have started |
| 3 | **Test server accepted any password.** `-Dgreenmail.auth.disabled=false` in `docker-compose.yml` disables authentication: GreenMail checks only that the flag is present. Login tests against it proved nothing. | High (for testing) | Flag removed, with a warning comment; wrong passwords and unknown users now fail |
| 4 | **D4 confirmed:** NestJS's default handler logged imapflow's error object, including the raw IMAP command sent (`SELECT NoSuchFolder`), against the no-protocol-logging rule; a missing folder returned 500 | High | Global filter: one error shape `{ error: { code, message, requestId } }`, 404 `folder_not_found`, logs only error class, code and request id. Frontend reads the new shape |
| 5 | **D20 confirmed:** `background-image:u\72l(https://tracker…)` passed the server sanitizer (the frame's CSP still blocked the request) | Medium | CSS escapes and comments decoded before checking; `image-set()` also caught; tests |
| 6 | Attachment names kept `../../` in the UTF-8 download name, and a right-to-left override (`invoice‮fdp.exe` shows as "invoiceexe.pdf") in both the download and the UI list | Medium | `safeFilename()` for both; tests |
| 7 | **D12 confirmed:** `to` sent as a string gave 500 | Low | 400 with a clear message |
| 8 | **D9:** no IMAP connect or greeting timeout | Medium | 10 s each (SMTP already had them) |
| 9 | Frontend type check failed: no Vite type declarations | Low | `src/vite-env.d.ts` |
| 10 | **D3:** deploy secrets not git-ignored; **D19:** README overclaimed move and custom folders | Low | `.gitignore` and README corrected |

**D8 (hostname verification) is now verified, not just reasoned about:** imapflow 2.9 passes `servername` to TLS (the top-level option is now set too). Against Dovecot, a certificate for `localhost` reached by its pinned IP passed; the same server reached as `127.0.0.1` was refused with `ERR_TLS_CERT_ALTNAME_INVALID`; an untrusted CA was refused with `SELF_SIGNED_CERT_IN_CHAIN`.

## 6. Hostile email checks

Three messages were injected into Bob's GreenMail mailbox over SMTP, then read through the API and opened in the browser.

| Attack | Server sanitizer | Viewer (browser) |
| --- | --- | --- |
| `<script>`, `onclick`/`onerror`, `<svg onload>` | Removed | No script ran; no console errors |
| `javascript:` (any case, leading spaces) and `data:text/html` links | `href` removed, text kept | — |
| `<iframe>`, `<object>`, `<embed>`, `<form>` with password field | Removed | — |
| MathML/style mutation trick (mXSS) | Removed | — |
| `<meta http-equiv="refresh">`, `<base href>` | Removed | No navigation |
| Remote tracking pixel, `srcset` | Blocked, `[remote image blocked]` placeholder | **No request** to `tracker.example` or `evil.example` |
| `style="background:url(…)"` | Style removed | — |
| CSS-escaped `url()` | Passed before fix 5; removed after | Blocked by frame CSP even before the fix |
| SVG `data:` image | Removed | — |
| Small PNG `data:` image | Kept | Shown |
| HTML attachment `../../evil.html` | — | Download: `application/octet-stream`, `attachment`, `nosniff`, sandbox CSP; name `evil.html` |
| `invoice‮fdp.exe` | — | Shown and downloaded as `invoicefdp.exe` |

Frame in use: `sandbox="allow-popups allow-popups-to-escape-sandbox"`, CSP `default-src 'none'; img-src data:; style-src 'unsafe-inline'`. It is still served from the app's origin (separate origin is FOX-045, a release blocker).

## 7. How the servers differ

- **GreenMail:** no TLS, no SPECIAL-USE, only INBOX, so no Trash and delete is permanent. With the auth flag present it accepts any password and creates unknown users.
- **Dovecot (both setups):** SPECIAL-USE roles for Sent, Drafts, Junk and Trash. A wrong password takes about 2 s to fail (Dovecot's built-in failure delay). The first login after a container starts took about 4 s; warm logins take about 45 ms for IMAP and 65 ms for SMTP over TLS.
- **Exim:** offers AUTH only after TLS (configured that way, as hosting servers usually are); authentication goes through Dovecot's auth socket, as on cPanel.
- **Sent folder (input for OPEN-4):** neither the Postfix nor the Exim setup copied sent mail into Sent. Foxalora will need to append sent messages to Sent itself on these servers.
- **Server registry limit (new, D23):** one TLS setting covers both IMAP and SMTP, so the most common real setup (IMAP 993 implicit TLS with SMTP 587 STARTTLS) cannot be configured. Tested here as two entries (993 + 465, and 143 + 587). Fix in FOX-006: separate IMAP and SMTP TLS settings.

## 8. Not done or not verified

- Still open from the gap analysis: D1 (opening a message downloads the whole raw message), D2 (UIDVALIDITY not checked on actions), D5, D6, D10, D11, D13, D14 (seen: after an API restart the UI shows errors instead of returning to login), D15, D16 (Docker image not built), D17. Separate render origin. D23.
- Flags and attachment download were tested on GreenMail only; delete-to-Trash on Exim + Dovecot only.
- Exim STARTTLS (587) checked with `openssl` only; the API's STARTTLS path was exercised against Postfix + Dovecot.
- No CI, no frontend tests; backend has 11 security unit tests (`npm test`).
- Not tested: Courier, cPanel, Plesk, DirectAdmin; real phones; load.

## 9. How to reproduce

```bash
# GreenMail without the Compose plugin
docker run -d --name foxalora-greenmail -p 3025:3025 -p 3143:3143 \
  -e GREENMAIL_OPTS="-Dgreenmail.setup.test.smtp -Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=alice:alice123@example.com,bob:bob123@example.com -Dgreenmail.users.login=email" \
  greenmail/standalone:2.1.2

# Real-TLS servers (both use ports 143/993/587/465, run one at a time)
dev/mailservers/dovecot-postfix.sh   # carol@dovecot.test / carol-pass-1, dave@dovecot.test / dave-pass-1
dev/mailservers/exim.sh              # erin@exim.test / erin-pass-1, frank@exim.test / frank-pass-1

# API trusting the test CA (verification stays on)
cd backend && SESSION_KEY=$(openssl rand -base64 32) \
  NODE_EXTRA_CA_CERTS=$PWD/../dev/mailservers/certs/ca.pem npm run start:dev
```

Add entries for `dovecot.test` / `exim.test` in `backend/mail-servers.json` with `"imapHost": "localhost"`, ports 993/465 and `"tls": "tls"` (or 143/587 with `"starttls"`), and `"allowPrivate": true`.
