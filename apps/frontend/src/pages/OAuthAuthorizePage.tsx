import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { authFetch, isLoggedIn, API_BASE } from "../auth.js";

/**
 * OAuth 2.1 consent screen. Lands here when an OAuth client (claude.ai's
 * "Add custom connector" flow + future directory consumers) sends the user
 * to authorization_endpoint with the standard query params.
 *
 * Flow:
 *   1. Parse query params (response_type, client_id, redirect_uri, state,
 *      code_challenge, code_challenge_method, scope).
 *   2. If not logged in, render a "sign in to continue" prompt that preserves
 *      the full URL so we land back here after auth (existing login form
 *      handles ?next=... — see LoginPage). For simplicity we just send the
 *      user to /auth/login; they can come back here from claude.ai's
 *      redirect after signing in (claude.ai retries the flow on failure).
 *   3. Fetch /oauth/client-info to show the client name, and /recipe-books
 *      to populate the scope picker.
 *   4. User picks read/write recipe books + default-write, clicks Authorize.
 *   5. POST /oauth/authorize/grant with the form + OAuth params; the response
 *      contains the redirect URL with code + state baked in. Navigate to it
 *      via window.location (full-page redirect — we're leaving Soup.net).
 *
 * Cancel: navigate to the redirect_uri with ?error=access_denied&state=... so
 * the client (claude.ai) sees the rejection rather than hanging.
 */

interface ClientInfo {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
}

interface RecipeBook {
  id: string;
  name: string;
  description: string | null;
  slug: string;
}

interface GrantResponse {
  redirect_url?: string;
  error?: string;
  error_description?: string;
}

interface OAuthParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
}

function parseOAuthParams(): OAuthParams {
  const qs = new URLSearchParams(window.location.search);
  return {
    responseType: qs.get("response_type") ?? "",
    clientId: qs.get("client_id") ?? "",
    redirectUri: qs.get("redirect_uri") ?? "",
    state: qs.get("state") ?? "",
    codeChallenge: qs.get("code_challenge") ?? "",
    codeChallengeMethod: qs.get("code_challenge_method") ?? "",
    scope: qs.get("scope") ?? "",
  };
}

function validateOAuthParams(p: OAuthParams): string | null {
  if (p.responseType !== "code") return "Unsupported response_type — only 'code' is accepted.";
  if (!p.clientId) return "Missing client_id.";
  if (!p.redirectUri) return "Missing redirect_uri.";
  if (!p.codeChallenge) return "Missing code_challenge — this client did not initiate a PKCE flow.";
  if (p.codeChallengeMethod !== "S256") return "Unsupported code_challenge_method — only 'S256' is accepted.";
  return null;
}

