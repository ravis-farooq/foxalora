# Foxalora Mail: launch kit

Drafts for getting hosting companies to install and use Foxalora. **Publish a claim only when it is true.** Everything marked [after v1.0] needs the product finished and the independent security test completed. Placeholders in [brackets] are facts only you know.

## 0. The three things a hosting company must see

A hosting company will replace its current webmail only if all three are true.

1. **Install in 15 minutes.** If setup takes longer, they will not try it. Treat 15 minutes as a target to measure in every pilot (from a fresh Linux server with Docker to a working login), and fix whatever makes it slower. Do not print the number in public material until pilots confirm it.
2. **Customers are happy.** Modern interface, good on phones, fewer support tickets. Measure it: ask pilot hosts to compare webmail-related ticket counts before and after, and collect a short satisfaction note from users. Do not claim "fewer tickets" until you have their numbers.
3. **Trust.** Email is very sensitive, so security needs proof, not promises: the independent penetration test summary, a vulnerability reporting policy you honour, a public list of known limitations, and a compatibility list of mail servers actually tested.

Every item below exists to support one of these three.

## 1. Order of work

1. Finish Phase 0 and Phase 1 in CLAUDE.md (the product has to exist and be safe first).
2. Pilot with 3 to 5 small hosting companies you know.
3. Install wizard, Docker install and docs polished from pilot feedback.
4. cPanel one-click integration.
5. Independent penetration test; publish a summary.
6. Public launch: GitHub release, demo site, forum posts.

## 2. GitHub README draft (publish at launch)

> # Foxalora Mail
> A modern, open-source webmail client for hosting companies. Works with the IMAP and SMTP servers you already run. No mail migration, no new mail server.
>
> **Why hosting companies use it**
> - Installs with Docker in about [15] minutes [verify in pilot before stating a number]
> - Your logo, name and support details on the login page
> - Map your domains to your mail servers; one install can serve many
> - Responsive on phones; English and Arabic (right-to-left) [after v1.0]
> - Single sign-on from cPanel [after v1.0]
>
> **Security by design**
> - Mailbox passwords are held only encrypted and briefly, never in the database or logs
> - Email HTML is sanitized and shown in an isolated frame
> - Users cannot point the app at arbitrary servers
> - Independent penetration test: [link to summary, after v1.0]
>
> **Quick start**
> ```
> git clone [repo-url] && cd foxalora
> ./deploy/install.sh mail.yourdomain.com
> ```
> **Try it:** [demo URL] (test mailbox: [demo login])
>
> **Licence:** GPL-3.0-or-later, with an exception for skins and plugins · **Report a vulnerability:** see SECURITY.md

## 3. Demo site checklist

- [ ] Hosted on its own domain, with a test mail server and a resettable demo mailbox
- [ ] Demo mailbox contains normal mail, a message with an attachment, and one harmless "hostile" HTML sample showing it is blocked
- [ ] Demo mailbox resets daily; no real personal data ever loaded
- [ ] Banner: "Demo site. Do not enter real credentials."
- [ ] Mobile screenshots and a 60-second screen recording on the README
- [ ] Rate limits on, so the demo cannot be used to send spam

## 4. Pilot partner email (copy and edit)

**Subject:** Free modern webmail for [Company], want to try it?

Hi [Name],

I am building Foxalora, an open-source webmail client for hosting companies. It connects to your existing IMAP/SMTP servers, so there is nothing to migrate, and your customers get a modern, mobile-friendly mailbox with your own branding.

I am looking for a few hosting providers to try an early version and tell me what is missing. In return I will help you install it and fix the issues you find. It is free and open source, and early software, so I suggest trying it on a test domain first.

Would a 20-minute call next week work to show you a demo?

[Your name] · [contact]

## 5. Forum post draft (WebHostingTalk, Reddit r/webhosting, cPanel and Plesk communities)

**Title:** Looking for hosts to test an open-source webmail alternative to Roundcube

I am working on Foxalora Mail, an open-source webmail client aimed at hosting companies. Goals: modern interface, easy Docker install, per-company branding, domain-to-server mapping, and a security design that keeps mailbox passwords out of the database and isolates email HTML.

Status: [early version / beta]. It works with standard IMAP/SMTP and I am testing on Dovecot and [others]. Not yet [list what is missing, for example cPanel SSO].

I would like feedback from people who run mail for customers: what annoys you about your current webmail, and what would stop you switching? Demo: [URL]. Source: [repo]. Happy to help anyone try it on a test domain.

## 6. Customer notice template (hosting company sends this to its customers)

**Subject:** Our webmail has a new look

Hello,

We have updated our webmail. Sign in at [webmail URL] with the same email address and password as before. Your messages, folders and contacts are unchanged, because they are stored on our mail server. The new version works better on phones and has a cleaner layout. If you need help, contact [support email].

## 7. Pilot onboarding checklist (for each hosting partner)

- [ ] Test domain and test mailboxes created on their mail server
- [ ] Server and domain mapping filled in; TLS certificate valid
- [ ] Install run on a test server; time taken and problems recorded
- [ ] Their branding added; login page reviewed
- [ ] Five real staff use it for two weeks; issues logged
- [ ] Decision: roll out to a small customer group
- [ ] Permission asked before naming them as a user

## 8. Trust signals to collect before public launch

- Independent penetration test summary and remediation status
- SECURITY.md with a contact and response times you can keep
- Public roadmap and release notes
- Known limitations page (honesty here earns more trust than a long feature list)
- Compatibility list of mail servers actually tested

## 9. Where to find hosting providers

WebHostingTalk, Reddit (r/webhosting, r/selfhosted), cPanel and Plesk community forums, hosting conferences, LinkedIn and local hosting provider groups, and the support contacts of small hosts you already know. Contact people individually; do not mass-post.
