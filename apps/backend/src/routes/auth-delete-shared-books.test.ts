import { describe, it, expect } from "vitest";
import postgres from "postgres";

/**
 * Integration tests for what account deletion does to recipe books [F70].
 *
 * DELETE /auth/me removes what the departing user AUTHORED. A recipe book
 * they own that other people still belong to is handed on, not destroyed:
 *
 *   - the book keeps its id, so other members' recipes, memberships and
 *     already-issued API keys keep working
 *   - ownership passes to an existing co-owner, else the longest-standing
 *     admin, else the longest-standing member, preferring accounts that can
 *     act (verified, not waitlisted) [F75]
 *   - the book is re-homed into the new owner's personal organization (the
 *     departing user's organization is removed), with the slug de-duplicated
 *     only when the new organization already uses it
 *   - the hand-over is recorded in audit_log
 *
 * A book with no other members is still deleted with the account.
 *
 * Requires a running backend (BACKEND_URL) with EMBEDDINGS_PROVIDER=stub and
 * direct DB access via PG* env vars — same setup as auth-delete-cascade.test.ts.
 */

const BASE = process.env["BACKEND_URL"] ?? "";

interface TestUser {
  token: string;
  userId: string;
  email: string;
  password: string;
  personalOrgId: string;
}

function makeSql() {
  return postgres({
    host: process.env["PGHOST"] ?? "localhost",
    port: Number(process.env["PGPORT"] ?? 5633),
    user: process.env["PGUSER"] ?? "claimnet",
    password: process.env["PGPASSWORD"] ?? "claimnet",
    database: process.env["PGDATABASE"] ?? "claimnet",
  });
}

type Sql = ReturnType<typeof makeSql>;

let userCounter = 0;

async function provisionUser(sql: Sql, suffix: string): Promise<TestUser> {
  const email = `handover-${Date.now()}-${userCounter++}-${suffix}@test.local`;
  const password = "handover-test-password-123";
  const reg = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tosAccepted: true }),
  });
  const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
  const vtok = regBody.data?.verificationToken;
  if (!vtok) throw new Error("Setup: verificationToken missing");
  await fetch(`${BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: vtok }),
  });
  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = (await login.json()) as { data?: { token?: string } };
  const token = loginBody.data?.token;
  if (!token) throw new Error("Setup: login failed");
  const rows: Array<{ id: string; personal_organization_id: string | null }> = await sql`
    SELECT id, personal_organization_id FROM claimnet.users WHERE email = ${email}
  `;
  const row = rows[0];
  if (!row?.personal_organization_id) throw new Error("Setup: user has no personal organization");
  return { token, userId: row.id, email, password, personalOrgId: row.personal_organization_id };
}

/**
 * An account that exists but cannot act: registered and never verified (no
 * session, no key). Only the id and personal organization are meaningful.
 */
async function provisionUnverifiedUser(sql: Sql, suffix: string): Promise<TestUser> {
  const email = `handover-${Date.now()}-${userCounter++}-${suffix}@test.local`;
  const password = "handover-test-password-123";
  const reg = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tosAccepted: true }),
  });
  if (!reg.ok) throw new Error(`Setup: register failed (status ${reg.status})`);
  const rows: Array<{ id: string; personal_organization_id: string | null }> = await sql`
    SELECT id, personal_organization_id FROM claimnet.users WHERE email = ${email}
  `;
  const row = rows[0];
  if (!row?.personal_organization_id) throw new Error("Setup: user has no personal organization");
  return { token: "", userId: row.id, email, password, personalOrgId: row.personal_organization_id };
}

/** Create a recipe book owned by `owner` in their personal org. Returns its id. */
async function createBook(owner: TestUser, slug: string): Promise<string> {
  const res = await fetch(`${BASE}/recipe-books`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({ name: `Book ${slug}`, slug, organizationId: owner.personalOrgId }),
  });
  const body = (await res.json()) as { data?: { id?: string } };
  const id = body.data?.id;
  if (!id) throw new Error(`Setup: recipe book create failed (status ${res.status})`);
  return id;
}

/** Fixture membership via SQL so role and joined_at are deterministic. */
async function addMember(
  sql: Sql,
  groupId: string,
  user: TestUser,
  role: "owner" | "admin" | "member",
  joinedAt: string,
): Promise<void> {
  await sql`
    INSERT INTO claimnet.group_members (group_id, user_id, role, daily_read, daily_write, joined_at)
    VALUES (${groupId}::uuid, ${user.userId}::uuid, ${role}, true, true, ${joinedAt}::timestamptz)
  `;
}

async function mintDailyKey(jwt: string): Promise<string> {
  const keyRes = await fetch(`${BASE}/keys/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  });
  const keyBody = (await keyRes.json()) as { data?: { key?: string } };
  const key = keyBody.data?.key;
  if (!key) throw new Error("Setup: daily key mint failed");
  return key;
}

async function checkRecipe(apiKey: string, bookSlug: string, recipe: string, evidence: string): Promise<string> {
  const params = new URLSearchParams({
    key: apiKey,
    trace: recipe,
    ef: evidence,
    recipe_book: bookSlug,
    format: "json",
  });
  const res = await fetch(`${BASE}/check?${params.toString()}`, { headers: { Accept: "application/json" } });
  const json = (await res.json()) as { data?: { checked?: { recipeId?: string } } };
  const traceId = json.data?.checked?.recipeId ?? "";
  if (!traceId) throw new Error(`/check did not return a recipeId (status ${res.status})`);
  return traceId;
}

async function deleteAccount(user: TestUser): Promise<Response> {
  return fetch(`${BASE}/auth/me`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
    body: JSON.stringify({ password: user.password }),
  });
}

