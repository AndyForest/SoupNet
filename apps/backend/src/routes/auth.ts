import { Hono } from "hono";
import { z } from "zod";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { registerUser, loginUser, requireAuth, requireVerifiedEmail, hashPassword } from "../auth";
import { isSignupCapReached, tryConsumeSignupSlot } from "../services/system-settings.service";
import { sendVerificationEmail, sendPasswordResetEmail } from "../services/email.service";
import { rateLimit } from "../middleware/rate-limit";
import type { AppEnv } from "../types";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  inviteToken: z.string().optional(),
  // Required: the user must explicitly accept the Terms of Service and
  // Privacy Policy on the register form. We record the timestamp on the
  // user row. The legal pages are currently placeholder content (see
  // backlog "Legal and compliance") but the structural decision is in
  // place from day one so we don't have to retrofit it later.
  tosAccepted: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms of Service and Privacy Policy to create an account." }),
  }),
});

// Rate limiters for auth endpoints
const authRateLimit = rateLimit({ max: 5, windowMs: 15 * 60 * 1000 }); // 5 per 15 min per IP
const verifyRateLimit = rateLimit({ max: 10, windowMs: 15 * 60 * 1000 }); // 10 per 15 min per IP
const resendRateLimit = rateLimit({ max: 3, windowMs: 15 * 60 * 1000 }); // 3 per 15 min per IP
const forgotPasswordRateLimit = rateLimit({ max: 3, windowMs: 15 * 60 * 1000 }); // 3 per 15 min per IP
const resetPasswordRateLimit = rateLimit({ max: 10, windowMs: 15 * 60 * 1000 }); // 10 per 15 min per IP

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

/** Hash a reset token before storing/looking up. SHA-256 hex, mirrors api-key.service. */
function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const auth = new Hono<AppEnv>();

// POST /auth/register
//
// F30 (security-audit-2026-04-09): the response is intentionally byte-
// -identical regardless of whether the email was new, already registered,
// or rejected by the signup cap. Returning distinguishable bodies (the old
// 409 / 403 / 200 split) was an account-enumeration oracle. The flow now is:
//   1. Caller POSTs email + password (+ optional invite token).
//   2. We always reply 200 with a generic "if eligible, check your email".
//   3. For the genuinely-new branch, we asynchronously send a verification
//      email and (in dev only, gated by ALLOW_AUTO_SETUP) surface the token
//      in the response so integration tests can complete /auth/verify
//      without scraping Mailpit.
//   4. The user is NOT auto-logged-in. They must verify, then call /login.
//
// Frontend impact: the previous flow handed the JWT back from /register and
// landed the user authed. New flow redirects to a verify-pending screen and
// requires explicit /login after the verification link is clicked — match
// what every other modern auth flow does.
auth.post("/register", authRateLimit, async (c) => {
  // Generic body returned on every branch — success, duplicate email, cap
  // reached, invalid invite token. Building it once avoids drift.
  const generic = (extra?: Record<string, unknown>) =>
    c.json({
      ok: true,
      data: {
        message:
          "If the email is eligible for registration, you'll receive a verification email shortly.",
        ...(extra ?? {}),
      },
    });

  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    // 400 still leaks malformed input — which is fine, that's caller's fault,
    // not data exposure. Zod errors stay specific.
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }
  const { email, password, inviteToken } = parsed.data;
  const db = getDb();

  // Resolve the invitation (if any) — but do not branch the response on
  // success vs. failure. An invalid invite token still returns the generic
  // success body, because revealing "invite token bad" gives an attacker
  // confirmation that the email was either right or wrong.
  let invitation: { id: string; groupId: string; bypassCap: boolean } | null = null;
  if (inviteToken) {
    const inviteRows = await db.execute(sql`
      SELECT id, group_id AS "groupId", bypass_cap AS "bypassCap"
      FROM claimnet.invitations
      WHERE token = ${inviteToken}
        AND accepted_at IS NULL
        AND expires_at > now()
        AND email = ${email}
      LIMIT 1
    `);
    invitation = (inviteRows as unknown as Array<{ id: string; groupId: string; bypassCap: boolean }>)[0] ?? null;
    if (!invitation) {
      // Bad invite token — silently return generic success.
      return generic();
    }
  }

  // Cap check — silently return generic success when over cap.
  if (!invitation?.bypassCap) {
    const allowed = await tryConsumeSignupSlot(db);
    if (!allowed) {
      return generic();
    }
  }

  try {
    const result = await registerUser(db, email, password);

    const verificationToken = crypto.randomBytes(32).toString("hex");
    await db.execute(sql`
      UPDATE claimnet.users
      SET email_verification_token = ${verificationToken},
          email_verification_token_created_at = now(),
          tos_accepted_at = now()
      WHERE id = ${result.user.id}::uuid
    `);

    // Fire-and-forget the email send so the response timing on the
    // genuinely-new branch is dominated by DB ops (which both branches do)
    // rather than SMTP latency (which only the new branch does).
    void sendVerificationEmail(email, verificationToken).catch((err) => {
      console.error("[auth/register] Failed to send verification email:", err);
    });

    // F31: group join is deferred to POST /invitations/:id/accept after
    // verification. Don't auto-join here even though the invite + email
    // match — proof of mailbox control via /auth/verify is required first.

    // Test-mode convenience: surface the verification token in the response
    // when ALLOW_AUTO_SETUP=true so integration tests can call /auth/verify
    // without scraping Mailpit. Never enabled in production.
    if (process.env["ALLOW_AUTO_SETUP"] === "true") {
      return generic({ verificationToken });
    }
    return generic();
  } catch (err: unknown) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null;
    const msg = err instanceof Error ? err.message : String(err);
    const causeMsg = cause?.message ?? "";
    const pgCode = cause && "code" in cause ? (cause as { code?: string }).code : undefined;

    if (
      pgCode === "23505" ||
      msg.includes("unique") || msg.includes("duplicate") ||
      causeMsg.includes("unique") || causeMsg.includes("duplicate")
    ) {
      // Duplicate email — silently return generic success. No verification
      // email is sent (and that's fine — the existing user already verified
      // or is in the verify-pending state from their original signup).
      return generic();
    }
    console.error("[auth/register] Registration error:", err);
    return c.json({ ok: false, error: "Registration failed" }, 500);
  }
});

