import { useQuery } from "@tanstack/react-query";
import { memberVisibleDescriptions } from "@soupnet/domain/browser";
import type { OrgActivityEvent } from "@soupnet/domain/browser";
import { authFetch } from "../auth.js";
import { describeOrgEvent } from "../lib/org-activity-copy.js";

interface OrganizationResponse {
  organization: {
    id: string;
    name: string;
    role: "owner" | "admin" | "member";
    sharing: { outbound: string; inbound: string } | null;
  } | null;
  adminActions: OrgActivityEvent[];
  signIns: Array<{ at: string; method: "password" | "google" }>;
}

const OUTBOUND_COPY: Record<string, string> = {
  allowed: "Members can share the organization's recipe books with people outside it.",
  admins_only: "Only owners and admins can share the organization's recipe books with people outside it.",
  blocked: "Nobody can share the organization's recipe books with people outside it.",
};

const INBOUND_COPY: Record<string, string> = {
  allowed: "You can join recipe books owned outside the organization, such as a personal account's book shared with you.",
  blocked: "You can't join recipe books owned outside the organization.",
};

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * "What your organization's admins can see" (/app/settings/organization),
 * for an account an organization manages (CN-T1 to CN-T3; recipe 57fc1eee).
 * The "can see" list is rendered from the same column set the org console
 * uses, so the page can't claim less than the console shows.
 */
export function SettingsOrganizationPage() {
  const query = useQuery({
    queryKey: ["me", "organization"],
    queryFn: async () => {
      const res = await authFetch("/me/organization");
      const json = (await res.json()) as { ok: boolean; data?: OrganizationResponse; error?: string };
      if (!json.ok || !json.data) throw new Error(json.error ?? "Failed to load your organization");
      return json.data;
    },
  });

  if (query.isLoading) return <p>Loading…</p>;
  if (query.error) return <p style={{ color: "var(--color-error, #ef4444)" }}>{(query.error as Error).message}</p>;
  const data = query.data;
  if (!data?.organization) {
    return (
      <section>
        <h1>Your organization</h1>
        <p>No organization manages this account. It is yours alone.</p>
      </section>
    );
  }
  const org = data.organization;

  return (
    <section style={{ maxWidth: 720 }}>
      <h1>What your organization's admins can see</h1>
      <p>
        This account belongs to <strong>{org.name}</strong>, and you are {org.role === "member" ? "a member" : `an ${org.role}`}.
        The organization owns the account and everything you create with it.
      </p>

      <h2>They can see</h2>
      <ul>
        {memberVisibleDescriptions().map((d) => <li key={d}>{d[0]!.toUpperCase() + d.slice(1)}.</li>)}
        <li>The names of the organization's org-wide recipe books, and how many people belong to each.</li>
      </ul>

      <h2>They can't see</h2>
      <ul>
        <li>Your private recipe books' names or contents.</li>
        <li>The text of your recipes, or what you and your agents search for.</li>
        <li>Your API keys themselves, their names, or which books they reach.</li>
        <li>When and how you sign in (they see only when you were last active).</li>
      </ul>

      <h2>The one way in</h2>
      <p>
        Your organization can get to your data by taking over this account. Because it controls your work
        email and, if you sign in with Google, your company Google account, it can reset your sign-in and sign
        in as you. Soup.net doesn't let admins browse your books, so that is the only path, and it shows up
        below as a sign-in you didn't make.
      </p>

      <h2>Your recent sign-ins</h2>
      {data.signIns.length === 0 ? (
        <p>None recorded yet.</p>
      ) : (
        <ul>
          {data.signIns.map((s) => (
            <li key={s.at}>{fmt(s.at)}, {s.method === "google" ? "with Google" : "with your password"}</li>
          ))}
        </ul>
      )}

      <h2>What admins have done to your account</h2>
      {data.adminActions.length === 0 ? (
        <p>Nothing yet.</p>
      ) : (
        <ul>
          {data.adminActions.map((e, i) => (
            <li key={`${e.at}-${i}`}>{fmt(e.at)}: {describeOrgEvent(e, "me")}, by {e.actor}</li>
          ))}
        </ul>
      )}

      {org.sharing ? (
        <>
          <h2>Sharing</h2>
          <p>{OUTBOUND_COPY[org.sharing.outbound]} {INBOUND_COPY[org.sharing.inbound]}</p>
          <p>
            A sharing policy decides who can be invited into recipe books. It can't stop an API key being used by
            whoever holds it, so keep your keys to yourself and your own agents.
          </p>
        </>
      ) : null}
    </section>
  );
}
