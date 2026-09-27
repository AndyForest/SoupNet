/**
 * The authorization seam for human (JWT-path) recipe-book access.
 *
 *   book-access.ts  — who can see which books, role lookup, trace read rule
 *   memberships.ts  — the membership rows themselves
 *   roles.ts        — pure role predicates
 *
 * Import from here. See docs/engineering-principles.md §7.
 */

export * from "./roles";
export * from "./book-access";
export * from "./memberships";
export * from "./book-succession";
