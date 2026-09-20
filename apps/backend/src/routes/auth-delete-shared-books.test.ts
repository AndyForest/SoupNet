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
 *     admin, else the longest-standing member
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
      const coSourcesBefore = await count(sql`
        SELECT COUNT(*)::int AS n FROM claimnet.embedding_sources WHERE source_id IN ${sql(coEntityIds)}
      `);
      expect(coSourcesBefore).toBeGreaterThan(0);

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
        SELECT COUNT(*)::int AS n FROM claimnet.embedding_sources WHERE source_id IN ${sql(coEntityIds)}
      `)).toBe(coSourcesBefore);

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

      // Once the organization is no longer shared, deletion proceeds.
      await sql`
        DELETE FROM claimnet.group_members
        WHERE group_id = ${teamBook}::uuid AND user_id = ${colleague.userId}::uuid
      `;
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
