/**
 * The authorization seam for human (JWT-path) recipe-book access.
 *
 *   book-access.ts     — who can see which books, role lookup
 *   trace-access.ts    — a viewer's standing on one recipe, in one statement
 *   memberships.ts     — the membership rows themselves
 *   book-succession.ts — membership questions account deletion asks
 *   roles.ts           — pure role predicates, and the trace read rule
 *   membership-sql.ts  — the membership condition, written once (internal:
 *                        deliberately not re-exported)
 *
 * Import from here. See docs/engineering-principles.md §7.
 */

export * from "./roles";
export * from "./book-access";
export * from "./trace-access";
export * from "./memberships";
export * from "./book-succession";
