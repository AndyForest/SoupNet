import { createTransport } from "nodemailer";
import type { Transporter } from "nodemailer";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    const smtpHost = process.env["SMTP_HOST"] ?? "localhost";
    const smtpPort = parseInt(process.env["SMTP_PORT"] ?? "1125", 10);
    const smtpUser = process.env["SMTP_USER"];
    const smtpPass = process.env["SMTP_PASS"];
    const smtpSecure = process.env["SMTP_SECURE"] === "true";

    transporter = createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      ...(smtpUser && smtpPass ? { auth: { user: smtpUser, pass: smtpPass } } : {}),
    });
  }
  return transporter;
}

const FROM_ADDRESS = process.env["EMAIL_FROM"] ?? "noreply@soup.net";
const APP_URL = process.env["FRONTEND_URL"] ?? "http://localhost:5273";

/** HTML-escape dynamic values inserted into email templates. */
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Logged sender ────────────────────────────────────────────────────────────
//
// Principle (engineering-principles.md §Outgoing email is logged): every
// outgoing email goes through sendLoggedMail so claimnet.email_log carries a
// complete record for the admin CRM view and security/abuse sweeps.
//
// Logs METADATA ONLY (recipient, kind, subject, status) — never the body.
// Bodies carry secrets (verification links, reset tokens, invite tokens);
// the log must not become a token archive.
//
// Retention: 60 days, purged opportunistically before each send — no
// scheduler to maintain, and the table stays bounded as long as email is
// being sent at all. Disclosed in the privacy policy §8.

export const EMAIL_LOG_RETENTION_DAYS = 60;

export type EmailKind =
  | "verification"
  | "password_reset"
  | "invitation"
  | "waitlist_spot_open";

async function sendLoggedMail(
  kind: EmailKind,
  mail: { to: string; subject: string; text: string; html: string },
): Promise<void> {
  const db = getDb();

  try {
    await db.execute(sql`
      DELETE FROM claimnet.email_log
      WHERE created_at < now() - make_interval(days => ${EMAIL_LOG_RETENTION_DAYS})
    `);
  } catch (err) {
    // Purge failure must never block sending mail.
    console.error("[email] Failed to purge email_log:", err);
  }

  let sendError: unknown = null;
  try {
    await getTransporter().sendMail({ from: FROM_ADDRESS, ...mail });
  } catch (err) {
    sendError = err;
  }

  try {
    const status = sendError ? "failed" : "sent";
    const errorText = sendError
      ? (sendError instanceof Error ? sendError.message : String(sendError))
      : null;
    await db.execute(sql`
      INSERT INTO claimnet.email_log (to_email, kind, subject, status, error)
      VALUES (${mail.to.toLowerCase().trim()}, ${kind}, ${mail.subject}, ${status}, ${errorText})
    `);
  } catch (err) {
    console.error("[email] Failed to write email_log row:", err);
  }

  if (sendError) throw sendError;
}

