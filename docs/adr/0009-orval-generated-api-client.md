# ADR-0009: Orval-generated React Query client from OpenAPI spec

**Date:** 2026-03-19
**Status:** Accepted

---

## Context

The frontend needs typed HTTP client code to call the backend REST API. Options:

1. **Hand-written fetch calls** — immediate to start, diverges from the API over time, no type safety guarantees
2. **Shared Zod schemas from `packages/contracts`** — type-safe, but still requires manual fetch wrappers per endpoint
3. **Generated client from OpenAPI spec** — fully typed, automatically synchronized with the API, React Query integration included

The backend already generates an OpenAPI 3.1 spec at `/api/openapi.json` from Zod schemas in `packages/contracts/src/openapi-registry.ts` (see ADR-0004). This spec is the authoritative contract between frontend and backend.

## Decision

Use **[Orval](https://orval.dev)** to generate React Query v5 hooks + TypeScript types from the OpenAPI spec.

### Why Orval over alternatives

| Tool | Why not |
|---|---|
| `openapi-typescript` | Generates types only, not hooks. Would still need manual React Query wrappers. |
| `openapi-generator` | Java-based, heavy, poor React Query v5 support |
| `hey-api` | Good alternative but Orval has better Zod integration and more active community |
| Hand-written with `packages/contracts` | Shares Zod schemas but not the full OpenAPI contract; misses path params, query params, response codes |

Orval generates:
- One React Query hook per endpoint (`useGetClaim`, `useSearchClaims`, `useSubmitValidation`, etc.)
- TypeScript request/response types inferred from the OpenAPI schema
- A thin fetch wrapper that's easy to customize (auth, base URL, error handling)

### Package structure

The generated code lives in `packages/api-client`:

```
packages/api-client/
  src/
    generated/          ← Orval output, never hand-edited
      claimnet.ts       ← all hooks and types
      claimnet.msw.ts   ← MSW mock handlers (for Storybook + tests)
    mutator/
      auth-fetch.ts     ← custom fetch with cookie credentials
    index.ts            ← re-export public surface
  orval.config.ts
  package.json
  tsconfig.json
```

### Custom auth mutator

Orval supports a custom `mutator` that replaces the default `fetch`. ClaimNet uses cookie-based auth (`credentials: 'include'`) so a thin wrapper is needed:

```typescript
// packages/api-client/src/mutator/auth-fetch.ts
export const authFetch = async <T>(
  url: string,
  options: RequestInit
): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',       // include cookies for Payload session
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
};
```

### OpenAPI spec snapshot

`packages/api-client/openapi.json` is a committed snapshot of the backend's OpenAPI spec. This decouples frontend generation from a running backend — CI fetches the latest spec from the backend build artifact, compares it against the committed snapshot, and fails if they diverge without a corresponding `packages/api-client` regeneration.

The regeneration command: `npm run generate:api-client` (in root `package.json`), which:
1. Runs the backend's `generateOpenApiSpec()` function to produce `openapi.json`
2. Runs `orval --config packages/api-client/orval.config.ts` to regenerate the hooks

Both steps run in CI on every PR touching `packages/contracts`.

### MSW mock handlers

Orval's `msw` mode generates `claimnet.msw.ts` containing MSW v2 request handlers for every endpoint. These are used in:
- Storybook stories (no running backend needed)
- Frontend integration tests with Vitest

---

## Consequences

- Frontend developers never hand-write API client code
- Adding a new endpoint in `packages/contracts/src/openapi-registry.ts` → `npm run generate:api-client` → hook is available
- Orval output is committed (not gitignored) — PRs show the generated diff, making API changes visible in code review
- The `packages/api-client/openapi.json` snapshot serves as the contract test: if the backend changes the API without regenerating, CI fails
- Frontend components use the generated hooks directly; no manual React Query boilerplate

## Not yet built

`packages/api-client` does not exist yet. See `docs/backlog.md` → "API Client" section.
