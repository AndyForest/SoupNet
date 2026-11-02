import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const { clearToken, getSignupProof, setSignupProof, setToken } = await import("./auth.js");

describe("the sign-up proof", () => {
  beforeEach(() => store.clear());

  it("ACC-VERIFY-23: signing out ends it", () => {
    setToken("a-session");
    setSignupProof("a-proof");
    clearToken();
    expect(getSignupProof()).toBeNull();
  });
});