export async function sendVerificationEmail(
  email: string,
  token: string,
): Promise<void> {
  const verifyUrl = `${APP_URL}/auth/verify?token=${encodeURIComponent(token)}`;

  await sendLoggedMail("verification", {
    to: email,
    subject: "Verify your Soup.net account",
    text: `Welcome to Soup.net!\n\nPlease verify your email by visiting:\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't create an account, you can ignore this email.`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h1 style="color: #051a0f; font-size: 1.5rem;">Welcome to Soup.net</h1>
        <p>Please verify your email address to get started.</p>
        <a href="${verifyUrl}" style="display: inline-block; background: #051a0f; color: #fff; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-family: sans-serif; font-size: 0.9rem;">Verify Email</a>
        <p style="color: #737973; font-size: 0.85rem; margin-top: 1.5rem;">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
): Promise<void> {
  const resetUrl = `${APP_URL}/auth/reset-password?token=${encodeURIComponent(token)}`;

  await sendLoggedMail("password_reset", {
    to: email,
    subject: "Reset your Soup.net password",
    text: `Someone (hopefully you) requested a password reset for your Soup.net account.\n\nReset your password here:\n${resetUrl}\n\nThis link expires in 1 hour and can only be used once.\n\nIf you didn't request a reset, you can safely ignore this email — your password will not change.`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h1 style="color: #051a0f; font-size: 1.5rem;">Reset your Soup.net password</h1>
        <p>Someone (hopefully you) requested a password reset. Click the button below to choose a new password.</p>
        <a href="${resetUrl}" style="display: inline-block; background: #051a0f; color: #fff; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-family: sans-serif; font-size: 0.9rem;">Reset Password</a>
        <p style="color: #737973; font-size: 0.85rem; margin-top: 1.5rem;">This link expires in 1 hour and can only be used once. If you didn't request a reset, you can safely ignore this email — your password will not change.</p>
      </div>
    `,
  });
}

/**
 * Notify a waitlist signup that a spot opened. Sent only from the admin
 * Signups page (explicit per-entry action, never automatic). Spam-safety:
 * waitlist signups handed us their email asking for exactly this
 * notification, so this does not cross the no-emails-to-non-users policy
 * (ADR-0016) the way unsolicited invitation email would.
 */
export async function sendWaitlistSpotOpenEmail(email: string): Promise<void> {
  const registerUrl = `${APP_URL}/auth/register`;

  await sendLoggedMail("waitlist_spot_open", {
    to: email,
    subject: "A spot opened up on Soup.net",
    text: `You asked us to let you know — a spot just opened on Soup.net.\n\nRegister here:\n${registerUrl}\n\nSpots are first come, first served, so don't wait too long.`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h1 style="color: #051a0f; font-size: 1.5rem;">A spot opened up</h1>
        <p>You asked us to let you know — a spot just opened on Soup.net.</p>
        <a href="${registerUrl}" style="display: inline-block; background: #051a0f; color: #fff; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-family: sans-serif; font-size: 0.9rem;">Register</a>
        <p style="color: #737973; font-size: 0.85rem; margin-top: 1.5rem;">Spots are first come, first served, so don't wait too long.</p>
      </div>
    `,
  });
}

/**
 * UNUSED as of 2026-04-19 (commit 45fa4b2). The spam-safe invitation flow
 * deliberately does not send email from the server to invitees — the
 * inviter receives a copy-pasteable blurb and delivers it through their
 * own channel. See ADR-0016 "Update 2026-04-19", `docs/design-thinking.md
 * §Collaboration user stories` ("No emails to non-users" principle), and
 * `apps/backend/src/routes/groups.ts` POST /groups/:id/invite handler.
 *
 * Retained for possible future use cases that are NOT cross to that
 * policy — e.g. a password-reset-style "you have a pending invitation"
 * reminder to a user who is already verified and logged in, or admin-only
 * bulk invitations to pre-vetted addresses. Do not wire this back into
 * `POST /groups/:id/invite` without re-reading the spam-safety rationale.
 */
export async function sendInvitationEmail(
  email: string,
  inviterEmail: string,
  groupName: string,
  token: string,
): Promise<void> {
  const inviteUrl = `${APP_URL}/auth/register?invite=${encodeURIComponent(token)}`;

  await sendLoggedMail("invitation", {
    to: email,
    subject: `You've been invited to a recipe book on Soup.net`,
    text: `${inviterEmail} invited you to join the recipe book "${groupName}" on Soup.net.\n\nSign up here:\n${inviteUrl}\n\nThis invitation expires in 7 days.`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h1 style="color: #051a0f; font-size: 1.5rem;">You're invited to Soup.net</h1>
        <p><strong>${escHtml(inviterEmail)}</strong> invited you to join the recipe book <strong>&ldquo;${escHtml(groupName)}&rdquo;</strong>.</p>
        <a href="${inviteUrl}" style="display: inline-block; background: #051a0f; color: #fff; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-family: sans-serif; font-size: 0.9rem;">Accept Invitation</a>
        <p style="color: #737973; font-size: 0.85rem; margin-top: 1.5rem;">This invitation expires in 7 days.</p>
      </div>
    `,
  });
}
