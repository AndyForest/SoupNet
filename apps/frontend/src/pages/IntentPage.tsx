import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useIntent } from "../hooks/useIntent.js";
import type { LineageEntry } from "../hooks/useIntent.js";
import { Icon } from "../components/Icon.js";
import { FeedbackCard } from "../components/FeedbackCard.js";
import { lineageLabel } from "../lib/intent-link.js";

/**
 * /app/intents/:intentId — one declared intent (drafts-and-triage slice 9).
 *
 * An intent is the task story an agent registers before it checks; the id it
 * gets back joins the recipes it was shown, the recipes it deposited, and the
 * feedback it logged. This page shows that lineage in time order, so the
 * person can see what one task of their agent's did. Reached from the intent
 * id on a feedback row (and, after slice 6a, from the review queue's intent
 * heading). Another person's intent, a missing one, and a malformed id all
 * show the same "Intent not found".
 */
export function IntentPage() {
  const { intentId } = useParams({ strict: false }) as { intentId: string };
  // The page number belongs to one intent: following a link to another starts at page 1.
  const [paging, setPaging] = useState({ intentId, page: 1 });
  const page = paging.intentId === intentId ? paging.page : 1;
  const setPage = (p: number) => setPaging({ intentId, page: p });
  const { data: result, isLoading, isError } = useIntent(intentId, page);

  if (isLoading) {
    return <p style={{ color: "var(--color-on-surface-variant)" }}>Loading intent...</p>;
  }
  if (result?.kind === "notFound") {
    return <p style={{ color: "var(--color-error)" }} data-testid="intent-not-found">Intent not found.</p>;
  }
  if (isError || !result || result.kind === "error") {
    const status = result?.kind === "error" ? ` (HTTP ${result.status})` : "";
    return <p style={{ color: "var(--color-error)" }} data-testid="intent-load-error">Could not load this intent{status}. Reload the page, or sign in again if your session has ended.</p>;
  }
  const data = result.data;

  const { intent, lineage } = data;
  const meta = [
    intent.agentId && `agent ${intent.agentId}`,
    intent.apiKeyLabel && `key: ${intent.apiKeyLabel}`,
    `registered ${new Date(intent.createdAt).toLocaleString()}`,
    `last used ${new Date(intent.lastUsedAt).toLocaleString()}`,
  ].filter(Boolean).join(" · ");

  return (
    <div data-testid="intent-page">
      <button
        className="btn-ghost"
        onClick={() => window.history.back()}
        style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)", marginBottom: "var(--space-lg)", fontSize: "0.85rem", padding: 0 }}
      >
        <Icon name="arrow-left" size={16} />
        Back
      </button>

      <header style={{ marginBottom: "var(--space-2xl)" }}>
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-xs)" }}>
          Intent <code style={{ overflowWrap: "anywhere" }}>{intent.id}</code>
        </p>
        <h1 style={{ fontSize: "1.5rem", lineHeight: 1.35, marginBottom: "var(--space-md)", overflowWrap: "anywhere" }}>
          {intent.story}
        </h1>
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", overflowWrap: "anywhere" }}>{meta}</p>
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }} data-testid="intent-counts">
          {intent.counts.shown} shown · {intent.counts.deposits} deposited · {intent.counts.feedback} feedback
        </p>
      </header>

      <h2 style={{ fontSize: "1.1rem", marginBottom: "var(--space-md)" }}>What happened, in order</h2>
      {lineage.length === 0 ? (
        <p style={{ color: "var(--color-on-surface-variant)" }}>Nothing recorded under this intent yet.</p>
      ) : (
        <ol style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {lineage.map((entry, i) => (
            <li key={`${entry.type}-${entryKey(entry)}-${i}`}>
              <LineageItem entry={entry} />
            </li>
          ))}
        </ol>
      )}

      {data.totalPages > 1 && (
        <nav style={{ display: "flex", gap: "var(--space-md)", alignItems: "center", marginTop: "var(--space-lg)" }}>
          <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="text-xs">Page {data.page} of {data.totalPages}</span>
          <button className="btn-ghost" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </nav>
      )}
    </div>
  );
}

function entryKey(entry: LineageEntry): string {
  return entry.type === "feedback" ? entry.feedback.id : entry.traceId;
}

function LineageItem({ entry }: { entry: LineageEntry }) {
  const when = new Date(entry.at).toLocaleString();
  const label = lineageLabel(entry.type, entry.type === "deposit" ? entry.draftState : null);
  if (entry.type === "feedback") {
    return (
      <div>
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-xs)" }}>
          {label} · {when}
          {entry.feedback.traceId && (
            <> · about <a href={`/app/traces/${entry.feedback.traceId}`} style={{ color: "var(--color-primary)", textDecoration: "none", fontFamily: "var(--font-mono, monospace)" }}>{entry.feedback.traceId.slice(0, 8)}…</a></>
          )}
          {!entry.feedback.traceId && entry.feedback.searchId && " · about a search"}
        </p>
        <FeedbackCard row={entry.feedback} traceId={entry.feedback.traceId} showIntent={false} />
      </div>
    );
  }
  return (
    <p className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
      {label} · {when} ·{" "}
      <a href={`/app/traces/${entry.traceId}`} style={{ color: "var(--color-primary)", textDecoration: "none", fontFamily: "var(--font-mono, monospace)" }}>
        {entry.traceId.slice(0, 8)}…
      </a>
    </p>
  );
}
