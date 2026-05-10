import { createTransport } from "nodemailer";
import type { Transporter } from "nodemailer";

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

export async function sendVerificationEmail(
  email: string,
  token: string,
): Promise<void> {
  const verifyUrl = `${APP_URL}/auth/verify?token=${encodeURIComponent(token)}`;

  await getTransporter().sendMail({
    from: FROM_ADDRESS,
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

  await getTransporter().sendMail({
    from: FROM_ADDRESS,
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

  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: email,
    subject: `You've been invited to a group on Soup.net`,
    text: `${inviterEmail} invited you to join the group "${groupName}" on Soup.net.\n\nSign up here:\n${inviteUrl}\n\nThis invitation expires in 7 days.`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
        <h1 style="color: #051a0f; font-size: 1.5rem;">You're invited to Soup.net</h1>
        <p><strong>${escHtml(inviterEmail)}</strong> invited you to join the group <strong>&ldquo;${escHtml(groupName)}&rdquo;</strong>.</p>
        <a href="${inviteUrl}" style="display: inline-block; background: #051a0f; color: #fff; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-family: sans-serif; font-size: 0.9rem;">Accept Invitation</a>
        <p style="color: #737973; font-size: 0.85rem; margin-top: 1.5rem;">This invitation expires in 7 days.</p>
      </div>
    `,
  });
}
