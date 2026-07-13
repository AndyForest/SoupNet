import { Hono } from "hono";
import { z } from "zod";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { registerUser, loginUser, requireAuth, requireVerifiedEmail, hashPassword, verifyPassword } from "../auth";
import { writeAudit } from "../services/audit-log.service";
import { isSignupCapReached, mayRegister } from "../services/system-settings.service";
import { purgeStaleWaitlistedUsers } from "../services/waitlist.service";
import { deleteUserCascade } from "../services/user-delete.service";
import { sendVerificationEmail, sendPasswordResetEmail } from "../services/email.service";
import { rateLimit } from "../middleware/rate-limit";
import { normalizeEmail } from "../lib/normalize-email";
import type { AppEnv } from "../types";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  inviteToken: z.string().optional(),
  // Optional "What would you use Soup.net for?" — collected for every
  // signup (waitlisted or not), surfaced in the admin Signups/Users views.
  reason: z.string().max(2000).optional(),
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
// Registration ALWAYS creates an account (waitlist v2, 2026-06-11): when
// the cap has room (or a valid invitation admits them) the account is
// active; when the cap is full the account is created with waitlisted_at
// set — password and ToS captured up front, email verifiable while waiting,
// sign-in blocked until approval/promotion clears the flag.
//
// F30 (security-audit-2026-04-09) still holds, restated for the two-branch
// flow: the response body may branch ONLY on attacker-knowable state — the
// public cap status (GET /auth/signup-status) and the validity of a token
// the caller themselves supplied — never on whether the email already
// exists. Within a branch, new and duplicate emails get byte-identical
// bodies (modulo the dev-only verificationToken, absent in production).
//   1. Caller POSTs email + password (+ optional invite token + reason).
//   2. We reply 200 with either the "check your email" body (active branch)
//      or the "you're on the waitlist" body (cap-full branch).
//   3. For the genuinely-new branch, we asynchronously send a verification
//      email (waitlist-variant copy on the cap-full branch) and, in dev
//      only (ALLOW_AUTO_SETUP), surface the token for integration tests.
//   4. The user is NOT auto-logged-in. They must verify, then call /login.
auth.post("/register", authRateLimit, async (c) => {
  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    // 400 still leaks malformed input — which is fine, that's caller's fault,
    // not data exposure. Zod errors stay specific.
    return c.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, 400);
  }
  // Canonical lowercase form everywhere: the invite lookup below, the user
  // row registerUser inserts, and the verification email must all agree.
  const email = normalizeEmail(parsed.data.email);
  const { password, inviteToken } = parsed.data;
  const signupReason = parsed.data.reason?.trim() || null;
  const db = getDb();

  // Resolve the invitation (if any) — but do not branch the response on
  // success vs. failure. An invalid invite token still returns the generic
  // success body, because revealing "invite token bad" gives an attacker
  // confirmation that the email was either right or wrong.
  let invitation: { id: string; groupId: string | null; bypassCap: boolean } | null = null;
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
    invitation = (inviteRows as unknown as Array<{ id: string; groupId: string | null; bypassCap: boolean }>)[0] ?? null;
  }

  // Response builders — see the F30 note above. `waitlisted: true/false` is
  // derived from public cap state + caller-supplied token, so exposing it
  // adds no enumeration signal; the frontend uses it to pick the post-submit
  // screen.
  const respondActive = (extra?: Record<string, unknown>) =>
    c.json({
      ok: true,
      data: {
        waitlisted: false,
        message:
          "If the email is eligible for registration, you'll receive a verification email shortly.",
        ...(extra ?? {}),
      },
    });
  const respondWaitlisted = (extra?: Record<string, unknown>) =>
    c.json({
      ok: true,
      data: {
        waitlisted: true,
        message:
          "You're on the waitlist. Confirm your email via the link we just sent to hold your place — we'll email you when a spot opens. First come, first served.",
        ...(extra ?? {}),
      },
    });

  if (inviteToken && !invitation) {
    // Bad invite token (or token/email mismatch) — respond exactly as the
    // no-invite state would, with no side effects. Revealing the mismatch
    // would confirm which email a stolen token belongs to.
    return (await isSignupCapReached(db)) ? respondWaitlisted() : respondActive();
  }

  // Cap decision. A member invitation is a reservation at the top of the
  // waitlist, not a bypass: the invitee registers actively only while their
  // reservation fits within the cap (own invitation excluded from the count
  // — see mayRegister). Admin invitations (bypass_cap) always register
  // actively. Everyone else lands waitlisted when the cap is full.
  const allowed = await mayRegister(db, invitation);
  const waitlisted = !allowed;
  const respond = waitlisted ? respondWaitlisted : respondActive;

  if (waitlisted) {
    // Hygiene sweep on the low-traffic branch: drop waitlisted accounts that
    // never verified within the purge window (storage-abuse guard).
    try {
      await purgeStaleWaitlistedUsers(db);
    } catch (err) {
      console.error("[auth/register] Stale-waitlist purge failed:", err);
    }
  }

  try {
    const result = await registerUser(db, email, password, "tenant", { waitlisted, signupReason });

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
    void sendVerificationEmail(email, verificationToken, { waitlisted }).catch((err) => {
      console.error("[auth/register] Failed to send verification email:", err);
    });

    // F31: group join is deferred to POST /invitations/:id/accept after
    // verification. Don't auto-join here even though the invite + email
    // match — proof of mailbox control via /auth/verify is required first.
    //
    // Groupless invitations (admin invite-by-email) have nothing to accept —
    // cap bypass was their only job — so stamp them consumed now. Otherwise
    // they'd linger pending (the accept flow never sees them: its queries
    // JOIN groups) and reappear usable if the user were ever deleted.
    if (invitation && !invitation.groupId) {
      await db.execute(sql`
        UPDATE claimnet.invitations SET accepted_at = now() WHERE id = ${invitation.id}::uuid
      `);
    }

    // Test-mode convenience: surface the verification token in the response
    // when ALLOW_AUTO_SETUP=true so integration tests can call /auth/verify
    // without scraping Mailpit. Never enabled in production.
    if (process.env["ALLOW_AUTO_SETUP"] === "true") {
      return respond({ verificationToken });
    }
    return respond();
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
      // Duplicate email — return the same body as the branch's success case.
      // No verification email is sent (the existing user already verified or
      // is in the verify-pending / waitlisted state from their original
      // signup). No fields update — re-registering can't change a password
      // or reason.
      return respond();
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

// GET /auth/invite-status?token=... — public. Lets the register page decide
// what to show for an invite link: the register form (reservation fits within
// the cap, or admin bypass) or the "you're at the top of the waitlist"
// message (cap currently full). Token validity is safe to reveal — tokens
// are unguessable 32-byte secrets, so possession already proves the caller
// was handed the link; no email or group data is returned.
auth.get("/invite-status", verifyRateLimit, async (c) => {
  const token = c.req.query("token");
  if (!token) {
    return c.json({ ok: false, error: "token required" }, 400);
  }
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT id, bypass_cap AS "bypassCap"
    FROM claimnet.invitations
    WHERE token = ${token}
      AND accepted_at IS NULL
      AND declined_at IS NULL
      AND expires_at > now()
    LIMIT 1
  `);
  const invite = (rows as unknown as Array<{ id: string; bypassCap: boolean }>)[0];
  if (!invite) {
    return c.json({ ok: true, data: { valid: false, canRegister: false } });
  }
  const canRegister =
    invite.bypassCap ||
    !(await isSignupCapReached(db, { excludeInvitationId: invite.id }));
  return c.json({ ok: true, data: { valid: true, canRegister } });
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

  // Waitlisted accounts: correct password, but no JWT until approved.
  // Telling them their status here is fine — only the password holder gets
  // this far. last_login_at stays null so "never signed in" stays true.
  //
  // The message branches on verification, and the unverified branch is
  // self-healing: verification links expire in 24h and waitlisted users may
  // come back days later, so a stale (>1h old) or missing token is silently
  // regenerated and re-sent right here — no resend button needed, and the
  // password check just done makes this spam-safe (only the account holder
  // can trigger it; the auth rate limit bounds volume).
  if (result.waitlistedAt) {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT email_verified_at AS "verifiedAt",
             email_verification_token_created_at AS "tokenCreatedAt"
      FROM claimnet.users WHERE id = ${result.user.id}::uuid
    `);
    const row = (rows as unknown as Array<{ verifiedAt: string | null; tokenCreatedAt: string | null }>)[0];

    if (row?.verifiedAt) {
      return c.json({
        ok: false,
        error: "waitlisted",
        verified: true,
        message:
          "You're on the waitlist and your email is verified — your place is held. We'll email you the moment a spot opens.",
      }, 403);
    }

    const tokenAgeMs = row?.tokenCreatedAt
      ? Date.now() - new Date(row.tokenCreatedAt).getTime()
      : Infinity;
    let resent = false;
    if (tokenAgeMs > 60 * 60 * 1000) {
      const freshToken = crypto.randomBytes(32).toString("hex");
      await db.execute(sql`
        UPDATE claimnet.users
        SET email_verification_token = ${freshToken},
            email_verification_token_created_at = now()
        WHERE id = ${result.user.id}::uuid
      `);
      void sendVerificationEmail(result.user.email, freshToken, { waitlisted: true }).catch((err) => {
        console.error("[auth/login] Failed to resend waitlist verification email:", err);
      });
      resent = true;
    }

    return c.json({
      ok: false,
      error: "waitlisted",
      verified: false,
      message: resent
        ? "You're on the waitlist, but your email isn't verified yet — we just sent you a fresh verification link. Confirm it to hold your place."
        : "You're on the waitlist, but your email isn't verified yet. Check your inbox (and spam) for the verification link we sent — confirming it holds your place.",
    }, 403);
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

  return c.json({
    ok: true,
    data: { user: result.user, token: result.token, emailVerified: isVerified },
  });
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
    SELECT email_verified_at AS "emailVerifiedAt",
           premium_at AS "premiumAt"
    FROM claimnet.users WHERE id = ${user.id}::uuid
  `);
  const row = (rows as unknown as Array<{ emailVerifiedAt: string | null; premiumAt: string | null }>)[0];

  // premium ⇔ premium_at IS NOT NULL (admin-assigned; see premium-llm-features.md).
  return c.json({
    ok: true,
    data: { user: { ...user, emailVerified: !!row?.emailVerifiedAt, premium: !!row?.premiumAt } },
  });
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

  // decided_at semantics (see docs/planning/corpus-import.md §v1.1): null means
  // the decision was CONTEMPORANEOUS with the check (the common case); a
  // populated value means it was backfilled to a historical date (decision
  // archaeology). The null vs. populated distinction is information — export
  // and import preserve it exactly. A consumer that needs "when was this
  // decided" for filtering/ordering should coalesce: COALESCE(decided_at,
  // created_at); the coalesce belongs in the consumer, not in the stored data.
  const traces = await db.execute(sql`
    SELECT id, user_id AS "userId", group_id AS "groupId", api_key_id AS "apiKeyId",
           claim_text AS "claimText", claim_text_hash AS "claimTextHash",
           format_adherence_score AS "formatAdherenceScore",
           decided_at AS "decidedAt",
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
    // schemaVersion stays 1 across purely additive, nullable field additions
    // (e.g. traces.decidedAt, added 2026-07-06). Old readers ignore unknown keys;
    // new readers feature-detect the field by presence. The integer is reserved
    // for BREAKING changes (removed/renamed/retyped fields) so the corpus-import
    // "schemaVersion gate with explicit migration path" (docs/backlog.md) can use
    // it as a real compatibility signal rather than an every-field change counter.
    // Judgment checked on Soup.net: recipe 197d9f07-c9d1-4137-8112-2ad8263a3c66.
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

// DELETE /auth/me — self-serve account deletion. Password confirmation is
// required (defends against stolen-session takeover deleting the account).
// Hard-deletes everything attributable to the user via deleteUserCascade
// (user-delete.service.ts — the single teardown path, see its header for
// the full table list): traces with their evidence/references and the
// embedding_sources/chunks/vectors that hold recipe + evidence text in
// cleartext, check_feedback authored by the user's keys, uploads, api_keys,
// oauth codes, owned orgs/groups, memberships, then the users row.
//
// Deliberately retained (documented):
//   - audit_log entries with actor_user_id=this user are left in place so the
//     audit trail survives the deletion (per §5 retention).
//   - vector_cache rows: content-hash keyed, no source text, no FK back to
//     any entity — genuinely PII-free (see enqueue.ts). NOTE: an earlier
//     version of this comment claimed the same of embedding_sources; that
//     was wrong — embedding_sources.source_text is cleartext user content
//     and is now deleted by the cascade.
//
// Self-serve deletion auto-rate-limited (5 per 15min per IP) — even if a
// token leaks, an attacker can't burn an account list quickly.
auth.delete("/me", authRateLimit, requireAuth, async (c) => {
  const user = c.get("user");
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ ok: false, error: "password is required to confirm deletion" }, 400);
  }
  const password = typeof body["password"] === "string" ? body["password"] : "";
  if (!password) {
    return c.json({ ok: false, error: "password is required to confirm deletion" }, 400);
  }

  const db = getDb();

  // Re-fetch the password hash and verify the supplied password. Don't trust
  // any cached state — the user could have changed their password since the
  // JWT was issued, and we want the canonical hash for this check.
  const userRows = await db.execute(sql`
    SELECT password_hash FROM claimnet.users WHERE id = ${user.id}::uuid LIMIT 1
  `);
  const userRow = (userRows as unknown as Array<{ password_hash: string }>)[0];
  if (!userRow) {
    return c.json({ ok: false, error: "account not found" }, 404);
  }
  const passwordOk = await verifyPassword(password, userRow.password_hash);
  if (!passwordOk) {
    return c.json({ ok: false, error: "incorrect password" }, 401);
  }

  // Guard: shared (non-personal) organizations the user owns and that have
  // other members can't be auto-cleaned by self-serve — destroying them
  // would take other users' content with it. The user has to transfer
  // ownership (admin work for now) before we can proceed. Personal orgs
  // and shared orgs that are now sole-member are fine to cascade-delete.
  const blockingOrgs = await db.execute(sql`
    SELECT o.id, o.name FROM claimnet.organizations o
    WHERE o.owner_id = ${user.id}::uuid
      AND o.is_personal = false
      AND EXISTS (
        SELECT 1 FROM claimnet.group_members gm
        JOIN claimnet.groups g ON g.id = gm.group_id
        WHERE g.organization_id = o.id AND gm.user_id <> ${user.id}::uuid
      )
  `);
  const blockingOrgList = blockingOrgs as unknown as Array<{ id: string; name: string }>;
  if (blockingOrgList.length > 0) {
    return c.json({
      ok: false,
      error: "owned_shared_orgs_exist",
      message:
        "You own organizations with other members. Transfer ownership or remove the other members before deleting your account.",
      organizations: blockingOrgList,
    }, 409);
  }

  // Capture the audit entry BEFORE the cascade, so actor_user_id is still
  // valid. The entry itself survives the deletion per §5 retention. Written
  // outside the cascade's transactions (the cascade batches per trace —
  // see user-delete.service.ts): if the cascade fails partway, the audit
  // row records the attempt and the account remains, visibly retryable.
  await writeAudit(db, {
    actorUserId: user.id,
    action: "user.self_delete",
    targetType: "user",
    targetId: user.id,
    metadata: { source: "DELETE /auth/me" },
  });

  await deleteUserCascade(db, user.id);

  return c.json({ ok: true });
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
    RETURNING id, email, (waitlisted_at IS NOT NULL) AS "waitlisted"
  `);

  const updated = (result as unknown as Array<{ id: string; email: string; waitlisted: boolean }>)[0];
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
    data: {
      verified: true,
      email: updated.email,
      pendingInvitations: pendingCount,
      // Waitlisted accounts get "your place is held" copy instead of
      // "sign in and start" — signing in won't work until promotion.
      waitlisted: updated.waitlisted,
    },
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
  // Same normalization as register/login — the not-exists branch does the
  // identical work, so this adds no enumeration signal (F45).
  const email = normalizeEmail(parsed.data.email);
  const db = getDb();

  // Look up the user — but never reveal whether they exist.
  const userRows = await db.execute(sql`
    SELECT id FROM claimnet.users WHERE email = ${email} LIMIT 1
  `);
  const user = (userRows as unknown as Array<{ id: string }>)[0];

  // F45 residual (security-audit-2026-06-11): equalize the work both branches
  // do, so response latency can't be used as an account-enumeration oracle.
  // The earlier F45 pass made the response BODY generic and the email send
  // fire-and-forget, but the account-exists branch still did extra work the
  // not-exists branch skipped — crypto.randomBytes + hashResetToken + a DB
  // UPDATE round-trip to RDS. That round-trip is a measurable latency delta a
  // targeted attacker can A/B-compare (a known-unregistered email vs. the
  // target) to learn whether the target is registered; the 3-per-15-min/IP
  // rate limit defeats a statistical sweep but NOT a single targeted
  // comparison. Mirror the F30 register fix ("bcrypt on both branches"): do
  // the SAME work regardless of existence. Token generation + hashing run
  // unconditionally, and the not-exists branch issues an equivalent UPDATE
  // that matches zero rows so both paths pay exactly one UPDATE round-trip.
  // No random delay — that leaks under averaging and penalizes legit users.
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(rawToken);

  let devOnlyResetToken: string | null = null;
  if (user) {
    await db.execute(sql`
      UPDATE claimnet.users
      SET password_reset_token_hash = ${tokenHash},
          password_reset_token_created_at = NOW()
      WHERE id = ${user.id}::uuid
    `);
    // Fire-and-forget the SMTP roundtrip (original F45 fix): awaiting it only
    // on the account-exists branch was itself a timing oracle. Errors are
    // swallowed for the same reason — the user can request again.
    void sendPasswordResetEmail(email, rawToken).catch((err) => {
      console.error("[auth/forgot-password] Failed to send reset email:", err);
    });
    if (process.env["ALLOW_AUTO_SETUP"] === "true") {
      devOnlyResetToken = rawToken;
    }
  } else {
    // Not-exists branch: perform an equivalent UPDATE that matches zero rows,
    // so the database does the same statement-parse + primary-key probe +
    // round-trip the real branch pays. The all-zeros UUID is never issued as
    // a real user id (gen_random_uuid / uuidv4 cannot produce it), so this can
    // never touch a real row. No email is sent (there's no mailbox), and that
    // send is off the response's critical path anyway, so it doesn't affect
    // timing. No reset token is surfaced even under ALLOW_AUTO_SETUP.
    await db.execute(sql`
      UPDATE claimnet.users
      SET password_reset_token_hash = ${tokenHash},
          password_reset_token_created_at = NOW()
      WHERE id = '00000000-0000-0000-0000-000000000000'::uuid
    `);
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
