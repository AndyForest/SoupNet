import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Context, Next } from "hono";
import { users, organizations, groups, groupMembers } from "@soupnet/db";
import { normalizeEmail } from "./lib/normalize-email";

const JWT_SECRET = () => {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET is required");
  if (secret.includes("change-me") || secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters and not the default placeholder");
  }
  return secret;
};

const JWT_EXPIRY = "7d";
const SALT_ROUNDS = 12;

// ── Types ────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  role: string;       // 'system' | 'tenant'
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

// ── Password helpers ────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── JWT helpers ─────────────────────────────────────────────────────────

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET(), { expiresIn: JWT_EXPIRY, algorithm: "HS256" });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET(), { algorithms: ["HS256"] }) as JwtPayload;
  } catch {
    return null;
  }
}

// ── Hono middleware ─────────────────────────────────────────────────────

/**
 * JWT auth middleware. Sets c.set("user", { id, email, role }) on success.
 * Returns 401 if no valid token.
 */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ ok: false, error: "Missing or invalid Authorization header" }, 401);
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return c.json({ ok: false, error: "Invalid or expired token" }, 401);
  }
  // Emails are stored in canonical lowercase form (see lib/normalize-email),
  // but a JWT signed before migration 0027 can still carry the as-typed
  // casing for its remaining lifetime. Normalizing here closes that window
  // for every downstream email comparison (e.g. /invitations/pending).
  c.set("user", { id: payload.sub, email: normalizeEmail(payload.email), role: payload.role } as AuthUser);
  return next();
}

/**
 * Require system role (root admin).
 * Must be used AFTER requireAuth.
 */
export async function requireSystem(c: Context, next: Next): Promise<Response | void> {
  const user = c.get("user") as AuthUser;
  if (user.role !== "system") {
    return c.json({ ok: false, error: "System role required" }, 403);
  }
  return next();
}

/**
 * Require the authenticated user to have a verified email address.
 * Must be used AFTER requireAuth.
 *
 * Returns 403 with `error: "email_not_verified"` and a hint to call
 * `POST /auth/resend-verification` if the user has not yet clicked the
 * verification link in their inbox. This gates every JWT-authed endpoint
 * behind email ownership proof (closes F15).
 *
 * SECURE-BY-DEFAULT CONVENTION: every JWT-authed router in this codebase
 * mounts BOTH `requireAuth` AND `requireVerifiedEmail` together (see
 * routes/keys.ts, routes/groups.ts, routes/traces.ts, routes/admin.ts).
 * The only opt-outs are two routes in routes/auth.ts that must remain
 * reachable pre-verification: GET /auth/me (so the verify-pending page can
 * read user state) and POST /auth/resend-verification (so the verify-pending
 * page can request a new email). Keep that list short — adding a new opt-out
 * means a new pre-verification attack surface.
 */
export async function requireVerifiedEmail(c: Context, next: Next): Promise<Response | void> {
  const user = c.get("user") as AuthUser;
  // Lazy import avoids a circular dep with db.ts at module load time.
  const { getDb } = await import("./db");
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT email_verified_at FROM claimnet.users WHERE id = ${user.id}::uuid
  `);
  const verifiedAt = (rows as unknown as Array<{ email_verified_at: string | null }>)[0]?.email_verified_at;
  if (!verifiedAt) {
    return c.json({
      ok: false,
      error: "email_not_verified",
      message: "Verify your email address before continuing. Check your inbox for the verification link, or POST to /auth/resend-verification to request a new one.",
    }, 403);
  }
  return next();
}

// ── User registration + auto-setup ──────────────────────────────────────

/**
 * Register a new user. Creates personal org + default group.
 * Returns the user (without password hash) and a JWT token.
 */
export async function registerUser(
  db: PostgresJsDatabase,
  email: string,
  password: string,
  role: string = "tenant",
  opts?: {
    /** Create the account in waitlisted state (cap was full at registration). */
    waitlisted?: boolean;
    /** Optional "what would you use Soup.net for?" answer from the register form. */
    signupReason?: string | null;
  },
): Promise<{ user: { id: string; email: string; role: string }; token: string }> {
  email = normalizeEmail(email);
  const passwordHash = await hashPassword(password);

  // Insert user
  const userRows = await db.insert(users).values({
    email,
    passwordHash,
    role,
    waitlistedAt: opts?.waitlisted ? new Date() : null,
    signupReason: opts?.signupReason ?? null,
  }).returning({ id: users.id, email: users.email, role: users.role });

  const user = userRows[0];
  if (!user) throw new Error("Failed to create user");

  // Create personal org
  const slug = email.split("@")[0]?.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "user";
  const orgRows = await db.insert(organizations).values({
    name: `${email}'s workspace`,
    slug: `${slug}-${user.id.slice(0, 8)}`,
    ownerId: user.id,
    isPersonal: true,
  }).returning({ id: organizations.id });

  const org = orgRows[0];
  if (!org) throw new Error("Failed to create organization");

  // Create default group in that org
  const groupRows = await db.insert(groups).values({
    name: "Personal",
    slug: "personal",
    organizationId: org.id,
  }).returning({ id: groups.id });

  const group = groupRows[0];
  if (group) {
    // The user's own Personal group is auto-opted-in for daily-link
    // read + write — the "new groups default to excluded" rule applies to
    // memberships gained via invite accept, not to groups you own yourself.
    await db.insert(groupMembers).values({
      groupId: group.id,
      userId: user.id,
      role: "owner",
      dailyRead: true,
      dailyWrite: true,
    });
  }

  const token = signToken({ sub: user.id, email: user.email, role: user.role });

  return { user: { id: user.id, email: user.email, role: user.role }, token };
}