export function OAuthAuthorizePage() {
  const [params] = useState(parseOAuthParams);
  const paramError = validateOAuthParams(params);

  const [readIds, setReadIds] = useState<string[]>([]);
  const [writeIds, setWriteIds] = useState<string[]>([]);
  const [defaultWriteId, setDefaultWriteId] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // If not logged in, send the user to login. Preserve the full URL via the
  // browser's referer / by stashing it in sessionStorage so a "sign in then
  // return here" flow is possible. For the minimum viable version, we just
  // store the path+search in sessionStorage and instruct the user to retry
  // from claude.ai after signing in.
  useEffect(() => {
    if (!isLoggedIn() && !paramError) {
      sessionStorage.setItem("oauth_return_to", window.location.pathname + window.location.search);
    }
  }, [paramError]);

  const clientQuery = useQuery({
    queryKey: ["oauth-client-info", params.clientId],
    enabled: !paramError && !!params.clientId,
    queryFn: async (): Promise<ClientInfo> => {
      const res = await fetch(`${API_BASE}/oauth/client-info?client_id=${encodeURIComponent(params.clientId)}`);
      if (!res.ok) throw new Error(`Failed to load client info (${res.status})`);
      return (await res.json()) as ClientInfo;
    },
  });

  const booksQuery = useQuery({
    queryKey: ["oauth-recipe-books"],
    enabled: isLoggedIn() && !paramError,
    queryFn: async (): Promise<RecipeBook[]> => {
      const res = await authFetch("/recipe-books");
      if (!res.ok) throw new Error(`Failed to load recipe books (${res.status})`);
      const body = (await res.json()) as { data: RecipeBook[] };
      return body.data;
    },
  });

  const grantMutation = useMutation({
    mutationFn: async (): Promise<GrantResponse> => {
      const res = await authFetch("/oauth/authorize/grant", {
        method: "POST",
        body: JSON.stringify({
          response_type: params.responseType,
          client_id: params.clientId,
          redirect_uri: params.redirectUri,
          state: params.state,
          code_challenge: params.codeChallenge,
          code_challenge_method: params.codeChallengeMethod,
          scope_read_group_ids: readIds,
          scope_write_group_ids: writeIds,
          scope_default_write_group_id: defaultWriteId,
        }),
      });
      const body = (await res.json()) as GrantResponse;
      if (!res.ok) {
        throw new Error(body.error_description ?? body.error ?? `request failed (${res.status})`);
      }
      return body;
    },
    onSuccess: (data) => {
      if (data.redirect_url) {
        window.location.href = data.redirect_url;
      } else {
        setSubmitError("No redirect URL returned by server.");
      }
    },
    onError: (err: Error) => {
      setSubmitError(err.message);
    },
  });

  function handleCancel() {
    // Send the user back to the client with access_denied per RFC 6749 §4.1.2.1.
    try {
      const url = new URL(params.redirectUri);
      url.searchParams.set("error", "access_denied");
      if (params.state) url.searchParams.set("state", params.state);
      window.location.href = url.toString();
    } catch {
      // If redirect_uri is malformed there's nowhere to send the user — just
      // navigate home. The server-side validation would have caught this too.
      window.location.href = "/";
    }
  }

  function toggleRead(id: string) {
    setReadIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    // Write scope must be a subset of read scope.
    setWriteIds((prev) => prev.filter((x) => x === id || readIds.includes(x)));
  }

  function toggleWrite(id: string) {
    setWriteIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      // If write gets added, read must include it too.
      if (next.includes(id) && !readIds.includes(id)) {
        setReadIds((r) => [...r, id]);
      }
      return next;
    });
    if (defaultWriteId === id && writeIds.includes(id)) {
      // Removing default-write — reset it.
      setDefaultWriteId("");
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (paramError) {
    return (
      <div style={containerStyle}>
        <h1 style={h1Style}>Invalid OAuth request</h1>
        <p>{paramError}</p>
        <p style={{ marginTop: "var(--space-lg)" }}>
          <Link to="/">← Back to soup.net</Link>
        </p>
      </div>
    );
  }

  if (!isLoggedIn()) {
    return (
      <div style={containerStyle}>
        <h1 style={h1Style}>Sign in to authorize</h1>
        <p>
          You need a Soup.net account to authorize this connector.
        </p>
        <p>
          <Link to="/auth/login">Sign in →</Link> · <Link to="/auth/register">Create account →</Link>
        </p>
        <p style={{ marginTop: "var(--space-xl)", color: "var(--color-on-surface-variant)" }}>
          After signing in, return to claude.ai and retry the connector setup — claude.ai will send you back here.
        </p>
      </div>
    );
  }

  if (clientQuery.isLoading || booksQuery.isLoading) {
    return <div style={containerStyle}>Loading…</div>;
  }

  if (clientQuery.error) {
    return (
      <div style={containerStyle}>
        <h1 style={h1Style}>Unknown client</h1>
        <p>This OAuth client is not registered with Soup.net.</p>
      </div>
    );
  }

  const client = clientQuery.data;
  const books = booksQuery.data ?? [];

  const canSubmit =
    readIds.length > 0 &&
    writeIds.length > 0 &&
    !!defaultWriteId &&
    writeIds.includes(defaultWriteId);

  return (
    <div style={containerStyle}>
      <h1 style={h1Style}>
        Authorize <span style={{ color: "var(--color-primary)" }}>{client?.client_name ?? client?.client_id}</span>
      </h1>
      <p>
        This will let <strong>{client?.client_name ?? client?.client_id}</strong> recipe-check the books you choose below — searching them
        for context and logging new recipes when you make a call.
      </p>

      <h2 style={h2Style}>Choose recipe books</h2>
      <p style={{ color: "var(--color-on-surface-variant)" }}>
        Pick which recipe books the connector can read from, which it can write to, and which it should default to for new recipes.
      </p>

      {books.length === 0 ? (
        <p>You don't have any recipe books yet. <Link to="/app/recipe-books">Create one</Link> first, then return here.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Recipe book</th>
              <th style={thStyle}>Read</th>
              <th style={thStyle}>Write</th>
              <th style={thStyle}>Default write</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.id}>
                <td style={tdStyle}>
                  <strong>{b.name}</strong>
                  {b.description ? <div style={{ color: "var(--color-on-surface-variant)", fontSize: "0.85em" }}>{b.description}</div> : null}
                </td>
                <td style={tdCenterStyle}>
                  <input
                    type="checkbox"
                    checked={readIds.includes(b.id)}
                    onChange={() => toggleRead(b.id)}
                    aria-label={`Read access to ${b.name}`}
                  />
                </td>
                <td style={tdCenterStyle}>
                  <input
                    type="checkbox"
                    checked={writeIds.includes(b.id)}
                    onChange={() => toggleWrite(b.id)}
                    aria-label={`Write access to ${b.name}`}
                  />
                </td>
                <td style={tdCenterStyle}>
                  <input
                    type="radio"
                    name="default-write"
                    checked={defaultWriteId === b.id}
                    disabled={!writeIds.includes(b.id)}
                    onChange={() => setDefaultWriteId(b.id)}
                    aria-label={`Default write to ${b.name}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {submitError ? (
        <p style={{ color: "var(--color-error, #c0392b)" }}>{submitError}</p>
      ) : null}

      <div style={{ marginTop: "var(--space-xl)", display: "flex", gap: "var(--space-md)" }}>
        <button
          type="button"
          onClick={() => grantMutation.mutate()}
          disabled={!canSubmit || grantMutation.isPending}
          style={primaryButtonStyle}
        >
          {grantMutation.isPending ? "Authorizing…" : "Authorize"}
        </button>
        <button type="button" onClick={handleCancel} style={secondaryButtonStyle}>
          Cancel
        </button>
      </div>

      <p style={{ marginTop: "var(--space-xl)", fontSize: "0.85em", color: "var(--color-on-surface-variant)" }}>
        You can revoke this access at any time from your <Link to="/app/keys">Keys</Link> page.
      </p>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "var(--space-2xl) var(--space-xl)",
  lineHeight: 1.65,
  color: "var(--color-on-surface)",
};
const h1Style: React.CSSProperties = { fontSize: "1.75rem", marginBottom: "var(--space-md)" };
const h2Style: React.CSSProperties = { fontSize: "1.15rem", marginTop: "var(--space-xl)", marginBottom: "var(--space-sm)" };
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", marginTop: "var(--space-md)" };
const thStyle: React.CSSProperties = { textAlign: "left", padding: "var(--space-sm)", borderBottom: "1px solid var(--color-outline-variant, #e0e0e0)", fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: "var(--space-sm)", borderBottom: "1px solid var(--color-outline-variant, #f0f0f0)" };
const tdCenterStyle: React.CSSProperties = { ...tdStyle, textAlign: "center" };
const primaryButtonStyle: React.CSSProperties = {
  background: "var(--color-primary)",
  color: "var(--color-on-primary, white)",
  border: "none",
  padding: "var(--space-sm) var(--space-lg)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontSize: "1rem",
};
const secondaryButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--color-on-surface)",
  border: "1px solid var(--color-outline, #ccc)",
  padding: "var(--space-sm) var(--space-lg)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontSize: "1rem",
};
