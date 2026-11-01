// The OpenAI plugin package: validation and a reproducible ZIP.
//
// plugins/soupnet/ is the one source for the plugin directory upload and the
// repository's Codex marketplace (.agents/plugins/marketplace.json). This
// module checks that source against OpenAI's published submission limits
// (developers.openai.com/plugins/deploy/submission.md, read 2026-10-26) and
// writes the ZIP with sorted entries and fixed timestamps, so the same source
// always gives the same bytes. Build plan: docs/planning/openai-plugin-build/
// listing.md, rows L7 to L9.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

export const PACKAGE_DIR = "plugins/soupnet";

const MIB = 1024 * 1024;
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".svg"];
const FORBIDDEN_NAMES = ["test_credentials", "reviewer_instructions"];
const REQUIRED_URLS = ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"];

// Only these files may ship, so a stray note or credential file can't ride
// along: the manifest, the server config, images under assets/, and skills.
const ALLOWED_FILES = [
  /^plugin\.json$/,
  /^mcp\.json$/,
  /^assets\/[a-z0-9-]+\.(png|jpe?g|webp|svg)$/,
  /^skills\/[a-z0-9-]+\/SKILL\.md$/,
];

// Credential-shaped strings refused in any text file of the package. The
// public support address is the one email allowed.
const PUBLIC_EMAILS = ["admin@soup.net"];
const SECRET_PATTERNS = [
  { name: "a Soup.net API key", pattern: /\bcn_[a-z]_[A-Za-z0-9]{16,}/ },
  { name: "an OpenAI-style secret key", pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: "an AWS access key", pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "a JSON web token", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./ },
  { name: "a bearer token", pattern: /\bBearer\s+(?!YOUR_|<)[A-Za-z0-9._~+/-]{16,}/ },
  { name: "a private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "a password assignment", pattern: /\bpass(word)?\s*[:=]\s*\S+/i },
];

/** Problems with credential-shaped content in one text file. */
export function scanForSecrets(name, text) {
  const problems = [];
  for (const { name: what, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) problems.push(`${name} contains ${what}`);
  }
  for (const email of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
    if (!PUBLIC_EMAILS.includes(email.toLowerCase())) problems.push(`${name} contains an email address other than the public support address: ${email}`);
  }
  return problems;
}

/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #RRGGBB colours, from 1 to 21. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Width and height of a PNG from its IHDR chunk, or null if it isn't one. */
export function pngSize(buf) {
  const signature = "89504e470d0a1a0a";
  if (buf.length < 24 || buf.subarray(0, 8).toString("hex") !== signature) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Claude's plugin files share this directory but aren't part of OpenAI's package.
const NOT_PACKAGED = new Set([".claude-plugin", "README.md"]);

/** Every packaged file under dir as a sorted list of posix paths relative to dir. */
export function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (current === dir && NOT_PACKAGED.has(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join(posix.sep));
    }
  };
  walk(dir);
  return out.sort();
}

function isHttpsUrl(value, maxLength) {
  if (typeof value !== "string" || value.length > maxLength) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function checkAssetPath(dir, field, value, errors) {
  if (typeof value !== "string" || !value.startsWith("./")) {
    errors.push(`${field} must be a path starting with ./`);
    return;
  }
  const full = resolve(dir, value);
  if (!full.startsWith(resolve(dir) + sep)) {
    errors.push(`${field} must stay inside the plugin root`);
    return;
  }
  if (!existsSync(full)) {
    errors.push(`${field} points at ${value}, which doesn't exist`);
    return;
  }
  const ext = posix.extname(value).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(ext)) errors.push(`${field} must be PNG, JPEG, WebP or SVG`);
  if (statSync(full).size > 5 * MIB) errors.push(`${field} is over 5 MiB`);
  if (ext === ".png") {
    const size = pngSize(readFileSync(full));
    if (!size) errors.push(`${field} is not a valid PNG`);
    else if (size.width !== size.height) errors.push(`${field} is ${size.width}x${size.height}; it must be square`);
    else if (size.width < 48 || size.width > 4096) errors.push(`${field} is ${size.width} px; it must be 48 to 4096`);
  }
}

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return fields;
}

