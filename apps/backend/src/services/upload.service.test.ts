import { describe, it, expect } from "vitest";
import { parseOwnHostnameUpload } from "./upload.service";

describe("parseOwnHostnameUpload", () => {
  const HOST = "mcp.soup.net";
  const VALID_UUID = "9f3c2e1a-1234-5678-9abc-1234567890ab";

  it("extracts the UUID from a well-formed own-hostname URL", () => {
    const result = parseOwnHostnameUpload(`https://mcp.soup.net/uploads/${VALID_UUID}.png`, HOST);
    expect(result).toEqual({ id: VALID_UUID });
  });

  it("accepts URLs without an extension", () => {
    const result = parseOwnHostnameUpload(`https://mcp.soup.net/uploads/${VALID_UUID}`, HOST);
    expect(result).toEqual({ id: VALID_UUID });
  });

  it("accepts http (not just https) for dev parity", () => {
    const result = parseOwnHostnameUpload(`http://mcp.soup.net/uploads/${VALID_UUID}.png`, HOST);
    expect(result).toEqual({ id: VALID_UUID });
  });

  it("is case-insensitive on hostname", () => {
    const result = parseOwnHostnameUpload(`https://MCP.SOUP.NET/uploads/${VALID_UUID}.png`, HOST);
    expect(result).toEqual({ id: VALID_UUID });
  });

  it("ignores query strings and fragments after the path", () => {
    const result = parseOwnHostnameUpload(`https://mcp.soup.net/uploads/${VALID_UUID}.png?v=2#x`, HOST);
    expect(result).toEqual({ id: VALID_UUID });
  });

  it("accepts arbitrary file extensions (mime decided server-side)", () => {
    const result = parseOwnHostnameUpload(`https://mcp.soup.net/uploads/${VALID_UUID}.pdf`, HOST);
    expect(result).toEqual({ id: VALID_UUID });
  });

  it("rejects mismatched hostname", () => {
    const result = parseOwnHostnameUpload(`https://evil.com/uploads/${VALID_UUID}.png`, HOST);
    expect(result).toBeNull();
  });

  it("rejects substring-spoofed hostname (path-as-host attack)", () => {
    // Common SSRF mistake: substring check against the full URL would let
    // https://evil.com/mcp.soup.net/... match. URL.hostname only returns the
    // actual host, so this must reject.
    const result = parseOwnHostnameUpload(`https://evil.com/mcp.soup.net/uploads/${VALID_UUID}.png`, HOST);
    expect(result).toBeNull();
  });

  it("rejects subdomain spoofing", () => {
    const result = parseOwnHostnameUpload(`https://mcp.soup.net.evil.com/uploads/${VALID_UUID}.png`, HOST);
    expect(result).toBeNull();
  });

  it("rejects unsupported URL schemes", () => {
    expect(parseOwnHostnameUpload(`file:///uploads/${VALID_UUID}.png`, HOST)).toBeNull();
    expect(parseOwnHostnameUpload(`ftp://mcp.soup.net/uploads/${VALID_UUID}.png`, HOST)).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(parseOwnHostnameUpload("not a url", HOST)).toBeNull();
    expect(parseOwnHostnameUpload("", HOST)).toBeNull();
  });

  it("rejects non-uploads paths on the right host", () => {
    expect(parseOwnHostnameUpload(`https://mcp.soup.net/check/${VALID_UUID}.png`, HOST)).toBeNull();
    expect(parseOwnHostnameUpload(`https://mcp.soup.net/uploads/`, HOST)).toBeNull();
    expect(parseOwnHostnameUpload(`https://mcp.soup.net/`, HOST)).toBeNull();
  });

  it("rejects path traversal attempts in the upload id", () => {
    expect(parseOwnHostnameUpload(`https://mcp.soup.net/uploads/../etc/passwd`, HOST)).toBeNull();
    expect(parseOwnHostnameUpload(`https://mcp.soup.net/uploads/${VALID_UUID}/extra`, HOST)).toBeNull();
  });

  it("rejects non-UUID upload ids", () => {
    expect(parseOwnHostnameUpload(`https://mcp.soup.net/uploads/not-a-uuid.png`, HOST)).toBeNull();
    expect(parseOwnHostnameUpload(`https://mcp.soup.net/uploads/12345.png`, HOST)).toBeNull();
    // Truncated UUID
    expect(parseOwnHostnameUpload(`https://mcp.soup.net/uploads/9f3c2e1a-1234-5678-9abc.png`, HOST)).toBeNull();
  });

  it("tolerates a trailing slash on the path", () => {
    const result = parseOwnHostnameUpload(`https://mcp.soup.net/uploads/${VALID_UUID}.png/`, HOST);
    expect(result).toEqual({ id: VALID_UUID });
  });
});
