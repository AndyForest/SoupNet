import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DomainClaimStatus } from "@soupnet/domain/browser";
import { authFetch } from "../auth.js";
import {
  AdminLayout,
  AdminPageHeader,
  AdminEmptyState,
  AdminStatusDot,
  fmtAdminDate,
  useAdminGate,
  useAdminListQuery,
} from "../components/admin/index.js";
import { DOMAIN_STATUS_LABELS, accountsAwaitingMessage, autoJoinConfirmMessage, migrationSummaryMessage } from "../lib/org-console-copy.js";

interface MigrationSummary {
  joined: number;
  awaitingSeat: number;
  failed: number;
  stopped?: true;
}

/** A claim as GET /organizations/:id/domains returns it (stream Domains, OD-A2, OD-X4, OD-X6). */
interface DomainClaim {
  id: string;
  domain: string;
  status: DomainClaimStatus;
  recordName: string;
  recordValue: string;
  instructions: string;
  tokenExpiresAt?: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  failingSince: string | null;
  lapsesAt?: string;
  autoJoin: boolean;
  accountsAwaitingJoin?: number;
  migrationFailure?: { accounts: number; at: string; message: string };
}

/** What a write answers with beyond the claim: a not-found message, or what a migration did. */
type ClaimWriteResult = DomainClaim & { message?: string; migration?: MigrationSummary };

const STATUS_DOT = { pending: "warning", verified: "healthy", failing: "error", expired: "error" } as const;

const MUTED: CSSProperties = { color: "var(--color-on-surface-variant)", fontSize: "0.8125rem" };
const ERROR: CSSProperties = { color: "var(--color-error, #ef4444)", fontSize: "0.8125rem" };
const SMALL_BUTTON: CSSProperties = { fontSize: "0.75rem", padding: "0.25rem 0.6rem" };
const RECORD: CSSProperties = { display: "block", userSelect: "all", overflowWrap: "anywhere", fontSize: "0.8125rem", padding: "0.25rem 0.5rem", background: "var(--color-surface-container, rgba(127,127,127,0.1))", borderRadius: 4 };

async function send<T>(path: string, method: string, body?: unknown): Promise<T | undefined> {
  const res = await authFetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  // A rate limit or server failure may not answer in JSON, and the person sees this message.
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; message?: string; error?: string } | null;
  if (!json?.ok) throw new Error(json?.message ?? json?.error ?? "That didn't work. Try again in a moment.");
  return json.data;
}

/**
 * The org console's Domains page (/org/domains, CN-D1): each domain's state,
 * the TXT record to add, the automatic-joining switch, and how many accounts
 * are waiting, including a stalled migration's message. Copy that the IETF
 * draft requires comes from the backend (OD-D2), not from here.
 */
