import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { sql } from "drizzle-orm";

import { runMigrations } from "./db";
import { autoSetup } from "./auth";
import { getDb } from "./db";
import { authRoutes } from "./routes/auth";
import { keyRoutes } from "./routes/keys";
import { meRoutes } from "./routes/me";
import { briefingRoutes } from "./routes/briefing";
import { checkRoutes } from "./routes/check";
import { recipeRoutes } from "./routes/recipes";
import { versionRoutes } from "./routes/version";
import { groupRoutes } from "./routes/groups";
import { invitationRoutes } from "./routes/invitations";
import { adminRoutes } from "./routes/admin";
import { docsRoutes } from "./routes/docs";
import { schemas as schemaRoutes } from "./routes/schemas";
import { traceRoutes } from "./routes/traces";
import { importRoutes } from "./routes/import";
import { mcpRoutes } from "./routes/mcp";
import { uploadsRoutes } from "./routes/uploads";
import { oauthRoutes, oauthWellKnownRoutes } from "./routes/oauth";
import { feedbackRoutes } from "./routes/feedback";
import { startEmbeddingWorker } from "./embedding-worker";
import { isLoopbackOrigin } from "./lib/local-origin";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// CORS — allow the frontend SPA origin and the backend's own origin.
// The SPA calls the backend cross-origin in both dev and prod (no Vite proxy
// in dev — see apps/frontend/vite.config.ts). Authorization must be in
// allowHeaders so the preflight for Bearer-token requests succeeds.
const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5273";
const backendUrl = process.env["BACKEND_URL"] ?? "http://localhost:3101";
const allowedOrigins = new Set([frontendUrl, backendUrl]);
// Loopback origins reflect on any port so local dev survives origin drift
// (Vite auto-bumping 5273→5274, 127.0.0.1 vs localhost, IPv6 loopback) —
// the same rule the MCP router's Origin validation has always used. Safe
// with credentials because auth is header-borne (JWT/API key), never
// cookies: a page on another local origin cannot read this origin's
// localStorage and its requests carry no ambient credentials.
app.use(
  "/*",
  cors({
    origin: (origin) =>
      allowedOrigins.has(origin) || isLoopbackOrigin(origin) ? origin : frontendUrl,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  }),
);

// Security headers — per-request nonce for scripts on the check page.
// Hardened alongside the 2026-06-11 audit fixes:
//  - object-src 'none', base-uri 'self', form-action 'self' close the classic
//    CSP gaps (same-origin plugin embeds, <base>-tag hijack of nonce'd script
//    URLs, form exfiltration). frame-ancestors 'none' is the modern
//    equivalent of X-Frame-Options DENY; both are sent.
//  - Permissions-Policy: nothing in the product uses these sensors.
//  - CSP is set only when a route hasn't already set its own — /uploads/*
//    pins a stricter user-content sandbox policy (see routes/uploads.ts).
app.use("/*", async (c, next) => {
  // Generate a per-request nonce for CSP script-src
  const nonce = crypto.randomUUID();
  c.set("cspNonce" as never, nonce as never);
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "0"); // Disabled per OWASP — CSP is the modern approach
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // HSTS: enforce HTTPS for 1 year (only effective behind TLS termination)
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (!c.res.headers.get("Content-Security-Policy")) {
    // CSP: allow self + inline styles + Google Fonts; nonce-gated scripts for check page copy button
    c.header("Content-Security-Policy", `default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'nonce-${nonce}'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`);
  }
});

// Static files (public assets only — uploads require auth)
app.use("/check-style.css", serveStatic({ path: "./public/check-style.css" }));
app.use("/soupnet.mcpb", serveStatic({ path: "./public/soupnet.mcpb" }));

// Liveness: process is up. Cheap, no I/O.
app.get("/health", (c) => c.json({ ok: true }));

// Readiness: DB is reachable. Point a load balancer / health-check probe at
// this path if the deployment uses a rotating database password — the
// `SELECT 1` lets the probe detect auth drift after rotation and trigger
// task replacement, instead of the first unlucky user request hitting it.
app.get("/health/ready", async (c) => {
  try {
    await getDb().execute(sql`select 1`);
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false }, 503);
  }
});

// Stack introspection (eval-reset contract item (d) + reduced (f)). API-key
// authed — coarse liveness stays public above; the detailed block (git commit,
// ranking version, migration head, embeddings provider/model, presenting key's
// expiry) requires a valid key. Distinct exact path from /health and
// /health/ready, so it mounts as its own sub-router. See routes/version.ts.
app.route("/health/version", versionRoutes);