async function bookRow(sql: Sql, groupId: string) {
  const rows: Array<{ id: string; slug: string; organization_id: string }> = await sql`
    SELECT id, slug, organization_id FROM claimnet.groups WHERE id = ${groupId}::uuid
  `;
  return rows[0];
}

async function roleOf(sql: Sql, groupId: string, userId: string): Promise<string | undefined> {
  const rows: Array<{ role: string }> = await sql`
    SELECT role FROM claimnet.group_members
    WHERE group_id = ${groupId}::uuid AND user_id = ${userId}::uuid
  `;
  return rows[0]?.role;
}

async function count(rows: Promise<Array<{ n: number }>>): Promise<number> {
  return (await rows)[0]!.n;
}

describe.skipIf(!BASE)("DELETE /auth/me — shared recipe books are handed on, not destroyed [F70]", () => {
  it("keeps a co-author's recipes, evidence, membership and API key working; removes only what the owner authored", { timeout: 90_000 }, async () => {
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "owner");
      const coAuthor = await provisionUser(sql, "coauthor");
      const slug = `shared-${Date.now().toString(36)}`;
      const bookId = await createBook(owner, slug);
      await addMember(sql, bookId, coAuthor, "member", "2026-01-01T00:00:00Z");

      // Keys are minted AFTER the membership exists (scope is captured at mint).
      const ownerKey = await mintDailyKey(owner.token);
      const coAuthorKey = await mintDailyKey(coAuthor.token);

      const now = Date.now();
      const ownerTrace = await checkRecipe(
        ownerKey, slug,
        `As a book owner working on a shared notebook, I prefer my own notes to leave with me so that deletion means deletion. (${now})`,
        `Owner-authored fixture.\n> "owner authored this"\n-- handover test fixture (owner) ${now}`,
      );
      const coAuthorTrace = await checkRecipe(
        coAuthorKey, slug,
        `As a contributor working on a shared notebook, I prefer my recipes to outlive a colleague's departure so that nobody's work disappears. (${now})`,
        `Co-author fixture.\n> "co-author authored this"\n-- handover test fixture (co-author) ${now}`,
      );

      const coEvidenceIds = (await sql`
        SELECT evidence_id AS id FROM claimnet.trace_evidence WHERE trace_id = ${coAuthorTrace}::uuid
      ` as Array<{ id: string }>).map((r) => r.id);
      const coReferenceIds = (await sql`
        SELECT reference_id AS id FROM claimnet.trace_references WHERE trace_id = ${coAuthorTrace}::uuid
      ` as Array<{ id: string }>).map((r) => r.id);
      expect(coEvidenceIds.length).toBeGreaterThan(0);
      expect(coReferenceIds.length).toBeGreaterThan(0);
      const coEntityIds = [coAuthorTrace, ...coEvidenceIds, ...coReferenceIds];
      // The embedding sweep can add a source row for another chunking strategy
      // at any moment, so what must hold is that none of these rows is lost,
      // not that the count stays still.
      const coSourceIdsBefore = (await sql`
        SELECT id FROM claimnet.embedding_sources WHERE source_id IN ${sql(coEntityIds)}
      ` as Array<{ id: string }>).map((r) => r.id);
      expect(coSourceIdsBefore.length).toBeGreaterThan(0);

      const ownerEvidenceIds = (await sql`
        SELECT evidence_id AS id FROM claimnet.trace_evidence WHERE trace_id = ${ownerTrace}::uuid
      ` as Array<{ id: string }>).map((r) => r.id);
      expect(ownerEvidenceIds.length).toBeGreaterThan(0);

      // ── The owner deletes their account ──
      const delRes = await deleteAccount(owner);
      expect(delRes.status).toBe(200);

      // The owner, their organization, and what they authored are gone.
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.users WHERE id = ${owner.userId}::uuid`)).toBe(0);
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.organizations WHERE id = ${owner.personalOrgId}::uuid`)).toBe(0);
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id = ${ownerTrace}::uuid`)).toBe(0);
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.evidence WHERE id IN ${sql(ownerEvidenceIds)}`)).toBe(0);
      expect(await count(sql`
        SELECT COUNT(*)::int AS n FROM claimnet.group_members WHERE user_id = ${owner.userId}::uuid
      `)).toBe(0);

      // The co-author's recipe and its whole subgraph survive.
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id = ${coAuthorTrace}::uuid`)).toBe(1);
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.evidence WHERE id IN ${sql(coEvidenceIds)}`)).toBe(coEvidenceIds.length);
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.references WHERE id IN ${sql(coReferenceIds)}`)).toBe(coReferenceIds.length);
      expect(await count(sql`
        SELECT COUNT(*)::int AS n FROM claimnet.embedding_sources WHERE id IN ${sql(coSourceIdsBefore)}
      `)).toBe(coSourceIdsBefore.length);

      // The book survives under the same id, now owned by the co-author and
      // living in the co-author's personal organization.
      const book = await bookRow(sql, bookId);
      expect(book).toBeTruthy();
      expect(book!.organization_id).toBe(coAuthor.personalOrgId);
      expect(book!.slug).toBe(slug);
      expect(await roleOf(sql, bookId, coAuthor.userId)).toBe("owner");

      // The co-author still reads the recipe via JWT…
      const jwtRead = await fetch(`${BASE}/traces/${coAuthorTrace}`, {
        headers: { Authorization: `Bearer ${coAuthor.token}` },
      });
      expect(jwtRead.status).toBe(200);
      const listRes = await fetch(`${BASE}/recipe-books`, { headers: { Authorization: `Bearer ${coAuthor.token}` } });
      const listBody = (await listRes.json()) as { data?: Array<{ id: string; member_role: string }> };
      expect(listBody.data?.find((g) => g.id === bookId)?.member_role).toBe("owner");

      // …and the key they minted BEFORE the deletion still reads and writes the book.
      const lookup = await fetch(`${BASE}/recipes?ids=${coAuthorTrace}`, {
        headers: { Authorization: `Bearer ${coAuthorKey}` },
      });
      expect(lookup.status).toBe(200);
      const lookupText = await lookup.text();
      expect(lookupText).toContain("outlive a colleague's departure");
      expect(lookupText).not.toContain("not_found_or_unreadable");
      const afterTrace = await checkRecipe(
        coAuthorKey, slug,
        `As a contributor working on a shared notebook, I prefer to keep writing to the book after it changes hands so that my agents need no new key. (${now})`,
        `Post-handover fixture.\n> "still writable"\n-- handover test fixture (after) ${now}`,
      );
      const afterRows: Array<{ group_id: string }> = await sql`
        SELECT group_id FROM claimnet.traces WHERE id = ${afterTrace}::uuid
      `;
      expect(afterRows[0]?.group_id).toBe(bookId);

      // The hand-over is on the audit trail, attributed to the departing owner.
      const auditRows: Array<{ metadata: Record<string, unknown> }> = await sql`
        SELECT metadata FROM claimnet.audit_log
        WHERE action = 'recipe_book.ownership_transferred'
          AND target_id = ${bookId}::uuid
          AND actor_user_id = ${owner.userId}::uuid
      `;
      expect(auditRows.length).toBe(1);
      expect(auditRows[0]!.metadata["newOwnerUserId"]).toBe(coAuthor.userId);
      expect(auditRows[0]!.metadata["successionRule"]).toBe("longest_standing_member");
      expect(auditRows[0]!.metadata["newOrganizationId"]).toBe(coAuthor.personalOrgId);
      // No PII beyond ids: no email addresses in the metadata.
      expect(JSON.stringify(auditRows[0]!.metadata)).not.toContain("@");
    } finally {
      await sql.end();
    }
  });

  it("still deletes a book that has no other members, with its recipes — and purges it from a former member's key scope", { timeout: 60_000 }, async () => {
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "solo");
      const former = await provisionUser(sql, "former");
      const slug = `solo-${Date.now().toString(36)}`;
      const bookId = await createBook(owner, slug);

      // A former member minted a key while they belonged to the book, then
      // left. Their key still carries the book id; point its default write
      // target at the book too so the repair path is exercised.
      await addMember(sql, bookId, former, "member", "2026-01-01T00:00:00Z");
      await mintDailyKey(former.token);
      await sql`
        DELETE FROM claimnet.group_members
        WHERE group_id = ${bookId}::uuid AND user_id = ${former.userId}::uuid
      `;
      await sql`
        UPDATE claimnet.api_keys SET default_write_group_id = ${bookId}::uuid
        WHERE user_id = ${former.userId}::uuid
      `;

      const key = await mintDailyKey(owner.token);
      const trace = await checkRecipe(
        key, slug,
        `As a solo author working on a private notebook, I prefer the notebook to go when I go so that nothing of mine lingers. (${Date.now()})`,
        `Solo fixture.\n> "solo book"\n-- handover test fixture (solo)`,
      );

      expect((await deleteAccount(owner)).status).toBe(200);

      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.groups WHERE id = ${bookId}::uuid`)).toBe(0);
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id = ${trace}::uuid`)).toBe(0);
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.group_members WHERE group_id = ${bookId}::uuid`)).toBe(0);
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.organizations WHERE id = ${owner.personalOrgId}::uuid`)).toBe(0);
      expect(await count(sql`
        SELECT COUNT(*)::int AS n FROM claimnet.audit_log
        WHERE action = 'recipe_book.ownership_transferred' AND target_id = ${bookId}::uuid
      `)).toBe(0);

      // No surviving key still references the deleted book, and the former
      // member's default write target fell back to a book that exists.
      const formerKeys: Array<{ dangling: boolean; default_ok: boolean }> = await sql`
        SELECT (${bookId}::uuid = ANY(k.read_group_ids) OR ${bookId}::uuid = ANY(k.write_group_ids)) AS dangling,
               EXISTS (SELECT 1 FROM claimnet.groups g WHERE g.id = k.default_write_group_id) AS default_ok
        FROM claimnet.api_keys k WHERE k.user_id = ${former.userId}::uuid
      `;
      expect(formerKeys.length).toBeGreaterThan(0);
      for (const k of formerKeys) {
        expect(k.dangling).toBe(false);
        expect(k.default_ok).toBe(true);
      }
    } finally {
      await sql.end();
    }
  });

  it("gives the new owner a personal organization when they have none to re-home the book into", { timeout: 60_000 }, async () => {
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "orgless-owner");
      const heir = await provisionUser(sql, "orgless-heir");
      const bookId = await createBook(owner, `orgless-${Date.now().toString(36)}`);
      await addMember(sql, bookId, heir, "member", "2026-01-01T00:00:00Z");

      // Fixture: strip the heir's organization entirely (not reachable through
      // the API — registration always creates one — but the pointer has no FK).
      await sql`
        DELETE FROM claimnet.group_members WHERE group_id IN (
          SELECT id FROM claimnet.groups WHERE organization_id = ${heir.personalOrgId}::uuid
        )
      `;
      await sql`DELETE FROM claimnet.groups WHERE organization_id = ${heir.personalOrgId}::uuid`;
      await sql`DELETE FROM claimnet.organizations WHERE id = ${heir.personalOrgId}::uuid`;
      await sql`UPDATE claimnet.users SET personal_organization_id = NULL WHERE id = ${heir.userId}::uuid`;

      expect((await deleteAccount(owner)).status).toBe(200);

      const book = await bookRow(sql, bookId);
      expect(book).toBeTruthy();
      const orgRows: Array<{ owner_id: string; is_personal: boolean }> = await sql`
        SELECT owner_id, is_personal FROM claimnet.organizations WHERE id = ${book!.organization_id}::uuid
      `;
      expect(orgRows[0]?.owner_id).toBe(heir.userId);
      expect(orgRows[0]?.is_personal).toBe(true);
      const pointer: Array<{ personal_organization_id: string | null }> = await sql`
        SELECT personal_organization_id FROM claimnet.users WHERE id = ${heir.userId}::uuid
      `;
      expect(pointer[0]?.personal_organization_id).toBe(book!.organization_id);
      expect(await roleOf(sql, bookId, heir.userId)).toBe("owner");
    } finally {
      await sql.end();
    }
  });

  it("still refuses to dissolve a shared (non-personal) organization that other people belong to, and changes nothing", { timeout: 60_000 }, async () => {
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "org-owner");
      const colleague = await provisionUser(sql, "org-colleague");
      const stamp = Date.now().toString(36);

      // Fixture via SQL: no route creates non-personal organizations yet.
      const orgRows: Array<{ id: string }> = await sql`
        INSERT INTO claimnet.organizations (name, slug, owner_id, is_personal)
        VALUES (${`Shared Org ${stamp}`}, ${`shared-org-${stamp}`}, ${owner.userId}::uuid, false)
        RETURNING id
      `;
      const orgId = orgRows[0]!.id;
      const groupRows: Array<{ id: string }> = await sql`
        INSERT INTO claimnet.groups (name, slug, organization_id)
        VALUES ('Team Book', ${`team-${stamp}`}, ${orgId}::uuid) RETURNING id
      `;
      const teamBook = groupRows[0]!.id;
      await addMember(sql, teamBook, owner, "owner", "2026-01-01T00:00:00Z");
      await addMember(sql, teamBook, colleague, "member", "2026-02-01T00:00:00Z");

      const blocked = await deleteAccount(owner);
      expect(blocked.status).toBe(409);
      const blockedBody = (await blocked.json()) as { error?: string; message?: string; organizations?: Array<{ id: string }> };
      expect(blockedBody.error).toBe("owned_shared_orgs_exist");
      expect(blockedBody.message).toMatch(/shared organization/i);
      expect(blockedBody.organizations?.map((o) => o.id)).toEqual([orgId]);

      // Nothing moved: the account, the book's home and the roles are as before.
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.users WHERE id = ${owner.userId}::uuid`)).toBe(1);
      expect((await bookRow(sql, teamBook))?.organization_id).toBe(orgId);
      expect(await roleOf(sql, teamBook, colleague.userId)).toBe("member");

      // A second book in the organization held a recipe by a former member.
      // Removing its members does not make the organization unshared: the
      // guard still counts the recipes other people wrote there [F73].
      const authoredRows: Array<{ id: string }> = await sql`
        INSERT INTO claimnet.groups (name, slug, organization_id)
        VALUES ('Team Archive', ${`team-archive-${stamp}`}, ${orgId}::uuid) RETURNING id
      `;
      const archiveBook = authoredRows[0]!.id;
      await addMember(sql, archiveBook, owner, "owner", "2026-01-01T00:00:00Z");
      await addMember(sql, archiveBook, colleague, "member", "2026-02-01T00:00:00Z");
      const colleagueTrace = await checkRecipe(
        await mintDailyKey(colleague.token), `team-archive-${stamp}`,
        `As a colleague working on a team notebook, I prefer my notes to stay with the team so that my work outlives my membership. (${Date.now()})`,
        `Guard fixture.\n> "colleague wrote this"\n-- handover test fixture (org guard)`,
      );
      await sql`
        DELETE FROM claimnet.group_members
        WHERE group_id IN (${teamBook}::uuid, ${archiveBook}::uuid) AND user_id = ${colleague.userId}::uuid
      `;
      const stillBlocked = await deleteAccount(owner);
      expect(stillBlocked.status).toBe(409);
      const stillBlockedBody = (await stillBlocked.json()) as { message?: string };
      expect(stillBlockedBody.message).not.toMatch(/remove the other members/i);
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id = ${colleagueTrace}::uuid`)).toBe(1);

      // Once nothing in the organization belongs to anyone else, deletion proceeds.
      const hardDelete = await fetch(`${BASE}/traces/${colleagueTrace}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      expect(hardDelete.status).toBe(200);
      expect((await deleteAccount(owner)).status).toBe(200);
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.organizations WHERE id = ${orgId}::uuid`)).toBe(0);
    } finally {
      await sql.end();
    }
  });

  it("succession: an existing co-owner first, else the longest-standing admin, else the longest-standing member", { timeout: 90_000 }, async () => {
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "succ-owner");
      const early = await provisionUser(sql, "succ-early");
      const late = await provisionUser(sql, "succ-late");
      const mid = await provisionUser(sql, "succ-mid");
      const stamp = Date.now().toString(36);

      // Book 1 — a co-owner exists (joined last): the co-owner keeps the book
      // even though an admin and a member have been there longer.
      const coOwned = await createBook(owner, `co-owned-${stamp}`);
      await addMember(sql, coOwned, early, "admin", "2026-01-01T00:00:00Z");
      await addMember(sql, coOwned, mid, "member", "2026-02-01T00:00:00Z");
      await addMember(sql, coOwned, late, "owner", "2026-03-01T00:00:00Z");

      // Book 2 — no co-owner: the longest-standing ADMIN wins over a member
      // who joined before any admin did.
      const adminBook = await createBook(owner, `admin-book-${stamp}`);
      await addMember(sql, adminBook, early, "member", "2026-01-01T00:00:00Z");
      await addMember(sql, adminBook, late, "admin", "2026-03-01T00:00:00Z");
      await addMember(sql, adminBook, mid, "admin", "2026-02-01T00:00:00Z");

      // Book 3 — members only: the longest-standing member.
      const memberBook = await createBook(owner, `member-book-${stamp}`);
      await addMember(sql, memberBook, late, "member", "2026-03-01T00:00:00Z");
      await addMember(sql, memberBook, early, "member", "2026-01-01T00:00:00Z");

      expect((await deleteAccount(owner)).status).toBe(200);

      const rule = async (groupId: string) => {
        const rows: Array<{ metadata: Record<string, unknown> }> = await sql`
          SELECT metadata FROM claimnet.audit_log
          WHERE action = 'recipe_book.ownership_transferred' AND target_id = ${groupId}::uuid
        `;
        return rows[0]?.metadata["successionRule"];
      };

      expect((await bookRow(sql, coOwned))?.organization_id).toBe(late.personalOrgId);
      expect(await roleOf(sql, coOwned, late.userId)).toBe("owner");
      expect(await roleOf(sql, coOwned, early.userId)).toBe("admin");
      expect(await roleOf(sql, coOwned, mid.userId)).toBe("member");
      expect(await rule(coOwned)).toBe("existing_owner");

      expect((await bookRow(sql, adminBook))?.organization_id).toBe(mid.personalOrgId);
      expect(await roleOf(sql, adminBook, mid.userId)).toBe("owner");
      expect(await roleOf(sql, adminBook, late.userId)).toBe("admin");
      expect(await roleOf(sql, adminBook, early.userId)).toBe("member");
      expect(await rule(adminBook)).toBe("longest_standing_admin");

      expect((await bookRow(sql, memberBook))?.organization_id).toBe(early.personalOrgId);
      expect(await roleOf(sql, memberBook, early.userId)).toBe("owner");
      expect(await roleOf(sql, memberBook, late.userId)).toBe("member");
      expect(await rule(memberBook)).toBe("longest_standing_member");

      // Every surviving book has exactly one organization and at least one owner.
      for (const id of [coOwned, adminBook, memberBook]) {
        expect(await count(sql`
          SELECT COUNT(*)::int AS n FROM claimnet.group_members WHERE group_id = ${id}::uuid AND role = 'owner'
        `)).toBeGreaterThan(0);
      }
    } finally {
      await sql.end();
    }
  });

  it("keeps a former member's recipes: a book holding other authors' recipes passes to its longest-standing author who can act, re-added as owner [F73]", { timeout: 120_000 }, async () => {
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "fa-owner");
      const dormant = await provisionUser(sql, "fa-dormant");
      const early = await provisionUser(sql, "fa-early");
      const late = await provisionUser(sql, "fa-late");
      const slug = `former-${Date.now().toString(36)}`;
      const bookId = await createBook(owner, slug);
      for (const m of [dormant, early, late]) await addMember(sql, bookId, m, "member", "2026-01-01T00:00:00Z");

      const now = Date.now();
      const write = async (u: TestUser, label: string) => checkRecipe(
        await mintDailyKey(u.token), slug,
        `As a contributor working on a shared notebook, I prefer my ${label} notes to outlive my membership so that my work stays mine. (${now})`,
        `Former-author fixture.\n> "${label}"\n-- handover test fixture (${label}) ${now}`,
      );
      const ownerTrace = await write(owner, "owner");
      const dormantTrace = await write(dormant, "dormant");
      const earlyTrace = await write(early, "early");
      const lateTrace = await write(late, "late");
      // Deterministic authorship order: dormant first, then early, then late.
      await sql`UPDATE claimnet.traces SET created_at = '2026-01-10T00:00:00Z' WHERE id = ${dormantTrace}::uuid`;
      await sql`UPDATE claimnet.traces SET created_at = '2026-01-20T00:00:00Z' WHERE id = ${earlyTrace}::uuid`;
      await sql`UPDATE claimnet.traces SET created_at = '2026-01-30T00:00:00Z' WHERE id = ${lateTrace}::uuid`;

      // The owner removes every contributor, leaving themselves the only member.
      for (const m of [dormant, early, late]) {
        const res = await fetch(`${BASE}/recipe-books/${bookId}/members/${m.userId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${owner.token}` },
        });
        expect(res.status).toBe(200);
      }
      // The earliest author can no longer act (email unverified since).
      await sql`UPDATE claimnet.users SET email_verified_at = NULL WHERE id = ${dormant.userId}::uuid`;

      expect((await deleteAccount(owner)).status).toBe(200);

      // Every other author's recipe survives; the owner's own goes.
      for (const t of [dormantTrace, earlyTrace, lateTrace]) {
        expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id = ${t}::uuid`)).toBe(1);
      }
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id = ${ownerTrace}::uuid`)).toBe(0);

      // The book passes to the longest-standing author who can act, re-added
      // as owner with daily-link reads and writes off (they opt in), and is
      // re-homed into their personal organization.
      const book = await bookRow(sql, bookId);
      expect(book?.organization_id).toBe(early.personalOrgId);
      expect(book?.slug).toBe(slug);
      const rows: Array<{ role: string; daily_read: boolean; daily_write: boolean }> = await sql`
        SELECT role, daily_read, daily_write FROM claimnet.group_members
        WHERE group_id = ${bookId}::uuid AND user_id = ${early.userId}::uuid
      `;
      expect(rows[0]).toEqual({ role: "owner", daily_read: false, daily_write: false });
      expect(await roleOf(sql, bookId, dormant.userId)).toBeUndefined();
      expect(await roleOf(sql, bookId, late.userId)).toBeUndefined();

      const auditRows: Array<{ metadata: Record<string, unknown> }> = await sql`
        SELECT metadata FROM claimnet.audit_log
        WHERE action = 'recipe_book.ownership_transferred' AND target_id = ${bookId}::uuid
      `;
      expect(auditRows.length).toBe(1);
      expect(auditRows[0]!.metadata["newOwnerUserId"]).toBe(early.userId);
      expect(auditRows[0]!.metadata["successionRule"]).toBe("longest_standing_author");
    } finally {
      await sql.end();
    }
  });

  it("a current member inherits ahead of a former author [F73]", { timeout: 90_000 }, async () => {
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "fm-owner");
      const former = await provisionUser(sql, "fm-former");
      const member = await provisionUser(sql, "fm-member");
      const slug = `former-member-${Date.now().toString(36)}`;
      const bookId = await createBook(owner, slug);
      await addMember(sql, bookId, former, "member", "2026-01-01T00:00:00Z");
      const formerTrace = await checkRecipe(
        await mintDailyKey(former.token), slug,
        `As a contributor working on a shared notebook, I prefer my notes to stay after I leave so that my work stays mine. (${Date.now()})`,
        `Former fixture.\n> "former"\n-- handover test fixture (former-member)`,
      );
      await sql`DELETE FROM claimnet.group_members WHERE group_id = ${bookId}::uuid AND user_id = ${former.userId}::uuid`;
      await addMember(sql, bookId, member, "member", "2026-02-01T00:00:00Z");

      expect((await deleteAccount(owner)).status).toBe(200);

      expect(await roleOf(sql, bookId, member.userId)).toBe("owner");
      expect(await roleOf(sql, bookId, former.userId)).toBeUndefined();
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id = ${formerTrace}::uuid`)).toBe(1);
    } finally {
      await sql.end();
    }
  });

  it("succession skips accounts that cannot act: an unverified and a waitlisted member are passed over for an active one [F75]", { timeout: 90_000 }, async () => {
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "act-owner");
      const unverified = await provisionUnverifiedUser(sql, "act-unverified");
      const waitlisted = await provisionUser(sql, "act-waitlisted");
      const active = await provisionUser(sql, "act-active");
      // Verified but waitlisted: the state a queued sign-up is in before
      // promotion. Login refuses it a session.
      await sql`UPDATE claimnet.users SET waitlisted_at = NOW() WHERE id = ${waitlisted.userId}::uuid`;
      const stamp = Date.now().toString(36);

      // Members only: both accounts that cannot act joined before the active one.
      const memberBook = await createBook(owner, `act-members-${stamp}`);
      await addMember(sql, memberBook, unverified, "member", "2026-01-01T00:00:00Z");
      await addMember(sql, memberBook, waitlisted, "member", "2026-02-01T00:00:00Z");
      await addMember(sql, memberBook, active, "member", "2026-03-01T00:00:00Z");

      // Role outranks tenure only among accounts that can act: an unverified
      // admin does not beat an active member.
      const adminBook = await createBook(owner, `act-admin-${stamp}`);
      await addMember(sql, adminBook, unverified, "admin", "2026-01-01T00:00:00Z");
      await addMember(sql, adminBook, active, "member", "2026-03-01T00:00:00Z");

      expect((await deleteAccount(owner)).status).toBe(200);

      for (const bookId of [memberBook, adminBook]) {
        expect((await bookRow(sql, bookId))?.organization_id).toBe(active.personalOrgId);
        expect(await roleOf(sql, bookId, active.userId)).toBe("owner");
      }
      expect(await roleOf(sql, memberBook, unverified.userId)).toBe("member");
      expect(await roleOf(sql, memberBook, waitlisted.userId)).toBe("member");
      expect(await roleOf(sql, adminBook, unverified.userId)).toBe("admin");
    } finally {
      await sql.end();
    }
  });

  it("when nobody who can act remains, an account that cannot act still inherits rather than the book being lost [F75]", { timeout: 60_000 }, async () => {
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "fallback-owner");
      const unverified = await provisionUnverifiedUser(sql, "fallback-unverified");
      const bookId = await createBook(owner, `fallback-${Date.now().toString(36)}`);
      await addMember(sql, bookId, unverified, "member", "2026-01-01T00:00:00Z");

      expect((await deleteAccount(owner)).status).toBe(200);

      expect((await bookRow(sql, bookId))?.organization_id).toBe(unverified.personalOrgId);
      expect(await roleOf(sql, bookId, unverified.userId)).toBe("owner");
    } finally {
      await sql.end();
    }
  });

  it("de-duplicates the slug when the new owner's organization already uses it", { timeout: 60_000 }, async () => {
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "slug-owner");
      const heir = await provisionUser(sql, "slug-heir");
      const slug = `clash-${Date.now().toString(36)}`;

      const heirsOwnBook = await createBook(heir, slug);
      const heirsSecondBook = await createBook(heir, `${slug}-2`);
      const sharedBook = await createBook(owner, slug);
      await addMember(sql, sharedBook, heir, "member", "2026-01-01T00:00:00Z");

      expect((await deleteAccount(owner)).status).toBe(200);

      // The heir's own books are untouched; the inherited one takes the next
      // free suffix in the heir's organization.
      expect((await bookRow(sql, heirsOwnBook))?.slug).toBe(slug);
      expect((await bookRow(sql, heirsSecondBook))?.slug).toBe(`${slug}-2`);
      const moved = await bookRow(sql, sharedBook);
      expect(moved?.organization_id).toBe(heir.personalOrgId);
      expect(moved?.slug).toBe(`${slug}-3`);

      const auditRows: Array<{ metadata: Record<string, unknown> }> = await sql`
        SELECT metadata FROM claimnet.audit_log
        WHERE action = 'recipe_book.ownership_transferred' AND target_id = ${sharedBook}::uuid
      `;
      expect(auditRows[0]?.metadata["previousSlug"]).toBe(slug);
      expect(auditRows[0]?.metadata["newSlug"]).toBe(`${slug}-3`);
    } finally {
      await sql.end();
    }
  });

  it("a member (not owner) deleting their account leaves the book with its owner and removes only their own recipes", { timeout: 60_000 }, async () => {
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "stay-owner");
      const leaver = await provisionUser(sql, "leaver");
      const slug = `stay-${Date.now().toString(36)}`;
      const bookId = await createBook(owner, slug);
      await addMember(sql, bookId, leaver, "admin", "2026-01-01T00:00:00Z");
      const ownerKey = await mintDailyKey(owner.token);
      const leaverKey = await mintDailyKey(leaver.token);
      const now = Date.now();
      const ownerTrace = await checkRecipe(
        ownerKey, slug,
        `As a book owner working on a shared notebook, I prefer a colleague's exit to leave my notes alone so that the book stays whole. (${now})`,
        `Owner fixture.\n> "owner stays"\n-- handover test fixture (stay-owner) ${now}`,
      );
      const leaverTrace = await checkRecipe(
        leaverKey, slug,
        `As a contributor working on a shared notebook, I prefer my notes to leave with my account so that deletion means deletion. (${now})`,
        `Leaver fixture.\n> "leaver goes"\n-- handover test fixture (leaver) ${now}`,
      );

      expect((await deleteAccount(leaver)).status).toBe(200);

      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id = ${leaverTrace}::uuid`)).toBe(0);
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id = ${ownerTrace}::uuid`)).toBe(1);
      const book = await bookRow(sql, bookId);
      expect(book?.organization_id).toBe(owner.personalOrgId);
      expect(await roleOf(sql, bookId, owner.userId)).toBe("owner");
      expect(await roleOf(sql, bookId, leaver.userId)).toBeUndefined();
      expect(await count(sql`
        SELECT COUNT(*)::int AS n FROM claimnet.audit_log
        WHERE action = 'recipe_book.ownership_transferred' AND target_id = ${bookId}::uuid
      `)).toBe(0);
    } finally {
      await sql.end();
    }
  });
});

