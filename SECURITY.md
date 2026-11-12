# Security policy

Foxalora Mail gives access to people's email. We treat security reports as our highest priority.

## Reporting a vulnerability

**Do not open a public issue or pull request.**

Report privately to: **[security contact to be set before the repository is published]**
(Planned: a dedicated address with a published PGP key, and GitHub private vulnerability reporting.)

Please include the affected version or commit, steps to reproduce, the impact you observed, and whether you want to be credited.

## What to expect

- Acknowledgement within 3 working days.
- An initial assessment and severity within 10 working days.
- A fix or mitigation for critical and high-severity issues as fast as possible, normally within 30 days, released together with an advisory.
- Credit in the advisory if you want it.

We ask reporters to give us reasonable time to release a fix before public disclosure, and not to access mailboxes or data that are not their own while testing.

## Supported versions

Before version 1.0, only the latest release and the `main` branch receive security fixes.

## Scope

In scope: the Foxalora backend, frontend, render host, installer and official Docker images.
Out of scope: the hosting company's own mail servers, DNS, panels and infrastructure, and issues that need a compromised administrator account.
