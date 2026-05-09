import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No dev proxy. The frontend calls the backend directly at the URL set by
// VITE_API_BASE (defaulting to http://localhost:3001 in dev — see auth.ts).
// Backend CORS allows the frontend origin (FRONTEND_URL env on the backend,
// http://localhost:5173 by default). A proxy was used earlier to avoid CORS
// during dev but required a hand-maintained list of backend route prefixes
// that silently fell back to the SPA index.html on misses — adding a backend
// route and forgetting the proxy entry returned HTML parsed as JSON with no
// error surface. Matching prod's cross-origin model removes the list entirely.

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
