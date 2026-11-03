/**
 * Vitest global setup: start the fake Google once per run when the backend
 * under test points at it (GOOGLE_OIDC_TEST_ISSUER), so every test file can
 * drive it over HTTP (test-google-issuer.ts). A run without the variable
 * (the dev stack) starts nothing, and the Google suites skip.
 */

import { startFakeGoogleIssuer } from "./test-google-issuer";

export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  const issuer = process.env["GOOGLE_OIDC_TEST_ISSUER"];
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
  if (!issuer || !clientId) return undefined;
  const fake = await startFakeGoogleIssuer({ issuer, clientId, clientSecret: process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ?? "" });
  return () => fake.close();
}