/**
 * Login user. Returns JWT token if credentials match.
 *
 * waitlistedAt is surfaced so the route can block waitlisted accounts with
 * a "you're on the waitlist" message INSTEAD of issuing a token. Telling
 * the caller their waitlist status is privileged-but-safe: only someone
 * holding the correct password gets this far. No token is signed for
 * waitlisted accounts — without a JWT, every other surface (dashboard,
 * keys, MCP, OAuth) stays blocked with zero additional checks.
 */
export async function loginUser(
  db: PostgresJsDatabase,
  email: string,
  password: string,
): Promise<
  | { user: { id: string; email: string; role: string }; token: string; waitlistedAt: null }
  | { user: { id: string; email: string; role: string }; token: null; waitlistedAt: Date }
  | null
> {
  const rows = await db.select().from(users).where(sql`${users.email} = ${normalizeEmail(email)}`).limit(1);
  const user = rows[0];
  if (!user) return null;

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;

  if (user.waitlistedAt) {
    return {
      user: { id: user.id, email: user.email, role: user.role },
      token: null,
      waitlistedAt: user.waitlistedAt,
    };
  }

  const token = signToken({ sub: user.id, email: user.email, role: user.role });
  return { user: { id: user.id, email: user.email, role: user.role }, token, waitlistedAt: null };
}

/**
 * Auto-setup: create dev and test users on first startup.
 *
 * Security (F3): blocked in production. Only runs when NODE_ENV !== "production".
 * See docs/security/security-audit-2026-03-26.md.
 */
export async function autoSetup(db: PostgresJsDatabase): Promise<void> {
  // F3 fix: warn in production unless explicitly allowed.
  // Docker dev uses NODE_ENV=production for performance, so we can't just block on that.
  // Real production should not have DEV_USERNAME/DEV_PASSWORD in the environment at all.
  // F49 (security-audit-2026-06-11): the gate is `=== "true"`, not env-var
  // presence — previously ALLOW_AUTO_SETUP=false *enabled* auto-setup. All
  // gates on this var (here, signupCap below, routes/auth.ts) use the same
  // strict comparison.
  if (process.env["NODE_ENV"] === "production" && process.env["ALLOW_AUTO_SETUP"] !== "true") {
    if (process.env["DEV_USERNAME"] || process.env["TEST_USERNAME"]) {
      console.error(
        "[auto-setup] BLOCKED in production. Set ALLOW_AUTO_SETUP=true to override " +
        "(for Docker dev), or remove DEV_USERNAME/TEST_USERNAME for real production.",
      );
    }
    return;
  }

  // Dev user — only on empty database (first startup)
  const devEmail = process.env["DEV_USERNAME"];
  const devPassword = process.env["DEV_PASSWORD"];
  if (devEmail && devPassword) {
    const countResult = await db.execute(sql`SELECT count(*)::int AS total FROM claimnet.users`);
    const count = ((countResult[0] as Record<string, unknown>)?.["total"] as number) ?? 0;

    if (count === 0) {
      console.log(`[auto-setup] No users found. Creating system user: ${devEmail}`); // eslint-disable-line no-console
      const result = await registerUser(db, devEmail, devPassword, "system");
      // Mark the bootstrap system user as email-verified — it must be able to
      // create keys and submit traces immediately (F15 hard gate).
      await db.execute(sql`
        UPDATE claimnet.users SET email_verified_at = NOW() WHERE id = ${result.user.id}::uuid
      `);
      console.log(`[auto-setup] System user created: ${result.user.id}`); // eslint-disable-line no-console
    }
  }

  // Set signup cap for dev/test — allows integration tests to register users.
  // Production cap is managed via admin settings UI.
  if (process.env["ALLOW_AUTO_SETUP"] === "true") {
    const { getSetting, setSetting } = await import("./services/system-settings.service");
    const currentCap = await getSetting(db, "signupCap");
    if (currentCap === 0) {
      await setSetting(db, "signupCap", 1000);
      console.log("[auto-setup] Set signupCap to 1000 for dev/test environment"); // eslint-disable-line no-console
    }
  }

  // Test user — idempotent, created if not present (safe to re-run)
  const testEmail = process.env["TEST_USERNAME"];
  const testPassword = process.env["TEST_PASSWORD"];
  if (testEmail && testPassword) {
    const existing = await db.execute(
      sql`SELECT id FROM claimnet.users WHERE email = ${normalizeEmail(testEmail)} LIMIT 1`,
    );
    if ((existing as unknown[]).length === 0) {
      console.log(`[auto-setup] Creating test user: ${testEmail}`); // eslint-disable-line no-console
      const result = await registerUser(db, testEmail, testPassword, "user");
      await db.execute(sql`
        UPDATE claimnet.users SET email_verified_at = NOW() WHERE id = ${result.user.id}::uuid
      `);
      console.log(`[auto-setup] Test user created: ${result.user.id}`); // eslint-disable-line no-console
    }
  }
}
