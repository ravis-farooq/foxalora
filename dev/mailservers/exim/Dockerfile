# Exim (SMTP) + Dovecot (IMAP) test server: the same pairing cPanel hosting uses. Dev only.
FROM debian:bookworm-20261027-slim
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      exim4-daemon-heavy dovecot-imapd ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 5000 vmail && useradd -u 5000 -g vmail -d /var/mail -s /usr/sbin/nologin vmail
COPY exim4.conf /etc/exim4/exim4.conf
COPY localparts /etc/exim4/localparts
COPY dovecot.conf /etc/dovecot/dovecot.conf
COPY users /etc/dovecot/users
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh && chmod 640 /etc/dovecot/users && chown root:dovecot /etc/dovecot/users
EXPOSE 25 143 465 587 993
ENTRYPOINT ["/entrypoint.sh"]
