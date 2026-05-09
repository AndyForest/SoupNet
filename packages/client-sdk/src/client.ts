/**
 * Typed API client for ClaimNet.
 *
 * Used by:
 *   - apps/frontend (browser sessions via cookie auth)
 *   - future local agent clients (JWT or API key auth)
 *
 * The client talks only to documented REST endpoints.
 * It never imports Payload internals.
 *
 * See: technical_plan.md §10
 */
import type {
  ClaimRequest,
  CreateRequestBody,
  MatchRequestBody,
  SearchQuery,
  SearchResultItem,
  Claim,
  CreateClaimBody,
  CreateClaimResponse,
  Validation,
  CreateValidationBody,
  NodeCheckInBody,
  ClientNode,
} from "@soupnet/contracts";

export interface ClaimNetClientOptions {
  baseUrl: string;
  /** JWT for programmatic/agent access. Omit for browser cookie sessions. */
  apiKey?: string;
}

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export class ClaimNetClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(options: ClaimNetClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      credentials: "include", // cookie auth for browser sessions
      body: body !== undefined ? JSON.stringify(body) : null,
    });

    return res.json() as Promise<ApiResult<T>>;
  }

  // ── Requests ───────────────────────────────────────────────────────────────

  createRequest(body: CreateRequestBody): Promise<ApiResult<ClaimRequest>> {
    return this.request("POST", "/api/requests", body);
  }

  matchRequest(id: string, body: MatchRequestBody): Promise<ApiResult<SearchResultItem[]>> {
    return this.request("POST", `/api/requests/${id}/match`, body);
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  search(query: SearchQuery): Promise<ApiResult<SearchResultItem[]>> {
    return this.request("POST", "/api/search", query);
  }

  // ── Claims ─────────────────────────────────────────────────────────────────

  createClaim(body: CreateClaimBody): Promise<ApiResult<CreateClaimResponse>> {
    return this.request("POST", "/api/claims", body);
  }

  getClaim(id: string): Promise<ApiResult<Claim>> {
    return this.request("GET", `/api/claims/${id}`);
  }

  // ── Validations ────────────────────────────────────────────────────────────

  createValidation(claimId: string, body: CreateValidationBody): Promise<ApiResult<Validation>> {
    return this.request("POST", `/api/claims/${claimId}/validate`, body);
  }

  getValidation(id: string): Promise<ApiResult<Validation>> {
    return this.request("GET", `/api/validations/${id}`);
  }

  // ── Client nodes ───────────────────────────────────────────────────────────

  checkIn(body: NodeCheckInBody): Promise<ApiResult<ClientNode>> {
    return this.request("POST", "/api/client-nodes/check-in", body);
  }
}
