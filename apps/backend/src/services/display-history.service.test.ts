import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { cleanupDisplayHistory, DISPLAY_HISTORY_RETENTION_DAYS } from "./display-history.service";

// Display-history retention (privacy policy §8, OpenAI plugin round stream L):
// rows past 30 days go, rows inside the 7-day read window stay. Fixtures are
// inserted directly with backdated timestamps under ids unique to this run,
// and the sweep is called unthrottled.
const HAS_DB = Boolean(process.env["PGHOST"] || process.env["DATABASE_URL"]);
const uid = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

describe.skipIf(!HAS_DB)("cleanupDisplayHistory (DB fixtures)", () => {
  const db = getDb();
  const sessionId = `sess_dh_${uid}`;
  const intentId = `int_dh_${uid}`;

  afterAll(async () => {
    await db.execute(sql`DELETE FROM claimnet.session_shown WHERE session_id = ${sessionId}`);
    // intent_shown rows cascade with the intent.
    await db.execute(sql`DELETE FROM claimnet.intents WHERE id = ${intentId}`);
  });

  it("keeps a 30-day retention, past the 7-day read window", () => {
    expect(DISPLAY_HISTORY_RETENTION_DAYS).toBeGreaterThan(7);
  });

  it("deletes session history older than the retention and keeps recent rows", async () => {
    await db.execute(sql`
      INSERT INTO claimnet.session_shown (session_id, trace_id, shown_at)
      VALUES (${sessionId}, gen_random_uuid(), NOW() - INTERVAL '45 days'),
             (${sessionId}, gen_random_uuid(), NOW() - INTERVAL '2 days')
    `);

    await cleanupDisplayHistory(db);

    const rows = (await db.execute(sql`
      SELECT shown_at FROM claimnet.session_shown WHERE session_id = ${sessionId}
    `)) as unknown as Array<{ shown_at: string }>;
    expect(rows).toHaveLength(1);
    expect(Date.now() - new Date(rows[0]!.shown_at).getTime()).toBeLessThan(7 * 24 * 60 * 60 * 1000);
  });

  it("deletes intent history older than the retention and keeps recent rows", async () => {
    const [user] = (await db.execute(sql`SELECT id FROM claimnet.users LIMIT 1`)) as unknown as Array<{ id: string }>;
    expect(user, "the test database has at least one user (the seeded dev or test account)").toBeDefined();
    await db.execute(sql`
      INSERT INTO claimnet.intents (id, user_id, story) VALUES (${intentId}, ${user!.id}::uuid, 'display-history retention fixture')
    `);
    await db.execute(sql`
      INSERT INTO claimnet.intent_shown (intent_id, trace_id, shown_at)
      VALUES (${intentId}, gen_random_uuid(), NOW() - INTERVAL '45 days'),
             (${intentId}, gen_random_uuid(), NOW() - INTERVAL '2 days')
    `);

    await cleanupDisplayHistory(db);

    const rows = (await db.execute(sql`
      SELECT shown_at FROM claimnet.intent_shown WHERE intent_id = ${intentId}
    `)) as unknown as Array<{ shown_at: string }>;
    expect(rows).toHaveLength(1);
  });
});
