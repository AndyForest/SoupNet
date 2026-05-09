/**
 * Generates the ClaimNet OpenAPI JSON spec from the Zod registry and writes
 * it to packages/api-client/openapi.json (the committed snapshot Orval reads).
 *
 * Run via: npm run generate:openapi (root) or npm run generate (packages/contracts)
 *
 * Chain:
 *   1. This script → packages/api-client/openapi.json
 *   2. npm run generate:api-client (Orval) → packages/api-client/src/generated/
 *
 * See docs/architecture/api.md §Generation workflow
 */
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { generateOpenApiSpec } from "../src/openapi-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(__dirname, "../../api-client/openapi.json");

const spec = generateOpenApiSpec();
writeFileSync(outputPath, JSON.stringify(spec, null, 2) + "\n", "utf-8");
console.log(`✓ OpenAPI spec written to ${outputPath}`);
