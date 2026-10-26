import { describe, expect, it } from "vitest";
import { sesHeaders, smtpTransportOptions } from "./email.service";

describe("sesHeaders (SES configuration-set tagging)", () => {
  it("returns the X-SES-CONFIGURATION-SET header when a set name is configured", () => {
    expect(sesHeaders("soupnet-dev-transactional")).toEqual({
      "X-SES-CONFIGURATION-SET": "soupnet-dev-transactional",
    });
  });

  it("returns no headers when unset — local Mailpit and self-hosters without SES", () => {
    expect(sesHeaders(undefined)).toEqual({});
    expect(sesHeaders("")).toEqual({});
  });
});

// F123: STARTTLS is required on every non-secure connection that leaves the
// machine, so a stripped STARTTLS offer cannot send the credentials in clear.
describe("smtpTransportOptions (F123, requireTLS)", () => {
  const ses = { SMTP_HOST: "email-smtp.us-east-1.amazonaws.com", SMTP_PORT: "587", SMTP_USER: "u", SMTP_PASS: "p" };

  it("requires STARTTLS on a remote relay without implicit TLS, which is the production SES shape", () => {
    expect(smtpTransportOptions({ ...ses, SMTP_SECURE: "false" })).toEqual({
      host: "email-smtp.us-east-1.amazonaws.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "u", pass: "p" },
    });
    expect(smtpTransportOptions(ses).requireTLS).toBe(true);
  });

  it("leaves requireTLS off under implicit TLS (port 465), where the whole session is already encrypted", () => {
    const o = smtpTransportOptions({ ...ses, SMTP_PORT: "465", SMTP_SECURE: "true" });
    expect(o.secure).toBe(true);
    expect(o.requireTLS).toBe(false);
  });

  it("leaves requireTLS off for a local relay (Mailpit offers no STARTTLS), by host name or address", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "mailpit", "Mailpit"]) {
      expect(smtpTransportOptions({ SMTP_HOST: host, SMTP_PORT: "1025" }).requireTLS, host).toBe(false);
    }
    expect(smtpTransportOptions({}).requireTLS).toBe(false);
  });

  it("lets SMTP_REQUIRE_TLS override the default either way", () => {
    expect(smtpTransportOptions({ ...ses, SMTP_REQUIRE_TLS: "false" }).requireTLS).toBe(false);
    expect(smtpTransportOptions({ SMTP_HOST: "mailpit", SMTP_REQUIRE_TLS: "true" }).requireTLS).toBe(true);
  });

  it("sends no auth block without both a user and a password", () => {
    expect(smtpTransportOptions({ ...ses, SMTP_PASS: "" })).not.toHaveProperty("auth");
  });
});
