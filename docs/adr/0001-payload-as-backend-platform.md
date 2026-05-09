# ADR-0001: Use Payload CMS as the backend platform

**Date:** 2026-03-19
**Status:** Superseded (2026-03-24) — Payload CMS replaced by Hono + Drizzle. See [project memory](../../.claude/projects/C--github-claimNet/memory/project_drop_payload.md) for rationale.

---

## Context

ClaimNet needs:
- User authentication (browser sessions, JWT, API keys)
- Role-based access control
- A generated admin panel for moderation workflows
- REST endpoints for collections
- A schema-first data model
- Type-safe database access

We evaluated: hand-rolled Node/Hono, Next.js + Prisma, and Payload CMS.

## Decision

Use **Payload v3** as the backend platform.

Payload provides:
- Cookie + JWT + API key auth out of the box
- Generated REST and admin panel for all collections
- Drizzle-backed Postgres adapter with direct Drizzle access
- Custom endpoint support with access to `req.user` and the Local API
- Access control hooks per collection and field

The frontend is a **separate React SPA** (Vite). Payload's internal Next.js dependency applies only to the backend service and does not affect the frontend.

## Important caveats

### 1. Payload's Next.js internals

Payload v3 uses Next.js App Router internally for its admin panel. This means:
- The backend dev server is `next dev`, not plain Node
- The backend build is `next build`
- This is a known, documented tradeoff; it does not affect the public API or the frontend

### 2. Custom endpoints are NOT authenticated by default

Every custom endpoint must explicitly call `requireUser(req)` or `requireRole(req, ...)`.
Never assume a Payload endpoint is protected unless you verify it explicitly.

### 3. Local API skips access control by default

When using `payload.find()`, `payload.create()`, etc. inside service code, access control is bypassed unless you pass `overrideAccess: false`. All authorization-sensitive service code must pass this option.

### 4. Magic-link auth is not built in

Payload provides email verification and password reset, but not passwordless magic-link sign-in. Magic links can be added as a custom flow if needed in a later phase.

## Fallback

If Payload's Next.js dependency becomes unacceptable, the fallback is:
- Hono backend
- Drizzle + postgres
- Better Auth or Auth.js

Same deployment plan applies.

## Consequences

- Backend `dev`, `build`, and `start` scripts use `next`
- Admin panel available at `/admin`
- All product logic lives in `src/services/`, not in Payload collection config
- Payload collection config is schema + access rules only