export function OrgDomainsPage() {
  const { gate, isAdmin, organizationId } = useAdminGate("org");
  const queryClient = useQueryClient();
  const enabled = isAdmin && organizationId !== null;

  const overview = useAdminListQuery<{ name: string }>({
    queryKey: ["org", organizationId, "overview"],
    path: `/organizations/${organizationId}`,
    enabled,
    failure: "Failed to load the organization",
  });
  const domains = useAdminListQuery<DomainClaim[]>({
    queryKey: ["org", organizationId, "domains"],
    path: `/organizations/${organizationId}/domains`,
    enabled,
    failure: "Failed to load domains",
  });

  const [newDomain, setNewDomain] = useState("");
  const add = useMutation({
    mutationFn: (domain: string) => send<ClaimWriteResult>(`/organizations/${organizationId}/domains`, "POST", { domain }),
    onSuccess: () => setNewDomain(""),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["org", organizationId] }),
  });

  if (gate) return gate;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (newDomain.trim()) add.mutate(newDomain.trim());
  };
  const claims = domains.data ?? [];

  return (
    <AdminLayout scope="org" heading={overview.data?.name}>
      <AdminPageHeader eyebrow="Organization" title="Domains" subtitle="Prove your organization controls an email domain, and people on it can join automatically." />

      <div style={{ padding: "0 var(--space-lg) var(--space-lg)", maxWidth: 760 }}>
        <form onSubmit={submit} style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "var(--space-md)" }}>
          <label style={{ flex: "1 1 240px" }}>
            <span style={{ ...MUTED, display: "block" }}>Add a domain</span>
            <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="example.com" autoComplete="off" spellCheck={false} />
          </label>
          <button className="btn-primary" type="submit" disabled={add.isPending || !newDomain.trim()}>Add domain</button>
        </form>
        {add.error ? <div role="alert" style={{ ...ERROR, marginBottom: "var(--space-md)" }}>{(add.error as Error).message}</div> : null}

        {domains.isLoading ? (
          <div style={MUTED}>Loading domains…</div>
        ) : domains.error ? (
          <div style={ERROR}>{(domains.error as Error).message}</div>
        ) : claims.length === 0 ? (
          <AdminEmptyState title="No domains yet" body="Add your organization's email domain to get the DNS record that verifies it." />
        ) : (
          claims.map((claim) => <DomainCard key={claim.id} claim={claim} organizationId={organizationId!} />)
        )}
      </div>
    </AdminLayout>
  );
}

