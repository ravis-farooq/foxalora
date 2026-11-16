# Testing Foxalora Mail: guide for testers

Thank you for testing. Foxalora is a webmail app that hosting companies will give their customers. This is an **early test version** on a private test server.

## What you get

From the person running the test you receive:
- **Site address**, e.g. `https://foxalora-test.duckdns.org`
- **Gate login**: a shared user name and password. Your browser asks for it before the site opens.
- **Your mailbox**: e.g. `tester2@foxalora.test` and its password. You sign in to Foxalora with this.

## Rules of the test

- The mailboxes are **test mailboxes on a test server**. Mail between `@foxalora.test` addresses is delivered normally.
- Mail to **any other address** (Gmail, your work email) is **not delivered**. It is caught in a shared test inbox at `https://<site>/mailpit/`, where everyone with the gate login can read it. Do not send anything private.
- Do not use your real email passwords anywhere in this test.

## What to try

1. **Sign in** with your mailbox. Try a wrong password once: the message should not say whether the address or the password was wrong.
2. **Read** mail, open the sample messages, switch folders.
3. **Write** to another tester: plain and formatted text, a signature, an inline image. Reply, reply all, forward.
4. **Organise**: star, mark read and unread, move, archive, delete and undo, restore from Trash, create and rename folders, select several messages.
5. **Contacts and settings**: add contacts, import or export a vCard, change theme, density, time zone and display name.
6. **Send outside**: write to any Gmail address and look for it at `/mailpit/`. Check that Bcc recipients are not visible to others.
7. **Phone**: repeat a few of the above on a phone browser.
8. **Leave it idle** for 30 minutes and check that you are asked to sign in again.

## Reporting a problem

For each problem, send:
- what you did (steps), what you expected, what happened
- device and browser (e.g. iPhone 15, Safari)
- time it happened (so it can be found in the server logs)
- a screenshot if it helps (hide anything private)

Known gaps (no need to report): attachments cannot be added when sending, no threads, no search filters, no language other than English, no admin screens.
