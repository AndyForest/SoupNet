import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "../auth.js";
import { fmtAdminDate, useAdminListQuery } from "../components/admin/index.js";
import { newTabSecret, sha256Base64Url, storeTabSecret } from "../lib/google-sign-in.js";
import { directoryLastErrorLabel } from "../lib/org-console-copy.js";

/** GET /organizations/:id/directory (stream Offboarding, OB-K4): never the credential. */
export interface DirectoryConnection {
  connected: boolean;
  kind: "admin_consent" | "service_account" | null;
  domain: string | null;
  adminEmail: string | null;
  serviceAccountEmail: string | null;
  connectedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  checksPaused: boolean;
}

const MUTED: CSSProperties = { color: "var(--color-on-surface-variant)", fontSize: "0.8125rem" };
const ERROR: CSSProperties = { color: "var(--color-error, #ef4444)", fontSize: "0.8125rem" };

async function send<T>(path: string, method: string, body?: unknown): Promise<T | undefined> {
  const res = await authFetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; message?: string; error?: string } | null;
  if (!json?.ok) throw new Error(json?.message ?? json?.error ?? "That didn't work. Try again in a moment.");
  return json.data;
}

/**
 * The directory connection on the Members page (/org#directory, CN-U6; the
 * completion page after Google's consent links here). The connection's last
 * error shows as a code and a time, never a token or a response from Google,
 * and a pasted service-account key is dropped from the page once sent.
 */
