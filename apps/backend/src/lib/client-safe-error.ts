/**
 * Marker class for errors whose messages are deliberately written for the
 * caller — validation failures, size caps, MIME rejections. Catch-all
 * handlers surface ClientSafeError messages verbatim and replace everything
 * else with a generic body + server-side log (F47, security-audit-2026-06-11):
 * internal Error messages can carry implementation detail (driver errors,
 * upstream library strings) that doesn't belong in a response.
 *
 * Throw sites opt IN to client visibility by using this class; an unmarked
 * Error is internal by default, so new code fails closed.
 */
export class ClientSafeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ClientSafeError";
  }
}

/**
 * Resolve an unknown caught error to a client-visible message: ClientSafeError
 * messages pass through verbatim; anything else returns `generic` after the
 * raw error (message + cause) is written to the server log under `logPrefix`.
 */
export function publicErrorMessage(
  err: unknown,
  opts: { logPrefix: string; generic: string },
): string {
  if (err instanceof ClientSafeError) {
    return err.message;
  }
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause ? ` (cause: ${String(err.cause)})` : "";
  console.error(`${opts.logPrefix}: ${message}${cause}`);
  return opts.generic;
}