function DomainCard({ claim, organizationId }: { claim: DomainClaim; organizationId: string }) {
  const queryClient = useQueryClient();
  const base = `/organizations/${organizationId}/domains/${claim.id}`;
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingAutoJoin, setConfirmingAutoJoin] = useState(false);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["org", organizationId] });
  const report = (result: ClaimWriteResult | undefined) =>
    setNotice([result?.message, result?.migration ? migrationSummaryMessage(result.migration) : null].filter(Boolean).join(" ") || null);

  const check = useMutation({
    mutationFn: () => send<ClaimWriteResult>(`${base}/check`, "POST"),
    onMutate: () => setNotice(null),
    onSuccess: report,
    onSettled: refresh,
  });
  const setAutoJoin = useMutation({
    mutationFn: (autoJoin: boolean) => send<ClaimWriteResult>(base, "PATCH", { autoJoin }),
    onMutate: () => setNotice(null),
    onSuccess: report,
    onSettled: refresh,
  });
  // Adding the domain again issues a new code once the old one has expired.
  const renew = useMutation({
    mutationFn: () => send<ClaimWriteResult>(`/organizations/${organizationId}/domains`, "POST", { domain: claim.domain }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => send<unknown>(base, "DELETE"),
    onSettled: refresh,
  });

  const failure = (check.error ?? setAutoJoin.error ?? renew.error ?? remove.error) as Error | null;
  const recordIsTheNextStep = claim.status !== "verified";

  const record = (
    <>
      <div style={{ ...MUTED, marginTop: "var(--space-sm)" }}>TXT record name</div>
      <code style={RECORD}>{claim.recordName}</code>
      <div style={{ ...MUTED, marginTop: "var(--space-sm)" }}>Value</div>
      <code style={RECORD}>{claim.recordValue}</code>
      <p style={{ ...MUTED, marginTop: "var(--space-sm)" }}>{claim.instructions}</p>
    </>
  );

  return (
    <section aria-label={claim.domain} style={{ border: "1px solid var(--color-outline-variant, rgba(127,127,127,0.3))", borderRadius: 8, padding: "var(--space-md)", marginBottom: "var(--space-md)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-sm)", flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 style={{ fontSize: "1rem", margin: 0, overflowWrap: "anywhere" }}>{claim.domain}</h2>
        <AdminStatusDot status={STATUS_DOT[claim.status]} label={DOMAIN_STATUS_LABELS[claim.status]} />
      </div>

      <div style={{ ...MUTED, marginTop: "var(--space-xs, 0.25rem)" }}>
        Last checked {fmtAdminDate(claim.lastCheckedAt)}
        {claim.tokenExpiresAt && claim.status === "pending" ? ` · Code expires ${fmtAdminDate(claim.tokenExpiresAt)}` : ""}
        {claim.lapsesAt ? ` · Becomes unverified ${fmtAdminDate(claim.lapsesAt)} if the record stays missing` : ""}
      </div>

      {claim.migrationFailure ? (
        <div role="status" style={{ ...ERROR, marginTop: "var(--space-sm)" }}>
          {claim.migrationFailure.message} Last try: {fmtAdminDate(claim.migrationFailure.at)}.
        </div>
      ) : null}
      {claim.accountsAwaitingJoin ? <div style={{ fontSize: "0.875rem", marginTop: "var(--space-sm)" }}>{accountsAwaitingMessage(claim.accountsAwaitingJoin, claim.autoJoin)}</div> : null}

      {claim.status !== "expired" ? (
        <label style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-start", marginTop: "var(--space-sm)", fontSize: "0.875rem" }}>
          <input
            type="checkbox"
            style={{ width: "auto", marginTop: "0.2rem" }}
            checked={claim.autoJoin}
            disabled={setAutoJoin.isPending || confirmingAutoJoin}
            // Turning it on moves people's accounts, so it asks first. Turning it off moves nobody.
            onChange={(e) => (e.target.checked ? setConfirmingAutoJoin(true) : setAutoJoin.mutate(false))}
          />
          <span>
            Automatic joining
            <span style={{ ...MUTED, display: "block" }}>While the domain is verified, anyone who verifies an address on it joins your organization, and existing verified accounts on it move in.</span>
          </span>
        </label>
      ) : null}

      {confirmingAutoJoin ? (
        <div role="group" aria-label={`Turn on automatic joining for ${claim.domain}`} style={{ marginTop: "var(--space-sm)" }}>
          <p style={{ fontSize: "0.875rem", margin: 0 }}>{autoJoinConfirmMessage(claim.domain, claim.accountsAwaitingJoin)}</p>
          <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap", marginTop: "var(--space-sm)" }}>
            <button className="btn-primary" style={SMALL_BUTTON} disabled={setAutoJoin.isPending} onClick={() => { setConfirmingAutoJoin(false); setAutoJoin.mutate(true); }}>Turn on automatic joining</button>
            <button className="btn-secondary" style={SMALL_BUTTON} onClick={() => setConfirmingAutoJoin(false)}>Keep it off</button>
          </div>
        </div>
      ) : null}

      {recordIsTheNextStep ? record : <details style={{ marginTop: "var(--space-sm)" }}><summary style={MUTED}>The DNS record to keep in place</summary>{record}</details>}

      {notice ? <div role="status" style={{ fontSize: "0.875rem", marginTop: "var(--space-sm)" }}>{notice}</div> : null}
      {failure ? <div role="alert" style={{ ...ERROR, marginTop: "var(--space-sm)" }}>{failure.message}</div> : null}

      <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap", alignItems: "center", marginTop: "var(--space-sm)" }}>
        {claim.status === "expired" ? (
          <button className="btn-secondary" style={SMALL_BUTTON} disabled={renew.isPending} onClick={() => renew.mutate()}>Get a new code</button>
        ) : (
          <button className="btn-secondary" style={SMALL_BUTTON} disabled={check.isPending} onClick={() => check.mutate()}>Check now</button>
        )}
        {confirmingDelete ? (
          <>
            <span style={MUTED}>Automatic joining on {claim.domain} stops at once. Nobody's account or books change.</span>
            <button className="btn-secondary" style={SMALL_BUTTON} disabled={remove.isPending} onClick={() => remove.mutate()}>Delete {claim.domain}</button>
            <button className="btn-secondary" style={SMALL_BUTTON} onClick={() => setConfirmingDelete(false)}>Keep it</button>
          </>
        ) : (
          <button className="btn-secondary" style={SMALL_BUTTON} onClick={() => setConfirmingDelete(true)}>Delete</button>
        )}
      </div>
    </section>
  );
}
