/**
 * The browser-safe part of @soupnet/domain, for the SPA (`@soupnet/domain/browser`).
 *
 * The package's main entry also carries modules that import Node built-ins
 * (the stub embeddings use `crypto`), which a Vite build can't bundle. These
 * modules are pure and import nothing outside this list, so the org console
 * and the member's page share the backend's own column sets, sharing rule
 * and activity allowlist rather than copies (organization accounts round 1,
 * stream Console). Add a module here only if it, and everything it imports,
 * runs in a browser.
 */
export * from "./organizations";
export * from "./sharing-policy";
export * from "./admin-columns";
export * from "./org-activity";
