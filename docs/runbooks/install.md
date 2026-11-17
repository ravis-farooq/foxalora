# Installing Foxalora on a Linux server

For test and pilot installs. Foxalora is **not release-ready**: the separate render origin and the independent penetration test are still missing (CLAUDE.md rules 5 and Phase 6). Use test mailboxes or your own, keep access restricted (section 5), and do not offer it to customers yet.

Foxalora does not host mail. It connects to mail servers you already have (a hosting server, Gmail, Microsoft 365), so the server below needs no mail ports open, only 80 and 443.

## 1. What you need

- A Linux server (Ubuntu 24.04 tested in design; any distribution with Docker works), 2 CPU and 2 GB RAM or more, x86-64 or ARM64.
- Docker Engine with the Compose v2 plugin.
- A domain name, e.g. `webmail.yourdomain.com`, whose DNS A record points at the server. A free DuckDNS subdomain also works.
- Ports 80 and 443 open to the internet (80 is needed for Let's Encrypt).

**Free option:** Oracle Cloud "Always Free" ARM instance (Ampere A1, up to 4 OCPU / 24 GB). Open ports 80 and 443 in both the VCN security list and the instance firewall. Free offers change; check the current terms when signing up.

## 2. Prepare the server

```bash
# Docker Engine + Compose plugin (official convenience script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER" && newgrp docker
docker compose version

# Ubuntu images on Oracle Cloud ship with iptables rules that block 80/443:
sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Get the code

```bash
sudo mkdir -p /opt/foxalora && sudo chown "$USER" /opt/foxalora
git clone --branch dev https://github.com/ravis-farooq/foxalora.git /opt/foxalora
# Without GitHub access, copy it from your machine instead:
#   rsync -a --exclude node_modules --exclude dist --exclude .git ./ user@server:/opt/foxalora/
cd /opt/foxalora
```

## 4. Install

```bash
./deploy/install.sh webmail.yourdomain.com --letsencrypt you@yourdomain.com
```

The installer generates `deploy/.env` with random secrets, gets the certificate, builds the images (a few minutes on the first run), starts Nginx, the API, PostgreSQL and Valkey, runs migrations, and prints a **setup link**:

```
https://webmail.yourdomain.com/setup#token=<64 hex characters>
```

It can be run again safely; it prints the link again while setup is not finished.

## 4a. Setup wizard (in the browser)

Open the setup link. The wizard has five steps:

1. **Check**: HTTPS, database, session store, encryption key, production mode and site address. Continue is blocked while a check fails.
2. **Administrator**: company name, administrator email and password (at least 12 characters). This account is for the admin console, not for reading mail.
3. **Mail server**: the IMAP and SMTP host and security (SSL/TLS 993 or STARTTLS 143; SSL/TLS 465 or STARTTLS 587/25). **Test connection** checks the connection, TLS and certificate; with an optional test mailbox it also checks the login (the test password is used once and not stored). Advanced: "Mail server is on a private network" (only if it really is), "The server saves sent mail itself" (Gmail, Microsoft 365).
4. **Domains**: the email domains whose users sign in through this server, one per line.
5. **Review and finish**: everything is saved in one step; if anything fails, nothing is saved.

After finishing, the setup page answers "not found" for good, with or without the token. Customers sign in at `https://webmail.yourdomain.com`.

- Keep the setup link private until setup is done: whoever opens it first sets up the server.
- Lost the link: `grep SETUP_TOKEN deploy/.env`, then open `https://webmail.yourdomain.com/setup#token=` followed by the value.
- More servers and domains later (until the admin console exists), with the CLI:

```bash
./deploy/cli.sh tenant:list
./deploy/cli.sh server:add <tenantId> main --imap mail.yourdomain.com:993:tls --smtp mail.yourdomain.com:465:tls
./deploy/cli.sh domain:map <tenantId> yourdomain.com main
./deploy/cli.sh server:list <tenantId>
```

- Port 587 with STARTTLS: `--smtp mail.yourdomain.com:587:starttls`.
- Gmail: `--imap imap.gmail.com:993:tls --smtp smtp.gmail.com:465:tls --saves-sent`, map `gmail.com`; users sign in with an app password.
- Unencrypted connections (`none-dev-only`) are refused in production.

Sign in at `https://webmail.yourdomain.com` with a mailbox on one of the domains. **Write down how long the install took** (adoption target: 15 minutes).

Certificate renewal (daily; it renews only when needed):

```bash
( crontab -l 2>/dev/null; echo "17 3 * * * /opt/foxalora/deploy/renew-cert.sh >> /var/log/foxalora-cert.log 2>&1" ) | crontab -
```

## 5. Test server for testers

### Option A: testers use Gmail test accounts

Each tester creates a new Gmail account just for testing (not a personal one), turns on 2-Step Verification and creates an app password. Then:

```bash
./deploy/cli.sh server:add <tenantId> gmail --imap imap.gmail.com:993:tls --smtp smtp.gmail.com:465:tls --saves-sent
./deploy/cli.sh domain:map <tenantId> gmail.com gmail
./deploy/testing/gate.sh enable    # password gate in front of the site; prints the login
```

Testers sign in to Foxalora with their Gmail address and the app password. Mail is really delivered.

### Option B: private test mail server (testing add-on)

For a test install that several testers use, turn on the testing add-on right after section 4:

```bash
./deploy/testing/enable.sh 5      # 5 tester mailboxes
```

It adds, on the same server:
- a **private test mail server** for `@foxalora.test` mailboxes (a reserved name that can never be real). It has no ports open to the internet: only Foxalora can reach it, over TLS with a certificate from a private CA that may only sign `foxalora.test` names (its key is deleted after use);
- **Mailpit** at `https://<domain>/mailpit/`, which catches mail sent to any outside address. Nothing reaches the internet;
- a **shared password gate** (HTTP basic auth) in front of the whole site, so only people with the gate login can reach it. The gate credentials are removed before requests reach the API.

It prints the gate login and the mailbox passwords. Then send testers `docs/runbooks/testing.md` with their mailbox and the gate login. You do not need to map any other mail server.

| Task | Command |
|---|---|
| Add a tester mailbox | `./deploy/testing/tester.sh add <name>` |
| New mailbox password | `./deploy/testing/tester.sh password <name>` |
| Remove a mailbox (and its mail) | `./deploy/testing/tester.sh remove <name>` |
| List mailboxes | `./deploy/testing/tester.sh list` |
| Add or change a gate login | `./deploy/testing/gate.sh set <user>` |
| Remove a gate login | `./deploy/testing/gate.sh remove <user>` |

Without the add-on, keep a test install private another way: allow only your own IP on ports 80/443 in the cloud firewall (open 80 to all while Let's Encrypt issues or renews), or put it behind Cloudflare Tunnel with Cloudflare Access.

## Stopgap: run on your own machine with a Cloudflare quick tunnel

Before a server exists, `./deploy/testing/quick-tunnel.sh up` runs the same stack on the current machine with plain `docker` (no Compose needed), maps Gmail, turns on the password gate and publishes it at a random `https://<name>.trycloudflare.com` link. The machine must stay on, and the link changes whenever the tunnel restarts. `./deploy/testing/quick-tunnel.sh down` stops it (database kept). Nginx trusts the visitor address Cloudflare sends (`CF-Connecting-IP`) only from the private Docker network, so login throttling stays per visitor.

## 6. Day-to-day

| Task | Command (from `/opt/foxalora`) |
|---|---|
| Status | `./deploy/compose.sh ps` |
| API logs | `./deploy/compose.sh logs -f api` |
| Update | `git pull && ./deploy/install.sh webmail.yourdomain.com` (rebuilds, migrates, keeps data and the add-on) |
| Stop | `./deploy/compose.sh down` (data is kept) |
| Back up | `deploy/.env`, and `./deploy/compose.sh exec -T postgres pg_dump -U foxalora foxalora > backup.sql` |

`deploy/compose.sh` is `docker compose` with the right files for this install (it includes the testing add-on when it is on).

What is stored: PostgreSQL holds tenants, mail server settings, contacts, preferences, signatures and audit events, never mail or mailbox passwords. Valkey holds encrypted sessions in memory only; restarting it signs users out.

## 7. Tested so far (2026-11-16, 2026-11-17)

On a development machine with plain `docker` (no Compose plugin there), the same images and settings as `docker-compose.prod.yml`: images build; migrations run as the schema owner; the API runs read-only as the least-privilege role; the CLI creates a tenant and refuses `none-dev-only`; Nginx serves HTTPS with HSTS, CSP and `nosniff`, redirects HTTP to the configured domain only, rejects TLS 1.1 and unknown host names; login failures are generic; the cookie is `HttpOnly; Secure; SameSite=Strict`; a request without the CSRF header gets 403; send and receive work and the copy is saved to Sent; no password or session id appears in any container log.

Testing add-on, same way: certificates and gate login created by `enable.sh`; test mail server healthy with mailboxes created through `setup`; Foxalora connects to it over verified TLS; the CA's name constraint makes Node and OpenSSL reject a certificate for any other name; the site, API and Mailpit answer 401 without the gate login and work with it; ACME challenges on port 80 are not gated; tester-to-tester mail is delivered and saved to Sent; outside mail lands in Mailpit; the gate password, mailbox passwords and session ids never appear in the API log.

Setup wizard (2026-11-16), on a fresh production-mode stack with plain `docker` and an empty database, driven in headless Chrome: all six checks green; 404 without or with a wrong token; the connection test refused 127.0.0.1 and 10.1.2.3 (SSRF) with a plain explanation and passed against imap.gmail.com:993 and smtp.gmail.com:465 (TLS and certificate, no login); finishing created the tenant, the owner (scrypt hash), the server, the domain and audit entries; afterwards every setup route returned 404 and the page showed "Setup is not available"; no password or token in the API log; phone layout checked.

Fresh-server install (2026-11-17), following sections 2 to 4a on a clean Ubuntu 24.04 machine (a privileged container with its own Docker data disk, so Docker runs as on a real server, but no systemd and no public DNS): `get.docker.com` installed Docker with Compose 98 s after start; `./deploy/install.sh webmail.foxalora.test --self-signed` generated the secrets and certificate, built both images, ran migrations, waited for a healthy API and printed the setup link; **bare machine to setup link: 178 s**. The wizard, opened at the real host name, showed all six checks green, the connection test first failed SMTP with "same server" ticked and offered smtp.gmail.com, then passed both; finishing saved tenant, owner, server (with "saves sent mail itself"), domain and audit, and the setup routes then answered 404. HTTP redirects to HTTPS, an unknown host name is refused, a Gmail login with a wrong password reaches Gmail and gets the generic failure; no admin password, setup token or mailbox password in the API log. `install.sh` needs a host name with a dot (`localhost` is refused).

Not yet tested: `enable.sh`, `tester.sh` and `gate.sh` with `docker compose` end to end, Let's Encrypt issue and renewal, an ARM64 build, a real server on the internet, the wizard's connection test with a real test mailbox login.