export function OrgDirectorySection({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const section = useRef<HTMLElement>(null);
  const directory = useAdminListQuery<DirectoryConnection>({
    queryKey: ["org", organizationId, "directory"],
    path: `/organizations/${organizationId}/directory`,
    enabled: true,
    failure: "Failed to load the directory connection",
  });
  const domains = useAdminListQuery<Array<{ domain: string; status: string }>>({
    queryKey: ["org", organizationId, "domains"],
    path: `/organizations/${organizationId}/domains`,
    enabled: true,
    failure: "Failed to load domains",
  });
  const verified = (domains.data ?? []).filter((d) => d.status === "verified").map((d) => d.domain);

  const [chosenDomain, setChosenDomain] = useState("");
  const domain = verified.includes(chosenDomain) ? chosenDomain : (verified[0] ?? "");
  const [key, setKey] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["org", organizationId] });

  // The page loads before this section has anything to scroll to.
  const loaded = !directory.isLoading;
  useEffect(() => {
    if (loaded && window.location.hash === "#directory") section.current?.scrollIntoView();
  }, [loaded]);

  const connect = useMutation({
    mutationFn: async () => {
      const secret = newTabSecret();
      storeTabSecret(secret);
      const data = await send<{ url: string }>(`/organizations/${organizationId}/directory/google/start`, "POST", { binding: await sha256Base64Url(secret), domain });
      if (!data?.url) throw new Error("Google didn't answer. Try again in a moment.");
      window.location.assign(data.url);
    },
  });
  const serviceAccount = useMutation({
    mutationFn: () => send<DirectoryConnection>(`/organizations/${organizationId}/directory/service-account`, "PUT", { key, adminEmail }),
    onSuccess: () => {
      setKey("");
      setAdminEmail("");
    },
    onSettled: refresh,
  });
  const disconnect = useMutation({
    mutationFn: () => send<unknown>(`/organizations/${organizationId}/directory`, "DELETE"),
    onSuccess: () => setConfirmingDisconnect(false),
    onSettled: refresh,
  });

  const data = directory.data;
  const failure = (connect.error ?? serviceAccount.error ?? disconnect.error) as Error | null;

  const connectForms = (
    <>
      {verified.length === 0 ? (
        <p style={MUTED}>Verify a domain on the <a href="/org/domains">Domains page</a> first: a directory connects on a verified domain.</p>
      ) : (
        <>
          {verified.length > 1 ? (
            <label style={{ display: "block", marginBottom: "var(--space-sm)" }}>
              <span style={{ ...MUTED, display: "block" }}>Domain</span>
              <select value={domain} onChange={(e) => setChosenDomain(e.target.value)} style={{ width: "auto" }}>
                {verified.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          ) : null}
          <button className="btn-primary" disabled={connect.isPending} onClick={() => connect.mutate()}>
            {data?.connected ? "Reconnect with Google" : "Connect with Google"}
          </button>
          <p style={{ ...MUTED, marginTop: "var(--space-xs, 0.25rem)" }}>
            Opens Google, where a Workspace admin's account for {domain} is asked once for read-only access to your directory.
          </p>
        </>
      )}
      <details style={{ marginTop: "var(--space-sm)" }}>
        <summary style={MUTED}>Use a service account instead</summary>
        <label style={{ display: "block", marginTop: "var(--space-sm)" }}>
          <span style={{ ...MUTED, display: "block" }}>A Workspace admin's address, on a verified domain</span>
          <input value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label style={{ display: "block", marginTop: "var(--space-sm)" }}>
          <span style={{ ...MUTED, display: "block" }}>The service account's JSON key</span>
          <textarea value={key} onChange={(e) => setKey(e.target.value)} rows={4} autoComplete="off" spellCheck={false} />
        </label>
        <button className="btn-secondary" style={{ marginTop: "var(--space-sm)" }} disabled={serviceAccount.isPending || !key.trim() || !adminEmail.trim()} onClick={() => serviceAccount.mutate()}>
          Connect the service account
        </button>
      </details>
    </>
  );

  return (
    <section id="directory" ref={section} style={{ marginTop: "var(--space-xl)", maxWidth: 680, scrollMarginTop: "var(--space-lg)" }}>
      <h2 style={{ fontSize: "1rem", marginBottom: "var(--space-sm)" }}>Google Workspace directory</h2>
      {directory.isLoading ? (
        <div style={MUTED}>Loading the directory connection…</div>
      ) : directory.error ? (
        <div style={MUTED}>{(directory.error as Error).message}</div>
      ) : data?.connected ? (
        <>
          {data.checksPaused ? (
            <div role="status" style={{ fontSize: "0.875rem", marginBottom: "var(--space-sm)", color: "var(--color-error, #ef4444)" }}>
              Checks paused: {data.domain}'s verification isn't current. People already switched off stay switched off. Put the TXT record back on the <a href="/org/domains">Domains page</a> to resume.
            </div>
          ) : null}
          <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "0.25rem var(--space-md)", fontSize: "0.875rem", margin: 0 }}>
            <dt style={MUTED}>Domain</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{data.domain}</dd>
            <dt style={MUTED}>Connected with</dt>
            <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
              {data.kind === "service_account" ? `Service account ${data.serviceAccountEmail ?? ""}, as ${data.adminEmail ?? ""}` : `${data.adminEmail ?? "An admin's Google account"}`}
            </dd>
            <dt style={MUTED}>Connected</dt><dd style={{ margin: 0 }}>{fmtAdminDate(data.connectedAt)}</dd>
            <dt style={MUTED}>Last successful check</dt><dd style={{ margin: 0 }}>{fmtAdminDate(data.lastSuccessAt)}</dd>
            {data.lastError ? (
              <>
                <dt style={MUTED}>Last error</dt>
                <dd style={{ margin: 0 }}>{directoryLastErrorLabel(data.lastError)}, {fmtAdminDate(data.lastErrorAt)}</dd>
              </>
            ) : null}
          </dl>
          <div style={{ marginTop: "var(--space-md)" }}>{connectForms}</div>
          <div style={{ marginTop: "var(--space-md)", display: "flex", gap: "var(--space-sm)", flexWrap: "wrap", alignItems: "center" }}>
            {confirmingDisconnect ? (
              <>
                <span style={MUTED}>Checks stop, and people the directory switched off can use Soup.net again.</span>
                <button className="btn-secondary" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect the directory</button>
                <button className="btn-secondary" onClick={() => setConfirmingDisconnect(false)}>Keep it connected</button>
              </>
            ) : (
              <button className="btn-secondary" onClick={() => setConfirmingDisconnect(true)}>Disconnect</button>
            )}
          </div>
        </>
      ) : (
        <>
          <p style={{ ...MUTED, marginTop: 0 }}>Connect your directory and anyone suspended or removed in Google Workspace loses access to Soup.net, with their agents' keys, within the hour.</p>
          {connectForms}
        </>
      )}
      {failure ? <div role="alert" style={{ ...ERROR, marginTop: "var(--space-sm)" }}>{failure.message}</div> : null}
    </section>
  );
}
