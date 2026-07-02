/**
 * Canonical email form: trimmed + lowercased.
 *
 * Emails are canonicalized at EVERY write and lookup boundary (register,
 * login, invites, member-add, password reset) so equality on
 * `users.email` / `invitations.email` is byte-exact everywhere — no query
 * needs to know about case. Migration 0027 lowercased pre-existing rows.
 *
 * RFC 5321 technically allows case-sensitive local parts, but no real
 * mail provider distinguishes them, and treating "Alice@x.com" and
 * "alice@x.com" as different accounts produced invisible invitations
 * (invite stored lowercase, user stored as typed — the pending query
 * never matched).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
