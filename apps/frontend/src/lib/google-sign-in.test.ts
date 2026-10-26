import { describe, it, expect } from "vitest";
import {
  newTabSecret,
  sha256Base64Url,
  returnTargetFor,
  authorizeTargetFrom,
  readCompleteFragment,
  googleSignInMessage,
} from "./google-sign-in.js";

describe("the tab secret", () => {
  it("is 43 base64url characters, fresh each time", () => {
    const a = newTabSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newTabSecret()).not.toBe(a);
  });

  it("hashes as the backend does (SHA-256, base64url; RFC 7636 Appendix B)", async () => {
    expect(await sha256Base64Url("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("returnTargetFor (SSO-U1, SSO-U2)", () => {
  it("returns to an app path", () => {
    expect(returnTargetFor("/app/drafts?ids=a")).toEqual({ kind: "app", path: "/app/drafts?ids=a" });
  });

  it("returns to the consent page with its parameters", () => {
    const next = "/oauth/authorize?response_type=code&client_id=c&redirect_uri=https%3A%2F%2Fx.example%2Fcb&state=s&code_challenge=abc&code_challenge_method=S256&scope=read&resource=https%3A%2F%2Fmcp.example";
    expect(returnTargetFor(next)).toEqual({
      kind: "oauth_authorize",
      params: {
        response_type: "code",
        client_id: "c",
        redirect_uri: "https://x.example/cb",
        state: "s",
        code_challenge: "abc",
        code_challenge_method: "S256",
        scope: "read",
        resource: "https://mcp.example",
      },
    });
  });

  it("is null for anything the return rule refuses", () => {
    expect(returnTargetFor(null)).toBeNull();
    expect(returnTargetFor("https://evil.example/app/x")).toBeNull();
    expect(returnTargetFor("/oauth/authorize/grant")).toBeNull();
  });

  it("fills absent authorize parameters with empty strings", () => {
    expect(authorizeTargetFrom("?client_id=c")).toMatchObject({ kind: "oauth_authorize", params: { client_id: "c", scope: "", resource: "" } });
  });
});

describe("readCompleteFragment (SSO-U3)", () => {
  it("reads a handoff code or an error code", () => {
    const code = "a".repeat(43);
    expect(readCompleteFragment(`#handoff=${code}`)).toEqual({ handoff: code });
    expect(readCompleteFragment("#error=expired")).toEqual({ error: "expired" });
  });

  it("ignores anything malformed", () => {
    expect(readCompleteFragment("")).toBeNull();
    expect(readCompleteFragment("#handoff=short")).toBeNull();
    expect(readCompleteFragment("#error=<script>")).toBeNull();
  });
});

describe("the outcome copy", () => {
  // The backend's closed list (@soupnet/domain GOOGLE_SIGN_IN_ERRORS). The
  // SPA keeps its own copy of the sentences; the backend's suite checks they
  // match word for word (routes/google-auth.test.ts).
  const codes = ["expired", "cancelled", "not_authoritative", "different_google_account", "sso_required_workspace", "waitlisted", "organization_full", "account_disabled", "account_suspended", "reauthenticate", "failed"];

  it("has a sentence for every code the callback can name", () => {
    for (const code of codes.filter((c) => c !== "failed")) expect(googleSignInMessage(code), code).not.toBe(googleSignInMessage("failed"));
  });

  it("falls back to the failure copy", () => {
    expect(googleSignInMessage("nope")).toBe(googleSignInMessage("failed"));
  });
});
