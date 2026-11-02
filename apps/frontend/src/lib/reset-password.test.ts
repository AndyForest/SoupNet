import { describe, expect, it } from "vitest";
import { readResetAnswer } from "./reset-password";

const answering = (body: unknown) => Promise.resolve({ json: async () => body });

describe("readResetAnswer (F163)", () => {
  it("gives a sentence, not a parse error, when the server's error isn't JSON", async () => {
    const internalError = Promise.resolve({ json: async () => JSON.parse("Internal Server Error") as unknown });
    await expect(readResetAnswer(internalError)).rejects.toThrow(/went wrong on our side/);
  });

  it("gives the same sentence when the request never arrives", async () => {
    await expect(readResetAnswer(Promise.reject(new TypeError("Failed to fetch")))).rejects.toThrow(/went wrong on our side/);
  });

  it("prefers the server's message to its error code", async () => {
    await expect(readResetAnswer(answering({ ok: false, error: "sso_required", message: "Sign in with Google." }))).rejects.toThrow("Sign in with Google.");
    await expect(readResetAnswer(answering({ ok: false, error: "Invalid or expired reset token" }))).rejects.toThrow("Invalid or expired reset token");
  });

  it("reads what's still running", async () => {
    const stillRunning = { apiKeys: 1, connectedApps: 2 };
    await expect(readResetAnswer(answering({ ok: true, data: { stillRunning } }))).resolves.toEqual({ stillRunning });
    await expect(readResetAnswer(answering({ ok: true, data: {} }))).resolves.toEqual({ stillRunning: { apiKeys: 0, connectedApps: 0 } });
  });
});
