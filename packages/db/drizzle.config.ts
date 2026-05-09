import { defineConfig } from "drizzle-kit";

function getDatabaseUrl(): string {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  const host = process.env["PGHOST"] ?? "localhost";
  const port = process.env["PGPORT"] ?? "5533";
  const user = process.env["PGUSER"] ?? "claimnet";
  const password = process.env["PGPASSWORD"] ?? "claimnet";
  const database = process.env["PGDATABASE"] ?? "claimnet";
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: getDatabaseUrl(),
  },
  // Only manage the claimnet schema — never touch public (Payload's territory)
  schemaFilter: ["claimnet"],
});
