import { defineConfig } from "orval";

export default defineConfig({
  claimnet: {
    input: {
      // Committed snapshot of the backend's OpenAPI spec.
      // Regenerate with: npm run generate:api-client (root)
      target: "./openapi.json",
    },
    output: {
      mode: "single",
      target: "./src/generated/claimnet.ts",
      packageJson: "./package.json",
      client: "react-query",
      httpClient: "fetch",
      override: {
        // Custom fetch wrapper with cookie credentials for Payload session auth.
        mutator: {
          path: "./src/mutator/auth-fetch.ts",
          name: "authFetch",
        },
        query: {
          useQuery: true,
          useMutation: true,
          // React Query v5
          version: 5,
        },
      },
      prettier: true,
    },
  },
  // MSW mock handlers: disabled pending @orval/msw integration fix.
  // TODO: Re-enable once MSW custom generator API is confirmed for orval v7.
  // See backlog.md for details.
  // "claimnet-msw": { ... }
});
