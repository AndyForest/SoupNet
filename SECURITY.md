# Security Policy

## Reporting a vulnerability

**Please do not open a public issue or PR for security vulnerabilities.**

Report privately via GitHub's private vulnerability reporting: go to this repository's **Security** tab → **Report a vulnerability**. If that doesn't work for you, email **andy@soup.net**.

Include what you can: affected component or route, reproduction steps, and impact. A proof of concept helps but isn't required.

## What to expect

- Acknowledgment within a few days.
- We'll work with you on a fix and coordinate disclosure timing — please keep the report private until a fix is released.
- Credit in the fix's release notes if you'd like it.

## Scope

This policy covers the code in this repository and the hosted service at soup.net. For self-hosted instances, apply fixes by updating to the latest release.

## How security work happens here

The project runs a recurring audit cycle with separated audit and implementation roles, and every security fix ships with a test. The process is documented in [`docs/workflows/security.md`](docs/workflows/security.md). Audit findings themselves are kept private until fixed; the F-numbered comments in the code (F15, F29, …) reference resolved findings and preserve each fix's rationale in place.
