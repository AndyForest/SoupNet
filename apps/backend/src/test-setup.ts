/**
 * Shared test setup — registers/logins the test user, creates a group, gets a daily API key.
 *
 * Used by integration tests and for manual testing. Idempotent — safe to call repeatedly.
 * Reads TEST_USERNAME and TEST_PASSWORD from environment (loaded via vitest.config.ts).
 *
 * Usage in tests:
 *   import { getTestApiKey, getTestToken } from "../test-setup";
 *   const apiKey = await getTestApiKey();
 *
 * Usage for manual testing:
 *   npx tsx apps/backend/src/test-setup.ts
 *   → prints the API key for copy-paste into the browser
 */

const BASE = process.env["BACKEND_URL"] ?? "http://localhost:3101";
const TEST_EMAIL = process.env["TEST_USERNAME"] ?? "test@test.local";
const TEST_PASSWORD = process.env["TEST_PASSWORD"] ?? "test-password-123";

let cachedToken: string | undefined;
let cachedApiKey: string | undefined;

/**
 * Get a JWT token for the test user. Registers if needed, then logs in.
 */
export async function getTestToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  // Try to register (idempotent — may fail if user exists)
  await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });

  // Login (works whether register succeeded or user already existed)
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });

  const loginBody = (await loginRes.json()) as { data?: { token?: string } };
  const token = loginBody.data?.token;
  if (!token) throw new Error(`Test login failed for ${TEST_EMAIL}`);

  cachedToken = token;
  return token;
}

/**
 * Get a daily API key for the test user. Creates one if needed.
 */
export async function getTestApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;

  const token = await getTestToken();

  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const keyBody = (await keyRes.json()) as { data?: { key?: string } };
  const key = keyBody.data?.key;
  if (!key) throw new Error("Failed to get test API key");

  cachedApiKey = key;
  return key;
}

// When run directly: print the API key for manual testing
const isDirectRun = import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`;
if (isDirectRun) {
  getTestApiKey().then((key) => {
    console.log(`\nTest user: ${TEST_EMAIL}`); // eslint-disable-line no-console
    console.log(`API key: ${key}`); // eslint-disable-line no-console
    console.log(`\nUse in browser: ${BASE}/check?key=${key}`); // eslint-disable-line no-console
    console.log(`Use in curl: curl "${BASE}/check?key=${key}&trace=test&ef=test&format=json"`); // eslint-disable-line no-console
  }).catch((err) => {
    console.error("Test setup failed:", err);
    process.exit(1);
  });
}
