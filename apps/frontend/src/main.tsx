import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.js";
import "./design-system.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
});

// Expose the QueryClient on window in dev so the console can inspect cache
// state: `window.__queryClient.getQueryData(["invitations-pending"])`.
if (import.meta.env.DEV) {
  (globalThis as unknown as { __queryClient: QueryClient }).__queryClient = queryClient;
}

const router = createRouter({ routeTree });

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} position="bottom" buttonPosition="bottom-left" />}
    </QueryClientProvider>
  </React.StrictMode>
);