// GET /auth/signup-status — public, no auth required
auth.get("/signup-status", async (c) => {
  const db = getDb();
  const capReached = await isSignupCapReached(db);
  return c.json({ ok: true, data: { signupsOpen: !capReached } });
});

// POST /auth/login
auth.post("/login", authRateLimit, async (c) => {
  const body = await c.req.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }
  const { email, password } = parsed.data;

  const result = await loginUser(getDb(), email, password);
  if (!result) {
    return c.json({ ok: false, error: "Invalid email or password" }, 401);
  }

  const db = getDb();

  // Stamp last_login_at for admin visibility.
  await db.execute(sql`
    UPDATE claimnet.users SET last_login_at = now() WHERE id = ${result.user.id}::uuid
  `);

  // Check if email is verified
  const verifiedRows = await db.execute(sql`
    SELECT email_verified_at FROM claimnet.users WHERE id = ${result.user.id}::uuid
  `);
  const isVerified = !!(verifiedRows as unknown as Array<{ email_verified_at: string | null }>)[0]?.email_verified_at;

  return c.json({ ok: true, data: { ...result, emailVerified: isVerified } });
});

// GET /auth/me — get current user info.
// SECURE-BY-DEFAULT OPT-OUT: this route deliberately does NOT call
// requireVerifiedEmail. The frontend's verify-pending page needs to read the
// signed-in user's email + emailVerified flag to render itself, so blocking
// /auth/me for unverified users would lock them out of their own state.
// Every other JWT-authed router applies requireAuth + requireVerifiedEmail
// together — this is one of only two opt-outs (the other is
// /auth/resend-verification).
auth.get("/me", requireAuth, async (c) => {
  const user = c.get("user");

  const db = getDb();
  const rows = await db.execute(sql`
    SELECT email_verified_at AS "emailVerifiedAt"
    FROM claimnet.users WHERE id = ${user.id}::uuid
  `);
  const emailVerifiedAt = (rows as unknown as Array<{ emailVerifiedAt: string | null }>)[0]?.emailVerifiedAt;

  return c.json({ ok: true, data: { user: { ...user, emailVerified: !!emailVerifiedAt } } });
});

