#!/bin/sh
set -e
# Exim reads the TLS key after dropping to Debian-exim, so copy certs with suitable ownership.
mkdir -p /etc/ssl/foxalora
cp /certs/fullchain.pem /certs/server-key.pem /etc/ssl/foxalora/
chown root:Debian-exim /etc/ssl/foxalora/*.pem
chmod 640 /etc/ssl/foxalora/*.pem
mkdir -p /var/mail && chown vmail:vmail /var/mail

dovecot
exec exim -bdf -q15m
