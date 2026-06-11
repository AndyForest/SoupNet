import { useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { setToken, setEmailVerified } from "../auth.js";
import soupnetLogo from "../assets/soupnet-logo.png";

interface AuthResponse {
  ok: boolean;
  data?: {
    // /auth/login carries token + user. /auth/register (post-F30) carries
    // only a generic message so the response is byte-identical for new and
    // existing emails.
    user?: { id: string; email: string; role: string };
    token?: string;
    emailVerified?: boolean;
    message?: string;
  };
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

  // With an invite token, check whether the invitee can register right now.
  // An invitation reserves a place at the TOP of the waitlist — it doesn't
  // bypass it. canRegister=false means the cap is genuinely full and their
  // reservation is first in line when it rises.
  const inviteStatusQuery = useQuery({
    queryKey: ["invite-status", inviteToken],
    enabled: Boolean(inviteToken),
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/auth/invite-status?token=${encodeURIComponent(inviteToken ?? "")}`,
      );
      const json = (await res.json()) as {
        ok: boolean;
        data?: { valid: boolean; canRegister: boolean };
      };
      // Fail open to a register attempt if the endpoint errors — worst case
      // the backend declines with its generic response.
      return json.ok && json.data ? json.data : { valid: true, canRegister: true };
    },
    staleTime: 1000 * 60, // cache 1 min
  });

  const inviteInvalid = Boolean(inviteToken) && inviteStatusQuery.data?.valid === false;
  const inviteWaitlisted =
    Boolean(inviteToken) &&
    inviteStatusQuery.data?.valid === true &&
    inviteStatusQuery.data.canRegister === false;

  // Show waitlist proactively when signups are closed and the user tries to
  // register without a usable invitation (an invalid/expired invite behaves
  // like no invite).
  const signupsClosed =
    signupStatusQuery.data === false && (!inviteToken || inviteInvalid);

  const waitlistMutation = useMutation({
    mutationFn: async (body: { email: string; reason?: string }) => {
      const res = await fetch(`${API_BASE}/auth/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Couldn't join the waitlist — please try again.");
      }
      return json;
    },
    onSuccess: () => setWaitlistSubmitted(true),
  });

  function handleWaitlistSubmit(e: React.FormEvent) {
    e.preventDefault();
    const targetEmail = (waitlistEmail || email).toLowerCase().trim();
    const reason = waitlistReason.trim();
    waitlistMutation.mutate(reason ? { email: targetEmail, reason } : { email: targetEmail });
  }

  const mutation = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      isRegister
        ? registerRequest({ ...body, inviteToken: inviteToken ?? undefined, tosAccepted: true })
        : loginRequest(body),
    onSuccess: (data) => {
      if (data.ok && data.data) {
        if (isRegister) {
          // F30 (security-audit-2026-04-09): /auth/register responds with a
          // generic message and no JWT, regardless of whether the email was
          // new or already registered. Show the "check your email" page in
          // both cases — the user clicks the verification link and then
          // signs in normally. The signupStatusQuery / proactive waitlist
          // path above handles cap-reached without ever submitting register.
          setShowVerification(true);
          return;
        }
        // Login path — token + user always present on success.
        if (!data.data.token) {
          setError("Login response missing token");
          return;
        }
        // Clear React Query cache BEFORE setting the new token. With
        // `staleTime: 60s` (see main.tsx), a prior user's cached per-user
        // data (e.g. `["invitations-pending"]`) would otherwise be served
        // on the next page render without a refetch, making it look like
        // the new user is missing their data. Pair with the logout-side
        // `queryClient.clear()` in AppShell so every auth transition is
        // clean — whether via logout-then-login or direct account switch.
        queryClient.clear();
        setToken(data.data.token);
        setEmailVerified(data.data.emailVerified ?? false);
        if (data.data.emailVerified === false) {
          // Login succeeded but email isn't verified yet — bounce to the
          // verify-pending page where the only available actions are
          // resend-email and sign-out.
          void navigate({ to: "/auth/verify-pending" });
        } else {
          void navigate({ to: "/app/dashboard" });
        }
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
          {inviteToken && !inviteInvalid && !inviteWaitlisted && (
            <p style={{
              color: "var(--color-success)",
              fontSize: "0.85rem",
              marginTop: "var(--space-sm)",
            }}>
              You've been invited! Create an account to join.
            </p>
          )}
          {inviteInvalid && (
            <p style={{
              color: "var(--color-error)",
              fontSize: "0.85rem",
              marginTop: "var(--space-sm)",
            }}>
              This invitation link is invalid or has expired. Ask your inviter
              for a fresh one.
            </p>
          )}
        </div>

        {/* Invited while the cap is full: their reservation is at the top of
            the waitlist — no form needed, the invitation IS their place. */}
        {isRegister && inviteWaitlisted ? (
          <>
            <p style={{ color: "var(--color-success)", fontWeight: 600, marginBottom: "var(--space-md)", textAlign: "center" }}>
              You're invited — and at the top of the waitlist.
            </p>
            <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)", lineHeight: 1.5, fontSize: "0.9rem", textAlign: "center" }}>
              Soup.net is at capacity right now. Your invitation holds your
              place at the front of the line — try this same link again soon.
            </p>
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
        ) : null}

        {/* Show waitlist proactively when signups are closed and user is trying to register */}
        {isRegister && inviteWaitlisted ? null : isRegister && signupsClosed ? (
          <>
            {waitlistSubmitted ? (
              <div style={{ textAlign: "center" }}>
                <p style={{ color: "var(--color-success)", fontWeight: 600, marginBottom: "var(--space-md)" }}>
                  You're on the list!
                </p>
                <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)", lineHeight: 1.5, fontSize: "0.9rem" }}>
                  We'll let you know when a spot opens up. If someone already on Soup.net
                  invites you, their invitation puts you at the top of the waitlist.
                </p>
              </div>
            ) : (
              <>
                <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)", lineHeight: 1.5, fontSize: "0.9rem", textAlign: "center" }}>
                  We're limiting signups to ensure quality for early users. Join the
                  waitlist and we'll notify you — or ask someone already on Soup.net
                  to invite you. An invitation puts you at the top of the waitlist.
                </p>
                <form onSubmit={handleWaitlistSubmit}>
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
                  {waitlistMutation.isError && (
                    <p style={{
                      color: "var(--color-error)",
                      fontSize: "0.875rem",
                      marginBottom: "var(--space-md)",
                    }}>
                      {waitlistMutation.error instanceof Error
                        ? waitlistMutation.error.message
                        : "Couldn't join the waitlist — please try again."}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={waitlistMutation.isPending}
                    style={{ width: "100%", justifyContent: "center", marginBottom: "var(--space-md)" }}
                  >
                    {waitlistMutation.isPending ? "Please wait..." : "Join Waitlist"}
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
