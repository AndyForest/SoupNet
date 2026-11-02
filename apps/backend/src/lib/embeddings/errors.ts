/**
 * Embedding provider failures, classified by whose fault they are.
 *
 * The async pipeline's binary-split retry exists to isolate a row the provider
 * refuses (a poison pill). A rate limit, an outage, a revoked key or a model the
 * provider has stopped serving is nobody's row's fault: treating those as poison
 * marks healthy rows `failed` for good, which is how a burst of 429s used to end
 * a rebuild. See ADR-0024.
 */

export class EmbeddingHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryAfterMs: number | undefined;

  constructor(label: string, status: number, body: string, retryAfterMs?: number) {
    super(`${label} embedding API error ${status}: ${body}`);
    this.name = "EmbeddingHttpError";
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Read a provider's "come back in N" hint: the Retry-After header (seconds or an
 * HTTP date), else the `retryDelay` Google puts in the error body ("37s").
 */
export function parseRetryAfterMs(
  retryAfterHeader: string | null,
  body: string,
  now: number = Date.now(),
): number | undefined {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const at = Date.parse(retryAfterHeader);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  if (match) return Number(match[1]) * 1000;
  return undefined;
}

/**
 * True when the provider, not the row, is the problem, so the rows should go back
 * to `pending` and the caller should back off. False leaves the poison-pill path
 * to isolate the row. Google answers a bad API key, and an account precondition such as
 * billing, with a 400, hence the body check.
 */
export function isProviderSideFailure(err: unknown): boolean {
  if (err instanceof EmbeddingHttpError) {
    if ([401, 403, 404, 408, 429].includes(err.status)) return true;
    if (err.status >= 500) return true;
    return err.body.includes("API_KEY_INVALID") || err.body.includes("FAILED_PRECONDITION");
  }
  if (err instanceof Error) {
    // fetch: TypeError on a network failure, TimeoutError on AbortSignal.timeout.
    return err.name === "TimeoutError" || err.name === "AbortError" || err instanceof TypeError;
  }
  return false;
}
