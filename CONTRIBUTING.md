# Contributing to Soup.net

Thanks for contributing. This file covers the workflow; it deliberately doesn't duplicate setup or design docs — it points at them.

## Dev setup

Follow the [README quick start](README.md#quick-start). That's the whole setup: `.env` from `.env.example`, `docker compose up --build -d`, `npm run dev:frontend`. Prerequisites and the local-backend hot-reload variant are in the README's Development section.

## Tests

```bash
npx vitest run       # full suite (.env auto-loaded; keep docker compose up for integration tests)
npm run test:ci      # canonical CI reproduction — fresh DB, no Gemini key
```

`npm run test:ci` is the gate a PR has to pass; if it's green locally, CI should be green too. Coverage expectations and test layers are in [`docs/testing-plan.md`](docs/testing-plan.md).

## Key code rules

- **No business logic in route handlers or React components** — put it in services (`apps/backend/src/services/`) or `packages/domain`.
- **Never edit the database schema or data directly** — schema changes go through Drizzle migrations (`cd packages/db && npx drizzle-kit generate`). Never hand-write migrations either.
- **`import type { ... }`** for type-only imports.
- **`unknown`, not `any`.**

The reasoning behind these and more lives in [`docs/engineering-principles.md`](docs/engineering-principles.md).

## Pull requests

- Say what changed and why. Small, focused PRs land faster.
- **Behavior changes need tests.** New routes, services, or logic changes should come with unit or integration coverage per [`docs/testing-plan.md`](docs/testing-plan.md).
- **Security-touching changes need a test.** Anything that touches auth, API keys, crypto, validation, or authorization must include a test verifying the fix or behavior — see [`docs/workflows/security.md`](docs/workflows/security.md). If it can't be tested automatically, document the manual verification steps in the PR.
- Update docs when behavior changes. If you add a new doc, state its purpose at the top and link it from the README's "Learn more" section.
- Don't bundle unrelated changes; keep commits atomic.

Found a vulnerability? Don't open a PR or issue — see [SECURITY.md](SECURITY.md).

## Design decisions are recipes

This project dogfoods itself. Design decisions are logged as **recipes** in a public Soup.net recipe book (**soupnet-oss**). If your coding agent is connected to Soup.net (see the README's MCP setup section), it can check that book before making a judgment call and retrieve the prior decisions — with evidence — that shaped the code it's changing. Not required for contributing, but it's the fastest way to learn why things are the way they are.

## Questions and proposals

- Bugs and feature requests: use the issue templates.
- Design questions: open a **design discussion** issue — framing your proposal as *"As a [role] working on [goal], I prefer [X] so that [reason]"* matches the project's native decision format and makes it easy to log the outcome.
