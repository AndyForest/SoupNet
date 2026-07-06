import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { authFetch } from "../auth.js";
import { copyToClipboard, useClipboard } from "../hooks/useClipboard.js";
import { substituteBriefingKey } from "../lib/briefing-key.js";
import { Icon } from "../components/Icon.js";

// Internal type — represents a recipe book row from the backend. Named "Group"
// because the DB schema deferral keeps the table name `groups`. Per-DB-rename
// is tracked separately as a future ADR.
interface Group {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  organization_id: string;
  member_role: string;
  daily_read: boolean;
  daily_write: boolean;
}

interface Member {
  user_id: string;
  email: string;
  role: string;
  joined_at: string;
}

interface PendingInvite {
  id: string;
  email: string;
  inviteUrl: string;
  expiresAt: string;
  createdAt: string;
  inviterEmail: string;
}

interface IncomingInvite {
  id: string;
  groupId: string;
  groupName: string;
  groupSlug: string;
  groupDescription: string | null;
  inviterEmail: string;
  createdAt: string;
  expiresAt: string;
}

interface InviteResult {
  id: string;
  email: string;
  inviteUrl: string;
  blurb: string;
  expiresAt: string;
}

export function GroupsPage() {
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as { justJoined?: string };
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");

  const groupsQuery = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const res = await authFetch("/recipe-books");
      const json = (await res.json()) as { ok: boolean; data: Group[] };
      if (!json.ok) throw new Error("Failed to load recipe books");
      return json.data;
    },
  });

  const incomingInvitesQuery = useQuery({
    queryKey: ["invitations-pending"],
    queryFn: async () => {
      const res = await authFetch("/invitations/pending");
      const json = (await res.json()) as { ok: boolean; data: IncomingInvite[] };
      return json.ok ? json.data : [];
    },
  });

  const acceptInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const res = await authFetch(`/invitations/${inviteId}/accept`, { method: "POST" });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { groupSlug: string | null; groupName: string | null };
        error?: string;
      };
      if (!json.ok || !json.data) throw new Error(json.error ?? "Failed to accept");
      return json.data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["invitations-pending"] });
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      if (data.groupSlug) {
        // Keep the user on the Recipe Books page, but mark the joined book so
        // the onboarding banner shows.
        window.history.replaceState(null, "", `/app/recipe-books?justJoined=${encodeURIComponent(data.groupSlug)}`);
      }
    },
  });

  const declineInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const res = await authFetch(`/invitations/${inviteId}/decline`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to decline");
      return json;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations-pending"] });
    },
  });

  // When ?justJoined=SLUG is present, expand that group and scroll to the
  // onboarding banner so the user lands in the "inviting in your AI agent"
  // moment — not just a generic groups list.
  useEffect(() => {
    if (!search.justJoined || !groupsQuery.data) return;
    const target = groupsQuery.data.find((g) => g.slug === search.justJoined);
    if (target) setExpandedGroup(target.id);
  }, [search.justJoined, groupsQuery.data]);

  const createGroupMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      // Pick the user's OWN organization — the one where they are a group
      // owner — not just the first group in the list. Since accept-invite
      // landed, `groupsQuery.data[0]` can point at another user's org when
      // the invited group is the most recently created membership. Backend
      // correctly rejects that with 403. The user can only create groups
      // under organizations they own.
      const orgId = groupsQuery.data?.find((g) => g.member_role === "owner")?.organization_id;
      if (!orgId) throw new Error("No owned organization found — you need to own an org to create a recipe book.");

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const res = await authFetch("/recipe-books", {
        method: "POST",
        body: JSON.stringify({ name, slug, organizationId: orgId, description: description || undefined }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to create recipe book");
      return json;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      setShowCreateForm(false);
      setNewGroupName("");
      setNewGroupDesc("");
    },
  });

  return (
    <div>
      <header style={{ marginBottom: "var(--space-xl)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>Recipe Books</h1>
          <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
            Recipe books let you share recipes and accumulated judgment with collaborators,
            even across different organizations. Each recipe book is a shared corpus that
            every member's AI agents can search.{" "}
            <Link to="/app/check" style={{ color: "var(--color-primary)" }}>
              Learn about recipe format and how to check recipes →
            </Link>
          </p>
          <p className="text-sm" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-sm)" }}>
            When an agent writes to a recipe book, its recipes become searchable by all
            members. The recipe book description is shared context — every agent reading or
            writing here sees it, so recipes can leave out anything the description already
            implies. A well-written description compounds across every recipe in the book:
            tighter roles, less restated context, more transferable knowledge.
          </p>
        </div>
        <button
          className="btn"
          onClick={() => setShowCreateForm(!showCreateForm)}
          style={{ whiteSpace: "nowrap" }}
        >
          {showCreateForm ? "Cancel" : "+ Create Recipe Book"}
        </button>
      </header>

      {showCreateForm && (
        <div className="card" style={{ marginBottom: "var(--space-lg)" }}>
          <h3 style={{ marginBottom: "var(--space-sm)" }}>Create a new recipe book</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createGroupMutation.mutate({ name: newGroupName, description: newGroupDesc });
            }}
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}
          >
            <input
              type="text"
              placeholder="Recipe book name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              required
              style={{ padding: "var(--space-sm)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={newGroupDesc}
              onChange={(e) => setNewGroupDesc(e.target.value)}
              style={{ padding: "var(--space-sm)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}
            />
            <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", margin: 0, marginTop: "calc(-1 * var(--space-xs))" }}>
              One elevator-pitch sentence about what this recipe book is for — useful to every
              human and agent collaborator. Example: <em>A volunteer team planning our
              community spring fundraiser.</em>
            </p>
            <button className="btn" type="submit" disabled={createGroupMutation.isPending || !newGroupName}>
              {createGroupMutation.isPending ? "Creating..." : "Create Recipe Book"}
            </button>
            {createGroupMutation.isError && (
              <p style={{ color: "var(--color-error)", fontSize: "0.85rem" }}>
                {(createGroupMutation.error as Error).message}
              </p>
            )}
          </form>
        </div>
      )}

      {incomingInvitesQuery.data && incomingInvitesQuery.data.length > 0 && (
        <section style={{ marginBottom: "var(--space-xl)" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "var(--space-md)" }}>
            You've been invited to {incomingInvitesQuery.data.length} recipe book{incomingInvitesQuery.data.length !== 1 ? "s" : ""}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {incomingInvitesQuery.data.map((inv) => {
              const expiresIn = Math.max(0, Math.ceil((new Date(inv.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
              return (
                <div
                  key={inv.id}
                  className="card"
                  style={{
                    borderLeft: "4px solid var(--color-primary)",
                    padding: "var(--space-md) var(--space-lg)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "var(--space-md)",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      {inv.inviterEmail} invited you to{" "}
                      <span style={{ color: "var(--color-primary)" }}>{inv.groupName}</span>
                    </p>
                    {inv.groupDescription && (
                      <p className="text-sm" style={{ color: "var(--color-on-surface-variant)", margin: "var(--space-xs) 0 0 0" }}>
                        {inv.groupDescription}
                      </p>
                    )}
                    <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
                      Expires in {expiresIn}d.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                    <button
                      className="btn"
                      onClick={() => acceptInviteMutation.mutate(inv.id)}
                      disabled={acceptInviteMutation.isPending || declineInviteMutation.isPending}
                      style={{ fontSize: "0.85rem" }}
                    >
                      Accept
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => declineInviteMutation.mutate(inv.id)}
                      disabled={acceptInviteMutation.isPending || declineInviteMutation.isPending}
                      style={{ fontSize: "0.85rem" }}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {groupsQuery.isLoading && <p style={{ color: "var(--color-on-surface-variant)" }}>Loading recipe books...</p>}
      {groupsQuery.isError && <p style={{ color: "var(--color-error)" }}>Failed to load recipe books.</p>}
      {groupsQuery.data && groupsQuery.data.length === 0 && (!incomingInvitesQuery.data || incomingInvitesQuery.data.length === 0) && (
        <p style={{ color: "var(--color-on-surface-variant)" }}>
          You are not a member of any recipe books yet.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        {groupsQuery.data?.map((group) => (
          <GroupCard
            key={group.id}
            group={group}
            expanded={expandedGroup === group.id}
            justJoined={search.justJoined === group.slug}
            onToggle={() => setExpandedGroup(expandedGroup === group.id ? null : group.id)}
          />
        ))}
      </div>
    </div>
  );
}

function GroupCard({
  group,
  expanded,
  justJoined,
  onToggle,
}: {
  group: Group;
  expanded: boolean;
  justJoined: boolean;
  onToggle: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const [editDesc, setEditDesc] = useState(group.description ?? "");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const isOwner = group.member_role === "owner";
  const isOwnerOrAdmin = isOwner || group.member_role === "admin";

  const membersQuery = useQuery({
    queryKey: ["group-members", group.id],
    queryFn: async () => {
      const res = await authFetch(`/recipe-books/${group.id}/members`);
      const json = (await res.json()) as { ok: boolean; data: Member[] };
      if (!json.ok) throw new Error("Failed to load members");
      return json.data;
    },
    enabled: expanded,
  });

  const pendingInvitesQuery = useQuery({
    queryKey: ["group-invitations", group.id],
    queryFn: async () => {
      const res = await authFetch(`/recipe-books/${group.id}/invitations`);
      const json = (await res.json()) as { ok: boolean; data: PendingInvite[] };
      if (!json.ok) throw new Error("Failed to load invitations");
      return json.data;
    },
    enabled: expanded && isOwnerOrAdmin,
  });

  const updateGroupMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const res = await authFetch(`/recipe-books/${group.id}`, {
        method: "PUT",
        body: JSON.stringify({ name, description: description || null }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to update recipe book");
      return json;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await authFetch(`/recipe-books/${group.id}/members/${userId}`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to remove member");
      return json;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["group-members", group.id] });
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const res = await authFetch(`/recipe-books/${group.id}/invitations/${inviteId}`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to revoke invitation");
      return json;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["group-invitations", group.id] });
    },
  });

  return (
    <div className="card" style={justJoined ? { borderColor: "var(--color-primary)", borderWidth: 2, borderStyle: "solid" } : undefined}>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: editing ? "default" : "pointer" }}
        onClick={editing ? undefined : onToggle}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flex: 1, minWidth: 0 }}>
          <span style={{
            display: "inline-block",
            transition: "transform var(--transition-fast)",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            fontSize: "0.85rem",
            color: "var(--color-on-surface-variant)",
          }}>&#9654;</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ marginBottom: "var(--space-xs)" }}>{group.name}</h3>
            <p className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
              /{group.slug}
              {membersQuery.data && ` \u00b7 ${membersQuery.data.length} member${membersQuery.data.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "var(--space-xs)", alignItems: "center" }}>
          <a
            href={`/app/recipe-books/${group.id}/traces`}
            onClick={(e) => e.stopPropagation()}
            className="btn-ghost"
            style={{ fontSize: "0.75rem", padding: "2px var(--space-sm)", textDecoration: "none" }}
            title="Review traces in this recipe book"
          >
            Review traces →
          </a>
          {isOwner && !editing && (
            <button
              className="btn-ghost"
              style={{ fontSize: "0.75rem", padding: "2px var(--space-sm)" }}
              onClick={(e) => {
                e.stopPropagation();
                setEditName(group.name);
                setEditDesc(group.description ?? "");
                setEditError("");
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
          <span className="pill">{group.member_role}</span>
        </div>
      </div>
      {editing ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setEditError("");
            setSaving(true);
            try {
              await updateGroupMutation.mutateAsync({ name: editName.trim(), description: editDesc.trim() });
              setEditing(false);
            } catch (err) {
              setEditError(err instanceof Error ? err.message : "Failed to save");
            } finally {
              setSaving(false);
            }
          }}
          style={{ marginTop: "var(--space-sm)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}
        >
          <div>
            <label htmlFor={`edit-name-${group.id}`} style={{ fontSize: "0.8rem", color: "var(--color-on-surface-variant)" }}>Name</label>
            <input
              id={`edit-name-${group.id}`}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
              style={{ padding: "var(--space-sm)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", width: "100%" }}
            />
          </div>
          <div>
            <label htmlFor={`edit-desc-${group.id}`} style={{ fontSize: "0.8rem", color: "var(--color-on-surface-variant)" }}>Description</label>
            <textarea
              id={`edit-desc-${group.id}`}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              placeholder="Describe this recipe book — helps agents decide where to write recipes."
              style={{ padding: "var(--space-sm)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", width: "100%", fontFamily: "inherit", fontSize: "0.9rem", resize: "vertical" }}
            />
          </div>
          <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", margin: 0 }}>
            The URL slug <span className="text-mono">/{group.slug}</span> stays the same when you rename — existing API keys, invite links, and bookmarks keep working.
          </p>
          <div style={{ display: "flex", gap: "var(--space-sm)" }}>
            <button className="btn" type="submit" disabled={saving || !editName.trim()} style={{ fontSize: "0.85rem" }}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setEditing(false); setEditError(""); }}
              disabled={saving}
              style={{ fontSize: "0.85rem" }}
            >
              Cancel
            </button>
          </div>
          {editError && (
            <p style={{ color: "var(--color-error)", fontSize: "0.8rem", margin: 0 }}>{editError}</p>
          )}
        </form>
      ) : (
        group.description && (
          <p style={{ marginTop: "var(--space-sm)", color: "var(--color-on-surface-variant)", fontSize: "0.9rem" }}>
            {group.description}
          </p>
        )
      )}

      {expanded && <AgentConnectBox group={group} justJoined={justJoined} />}

      {expanded && <DailyPrefsToggles group={group} />}

      {expanded && (
        <div style={{ marginTop: "var(--space-md)", borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-md)" }}>
          <h4 style={{ marginBottom: "var(--space-sm)" }}>Members</h4>

          {membersQuery.isLoading && <p style={{ color: "var(--color-on-surface-variant)", fontSize: "0.85rem" }}>Loading...</p>}

          {membersQuery.data && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {membersQuery.data.map((member) => (
                <li
                  key={member.user_id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "var(--space-xs) 0",
                    fontSize: "0.9rem",
                  }}
                >
                  <span>
                    {member.email} <span className="pill" style={{ marginLeft: "var(--space-xs)" }}>{member.role}</span>
                  </span>
                  {isOwner && member.role !== "owner" && (
                    <button
                      className="btn-danger"
                      style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                      onClick={(e) => { e.stopPropagation(); removeMemberMutation.mutate(member.user_id); }}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isOwnerOrAdmin && <InviteBox groupId={group.id} />}

          {isOwnerOrAdmin && pendingInvitesQuery.data && pendingInvitesQuery.data.length > 0 && (
            <div style={{ marginTop: "var(--space-md)" }}>
              <h4 style={{ marginBottom: "var(--space-sm)", fontSize: "0.95rem" }}>Pending invitations</h4>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                {pendingInvitesQuery.data.map((inv) => (
                  <PendingInviteRow
                    key={inv.id}
                    invite={inv}
                    onRevoke={() => revokeInviteMutation.mutate(inv.id)}
                    revoking={revokeInviteMutation.isPending}
                  />
                ))}
              </ul>
              <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
                Invitations expire after 7 days. Soup.net never emails invitees — share the link through your own channel.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InviteBox({ groupId }: { groupId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [lastResult, setLastResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState<"link" | "blurb" | null>(null);
  const [disclosureOpen, setDisclosureOpen] = useState(false);

  const inviteMutation = useMutation({
    mutationFn: async (inviteeEmail: string) => {
      const res = await authFetch(`/recipe-books/${groupId}/invite`, {
        method: "POST",
        body: JSON.stringify({ email: inviteeEmail }),
      });
      const json = (await res.json()) as { ok: boolean; data?: InviteResult; error?: string };
      if (!json.ok || !json.data) throw new Error(json.error ?? "Failed to create invitation");
      return json.data;
    },
    onSuccess: (data) => {
      setLastResult(data);
      setEmail("");
      setCopied(null);
      setDisclosureOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["group-invitations", groupId] });
    },
  });

  return (
    <div style={{ marginTop: "var(--space-md)" }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email) inviteMutation.mutate(email);
        }}
        style={{ display: "flex", gap: "var(--space-xs)", alignItems: "flex-end" }}
      >
        <div style={{ flex: 1 }}>
          <label
            htmlFor={`invite-email-${groupId}`}
            className="text-label"
            style={{ display: "block", marginBottom: "var(--space-xs)" }}
          >
            Invite by email
          </label>
          <input
            id={`invite-email-${groupId}`}
            type="email"
            placeholder="collaborator@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", padding: "var(--space-xs) var(--space-sm)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", fontSize: "0.9rem" }}
          />
        </div>
        <button
          className="btn"
          type="submit"
          disabled={inviteMutation.isPending || !email}
          style={{ fontSize: "0.85rem", padding: "var(--space-xs) var(--space-md)" }}
        >
          {inviteMutation.isPending ? "Inviting..." : "Send invite"}
        </button>
      </form>
      {inviteMutation.isError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8rem", marginTop: "var(--space-xs)" }}>
          {(inviteMutation.error as Error).message}
        </p>
      )}
      {lastResult && (
        <div
          style={{
            marginTop: "var(--space-sm)",
            padding: "var(--space-sm) var(--space-md)",
            background: "var(--color-surface-container-low)",
            borderRadius: "var(--radius-sm)",
            fontSize: "0.85rem",
          }}
        >
          <p style={{ margin: 0 }}>
            <strong>Invited {lastResult.email}.</strong>{" "}
            <span style={{ color: "var(--color-on-surface-variant)" }}>
              If they're on Soup.net, the invite is waiting on their dashboard. They'll show up as a member once they accept.
            </span>
          </p>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: "0.75rem", padding: "2px 0", marginTop: "var(--space-xs)", color: "var(--color-primary)" }}
            onClick={() => setDisclosureOpen((o) => !o)}
          >
            {disclosureOpen ? "Hide message" : "Need to message them yourself? Show message ▾"}
          </button>
          {disclosureOpen && (
            <div style={{ marginTop: "var(--space-sm)" }}>
              <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", margin: "0 0 var(--space-xs) 0" }}>
                Soup.net never emails non-users. If {lastResult.email} doesn't have an account, send them this message through your own channel (Signal, email, DM):
              </p>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  background: "var(--color-surface)",
                  padding: "var(--space-sm)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.8rem",
                  fontFamily: "inherit",
                  margin: 0,
                  border: "1px solid var(--color-border)",
                }}
              >
                {lastResult.blurb}
              </pre>
              <div style={{ display: "flex", gap: "var(--space-xs)", marginTop: "var(--space-sm)", flexWrap: "wrap" }}>
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.8rem" }}
                  onClick={async () => {
                    await copyToClipboard(lastResult.blurb);
                    setCopied("blurb");
                    setTimeout(() => setCopied(null), 2000);
                  }}
                >
                  <Icon name="copy" size={13} />
                  {copied === "blurb" ? "Copied!" : "Copy message"}
                </button>
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.8rem" }}
                  onClick={async () => {
                    await copyToClipboard(lastResult.inviteUrl);
                    setCopied("link");
                    setTimeout(() => setCopied(null), 2000);
                  }}
                >
                  <Icon name="copy" size={13} />
                  {copied === "link" ? "Copied!" : "Copy link only"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PendingInviteRow({
  invite,
  onRevoke,
  revoking,
}: {
  invite: PendingInvite;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const expiresIn = Math.max(0, Math.ceil((new Date(invite.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-xs) var(--space-sm)",
        background: "var(--color-surface-container-low)",
        borderRadius: "var(--radius-sm)",
        fontSize: "0.85rem",
        flexWrap: "wrap",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        {invite.email}{" "}
        <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
          · expires in {expiresIn}d
        </span>
      </span>
      <div style={{ display: "flex", gap: "var(--space-xs)" }}>
        <button
          className="btn-ghost"
          style={{ fontSize: "0.75rem", padding: "2px var(--space-sm)" }}
          onClick={async () => {
            await copyToClipboard(invite.inviteUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        <button
          className="btn-danger"
          style={{ fontSize: "0.75rem", padding: "2px var(--space-sm)" }}
          onClick={onRevoke}
          disabled={revoking}
        >
          Revoke
        </button>
      </div>
    </li>
  );
}

/**
 * Per-recipe-book "connect your AI agent to this book" box. Surfaces the
 * same MCP/web briefing + recipe-check-page affordances that live on the
 * dashboard sidebar, but scoped to this specific recipe book. When
 * `justJoined` is set (the post-accept onboarding moment — see
 * design-thinking.md §"The 'inviting in your AI agent' moment") it gets
 * a primary-accent border and a welcoming heading. Wording kept in sync
 * with DashboardPage's "For Your Agents" section.
 */
function AgentConnectBox({ group, justJoined }: { group: Group; justJoined: boolean }) {
  const [dailyOpened, setDailyOpened] = useState(false);
  const { copyAsync, copied } = useClipboard(2500);
  const [briefingPending, setBriefingPending] = useState<boolean>(false);

  // Mint a 24h key scoped to this group, then fetch the unified briefing.
  // Invoked inside copyAsync so the ClipboardItem Promise keeps iOS Safari's
  // gesture context alive across both awaits. POST body keeps the raw key
  // out of the request URL; the response text carries only the YOUR_API_KEY
  // placeholder, substituted client-side at copy time.
  async function fetchBriefingText(): Promise<string> {
    const keyRes = await authFetch("/keys/daily", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writeRecipeBookId: group.id }),
    });
    const keyJson = (await keyRes.json()) as { ok: boolean; data?: { key: string } };
    if (!keyJson.ok || !keyJson.data) throw new Error("Failed to generate key");
    const briefRes = await authFetch("/keys/briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: keyJson.data.key }),
    });
    const briefJson = (await briefRes.json()) as { ok: boolean; data?: { text: string } };
    if (!briefJson.ok || !briefJson.data) throw new Error("Failed to get briefing");
    return substituteBriefingKey(briefJson.data.text, keyJson.data.key);
  }

  async function handleCopyBriefing() {
    setBriefingPending(true);
    try {
      await copyAsync(() => fetchBriefingText(), "briefing");
    } finally {
      setBriefingPending(false);
    }
  }

  const dailyGoMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/keys/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writeRecipeBookId: group.id }),
      });
      const json = (await res.json()) as { ok: boolean; data?: { searchUrl: string } };
      if (!json.ok || !json.data) throw new Error("Failed to generate key");
      return json.data;
    },
    onSuccess: (data) => {
      window.open(data.searchUrl, "_blank");
      setDailyOpened(true);
      setTimeout(() => setDailyOpened(false), 2500);
    },
  });

  const heading = justJoined
    ? `You're in the ${group.name} recipe book. Now invite your AI agent in.`
    : `Connect your AI agent to the ${group.name} recipe book`;

  return (
    <div
      style={{
        marginTop: "var(--space-md)",
        background: "var(--color-surface-container-low)",
        borderLeft: justJoined ? "4px solid var(--color-primary)" : undefined,
        borderRadius: "var(--radius-md)",
        padding: "var(--space-md) var(--space-lg)",
      }}
    >
      <h4 style={{ marginBottom: "var(--space-xs)", fontSize: "1rem" }}>{heading}</h4>
      <p style={{ margin: 0, color: "var(--color-on-surface-variant)", fontSize: "0.9rem" }}>
        Connect whichever AI agent you already use — Claude, ChatGPT, Gemini — so it can
        find this recipe book's accumulated taste and judgment on its next session.
      </p>
      <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-sm)", marginBottom: "var(--space-sm)" }}>
        Generates a 24-hour key: reads all recipe books, writes to <strong>{group.name}</strong>.
      </p>
      <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <button
          className="btn"
          onClick={() => void handleCopyBriefing()}
          disabled={briefingPending}
          style={{ fontSize: "0.85rem" }}
        >
          <Icon name="copy" size={14} />
          {copied === "briefing" ? "Copied!" : briefingPending ? "Generating..." : "Copy agent briefing"}
        </button>
        <button
          className="btn-secondary"
          onClick={() => dailyGoMutation.mutate()}
          disabled={dailyGoMutation.isPending}
          style={{ fontSize: "0.85rem" }}
        >
          <Icon name="external-link" size={14} />
          {dailyOpened ? "Opened!" : dailyGoMutation.isPending ? "Opening..." : "Open recipe check page"}
        </button>
        <Link
          to="/app/map"
          search={{ groupId: group.id } as never}
          style={{ textDecoration: "none" }}
        >
          <button className="btn-secondary" style={{ fontSize: "0.85rem" }}>
            <Icon name="map" size={14} />
            Recipe Map: {group.name}
          </button>
        </Link>
      </div>
      <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-sm)", marginBottom: 0 }}>
        For custom expiry, multiple write recipe books, or per-agent labels —{" "}
        <Link to="/app/keys" style={{ color: "var(--color-primary)" }}>manage API keys</Link>.
      </p>
    </div>
  );
}

/**
 * Per-recipe-book daily-link preference toggles. Controls whether the
 * dashboard's quick-click "Copy briefing" and "Open recipe check page"
 * buttons include this recipe book in read and/or write scope when the user
 * hasn't explicitly overridden. New memberships default to excluded; existing
 * memberships were grandfathered to included by migration 0016. See
 * design-thinking.md §Configurable defaults for the "daily agent link"
 * buttons.
 */
function DailyPrefsToggles({ group }: { group: Group }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (body: { dailyRead?: boolean; dailyWrite?: boolean }) => {
      const res = await authFetch(`/recipe-books/${group.id}/daily-prefs`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to update");
      return json;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });

  return (
    <div style={{ marginTop: "var(--space-md)", fontSize: "0.85rem" }}>
      <p className="text-label" style={{ marginBottom: "var(--space-xs)" }}>Daily agent link defaults</p>
      <div style={{ display: "flex", gap: "var(--space-lg)", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", cursor: "pointer", fontWeight: "normal" }}>
          <input
            type="checkbox"
            checked={group.daily_read}
            onChange={(e) => mutation.mutate({ dailyRead: e.target.checked })}
            disabled={mutation.isPending}
            style={{ width: "auto", marginRight: 0 }}
          />
          Include in reads
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", cursor: "pointer", fontWeight: "normal" }}>
          <input
            type="checkbox"
            checked={group.daily_write}
            onChange={(e) => mutation.mutate({ dailyWrite: e.target.checked })}
            disabled={mutation.isPending}
            style={{ width: "auto", marginRight: 0 }}
          />
          Include in writes
        </label>
      </div>
      <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)", marginBottom: 0 }}>
        Controls what the Dashboard's Copy-briefing and Open-check-page buttons include by default. For per-key control, use{" "}
        <Link to="/app/keys" style={{ color: "var(--color-primary)" }}>manage API keys</Link>.
      </p>
    </div>
  );
}
