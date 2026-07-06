import { describe, it, expect } from "vitest";
import { isLoopbackOrigin } from "./local-origin";

describe("isLoopbackOrigin", () => {
  it("accepts http loopback hosts on any port", () => {
    expect(isLoopbackOrigin("http://localhost:5273")).toBe(true);
    expect(isLoopbackOrigin("http://localhost:5274")).toBe(true); // Vite auto-bump
    expect(isLoopbackOrigin("http://127.0.0.1:5273")).toBe(true);
    expect(isLoopbackOrigin("http://[::1]:5273")).toBe(true);
    expect(isLoopbackOrigin("http://localhost")).toBe(true);
  });

  it("rejects non-loopback and non-http origins", () => {
    expect(isLoopbackOrigin("https://evil.example")).toBe(false);
    expect(isLoopbackOrigin("http://localhost.evil.example:5273")).toBe(false);
    expect(isLoopbackOrigin("https://localhost:5273")).toBe(false); // https loopback isn't a dev shape we serve
    expect(isLoopbackOrigin("http://192.168.1.10:5273")).toBe(false); // LAN is not loopback
    expect(isLoopbackOrigin("null")).toBe(false);
    expect(isLoopbackOrigin("")).toBe(false);
  });
});