/**
 * Account deletion racing member removal [F74].
 *
 * Both paths take the book's row lock before any membership row: removeMember
 * locks the book first, and the deletion cascade locks every book it will
 * touch, in id order, before reading or changing members. So a removal and a
 * deletion on the same book serialize instead of deadlocking.
 *
 * And the gap between the hand-over (phase 0) and the teardown (phase 2): the
 * departing owner is still a co-owner in between and can remove the member who
 * just inherited. The teardown then finds a book where the departing user is
 * the only member; it must not leave that book with no members at all.
 */
describe.skipIf(!BASE)("DELETE /auth/me racing member removal [F74]", () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let authz: typeof import("../authz");
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let getDb: typeof import("../db").getDb;

  async function load(): Promise<void> {
    authz ??= await import("../authz");
    getDb ??= (await import("../db")).getDb;
  }

  async function membersOf(sql: Sql, groupId: string): Promise<number> {
    return count(sql`SELECT COUNT(*)::int AS n FROM claimnet.group_members WHERE group_id = ${groupId}::uuid`);
  }

  async function bookExists(sql: Sql, groupId: string): Promise<boolean> {
    return (await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.groups WHERE id = ${groupId}::uuid`)) === 1;
  }

  it("removeMember holds the book row lock while it decides, the same first lock the deletion cascade takes", { timeout: 60_000 }, async () => {
    await load();
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "lock-owner");
      const member = await provisionUser(sql, "lock-member");
      const bookId = await createBook(owner, `lock-${Date.now().toString(36)}`);
      await addMember(sql, bookId, member, "member", "2026-01-01T00:00:00Z");

      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => { release = resolve; });
      let decided: () => void = () => {};
      const hasDecided = new Promise<void>((resolve) => { decided = resolve; });
      let outcome = "";
      const removal = getDb().transaction(async (tx) => {
        outcome = await authz.removeMember(tx, bookId, member.userId);
        decided();
        await held;
      });
      await hasDecided;
      expect(outcome).toBe("removed");

      let lockError: { code?: string } | undefined;
      try {
        await sql`SELECT id FROM claimnet.groups WHERE id = ${bookId}::uuid FOR UPDATE NOWAIT`;
      } catch (err) {
        lockError = err as { code?: string };
      }
      release();
      await removal;
      expect(lockError?.code).toBe("55P03"); // lock_not_available
    } finally {
      await sql.end();
    }
  });

  it("a member removal in flight when the owner deletes their account: the deletion waits for it, then both complete", { timeout: 90_000 }, async () => {
    await load();
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "inflight-owner");
      const heir = await provisionUser(sql, "inflight-heir");
      const leaving = await provisionUser(sql, "inflight-leaving");
      const bookId = await createBook(owner, `inflight-${Date.now().toString(36)}`);
      await addMember(sql, bookId, heir, "member", "2026-01-01T00:00:00Z");
      await addMember(sql, bookId, leaving, "member", "2026-02-01T00:00:00Z");

      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => { release = resolve; });
      let decided: () => void = () => {};
      const hasDecided = new Promise<void>((resolve) => { decided = resolve; });
      const removal = getDb().transaction(async (tx) => {
        await authz.removeMember(tx, bookId, leaving.userId);
        decided();
        await held;
      });
      await hasDecided;

      let deleteStatus = 0;
      const deletion = deleteAccount(owner).then((r) => { deleteStatus = r.status; });
      await new Promise((r) => setTimeout(r, 750));
      expect(deleteStatus).toBe(0); // waiting on the book the removal holds

      release();
      await removal;
      await deletion;
      expect(deleteStatus).toBe(200);
      expect(await roleOf(sql, bookId, heir.userId)).toBe("owner");
      expect(await roleOf(sql, bookId, leaving.userId)).toBeUndefined();
      expect(await membersOf(sql, bookId)).toBe(1);
    } finally {
      await sql.end();
    }
  });

  it("two co-owners deleting their accounts at the same moment both complete, and each book passes to the remaining member", { timeout: 90_000 }, async () => {
    const sql = makeSql();
    try {
      const first = await provisionUser(sql, "pair-first");
      const second = await provisionUser(sql, "pair-second");
      const heir = await provisionUser(sql, "pair-heir");
      const stamp = Date.now().toString(36);
      const bookA = await createBook(first, `pair-a-${stamp}`);
      const bookB = await createBook(second, `pair-b-${stamp}`);
      await addMember(sql, bookA, second, "owner", "2026-01-01T00:00:00Z");
      await addMember(sql, bookB, first, "owner", "2026-01-01T00:00:00Z");
      for (const id of [bookA, bookB]) await addMember(sql, id, heir, "member", "2026-02-01T00:00:00Z");

      const [a, b] = await Promise.all([deleteAccount(first), deleteAccount(second)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      for (const id of [bookA, bookB]) {
        expect(await roleOf(sql, id, heir.userId)).toBe("owner");
        expect(await membersOf(sql, id)).toBe(1);
      }
    } finally {
      await sql.end();
    }
  });

  it("the departing owner removes the member who just inherited: a book holding only the owner's recipes is deleted, never left without members", { timeout: 90_000 }, async () => {
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "gap-owner");
      const heir = await provisionUser(sql, "gap-heir");
      const slug = `gap-${Date.now().toString(36)}`;
      const bookId = await createBook(owner, slug);
      const ownerKey = await mintDailyKey(owner.token);
      const ownerTrace = await checkRecipe(
        ownerKey, slug,
        `As a book owner working on a notebook, I prefer my notes to leave with me so that deletion means deletion. (${Date.now()})`,
        `Gap fixture.\n> "owner only"\n-- handover test fixture (gap)`,
      );

      // The state phase 0 leaves: the book handed to the heir and re-homed
      // into the heir's organization, the departing owner still a co-owner.
      await addMember(sql, bookId, heir, "owner", "2026-01-01T00:00:00Z");
      await sql`UPDATE claimnet.groups SET organization_id = ${heir.personalOrgId}::uuid WHERE id = ${bookId}::uuid`;

      // In the gap, the departing owner removes the heir (two owners: allowed).
      const removed = await fetch(`${BASE}/recipe-books/${bookId}/members/${heir.userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      expect(removed.status).toBe(200);

      expect((await deleteAccount(owner)).status).toBe(200);

      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id = ${ownerTrace}::uuid`)).toBe(0);
      expect(await bookExists(sql, bookId)).toBe(false);
      expect(await membersOf(sql, bookId)).toBe(0);
    } finally {
      await sql.end();
    }
  });

  it("the departing owner removes the member who just inherited, and that member wrote recipes there: the book is handed back to them [F73]", { timeout: 90_000 }, async () => {
    const sql = makeSql();
    try {
      const owner = await provisionUser(sql, "gap2-owner");
      const heir = await provisionUser(sql, "gap2-heir");
      const slug = `gap2-${Date.now().toString(36)}`;
      const bookId = await createBook(owner, slug);
      await addMember(sql, bookId, heir, "member", "2026-01-01T00:00:00Z");
      const heirTrace = await checkRecipe(
        await mintDailyKey(heir.token), slug,
        `As a contributor working on a shared notebook, I prefer my notes to survive a colleague's exit so that my work stays mine. (${Date.now()})`,
        `Gap fixture.\n> "heir wrote this"\n-- handover test fixture (gap2)`,
      );

      // The state phase 0 leaves, then the removal in the gap.
      await sql`UPDATE claimnet.group_members SET role = 'owner' WHERE group_id = ${bookId}::uuid AND user_id = ${heir.userId}::uuid`;
      await sql`UPDATE claimnet.groups SET organization_id = ${heir.personalOrgId}::uuid WHERE id = ${bookId}::uuid`;
      const removed = await fetch(`${BASE}/recipe-books/${bookId}/members/${heir.userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      expect(removed.status).toBe(200);

      expect((await deleteAccount(owner)).status).toBe(200);

      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.traces WHERE id = ${heirTrace}::uuid`)).toBe(1);
      expect(await bookExists(sql, bookId)).toBe(true);
      expect(await roleOf(sql, bookId, heir.userId)).toBe("owner");
      expect(await membersOf(sql, bookId)).toBe(1);
      expect((await bookRow(sql, bookId))?.organization_id).toBe(heir.personalOrgId);
    } finally {
      await sql.end();
    }
  });

  it("a book in someone else's organization whose only member is the departing user is deleted, not left memberless", { timeout: 60_000 }, async () => {
    const sql = makeSql();
    try {
      const leaver = await provisionUser(sql, "sole-leaver");
      const orgOwner = await provisionUser(sql, "sole-org-owner");
      // Fixture: reachable today through the race above, and without any race
      // once organizations have members who do not belong to every book.
      const groupRows: Array<{ id: string }> = await sql`
        INSERT INTO claimnet.groups (name, slug, organization_id)
        VALUES ('Sole', ${`sole-${Date.now().toString(36)}`}, ${orgOwner.personalOrgId}::uuid) RETURNING id
      `;
      const bookId = groupRows[0]!.id;
      await addMember(sql, bookId, leaver, "owner", "2026-01-01T00:00:00Z");

      expect((await deleteAccount(leaver)).status).toBe(200);

      expect(await bookExists(sql, bookId)).toBe(false);
      // The organization it lived in is not the leaver's and stays.
      expect(await count(sql`SELECT COUNT(*)::int AS n FROM claimnet.organizations WHERE id = ${orgOwner.personalOrgId}::uuid`)).toBe(1);
    } finally {
      await sql.end();
    }
  });
});
