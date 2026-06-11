import { useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { setToken, setEmailVerified } from "../auth.js";
import soupnetLogo from "../assets/soupnet-logo.png";

interface AuthResponse {
  ok: boolean;
  data?: {
    // /auth/login carries token + user. /auth/register carries a message +
    // waitlisted flag; bodies are identical for new and existing emails
    // within a branch (F30) — `waitlisted` derives from public cap state,
    // never from the email.
    user?: { id: string; email: string; role: string };
    token?: string;
    emailVerified?: boolean;
    message?: string;
    waitlisted?: boolean;
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
  reason?: string | undefined;
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
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Informational status (e.g. "you're on the waitlist") — correct-password
  // outcomes that aren't failures, styled as info rather than error-red.
  const [notice, setNotice] = useState<string | null>(null);
  // Post-register screen: "verify" (active account, check your email) or
  // "waitlisted" (account created on the waitlist).
  const [postSubmit, setPostSubmit] = useState<"verify" | "waitlisted" | null>(null);

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

  // With an invite token, check whether the invitee registers actively. An
  // invitation reserves a place at the TOP of the waitlist — it doesn't
  // bypass it. canRegister=false means the cap is genuinely full and
  // registering will land them on the waitlist with their invite's priority.
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
      // Fail open to a register attempt if the endpoint errors.
      return json.ok && json.data ? json.data : { valid: true, canRegister: true };
    },
    staleTime: 1000 * 60, // cache 1 min
  });

  const inviteInvalid = Boolean(inviteToken) && inviteStatusQuery.data?.valid === false;
  const inviteWaitlisted =
    Boolean(inviteToken) &&
    inviteStatusQuery.data?.valid === true &&
    inviteStatusQuery.data.canRegister === false;

  // Registering while the cap is full creates a waitlisted account — the
  // form stays the same, only the messaging changes. An invalid/expired
  // invite behaves like no invite.
  const signupsClosed =
    signupStatusQuery.data === false && (!inviteToken || inviteInvalid);

  const mutation = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      isRegister
        ? registerRequest({
            ...body,
            inviteToken: inviteToken ?? undefined,
            reason: reason.trim() || undefined,
            tosAccepted: true,
          })
        : loginRequest(body),
    onSuccess: (data) => {
      if (data.ok && data.data) {
        if (isRegister) {
          // Register always answers 200 with identical bodies for new and
          // existing emails within a branch (F30). `waitlisted` picks which
          // post-submit screen to show — it derives from the public cap
          // state, so it leaks nothing about the email.
          setPostSubmit(data.data.waitlisted ? "waitlisted" : "verify");
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
      } else if (data.error === "waitlisted") {
        // Correct password, account still on the waitlist — informational,
        // not a failure. The backend message branches on verification and
        // auto-resends a stale verification link, so it's the whole story.
        setNotice(data.message ?? "You're on the waitlist — we'll email you when a spot opens.");
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
    setNotice(null);
    if (isRegister && !tosAccepted) {
      setError("You must accept the Terms of Service and Privacy Policy.");
      return;
    }
    mutation.mutate({ email, password });
  }

  // Post-register screens
  if (postSubmit) {
    const waitlisted = postSubmit === "waitlisted";
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
          textAlign: "center",
        }}>
          <h1 style={{ color: "var(--color-primary)", fontSize: "1.5rem", marginBottom: "var(--space-md)" }}>
            {waitlisted ? "You're on the waitlist" : "Check your email"}
          </h1>
          {waitlisted ? (
            <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)", lineHeight: 1.5 }}>
              We sent a verification link to <strong>{email}</strong>. Confirm
              your email to hold your place — we'll email you when a spot
              opens. First come, first served. Your account (this email and
              password) is ready the moment you're in.
            </p>
          ) : (
            <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)", lineHeight: 1.5 }}>
              We sent a verification link to <strong>{email}</strong>. Click it to activate your account.
            </p>
          )}
          <button
            className="btn-secondary"
            onClick={() => {
              setPostSubmit(null);
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
          {inviteToken && !inviteInvalid && (
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

        {/* Capacity notices — the register form stays the same either way;
            only the expectation changes. */}
        {isRegister && signupsClosed && (
          <p style={{
            color: "var(--color-on-surface-variant)",
            fontSize: "0.875rem",
            lineHeight: 1.5,
            marginBottom: "var(--space-lg)",
            padding: "var(--space-md)",
            background: "var(--color-surface-container-low)",
            borderRadius: "var(--radius-sm)",
          }}>
            Soup.net is at capacity right now, so new accounts join the
            waitlist. Create your account below — we'll email you when a spot
            opens. An invitation from someone already on Soup.net puts you at
            the top of the waitlist.
          </p>
        )}
        {isRegister && inviteWaitlisted && (
          <p style={{
            color: "var(--color-on-surface-variant)",
            fontSize: "0.875rem",
            lineHeight: 1.5,
            marginBottom: "var(--space-lg)",
            padding: "var(--space-md)",
            background: "var(--color-surface-container-low)",
            borderRadius: "var(--radius-sm)",
          }}>
            Soup.net is at capacity right now, so your account will start on
            the waitlist — your invitation puts you at the top of it. Create
            your account below and we'll email you when your spot opens.
          </p>
        )}

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
            <div style={{ marginBottom: "var(--space-md)" }}>
              <label htmlFor="signup-reason">What would you use Soup.net for? (optional)</label>
              <textarea
                id="signup-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Tell us about your use case..."
                style={{ resize: "vertical", fontSize: "0.875rem" }}
              />
            </div>
          )}

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

          {notice && (
            <p style={{
              color: "var(--color-on-surface)",
              fontSize: "0.875rem",
              lineHeight: 1.5,
              marginBottom: "var(--space-md)",
              padding: "var(--space-md)",
              background: "var(--color-surface-container-low)",
              borderRadius: "var(--radius-sm)",
            }}>
              {notice}
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
                ? signupsClosed || inviteWaitlisted
                  ? "Create Account & Join Waitlist"
                  : "Create Account"
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
      </div>
    </div>
  );
}