/**
 * Check the package directory against the submission limits. Returns the
 * list of problems, empty when the package is ready to zip.
 */
export function validatePackage(dir = PACKAGE_DIR) {
  const errors = [];
  const files = listFiles(dir);
  const manifest = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf-8"));
  const mcp = JSON.parse(readFileSync(join(dir, "mcp.json"), "utf-8"));

  // Package identity.
  if (manifest.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json") errors.push("plugin.json needs the portable plugin schema");
  if (mcp.$schema !== "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json") errors.push("mcp.json needs the portable MCP schema");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.name ?? "") || manifest.name.length > 64) {
    errors.push("name must be kebab-case, at most 64 characters");
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) errors.push("version must be semver (x.y.z)");
  if (typeof manifest.description !== "string" || manifest.description.length > 4000) {
    errors.push("description must be at most 4,000 characters");
  }
  if (!manifest.author?.name || manifest.author.name.length > 120) errors.push("author.name must be 1 to 120 characters");
  if (manifest.author?.url !== undefined && !isHttpsUrl(manifest.author.url, 2048)) errors.push("author.url must be HTTPS");

  const openai = manifest.extensions?.["com.openai"] ?? {};
  if (openai.apps !== undefined) errors.push("apps can't be submitted publicly");
  if (openai.hooks !== undefined) errors.push("hooks can't be submitted publicly");

  // Listing metadata.
  const ui = openai.interface ?? {};
  for (const [field, max] of [["displayName", 30], ["shortDescription", 30], ["longDescription", 4000]]) {
    if (typeof ui[field] !== "string" || ui[field].length === 0 || ui[field].length > max) {
      errors.push(`${field} is required, at most ${max} characters`);
    }
  }
  if (/\b(mcp|plugin)\b/i.test(ui.displayName ?? "")) errors.push("displayName must not carry MCP or Plugin");
  if (!ui.category) errors.push("category is required");
  if (typeof ui.developerName !== "string" || !ui.developerName.trim() || ui.developerName.length > 80) errors.push("developerName is required, at most 80 characters");
  if (!Array.isArray(ui.capabilities) || ui.capabilities.length > 20 || ui.capabilities.some((c) => c.length > 120)) {
    errors.push("capabilities must be an array of at most 20 entries, each at most 120 characters");
  }
  const prompts = ui.defaultPrompt ?? [];
  if (!Array.isArray(prompts) || prompts.length > 3) errors.push("defaultPrompt takes at most three prompts");
  if (new Set(prompts).size !== prompts.length) errors.push("defaultPrompt entries must be unique");
  for (const prompt of prompts) {
    if (prompt.length > 128) errors.push(`defaultPrompt over 128 characters: ${prompt}`);
    if (prompt.includes("@")) errors.push(`defaultPrompt must not mention an app with @: ${prompt}`);
  }
  for (const field of REQUIRED_URLS) {
    if (!isHttpsUrl(ui[field], 1024)) errors.push(`${field} must be an HTTPS URL of at most 1,024 characters`);
  }
  for (const [field, background] of [["brandColor", "#ffffff"], ["brandColorDark", "#212121"]]) {
    const colour = ui[field];
    if (!/^#[0-9a-fA-F]{6}$/.test(colour ?? "")) errors.push(`${field} must be #RRGGBB`);
    else if (contrastRatio(colour, background) < 2) errors.push(`${field} needs at least 2:1 contrast against ${background}`);
  }
  checkAssetPath(dir, "logo", ui.logo, errors);
  checkAssetPath(dir, "composerIcon", ui.composerIcon, errors);
  // House rule: "taste" and "judgment" travel as a pair in listing copy.
  for (const field of ["shortDescription", "longDescription"]) {
    const text = (ui[field] ?? "").toLowerCase();
    if (text.includes("taste") !== text.includes("judgment")) errors.push(`${field} uses "taste" or "judgment" without the other`);
  }

  // Review test cases: five positive, three negative.
  const cases = openai.review?.test_cases ?? {};
  const positive = cases.positive ?? [];
  const negative = cases.negative ?? [];
  if (positive.length !== 5) errors.push(`expected 5 positive test cases, found ${positive.length}`);
  if (negative.length !== 3) errors.push(`expected 3 negative test cases, found ${negative.length}`);
  positive.forEach((c, i) => {
    for (const field of ["description", "prompt", "expected_behavior"]) {
      if (typeof c[field] !== "string" || c[field].length === 0) errors.push(`positive case ${i + 1} needs ${field}`);
    }
    if (typeof c.tools_triggered !== "string" || c.tools_triggered.trim().length === 0) errors.push(`positive case ${i + 1} needs tools_triggered as a nonempty string`);
    if ((c.description ?? "").length > 4000) errors.push(`positive case ${i + 1} description is over 4,000 characters`);
  });
  negative.forEach((c, i) => {
    for (const field of ["description", "prompt"]) {
      if (typeof c[field] !== "string" || c[field].length === 0) errors.push(`negative case ${i + 1} needs ${field}`);
    }
  });

  // MCP configuration: one remote server, OAuth with dynamic registration.
  const servers = Object.values(mcp.mcpServers ?? {});
  if (servers.length !== 1) errors.push(`mcp.json must declare exactly one server, found ${servers.length}`);
  for (const server of servers) {
    if (server.type !== "streamable-http") errors.push("the server type must be streamable-http");
    if (!isHttpsUrl(server.url, 2048)) errors.push("the server url must be HTTPS");
    if (server.headers && Object.keys(server.headers).length > 0) errors.push("server headers must be empty for public submission");
    const auth = server.extensions?.["com.openai"]?.auth;
    if (auth?.type !== "oauth" || auth?.client?.mode !== "dcr") errors.push("auth must be oauth with client mode dcr");
    if (auth?.client?.clientId || auth?.client?.clientSecret) errors.push("a dcr client carries no client id or secret");
  }

  // Files: nothing the public submission rejects.
  for (const file of files) {
    if (!ALLOWED_FILES.some((allowed) => allowed.test(file))) errors.push(`not on the package's file allowlist: ${file}`);
    if (/\.(json|md|svg)$/.test(file)) errors.push(...scanForSecrets(file, readFileSync(join(dir, file), "utf-8")));
    const parts = file.split("/");
    if (parts.some((p) => FORBIDDEN_NAMES.some((name) => p.toLowerCase().startsWith(name)))) errors.push(`forbidden file name: ${file}`);
    if (parts[0] === "hooks" || parts.at(-1) === ".app.json") errors.push(`not allowed in a public submission: ${file}`);
  }
  const raw = readFileSync(join(dir, "plugin.json"), "utf-8");
  for (const name of FORBIDDEN_NAMES) if (raw.includes(name)) errors.push(`plugin.json mentions ${name}`);

  // Skills: frontmatter with name and description.
  const skills = files.filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f));
  if (skills.length > 5) errors.push("at most five skills");
  for (const skill of skills) {
    const text = readFileSync(join(dir, skill), "utf-8");
    const fields = frontmatter(text);
    if (!fields?.name || !fields?.description) errors.push(`${skill} needs name and description frontmatter`);
    if (Buffer.byteLength(text) > 256 * 1024) errors.push(`${skill} is over 256 KiB`);
  }

  return errors;
}

// A DOS timestamp of 1980-01-01 00:00, the earliest a ZIP can hold, on every
// entry so the archive doesn't depend on when or where it was built.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** A deflated ZIP of the given files, in the order given, with fixed timestamps. */
export function zipFiles(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf-8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** The package as ZIP bytes; throws with every problem if it doesn't validate. */
export function buildPackage(dir = PACKAGE_DIR) {
  const errors = validatePackage(dir);
  if (errors.length > 0) throw new Error(`The plugin package doesn't validate:\n- ${errors.join("\n- ")}`);
  const entries = listFiles(dir).map((name) => ({ name, data: readFileSync(join(dir, name)) }));
  const zip = zipFiles(entries);
  const { version } = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf-8"));
  return { zip, version, files: entries.map((e) => e.name), sha256: createHash("sha256").update(zip).digest("hex") };
}
