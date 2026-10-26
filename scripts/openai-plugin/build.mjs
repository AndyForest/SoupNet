#!/usr/bin/env node
// Build the OpenAI plugin ZIP from plugins/soupnet/: validate, then write
// dist/openai-plugin/soupnet-<version>.zip and print its SHA-256. The same
// source always gives the same bytes. Run from the repository root:
//   npm run build:openai-plugin

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPackage } from "./package.mjs";

try {
  const { zip, version, files, sha256 } = buildPackage();
  const outDir = join("dist", "openai-plugin");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `soupnet-${version}.zip`);
  writeFileSync(outFile, zip);
  console.log(`Wrote ${outFile} (${zip.length} bytes, ${files.length} files)`);
  for (const file of files) console.log(`  ${file}`);
  console.log(`SHA-256 ${sha256}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
