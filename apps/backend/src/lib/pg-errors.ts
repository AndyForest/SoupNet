/** Postgres unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Whether a write failed on this one unique constraint. Drizzle wraps driver
 * errors, so the postgres-js error carrying `code` and `constraint_name` may
 * sit on `.cause`. Any other failure answers false, so it still fails loudly.
 */
export function isUniqueViolationOn(err: unknown, constraint: string): boolean {
  let cur: unknown = err;
  for (let depth = 0; typeof cur === "object" && cur !== null && depth < 5; depth++) {
    const { code, constraint_name: name, cause } = cur as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (code === PG_UNIQUE_VIOLATION && name === constraint) return true;
    cur = cause;
  }
  return false;
}
