/**
 * Adds `.openapi()` to zod. Imported first by openapi-registry.ts, before any
 * schema module: zod 4 binds a schema's methods when the schema is created,
 * so only schemas built after this runs get `.openapi()` (zod 3 patched the
 * prototype, which also reached schemas built earlier).
 */
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);
