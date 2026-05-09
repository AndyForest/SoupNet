# ADR-0004: OpenAPI spec generated from Zod schemas

**Date:** 2026-03-19
**Status:** Accepted

---

## Context

ClaimNet has a REST API consumed by:
- The frontend (via `packages/client-sdk`)
- AI agent clients (directly or via the MCP server)
- Future external integrators

We need an accurate, machine-readable API spec with interactive docs.

## Decision

Use **`@asteasolutions/zod-to-openapi`** to generate an OpenAPI 3.1 spec from the Zod schemas in `packages/contracts`.

- `packages/contracts/src/openapi-registry.ts` is the single source of truth
- The registry registers all schemas and paths with `.openapi()` metadata
- The backend generates the spec at startup (cached) and serves it at `/api/openapi.json`
- **Scalar** (https://scalar.com) renders interactive docs at `/api/docs`

## Why Scalar over Swagger UI

- More modern UI; better DX for API exploration
- Smaller CDN bundle
- Supports OpenAPI 3.1 natively
- Same concept as Swagger UI; easy to swap if needed

## Why not TanStack Router for OpenAPI

TanStack Router is a client-side browser navigation library. It knows nothing about server API schemas. They operate at completely different layers.

## Source of truth contract

> **Never hand-edit the OpenAPI spec.**
> Update the Zod schemas in `packages/contracts/*.ts` and the registry in `openapi-registry.ts` instead.

This ensures the spec always matches the actual validation logic.

## Future: generated client

When external integrators need a typed client, generate one from the spec using `openapi-typescript` + `openapi-fetch`. This would replace or augment the hand-written `packages/client-sdk`.

## Consequences

- All Zod schemas used in endpoints must be registered in `openapi-registry.ts`
- Any path added to `customEndpoints` must also have a `registry.registerPath()` entry
- `@asteasolutions/zod-to-openapi` is a dependency of `packages/contracts`
