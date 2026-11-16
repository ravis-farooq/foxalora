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

The installer generates `deploy/.env` with random secrets, gets the certificate, builds the images (a few minutes on the first run), starts Nginx, the API, PostgreSQL and Valkey, runs migrations, creates the first tenant and prints its id. It can be run again safely.

Then map your email domain to its mail server (use the tenant id the installer printed):

```bash
./deploy/cli.sh server:add <tenantId> main --imap mail.yourdomain.com:993:tls --smtp mail.yourdomain.com:465:tls
./deploy/cli.sh domain:map <tenantId> yourdomain.com main
./deploy/cli.sh server:list <tenantId>
```

- Port 587 with STARTTLS: `--smtp mail.yourdomain.com:587:starttls`.
- Gmail: `--imap imap.gmail.com:993:tls --smtp smtp.gmail.com:465:tls --saves-sent`, map `gmail.com`; users sign in with an app password.
- Unencrypted connections (`none-dev-only`) are refused in production.

Open `https://webmail.yourdomain.com` and sign in with a mailbox on that domain. **Write down how long the install took** (adoption target: 15 minutes).

Certificate renewal (daily; it renews only when needed):

```bash
( crontab -l 2>/dev/null; echo "17 3 * * * /opt/foxalora/deploy/renew-cert.sh >> /var/log/foxalora-cert.log 2>&1" ) | crontab -
```

## 5. Keep a test install private

Until the release blockers are fixed, restrict who can reach it. Either:
- Allow only your own IP on ports 80/443 in the cloud firewall (temporarily open 80 to all while Let's Encrypt issues or renews), or
- Put it behind Cloudflare Tunnel with Cloudflare Access (login wall in front of the site).

## 6. Day-to-day

| Task | Command (from `/opt/foxalora`) |
|---|---|
| Status | `docker compose -f deploy/docker-compose.prod.yml ps` |
| API logs | `docker compose -f deploy/docker-compose.prod.yml logs -f api` |
| Update | `git pull && ./deploy/install.sh webmail.yourdomain.com` (rebuilds, migrates, keeps data) |
| Stop | `docker compose -f deploy/docker-compose.prod.yml down` (data is kept) |
| Back up | `deploy/.env`, and `docker compose -f deploy/docker-compose.prod.yml exec -T postgres pg_dump -U foxalora foxalora > backup.sql` |

What is stored: PostgreSQL holds tenants, mail server settings, contacts, preferences, signatures and audit events, never mail or mailbox passwords. Valkey holds encrypted sessions in memory only; restarting it signs users out.

## 7. Tested so far (2026-11-16)

On a development machine with plain `docker` (no Compose plugin there), the same images and settings as `docker-compose.prod.yml`: images build; migrations run as the schema owner; the API runs read-only as the least-privilege role; the CLI creates a tenant and refuses `none-dev-only`; Nginx serves HTTPS with HSTS, CSP and `nosniff`, redirects HTTP to the configured domain only, rejects TLS 1.1 and unknown host names; login failures are generic; the cookie is `HttpOnly; Secure; SameSite=Strict`; a request without the CSRF header gets 403; send and receive work and the copy is saved to Sent; no password or session id appears in any container log.

Not yet tested: `install.sh` and `docker compose` end to end, Let's Encrypt issue and renewal, an ARM64 build, a real server on the internet, the interface in a browser on the production stack.