// GET /auth/me/export — download all user-authored data as JSON.
// Covers recipes (traces), evidence, references, the N:N links between them,
// group memberships, and API key metadata. Excludes system-generated data
// (vectors, embedding chunks, audit log, multimodal file bytes) — per the
// data-ownership promise on the landing page, the user gets back what they
// contributed, not what the system derived. References' file_url/mime/hash
// metadata IS included as pointers, but the bytes are not fetched inline.
auth.get("/me/export", requireAuth, requireVerifiedEmail, async (c) => {
  const user = c.get("user");
  const db = getDb();

  const userRows = await db.execute(sql`
    SELECT id, email, created_at AS "createdAt", tos_accepted_at AS "tosAcceptedAt",
           email_verified_at AS "emailVerifiedAt"
    FROM claimnet.users WHERE id = ${user.id}::uuid
  `);
  const profile = (userRows as unknown as Array<{ id: string; email: string; createdAt: string; tosAcceptedAt: string | null; emailVerifiedAt: string | null }>)[0];

  const organizations = await db.execute(sql`
    SELECT id, name, slug, created_at AS "createdAt"
    FROM claimnet.organizations WHERE owner_id = ${user.id}::uuid
    ORDER BY created_at
  `);

  const groupMemberships = await db.execute(sql`
    SELECT g.id AS "groupId", g.name, g.slug, g.description,
           gm.role, gm.joined_at AS "joinedAt"
    FROM claimnet.group_members gm
    JOIN claimnet.groups g ON g.id = gm.group_id
    WHERE gm.user_id = ${user.id}::uuid
    ORDER BY gm.joined_at
  `);

  // API key metadata only — never the raw `key` column.
  const apiKeys = await db.execute(sql`
    SELECT id, key_prefix AS "keyPrefix", label, key_type AS "keyType",
           read_group_ids AS "readGroupIds", write_group_ids AS "writeGroupIds",
           default_write_group_id AS "defaultWriteGroupId",
           expires_at AS "expiresAt", last_used_at AS "lastUsedAt",
           created_at AS "createdAt"
    FROM claimnet.api_keys WHERE user_id = ${user.id}::uuid
    ORDER BY created_at
  `);

  const traces = await db.execute(sql`
    SELECT id, user_id AS "userId", group_id AS "groupId", api_key_id AS "apiKeyId",
           claim_text AS "claimText", claim_text_hash AS "claimTextHash",
           format_adherence_score AS "formatAdherenceScore",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM claimnet.traces WHERE user_id = ${user.id}::uuid
    ORDER BY created_at
  `);

  const traceEvidence = await db.execute(sql`
    SELECT te.id, te.trace_id AS "traceId", te.evidence_id AS "evidenceId",
           te.stance, te.api_key_id AS "apiKeyId", te.created_at AS "createdAt"
    FROM claimnet.trace_evidence te
    JOIN claimnet.traces t ON t.id = te.trace_id
    WHERE t.user_id = ${user.id}::uuid
    ORDER BY te.created_at
  `);

  const evidence = await db.execute(sql`
    SELECT DISTINCT e.id, e.content,
           e.created_at AS "createdAt", e.updated_at AS "updatedAt"
    FROM claimnet.evidence e
    JOIN claimnet.trace_evidence te ON te.evidence_id = e.id
    JOIN claimnet.traces t ON t.id = te.trace_id
    WHERE t.user_id = ${user.id}::uuid
    ORDER BY e.created_at
  `);

  const traceReferences = await db.execute(sql`
    SELECT tr.id, tr.trace_id AS "traceId", tr.reference_id AS "referenceId",
           tr.api_key_id AS "apiKeyId", tr.created_at AS "createdAt"
    FROM claimnet.trace_references tr
    JOIN claimnet.traces t ON t.id = tr.trace_id
    WHERE t.user_id = ${user.id}::uuid
    ORDER BY tr.created_at
  `);

  const evidenceReferences = await db.execute(sql`
    SELECT DISTINCT er.id, er.evidence_id AS "evidenceId",
           er.reference_id AS "referenceId", er.created_at AS "createdAt"
    FROM claimnet.evidence_references er
    JOIN claimnet.trace_evidence te ON te.evidence_id = er.evidence_id
    JOIN claimnet.traces t ON t.id = te.trace_id
    WHERE t.user_id = ${user.id}::uuid
    ORDER BY er.created_at
  `);

  // References reachable via either link table from the user's traces.
  const references = await db.execute(sql`
    SELECT DISTINCT r.id, r.quote, r.source,
           r.file_url AS "fileUrl", r.file_mime_type AS "fileMimeType",
           r.file_hash AS "fileHash", r.created_at AS "createdAt"
    FROM claimnet.references r
    WHERE r.id IN (
      SELECT tr.reference_id
      FROM claimnet.trace_references tr
      JOIN claimnet.traces t ON t.id = tr.trace_id
      WHERE t.user_id = ${user.id}::uuid
    )
    OR r.id IN (
      SELECT er.reference_id
      FROM claimnet.evidence_references er
      JOIN claimnet.trace_evidence te ON te.evidence_id = er.evidence_id
      JOIN claimnet.traces t ON t.id = te.trace_id
      WHERE t.user_id = ${user.id}::uuid
    )
    ORDER BY r.created_at
  `);

  const payload = {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    user: profile ?? null,
    organizations,
    groupMemberships,
    apiKeys,
    traces,
    evidence,
    references,
    traceEvidence,
    traceReferences,
    evidenceReferences,
  };

  const emailSlug = (profile?.email ?? "user").replace(/[^a-zA-Z0-9._-]/g, "_");
  const dateSlug = new Date().toISOString().slice(0, 10);
  const filename = `soupnet-export-${emailSlug}-${dateSlug}.json`;
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(JSON.stringify(payload, null, 2));
});

