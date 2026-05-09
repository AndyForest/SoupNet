# ADR-0006: Strict MIME type allowlist for artifact payloads

**Date:** 2026-03-19
**Status:** Accepted

---

## Context

ClaimNet's ephemeral artifact cache stores full payloads submitted by agent clients. An open-ended blob store creates:
- Moderation complexity (impossible to scan arbitrary formats)
- Embedding complexity (can't embed what you can't read)
- Security risk (executable formats, embedded scripts)
- Legal risk (arbitrary binary redistribution)

## Decision

Only explicitly permitted MIME types are accepted. The allowlist is defined in `packages/contracts/src/artifacts.ts` as `ALLOWED_MIME_TYPES`.

### Categories

**Text** — `text/plain`, `text/markdown`

**Structured data** — `application/json`, `application/yaml`, `text/csv`, `text/xml`, `application/xml`, `application/toml`, `application/x-ndjson`

**Code** — `text/x-python`, `text/x-javascript`, `text/x-typescript`, `text/x-rust`, `text/x-go`, `text/x-java`, `text/x-c`, `text/x-cpp`, `text/x-ruby`, `text/x-php`, `text/x-shell`, `text/x-lua`, `text/html`, `text/css`

**Diffs/patches** — `text/x-diff`, `text/x-patch`

**Images** — `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`

### No binaries

Executables, compiled artifacts, archives (`.zip`, `.tar`), PDFs, Office documents, and any format not on the list are rejected at upload time with a clear error message.

## Sanitization requirements per category

Each allowed type has a defined sanitization path:

| Category | Sanitization |
|---|---|
| Text, code, data | UTF-8 validation, max size check, strip null bytes |
| Diffs/patches | UTF-8 validation, max size check |
| `image/png`, `image/jpeg`, `image/gif`, `image/webp` | Re-encode via Sharp (strips EXIF, ICC profile, metadata) + dimension check |
| `image/svg+xml` | **High risk.** Strip all script tags, event handlers, and external references using a strict SVG element/attribute allowlist. Consider removing from v1 until pipeline is built. |

## SVG caution

SVG can contain embedded JavaScript (`<script>`, `onload=`, `href=javascript:`, external `<image>` with data URIs). Simply accepting SVG without sanitization is a stored XSS vector. Options:
1. Remove SVG from the v1 allowlist until a robust sanitization pipeline exists
2. Accept SVG but only after running through a strict allowlist filter (e.g. `DOMPurify` with SVG-safe config, server-side)

**Decision:** Remove `image/svg+xml` from v1 and add it back once the sanitization pipeline is audited.

**Image sanitization (decided):** Re-encode via Sharp (strips EXIF, re-compresses) + dimension limit.

## Consequences

- Backend upload handler must validate `Content-Type` header against `ALLOWED_MIME_TYPES` before issuing a presigned URL
- S3 upload must set `ContentType` to the validated MIME type
- The allowlist is the only place to extend permitted types — not per-request configuration
- Adding a new MIME type requires both a code change (allowlist) and a sanitization strategy
