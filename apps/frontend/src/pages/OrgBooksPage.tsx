import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InboundSharing, OutboundSharing } from "@soupnet/domain/browser";
import { authFetch } from "../auth.js";
import {
  AdminLayout,
  AdminPageHeader,
  AdminMetricCard,
  AdminEmptyState,
  AdminTable,
  useAdminGate,
  useAdminListQuery,
  type AdminColumn,
} from "../components/admin/index.js";

interface OrgWideBook {
  id: string;
  name: string;
  isDefault: boolean;
  members: number;
  outsideMembers: number;
  recipes: number;
}

interface BooksResponse {
  orgWideBooks: OrgWideBook[];
  privateBooks: number;
  outsidePeopleInPrivateBooks: number;
  sharing: { outbound: OutboundSharing; inbound: InboundSharing } | null;
}

const OUTBOUND_OPTIONS: Array<{ value: OutboundSharing; label: string }> = [
  { value: "allowed", label: "Anyone can share with people outside the organization" },
  { value: "admins_only", label: "Only owners and admins can share outside the organization" },
  { value: "blocked", label: "Nobody can share outside the organization" },
];

const INBOUND_OPTIONS: Array<{ value: InboundSharing; label: string }> = [
  { value: "allowed", label: "Members can join recipe books owned outside the organization" },
  { value: "blocked", label: "Members can't join recipe books owned outside the organization" },
];

/**
 * The org console's Books page (/org/books): the default and org-wide books,
 * private books as totals only, and the sharing policy beside the books it
 * governs (CN-B1, CN-B2, CN-P1, CN-P5; no Settings page, recipe ea5a5dca).
 */
export function OrgBooksPage() {
  const { gate, isAdmin, organizationId } = useAdminGate("org");
  const queryClient = useQueryClient();
  const enabled = isAdmin && organizationId !== null;

  const overview = useAdminListQuery<{ name: string }>({
    queryKey: ["org", organizationId, "overview"],
    path: `/organizations/${organizationId}`,
    enabled,
    failure: "Failed to load the organization",
  });
  const books = useAdminListQuery<BooksResponse>({
    queryKey: ["org", organizationId, "books"],
    path: `/organizations/${organizationId}/books`,
    enabled,
    failure: "Failed to load books",
  });

  const [outbound, setOutbound] = useState<OutboundSharing>("allowed");
  const [inbound, setInbound] = useState<InboundSharing>("allowed");
  useEffect(() => {
    if (books.data?.sharing) {
      setOutbound(books.data.sharing.outbound);
      setInbound(books.data.sharing.inbound);
    }
  }, [books.data?.sharing]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/organizations/${organizationId}/sharing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outbound, inbound }),
      });
      const json = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (!json.ok) throw new Error(json.message ?? json.error ?? "Couldn't save the sharing policy.");
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["org", organizationId] }),
  });

  const makePrivate = useMutation({
    mutationFn: async (bookId: string) => {
      const res = await authFetch(`/recipe-books/${bookId}/org-wide`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgWide: false }),
      });
      const json = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (!json.ok) throw new Error(json.message ?? json.error ?? "Couldn't change the book.");
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["org", organizationId] }),
  });

  if (gate) return gate;

  const changed = books.data?.sharing && (books.data.sharing.outbound !== outbound || books.data.sharing.inbound !== inbound);

  const columns: AdminColumn<OrgWideBook>[] = [
    { key: "name", header: "Org-wide book", render: (b) => <span>{b.name}{b.isDefault ? " (default)" : ""}</span> },
    { key: "members", header: "Members", align: "right", render: (b) => <span>{b.members}</span> },
    { key: "outsideMembers", header: "From outside", align: "right", render: (b) => <span>{b.outsideMembers}</span> },
    { key: "recipes", header: "Recipes", align: "right", render: (b) => <span>{b.recipes}</span> },
    {
      key: "actions",
      header: "",
      render: (b) =>
        b.isDefault ? null : (
          <button
            className="btn-secondary"
            disabled={makePrivate.isPending}
            onClick={() => makePrivate.mutate(b.id)}
            style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem" }}
            title="Members who were added to it directly keep their access; everyone else loses it."
          >
            Make private
          </button>
        ),
    },
  ];

  return (
    <AdminLayout scope="org" heading={overview.data?.name}>
      <AdminPageHeader eyebrow="Organization" title="Recipe books" subtitle="Org-wide books are open to every member. Private books are counted here, never named." />

      <div style={{ display: "flex", gap: "var(--space-sm)", padding: "0 var(--space-lg) var(--space-md)", flexWrap: "wrap" }}>
        <AdminMetricCard label="Org-wide books" value={books.data?.orgWideBooks.length ?? "—"} />
        <AdminMetricCard label="Private books" value={books.data?.privateBooks ?? "—"} />
        <AdminMetricCard
          label="Outsiders in private books"
          value={books.data?.outsidePeopleInPrivateBooks ?? "—"}
          hint="People outside the organization who belong to at least one member's private book."
        />
      </div>

      <div style={{ padding: "0 var(--space-lg) var(--space-lg)" }}>
        {books.error ? (
          <div style={{ color: "var(--color-error, #ef4444)" }}>{(books.error as Error).message}</div>
        ) : (
          <AdminTable
            rows={books.data?.orgWideBooks ?? []}
            columns={columns}
            rowKey={(b) => b.id}
            empty={<AdminEmptyState title="No org-wide books" body="A book's owner can make it org-wide from its own page." />}
          />
        )}
        {makePrivate.error ? <div role="alert" style={{ color: "var(--color-error, #ef4444)" }}>{(makePrivate.error as Error).message}</div> : null}

        <section style={{ marginTop: "var(--space-xl)", maxWidth: 680 }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "var(--space-sm)" }}>Sharing outside the organization</h2>
          <label style={{ display: "block", marginBottom: "var(--space-sm)" }}>
            <span style={{ display: "block", fontSize: "0.8rem", color: "var(--color-on-surface-variant)" }}>Our recipe books</span>
            <select value={outbound} onChange={(e) => setOutbound(e.target.value as OutboundSharing)}>
              {OUTBOUND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label style={{ display: "block", marginBottom: "var(--space-sm)" }}>
            <span style={{ display: "block", fontSize: "0.8rem", color: "var(--color-on-surface-variant)" }}>Other people's recipe books</span>
            <select value={inbound} onChange={(e) => setInbound(e.target.value as InboundSharing)}>
              {INBOUND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <button className="btn-primary" disabled={!changed || save.isPending} onClick={() => save.mutate()}>
            Save sharing policy
          </button>
          {save.error ? <div role="alert" style={{ color: "var(--color-error, #ef4444)" }}>{(save.error as Error).message}</div> : null}
          <p style={{ fontSize: "0.8rem", color: "var(--color-on-surface-variant)", marginTop: "var(--space-sm)" }}>
            A change applies to new invitations, pending ones and moves of recipes. Nobody who already belongs to a book loses access; remove people from an org-wide book on that book's members page. An API key works for whoever holds it, so this policy governs sharing, but it can't stop a member handing their key to someone.
          </p>
        </section>
      </div>
    </AdminLayout>
  );
}