// POST /auth/verify — verify email with token.
//
// Idempotent: calling this with the same token twice (e.g. React StrictMode
// double-fire, page refresh, email opened in two tabs) returns success both
// times without changing the verification timestamp. We use COALESCE to
// preserve the original verified_at, and we deliberately do NOT clear the
// token in this UPDATE — it expires naturally after 24h. A "used" token
// can't do anything except re-confirm existing verified state.
auth.post("/verify", verifyRateLimit, async (c) => {
  const body = await c.req.json();
  const token = (body as { token?: string }).token;
  if (!token) {
    return c.json({ ok: false, error: "Token required" }, 400);
  }

  const db = getDb();
  const result = await db.execute(sql`
    UPDATE claimnet.users
    SET email_verified_at = COALESCE(email_verified_at, now())
    WHERE email_verification_token = ${token}
      AND email_verification_token_created_at > now() - interval '24 hours'
    RETURNING id, email
  `);

  const updated = (result as unknown as Array<{ id: string; email: string }>)[0];
  if (!updated) {
    return c.json({ ok: false, error: "Invalid or expired verification token" }, 400);
  }

  // Verification proves mailbox control. Invitations bound to this email
  // stay pending — the user must click Accept in-app on their dashboard
  // (see docs/design-thinking.md §Collaboration user stories, "No
  // auto-accept" principle). This prevents someone from forcing a new user
  // into a group by planting an invite before they sign up, and keeps the
  // "inviting in your AI agent" post-accept onboarding as the first
  // deliberate step after joining.
  const pendingInviteCount = await db.execute(sql`
    SELECT count(*)::int AS total
    FROM claimnet.invitations
    WHERE email = ${updated.email}
      AND accepted_at IS NULL
      AND declined_at IS NULL
      AND expires_at > now()
  `);
  const pendingCount = ((pendingInviteCount as unknown as Array<{ total: number }>)[0]?.total) ?? 0;

  return c.json({
    ok: true,
    data: { verified: true, email: updated.email, pendingInvitations: pendingCount },
  });
});

