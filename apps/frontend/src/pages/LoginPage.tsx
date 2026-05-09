import { useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { setToken, setEmailVerified } from "../auth.js";
import soupnetLogo from "../assets/soupnet-logo.png";

interface AuthResponse {
  ok: boolean;
  data?: { user: { id: string; email: string; role: string }; token: string; emailVerified?: boolean };
  error?: string;
  message?: string;
}

import { API_BASE } from "../auth.js";

async function loginRequest(body: { email: string; password: string }): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<AuthResponse>;
}

async function registerRequest(body: {
  email: string;
  password: string;
  inviteToken?: string | undefined;
  tosAccepted: boolean;
}): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<AuthResponse>;
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showVerification, setShowVerification] = useState(false);
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistReason, setWaitlistReason] = useState("");
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);

  // Check for invite token in URL
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get("invite");
  if (inviteToken && !isRegister) {
    // Auto-switch to register mode if we have an invite token
    setIsRegister(true);
  }

  // Pre-check whether signups are open (public endpoint, no auth)
  const signupStatusQuery = useQuery({
    queryKey: ["signup-status"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/auth/signup-status`);
      const json = (await res.json()) as { ok: boolean; data: { signupsOpen: boolean } };
      return json.ok ? json.data.signupsOpen : true; // default open if endpoint fails
    },
    staleTime: 1000 * 60 * 5, // cache 5 min
  });

  // Show waitlist proactively when signups are closed and user tries to register
  // (unless they have an invite token, which bypasses the cap)
  const signupsClosed = signupStatusQuery.data === false && !inviteToken;

  const mutation = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      isRegister
        ? registerRequest({ ...body, inviteToken: inviteToken ?? undefined, tosAccepted: true })
        : loginRequest(body),
    onSuccess: (data) => {
      if (data.ok && data.data) {
        // Clear React Query cache BEFORE setting the new token. With
        // `staleTime: 60s` (see main.tsx), a prior user's cached per-user
        // data (e.g. `["invitations-pending"]`) would otherwise be served
        // on the next page render without a refetch, making it look like
        // the new user is missing their data. Pair with the logout-side
        // `queryClient.clear()` in AppShell so every auth transition is
        // clean — whether via logout-then-login or direct account switch.
        queryClient.clear();
        setToken(data.data.token);
        // Cache the verified state so the routing guard can redirect sync.
        // Registration always yields an unverified user; login responses
        // include the actual flag.
        setEmailVerified(isRegister ? false : (data.data.emailVerified ?? false));
        if (isRegister) {
          // Show verification message after registration
          setShowVerification(true);
        } else if (data.data.emailVerified === false) {
          // Login succeeded but email isn't verified yet — bounce to the
          // verify-pending page where the only available actions are
          // resend-email and sign-out.
          void navigate({ to: "/auth/verify-pending" });
        } else {
          void navigate({ to: "/app/dashboard" });
        }
      } else if (data.error === "waitlist") {
        setShowWaitlist(true);
      } else {
        setError(data.error ?? "Authentication failed");
      }
    },
    onError: () => {
      setError("Network error — is the backend running?");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isRegister && !tosAccepted) {
      setError("You must accept the Terms of Service and Privacy Policy.");
      return;
    }
    mutation.mutate({ email, password });
  }

  // Verification sent screen
  if (showVerification) {
    return (
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "var(--color-surface)",
      }}>
        <div style={{
          width: "100%",
          maxWidth: 400,
          background: "var(--color-surface-container-lowest)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-2xl) var(--space-xl)",
          textAlign: "center",
        }}>
          <h1 style={{ color: "var(--color-primary)", fontSize: "1.5rem", marginBottom: "var(--space-md)" }}>
            Check your email
          </h1>
          <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)" }}>
            We sent a verification link to <strong>{email}</strong>. Click it to activate your account.
          </p>
          <button
            className="btn-secondary"
            onClick={() => {
              setShowVerification(false);
              setIsRegister(false);
            }}
            style={{ width: "100%", justifyContent: "center" }}
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  // Waitlist screen
  if (showWaitlist) {
    return (
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "var(--color-surface)",
      }}>
        <div style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--color-surface-container-lowest)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-2xl) var(--space-xl)",
        }}>
          <h1 style={{ color: "var(--color-primary)", fontSize: "1.5rem", marginBottom: "var(--space-md)", textAlign: "center" }}>
            {waitlistSubmitted ? "You're on the list" : "Soup.net is at capacity"}
          </h1>

          {waitlistSubmitted ? (
            <div style={{ textAlign: "center" }}>
              <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)", lineHeight: 1.5 }}>
                We'll let you know when a spot opens up. In the meantime, if someone already
                on Soup.net invites you, that bypasses the waitlist.
              </p>
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowWaitlist(false);
                  setIsRegister(false);
                  setWaitlistSubmitted(false);
                }}
                style={{ width: "100%", justifyContent: "center" }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)", lineHeight: 1.5, textAlign: "center" }}>
                We're limiting signups to ensure quality for early users. Join the
                waitlist and we'll notify you when a spot opens — or ask someone already
                on Soup.net to invite you.
              </p>
              <form onSubmit={(e) => {
                e.preventDefault();
                // TODO: Wire up to POST /waitlist endpoint when backend is ready
                setWaitlistSubmitted(true);
              }}>
                <div style={{ marginBottom: "var(--space-md)" }}>
                  <label htmlFor="waitlist-email">Email</label>
                  <input
                    id="waitlist-email"
                    type="email"
                    required
                    value={waitlistEmail || email}
                    onChange={(e) => setWaitlistEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div style={{ marginBottom: "var(--space-md)" }}>
                  <label htmlFor="waitlist-reason">What would you use Soup.net for? (optional)</label>
                  <textarea
                    id="waitlist-reason"
                    rows={3}
                    value={waitlistReason}
                    onChange={(e) => setWaitlistReason(e.target.value)}
                    placeholder="Tell us about your use case — developers, designers, teams, personal projects..."
                    style={{ resize: "vertical", fontSize: "0.875rem" }}
                  />
                </div>
                <button
                  type="submit"
                  style={{ width: "100%", justifyContent: "center", marginBottom: "var(--space-md)" }}
                >
                  Join Waitlist
                </button>
              </form>
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowWaitlist(false);
                  setIsRegister(false);
                }}
                style={{ width: "100%", justifyContent: "center" }}
              >
                Back to sign in
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "100vh",
      background: "var(--color-surface)",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 400,
        background: "var(--color-surface-container-lowest)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-2xl) var(--space-xl)",
      }}>
        <div style={{ textAlign: "center", marginBottom: "var(--space-2xl)" }}>
          <h1 style={{
            margin: 0,
            marginBottom: "var(--space-xs)",
            display: "flex",
            justifyContent: "center",
          }}>
            <img
              src={soupnetLogo}
              alt="Soup.net"
              style={{ width: 220, height: "auto", display: "block" }}
            />
          </h1>
          <p style={{
            color: "var(--color-on-surface-variant)",
            fontSize: "0.9rem",
          }}>
            Taste and judgment for AI agents
          </p>
          {inviteToken && (
            <p style={{
              color: "var(--color-success)",
              fontSize: "0.85rem",
              marginTop: "var(--space-sm)",
            }}>
              You've been invited! Create an account to join.
            </p>
          )}
        </div>

        {/* Show waitlist proactively when signups are closed and user is trying to register */}
        {isRegister && signupsClosed ? (
          <>
            {waitlistSubmitted ? (
              <div style={{ textAlign: "center" }}>
                <p style={{ color: "var(--color-success)", fontWeight: 600, marginBottom: "var(--space-md)" }}>
                  You're on the list!
                </p>
                <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)", lineHeight: 1.5, fontSize: "0.9rem" }}>
                  We'll let you know when a spot opens up. If someone already on Soup.net
                  invites you, that bypasses the waitlist.
                </p>
              </div>
            ) : (
              <>
                <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)", lineHeight: 1.5, fontSize: "0.9rem", textAlign: "center" }}>
                  We're limiting signups to ensure quality for early users. Join the
                  waitlist and we'll notify you — or ask someone already on Soup.net
                  to invite you.
                </p>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  // TODO: Wire up to POST /waitlist endpoint when backend is ready
                  setWaitlistSubmitted(true);
                }}>
                  <div style={{ marginBottom: "var(--space-md)" }}>
                    <label htmlFor="waitlist-email">Email</label>
                    <input
                      id="waitlist-email"
                      type="email"
                      required
                      value={waitlistEmail || email}
                      onChange={(e) => setWaitlistEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </div>
                  <div style={{ marginBottom: "var(--space-md)" }}>
                    <label htmlFor="waitlist-reason">What would you use Soup.net for? (optional)</label>
                    <textarea
                      id="waitlist-reason"
                      rows={3}
                      value={waitlistReason}
                      onChange={(e) => setWaitlistReason(e.target.value)}
                      placeholder="Tell us about your use case..."
                      style={{ resize: "vertical", fontSize: "0.875rem" }}
                    />
                  </div>
                  <button
                    type="submit"
                    style={{ width: "100%", justifyContent: "center", marginBottom: "var(--space-md)" }}
                  >
                    Join Waitlist
                  </button>
                </form>
              </>
            )}
            <p style={{
              textAlign: "center",
              fontSize: "0.875rem",
              color: "var(--color-on-surface-variant)",
            }}>
              Already have an account?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setIsRegister(false);
                  setError(null);
                }}
              >
                Sign in
              </a>
            </p>
          </>
        ) : (
          <>
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: "var(--space-md)" }}>
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  placeholder="you@example.com"
                />
              </div>

              <div style={{ marginBottom: "var(--space-md)" }}>
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>

              {isRegister && (
                <div style={{
                  marginBottom: "var(--space-md)",
                  display: "flex",
                  flexDirection: "row",
                  gap: "var(--space-sm)",
                  alignItems: "flex-start",
                  width: "100%",
                }}>
                  <input
                    id="tos"
                    type="checkbox"
                    checked={tosAccepted}
                    onChange={(e) => setTosAccepted(e.target.checked)}
                    required
                    // Override design-system.css `input { width: 100% }`
                    // — that rule is for text inputs, not checkboxes.
                    style={{
                      marginTop: "0.2em",
                      flexShrink: 0,
                      width: "auto",
                      minWidth: 0,
                    }}
                  />
                  <label htmlFor="tos" style={{
                    // Override design-system.css `label { display: block }`
                    // so flex can give it the remaining space instead of
                    // letting it stack as its own block-level row.
                    display: "block",
                    flex: 1,
                    fontSize: "0.85rem",
                    fontFamily: "inherit",
                    fontWeight: "normal",
                    color: "var(--color-on-surface-variant)",
                    lineHeight: 1.5,
                    margin: 0,
                  }}>
                    I agree to the{" "}
                    <Link to="/info/terms" target="_blank">Terms of Service</Link>
                    {" "}and{" "}
                    <Link to="/info/privacy" target="_blank">Privacy Policy</Link>.
                  </label>
                </div>
              )}

              {error && (
                <p style={{
                  color: "var(--color-error)",
                  fontSize: "0.875rem",
                  marginBottom: "var(--space-md)",
                }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={mutation.isPending || (isRegister && !tosAccepted)}
                style={{ width: "100%", justifyContent: "center", marginBottom: "var(--space-md)" }}
              >
                {mutation.isPending
                  ? "Please wait..."
                  : isRegister
                    ? "Create Account"
                    : "Sign In"}
              </button>
            </form>

            {!isRegister && (
              <p style={{
                textAlign: "center",
                fontSize: "0.875rem",
                marginBottom: "var(--space-sm)",
              }}>
                <Link to="/auth/forgot-password">Forgot password?</Link>
              </p>
            )}

            <p style={{
              textAlign: "center",
              fontSize: "0.875rem",
              color: "var(--color-on-surface-variant)",
            }}>
              {isRegister ? "Already have an account?" : "No account yet?"}{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setIsRegister(!isRegister);
                  setError(null);
                }}
              >
                {isRegister ? "Sign in" : "Register"}
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
