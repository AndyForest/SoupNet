/**
 * Custom Orval mutator — wraps fetch with cookie credentials for Payload session auth.
 *
 * All API calls from the frontend include cookies automatically.
 * For agent/MCP access, the MCP server uses Bearer token auth separately.
 *
 * Orval passes (url, options) where url is already resolved against VITE_API_URL.
 */

const API_BASE = import.meta.env["VITE_API_URL"] ?? "http://localhost:3101";

export const authFetch = async <T>(
  url: string,
  options: RequestInit & { params?: Record<string, string | number | boolean | undefined> }
): Promise<T> => {
  const { params, ...fetchOptions } = options;

  // Append query params if present (Orval passes them in options.params)
  let fullUrl = `${API_BASE}${url}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value));
      }
    }
    const qs = searchParams.toString();
    if (qs) fullUrl += `?${qs}`;
  }

  const response = await fetch(fullUrl, {
    ...fetchOptions,
    credentials: "include", // include Payload session cookie
    headers: {
      "Content-Type": "application/json",
      ...fetchOptions.headers,
    },
  });

  if (!response.ok) {
    // Attempt to parse error body; fall back to status text
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = { message: response.statusText };
    }
    throw Object.assign(
      new Error(`API error ${response.status}: ${response.statusText}`),
      { status: response.status, body: errorBody }
    );
  }

  // 204 No Content — return empty
  if (response.status === 204) return undefined as unknown as T;

  return response.json() as Promise<T>;
};