// Routes
app.route("/auth", authRoutes);
app.route("/keys", keyRoutes);
app.route("/me", meRoutes);
app.route("/briefing", briefingRoutes);
app.route("/check", checkRoutes);
// WT-3: recipe lookup by id (API-key Bearer) — REST twin of MCP get_recipes.
app.route("/recipes", recipeRoutes);
// B1: primary path is /recipe-books. /groups is mounted with a 301 redirect
// alias so existing clients (briefing-link copies, in-flight invitation links,
// any cached frontend bundle still referencing /groups) keep working through
// the rename.
app.route("/recipe-books", groupRoutes);
app.use("/groups/*", async (c) => {
  const target = c.req.path.replace(/^\/groups/, "/recipe-books");
  const search = c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?")) : "";
  return c.redirect(`${target}${search}`, 308);
});
app.use("/groups", async (c) => c.redirect(`/recipe-books${c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?")) : ""}`, 308));
app.route("/invitations", invitationRoutes);
app.route("/admin", adminRoutes);
app.route("/docs", docsRoutes);
// Published wire schemas — public like /docs (shapes, not data).
app.route("/schemas", schemaRoutes);
app.route("/traces", traceRoutes);
// Corpus import — the inverse of GET /auth/me/export (docs/planning/corpus-import.md).
app.route("/import", importRoutes);
app.route("/mcp", mcpRoutes);
app.route("/uploads", uploadsRoutes);
app.route("/feedback", feedbackRoutes);
app.route("/oauth", oauthRoutes);
app.route("/.well-known", oauthWellKnownRoutes);

// Startup
const port = parseInt(process.env["PORT"] ?? "3101", 10);

async function start() {
  // Run migrations
  await runMigrations();

  // Auto-setup dev user if configured
  await autoSetup(getDb());

  // Log the chosen embedding provider so it's obvious which mode is running.
  // Imported lazily so the env var lookup happens after auto-setup, in case
  // the env is mutated by tests at startup.
  const { getEmbeddingProviderId, embeddingModel, embeddingBaseUrl } = await import(
    "./lib/embeddings/provider"
  );
  const providerId = getEmbeddingProviderId();
  console.warn(`[backend] Embedding provider: ${providerId}`);
  if (providerId === "stub") {
    console.warn(
      "[backend] WARNING: stub embeddings are deterministic but not semantically meaningful. " +
        "Set EMBEDDINGS_PROVIDER=gemini for real vectors.",
    );
  } else if (providerId === "local") {
    // Warm the in-process ONNX model so the ~0.5-2s load happens now, not on the
    // first real check. Non-fatal: warmup() already swallows its own errors, but
    // wrap defensively so a boot-time model-load hiccup can never crash startup —
    // the first real embedQuery retries (and degrades to lexical if it truly fails).
    console.warn(`[backend] Local embedding model: ${embeddingModel()}`);
    try {
      const { warmup } = await import("./lib/embeddings/local-client");
      await warmup();
    } catch (err) {
      console.warn("[backend] Local embedding warmup failed (first embed will retry):", err);
    }
  } else if (providerId === "openai-compatible") {
    // Resolve config now so a missing EMBEDDINGS_BASE_URL / EMBEDDINGS_MODEL fails
    // fast at boot with a clear message instead of silently degrading to lexical
    // on every request.
    console.warn(
      `[backend] OpenAI-compatible embedding endpoint: ${embeddingBaseUrl()} (model: ${embeddingModel()})`,
    );
  }

  // Log the synthesis provider too — the premium `synthesize` feature's one
  // LLM call runs through it. Same lazy-import reason as above.
  const { getSynthesisProviderId } = await import("./lib/synthesis/provider");
  const synthesisProviderId = getSynthesisProviderId();
  console.warn(`[backend] Synthesis provider: ${synthesisProviderId}`);
  if (synthesisProviderId === "stub") {
    console.warn(
      "[backend] WARNING: stub synthesis is deterministic but not a real profile. " +
        "Set SYNTHESIS_PROVIDER=gemini for real LLM synthesis.",
    );
  }

  // Boot the embedding worker (pg-boss consumers) in-process.
  // Gated by EMBEDDING_WORKER_ENABLED (default true). See ADR-0020.
  const stopWorker = await startEmbeddingWorker(getDb());

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[backend] Soup.net backend running on http://localhost:${info.port}`); // eslint-disable-line no-console
  });

  // Graceful shutdown: stop pg-boss first (let in-flight jobs finish), then
  // close the HTTP listener. ECS SIGTERM grace window is 30s.
  const shutdown = async () => {
    try {
      await stopWorker();
    } catch (err) {
      console.error("[backend] Error during worker shutdown:", err);
    }
    server.close(() => { process.exit(0); });
    // Hard exit if close hangs past 10s
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => { void shutdown(); });
  process.on("SIGINT", () => { void shutdown(); });
}

start().catch((err) => {
  console.error("[backend] Failed to start:", err);
  process.exit(1);
});