// POST /auth/resend-verification — resend verification email.
// SECURE-BY-DEFAULT OPT-OUT: this route deliberately does NOT call
// requireVerifiedEmail. By definition only unverified users need to call it,
// so blocking unverified users would make verification recovery impossible.
// This is one of only two opt-outs (the other is /auth/me).
auth.post("/resend-verification", resendRateLimit, requireAuth, async (c) => {
  const user = c.get("user");
  const db = getDb();

  // Check if already verified
  const rows = await db.execute(sql`
    SELECT email_verified_at, email_verification_token
    FROM claimnet.users WHERE id = ${user.id}::uuid
  `);
  const row = (rows as unknown as Array<{ email_verified_at: string | null; email_verification_token: string | null }>)[0];
  if (row?.email_verified_at) {
    return c.json({ ok: true, data: { message: "Email already verified" } });
  }

  // Generate new token (always regenerate to reset 24h expiry window)
  const token = crypto.randomBytes(32).toString("hex");
  await db.execute(sql`
    UPDATE claimnet.users
    SET email_verification_token = ${token},
        email_verification_token_created_at = now()
    WHERE id = ${user.id}::uuid
  `);

  try {
    await sendVerificationEmail(user.email, token);
    return c.json({ ok: true, data: { message: "Verification email sent" } });
  } catch {
    return c.json({ ok: false, error: "Failed to send email" }, 500);
  }
});

// POST /auth/forgot-password — request a password reset email.
// Always returns 200 to avoid account enumeration. The email is only actually
// sent when an account exists with the given address. Token is stored hashed
// (SHA-256), expires in 1 hour, single-use (cleared on successful reset).
auth.post("/forgot-password", forgotPasswordRateLimit, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid input" }, 400);
  }
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    // Still respond as if successful — never confirm email format issues
    // could be an enumeration vector. But Zod failure is a malformed request,
    // so 400 is fine here (it's not "this email doesn't exist").
    return c.json({ ok: false, error: "Invalid input" }, 400);
  }
  const { email } = parsed.data;
  const db = getDb();

  // Look up the user — but never reveal whether they exist.
  const userRows = await db.execute(sql`
    SELECT id FROM claimnet.users WHERE email = ${email} LIMIT 1
  `);
  const user = (userRows as unknown as Array<{ id: string }>)[0];

  let devOnlyResetToken: string | null = null;
  if (user) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(rawToken);
    await db.execute(sql`
      UPDATE claimnet.users
      SET password_reset_token_hash = ${tokenHash},
          password_reset_token_created_at = NOW()
      WHERE id = ${user.id}::uuid
    `);
    try {
      await sendPasswordResetEmail(email, rawToken);
    } catch (err) {
      console.error("[auth/forgot-password] Failed to send reset email:", err);
      // Swallow errors — never let the response differ based on whether email
      // delivery succeeded. The user can request again.
    }
    if (process.env["ALLOW_AUTO_SETUP"] === "true") {
      devOnlyResetToken = rawToken;
    }
  }

  const responseData: Record<string, unknown> = {
    message: "If an account exists for that email address, a password reset link has been sent. Check your inbox.",
  };
  // Test-mode convenience: surface the raw token when present so integration
  // tests can complete the reset flow without scraping Mailpit. Only set
  // when ALLOW_AUTO_SETUP=true AND the user existed — never returned in
  // production.
  if (devOnlyResetToken) {
    responseData["resetToken"] = devOnlyResetToken;
  }

  return c.json({ ok: true, data: responseData });
});

// POST /auth/reset-password — complete the reset using the emailed token.
// Validates the token hash, enforces 1-hour expiry and single-use (the token
// is cleared on success). Updates password_hash via bcrypt.
auth.post("/reset-password", resetPasswordRateLimit, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid input" }, 400);
  }
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }
  const { token, newPassword } = parsed.data;
  const db = getDb();

  const tokenHash = hashResetToken(token);
  const newHash = await hashPassword(newPassword);

  // Atomic update — only succeeds if the hash matches AND the token is fresh
  // (≤1 hour). We clear the reset columns in the same statement so the token
  // cannot be replayed.
  const result = await db.execute(sql`
    UPDATE claimnet.users
    SET password_hash = ${newHash},
        password_reset_token_hash = NULL,
        password_reset_token_created_at = NULL,
        updated_at = NOW()
    WHERE password_reset_token_hash = ${tokenHash}
      AND password_reset_token_created_at > NOW() - interval '1 hour'
    RETURNING id, email
  `);

  const updated = (result as unknown as Array<{ id: string; email: string }>)[0];
  if (!updated) {
    return c.json({ ok: false, error: "Invalid or expired reset token" }, 400);
  }

  return c.json({ ok: true, data: { reset: true, email: updated.email } });
});

export { auth as authRoutes };
