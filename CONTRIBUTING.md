# Contributing to Foxalora Mail

Thank you for helping. Foxalora handles people's email, so security rules come before features.

## Licence and sign-off

Foxalora Mail is GPL-3.0-or-later with an exception for skins and plugins (see `README.md` and `LICENSE.md`). By contributing you agree your work is released under the same terms.

Every commit must carry a Developer Certificate of Origin sign-off (`git commit -s`), stating that you wrote the change or have the right to submit it under this licence:

```
Signed-off-by: Your Name <you@example.com>
```

Code ported from other projects must keep its original copyright notice and say where it came from. Roundcube (GPL-3.0-or-later) may be ported this way; SnappyMail core is AGPL-3.0 and must not be copied.

## Before you open a pull request

1. Pick one backlog story and name it in the PR title, for example `FOX-027: enforce UIDVALIDITY`.
2. For security-relevant behaviour (SSRF, tenant isolation, sanitizer, vault, CSRF), write the test first.
3. Run the same checks CI runs:

```bash
cd backend && npm run lint && npm run typecheck && npm test && npm run build
cd ../frontend && npm run lint && npm run typecheck && npm run build
```

4. Never commit secrets, real mailbox credentials, `mail-servers.json`, `.env` files or TLS keys. CI scans for secrets and fails the build.
5. Do not add dependencies lightly. In the PR, give the package's licence (it must be compatible with GPL-3.0) and maintenance status, and pin an exact version.

## Rules that are never relaxed

The non-negotiable rules are in `CLAUDE.md` section 4. In short: mailbox passwords live only in the encrypted session vault; users never choose a mail server; mail connections go through the SSRF guard with TLS verification on; incoming HTML is always sanitized and isolated; tenant id always comes from the session; no passwords, tokens, message bodies or attachments in logs.

## Review

Pull requests need one approving review and green CI. Changes to `backend/src/security/`, `backend/src/auth/`, the vault, the database row-level security policies or `deploy/` need a review from a maintainer with security responsibility.

## Reporting vulnerabilities

Do not open a public issue. Follow `SECURITY.md`.
