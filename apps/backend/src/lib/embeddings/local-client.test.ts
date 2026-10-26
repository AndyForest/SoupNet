import { describe, it, expect } from "vitest";
import { applyHubEnv } from "./local-client";

// F124: transformers.js reads no Hugging Face env vars, so local-client.ts
// applies HF_HOME and the offline flags to its env object in code.
describe("applyHubEnv (F124)", () => {
  const fresh = () => ({ cacheDir: "/pkg/.cache/", allowRemoteModels: true });

  it("leaves transformers.js defaults alone when no variable is set", () => {
    const env = fresh();
    applyHubEnv(env, {});
    expect(env).toEqual(fresh());
  });

  it("uses HF_HOME as the cache directory", () => {
    const env = fresh();
    applyHubEnv(env, { HF_HOME: "/app/apps/backend/.hf-cache" });
    expect(env).toEqual({ cacheDir: "/app/apps/backend/.hf-cache", allowRemoteModels: true });
  });

  it("turns remote loading off for either offline flag, in any of huggingface_hub's true spellings", () => {
    for (const name of ["HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE"]) {
      for (const value of ["1", "true", "TRUE", "on", "Yes", " 1 "]) {
        const env = fresh();
        applyHubEnv(env, { [name]: value });
        expect(env.allowRemoteModels, `${name}=${value}`).toBe(false);
      }
    }
  });

  it("keeps remote loading on for an offline flag set to a false value", () => {
    for (const value of ["0", "false", "off", ""]) {
      const env = fresh();
      applyHubEnv(env, { HF_HUB_OFFLINE: value, TRANSFORMERS_OFFLINE: value });
      expect(env.allowRemoteModels, value).toBe(true);
    }
  });

  it("does nothing when the module exposes no env", () => {
    expect(() => applyHubEnv(undefined, { HF_HOME: "/x", HF_HUB_OFFLINE: "1" })).not.toThrow();
  });
});
