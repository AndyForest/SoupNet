import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
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
