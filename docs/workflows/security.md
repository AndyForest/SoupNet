# Security Workflow

How security auditing, implementation, and testing work together in this project. Designed for a multi-agent workflow where different AI agents (or humans) handle different roles.

---

## Roles

### Audit Agent (read-only)

**Purpose:** Finds vulnerabilities. Never fixes them.

**Access:** Read-only. Can read all source files, run `git log`, run tests, check recipes. Cannot edit files or create commits.

**Responsibilities:**
1. Scan all security-relevant files (routes, auth, services, config, Docker, Terraform)
2. Produce a dated findings document in `docs/security/security-audit-YYYY-MM-DD.md`
3. Mark each finding as OPEN, FIXED, or PARTIALLY FIXED with evidence
4. Assess test coverage gaps relevant to security
5. Check recipes on Soup.net for security decisions (Zod validation, security headers, agent separation, etc.)
6. Compare against the previous audit to track progress

**When to run:**
- Before any deployment milestone
- After a batch of security fixes (to verify they're complete)
- When new routes, services, or auth changes are added
- Periodically (monthly minimum)

**Output format:** See the latest audit in `docs/security/` for the canonical template (most recent: `security-audit-2026-04-09.md`, plus the JWT-focused review noted in backlog.md 2026-04-17). Key sections:
- Resolved since last audit (with evidence)
- Open findings (severity, file, line, fix recommendation)
- Test coverage gaps
- Positive practices (so the implementation agent knows what NOT to break)
- Priority summary table

### Implementation Agent (write-only for fixes)

**Purpose:** Applies security fixes. Does not self-validate.

**Access:** Full read/write. Can edit files, run tests, create commits.

**Responsibilities:**
1. Read the latest audit document
2. Pick items by priority (P0 first)
3. Implement fixes one at a time
4. Write or update tests that verify the fix
5. Run the full test suite to confirm no regressions
6. Commit with a message referencing the audit finding (e.g., `fix(security): add rate limiting [F1]`)
7. Do NOT update the audit document — that's the audit agent's job

**Rules:**
- Never mark your own fix as "verified" — the audit agent does that on re-scan
- Write a test for every security fix. If you can't test it automatically, document the manual verification steps
- Don't bundle unrelated changes with security fixes — keep commits atomic
- Follow existing patterns (Zod for validation, Drizzle for queries, middleware for headers)

### Test Suite (automated)

**Purpose:** Catches regressions. Runs in CI on every push.

**Current state:** Vitest, integration + unit suites against the running backend. Security-critical modules (auth, api-key, rate-limit, keys/groups/admin routes) have dedicated tests; see `apps/backend/src/**/*.test.ts`. Run via `npm run test:ci` for the CI-equivalent gate.

---

## Security Test Strategy

### Layer 1: Unit tests (no DB, no network)

Fast, isolated, run on every commit. Target pure security functions:

```
apps/backend/src/auth.ts
├── hashPassword / verifyPassword round-trip
├── signToken / verifyToken rejects tampered tokens
├── verifyToken rejects alg:none tokens
├── JWT_SECRET validation rejects defaults and short values
└── autoSetup skips when NODE_ENV=production

apps/backend/src/services/api-key.service.ts
├── hashKey is deterministic (same input → same output)
├── base62 encoding produces valid characters only
├── generated keys have expected format and length
└── key prefix is unique per type (cn_daily_, cn_scoped_)
```

### Layer 2: Integration tests (requires DB)

Verify authorization and access control with real queries:

```
apps/backend/src/routes/keys.ts
├── POST /keys/scoped rejects non-member groupIds → 403
├── POST /keys/scoped rejects past expiresAt → 400
├── POST /keys/scoped rejects expiresAt > 1 year → 400
├── DELETE /keys/:id rejects other user's key → 403
└── Expired keys are rejected by validateKey

apps/backend/src/routes/groups.ts
├── POST /groups rejects non-owned organizationId → 403
└── POST /groups validates slug format

apps/backend/src/routes/admin.ts
├── GET /admin/organizations returns 403 for non-system users
└── GET /admin/organizations returns data for system users
```

### Layer 3: Security regression tests

Tests that specifically verify audit findings stay fixed:

```
tests/security/
├── headers.test.ts        — verify CSP, X-Frame-Options, nosniff on all HTML routes
├── error-leakage.test.ts  — verify no SQL/stack traces in 4xx/5xx responses
├── auth-bypass.test.ts    — verify protected routes reject missing/invalid/expired tokens
└── input-validation.test.ts — verify Zod rejects malformed payloads on all validated routes
```

### Layer 4: Manual verification checklist

For things that can't be easily automated:

- [ ] `docker compose up` with no `.env` file — backend should refuse to start (JWT_SECRET missing)
- [ ] `docker compose up` with default `.env.example` values — backend should refuse to start (JWT_SECRET contains "change-me")
- [ ] Set `NODE_ENV=production` with `DEV_USERNAME` set — verify auto-setup is blocked/skipped
- [ ] Check production build output (`npm run build`) — verify no `.map` files (once sourcemaps are disabled)

---

## Audit Cycle

```
1. AUDIT AGENT scans codebase
   ├── Reads all security-relevant files
   ├── Compares against previous audit
   ├── Checks recipes on Soup.net
   └── Writes docs/security/security-audit-YYYY-MM-DD.md

2. HUMAN reviews findings
   ├── Confirms priorities
   ├── Assigns to implementation agent or self
   └── May adjust severity based on deployment context

3. IMPLEMENTATION AGENT applies fixes
   ├── One fix per commit, referencing finding number
   ├── Writes/updates tests for each fix
   ├── Runs full test suite
   └── Does NOT update audit document

4. AUDIT AGENT re-scans
   ├── Verifies fixes are complete (not partial)
   ├── Updates findings with FIXED status and evidence
   ├── Identifies any new issues introduced by fixes
   └── Writes updated audit document

5. Repeat from step 2 until all P0/P1 items are resolved
```

---

## File Locations

| Artifact | Location |
|----------|----------|
| Security audits | private deployment repo: `docs/security/security-audit-YYYY-MM-DD.md` (not in this repo — they cover the hosted deployment; ask the operator for access) |
| Security workflow | `docs/workflows/security.md` (this file) |
| Security regression tests | `tests/security/` (to be created) |
| Unit tests | `apps/*/src/**/*.test.ts` |
| Integration tests | `apps/*/src/**/*.test.ts` |
| CI pipeline | `.github/workflows/ci.yml` |

---

## Audit History

Audits live in the private deployment repo's `docs/security/`. Summary as of the last scan:

| Date | Focus | File |
|------|-------|------|
| 2026-03-25 → 2026-03-29 | Initial pass + batch fixes | `security-audit-2026-03-25.md` … `2026-03-29.md` |
| 2026-03-31 | Re-audit after batch 2 | `security-audit-2026-03-31.md` |
| 2026-04-01 | Recipe-check additions | `security-audit-2026-04-01.md` |
| 2026-04-09 | Latest general audit (F1–F30) | `security-audit-2026-04-09.md` |
| 2026-04-17 | JWT-focused review (see backlog §JWT auth hardening) | results in backlog.md |

Read the newest before starting security-related work to avoid re-introducing fixed issues.

---

## Recipes Checked

The following security decisions have been logged as recipes on Soup.net for future reference and cross-project learning:

1. **Separate audit and implementation agents** — prevents self-validation bias (NIST SP 800-53 AC-5, ISO 27001 A.8.29)
2. **Zod validation at route level** — defense-in-depth with Drizzle parameterized queries (OWASP Input Validation)
3. **Security unit tests for crypto and auth** — catch regressions that integration tests miss (OWASP Testing Guide v4.2)
4. **CSP/X-Frame-Options/nosniff headers** — defense-in-depth beyond application-level escaping (OWASP Secure Headers)
5. **Read-only audit agent, write-only implementation agent** — auditable trail in git with independent verification
6. **Agents check for audit files before starting new tasks** — prevents re-introducing fixed vulnerabilities when multiple agents work concurrently
