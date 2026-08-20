import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// envDir points at the SoupNet repo root so a single .env at the top of the
// monorepo configures both backend (BACKEND_URL, PORT, …) and frontend
// (FRONTEND_PORT, VITE_API_BASE). VITE_*-prefixed vars are exposed to client
// code via import.meta.env automatically; non-VITE vars stay server-side.
//
// No dev proxy. The frontend calls the backend directly at the URL set by
// VITE_API_BASE (defaulting to http://localhost:3101 in dev — see auth.ts).
// Backend CORS allows the frontend origin (FRONTEND_URL env on the backend,
// http://localhost:5273 by default). A proxy was tried and removed 2026-04-19
// because the hand-maintained route-prefix list silently fell back to the SPA
// index.html on misses; matching prod's cross-origin model removes that risk.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Machine-readable ".md twins" (2026-08-19): the SPA is client-rendered, so
// an AI agent fetching a page gets only the HTML shell. Every page whose
// prose is ?raw-imported markdown gets its SOURCE file served at the same
// route + ".md" — DRY by construction (the twin IS the source), one rule to
// teach ("append .md"), indexed at /llms.txt. A page gains a twin by getting
// a markdown source and a row here; component-built pages (landing,
// how-it-works) have no twin until their prose moves to markdown.
const MD_TWINS: Record<string, string> = {
  "info/connect.md": "docs/connectors/index.md",
  "info/privacy.md": "docs/legal/privacy-policy.md",
  "info/terms.md": "docs/legal/terms-of-service.md",
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ROOT, "");
  // Social preview meta tags (og:url, og:image) need an absolute URL baked
  // into the static index.html — crawlers don't run JS. Sourced from
  // FRONTEND_URL (process.env wins so CI can set it without a .env file),
  // defaulting to the canonical deployment.
  const siteUrl = (process.env.FRONTEND_URL ?? env.FRONTEND_URL ?? "https://soup.net").replace(/\/$/, "");
  return {
    plugins: [
      react(),
      {
        name: "inject-site-url",
        transformIndexHtml(html: string) {
          return html.replaceAll("%SITE_URL%", siteUrl);
        },
      },
      {
        name: "md-twins",
        // Build: emit each source file into dist at its twin path.
        generateBundle() {
          for (const [fileName, source] of Object.entries(MD_TWINS)) {
            this.emitFile({
              type: "asset",
              fileName,
              source: fs.readFileSync(path.resolve(ROOT, source), "utf8"),
            });
          }
        },
        // Dev: serve the same twins so the behavior is testable locally.
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const twin = MD_TWINS[(req.url ?? "").replace(/^\//, "").split("?")[0] ?? ""];
            if (!twin) return next();
            res.setHeader("Content-Type", "text/markdown; charset=utf-8");
            res.end(fs.readFileSync(path.resolve(ROOT, twin), "utf8"));
          });
        },
      },
    ],
    envDir: ROOT,
    server: {
      port: parseInt(env.FRONTEND_PORT ?? "5273", 10),
    },
    build: {
      outDir: "dist",
      // F8 (security-audit-2026-04-09): sourcemaps off in production. They
      // give attackers a clean view of internal logic and call paths in the
      // OSS-published frontend. Local dev still gets `dev` mode source maps
      // automatically (Vite default) — this only affects `vite build`.
      sourcemap: mode !== "production" ? true : false,
    },
  };
});
