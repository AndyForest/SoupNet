import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { authFetch } from "../auth.js";
import { AdminPagination } from "../components/admin/AdminPagination.js";
import {
  QUEUE_ACTIONS,
  actionAccessibleName,
  actionLabel,
  actionOutcome,
  depositedText,
  excerpt,
  linkNotShownText,
  nextFocusId,
  queueRatingsText,
  queueTotalText,
  stateLabel,
  whyLabel,
} from "../lib/draft-queue.js";
import type { QueueAction, QueueItem } from "../lib/draft-queue.js";
import styles from "./DraftQueuePage.module.css";

/**
 * The review queue (drafts-and-triage slice 3): drafts your agents parked
 * about your taste and judgment because they could not ask you, sorted for
 * triage, with confirm, reject, and not chosen. `?ids=a,b` (the link an
 * agent hands you) shows exactly those recipes instead. Everything listed
 * comes from GET /traces/drafts, which decides what you may see; this page
 * only renders and acts.
 */

interface QueueData { mode: "queue"; items: QueueItem[]; total: number; page: number; perPage: number; totalPages: number; order: string }
interface LinkData { mode: "ids"; items: QueueItem[]; notShown: number; truncated: boolean }

class QueryError extends Error {}

async function fetchQueue(q: string, page: number): Promise<QueueData> {
  const qs = new URLSearchParams({ page: String(page), ...(q ? { q } : {}) });
  const res = await authFetch(`/traces/drafts?${qs.toString()}`);
  const json = (await res.json()) as { ok: boolean; data?: QueueData; error?: string };
  if (!json.ok || !json.data) throw new QueryError(json.error ?? "Could not load your drafts.");
  return json.data;
}

async function fetchLinked(ids: string): Promise<LinkData> {
  const res = await authFetch(`/traces/drafts?ids=${encodeURIComponent(ids)}`);
  const json = (await res.json()) as { ok: boolean; data?: LinkData; error?: string };
  if (!json.ok || !json.data) throw new Error(json.error ?? "Could not load these recipes.");
  return json.data;
}

async function act(action: QueueAction, id: string): Promise<{ alreadyResolved?: boolean; draftState?: string | null }> {
  const res = action === "not_chosen"
    ? await authFetch(`/traces/${id}/not-chosen`, { method: "POST" })
    : await authFetch(`/traces/${id}/reaction`, {
      method: "PUT",
      body: JSON.stringify({ reaction: action === "confirm" ? "still_true" : "wrong" }),
    });
  const json = (await res.json()) as { ok: boolean; status?: string; error?: string; draftState?: string; data?: { alreadyResolved?: boolean; draftState?: string | null } };
  if (res.status === 409 && json.status === "already_resolved") return { alreadyResolved: true, draftState: json.draftState ?? null };
  if (!json.ok) {
    if (res.status === 404) throw new Error("This draft is no longer available to you.");
    throw new Error(json.error ?? "That did not work. Try again.");
  }
  return json.data ?? {};
}

export function DraftQueuePage() {
  const search = useSearch({ strict: false }) as { ids?: string; q?: string; page?: number | string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ids = typeof search.ids === "string" ? search.ids : search.ids !== undefined ? String(search.ids) : undefined;
  const q = typeof search.q === "string" ? search.q : "";
  const page = Math.max(1, Number(search.page ?? 1) || 1);
  const linkMode = ids !== undefined;

  const [draftQuery, setDraftQuery] = useState(q);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null | undefined>(undefined);

  useEffect(() => setDraftQuery(q), [q]);

  const queueQuery = useQuery({
    queryKey: ["drafts-queue", q, page],
    queryFn: () => fetchQueue(q, page),
    enabled: !linkMode,
    retry: false,
  });
  const linkQuery = useQuery({
    queryKey: ["drafts-link", ids],
    queryFn: () => fetchLinked(ids ?? ""),
    enabled: linkMode,
  });

  const items: QueueItem[] = (linkMode ? linkQuery.data?.items : queueQuery.data?.items) ?? [];
  const loading = linkMode ? linkQuery.isLoading : queueQuery.isLoading;
  const loadError = linkMode ? linkQuery.error : queueQuery.error;

  // Move focus once the list re-renders after an action (S3-A5).
  useEffect(() => {
    if (pendingFocus.current === undefined) return;
    const target = pendingFocus.current;
    pendingFocus.current = undefined;
    const el = target ? itemRefs.current.get(target) : null;
    (el ?? headingRef.current)?.focus();
  });

  const mutation = useMutation({
    mutationFn: ({ action, item }: { action: QueueAction; item: QueueItem }) => act(action, item.id),
    onSuccess: (result, { action, item }) => {
      setActionError(null);
      setAnnouncement(result.alreadyResolved
        ? `"${excerpt(item.recipe, 60)}" was already resolved${result.draftState ? ` (${result.draftState.replace("_", " ")})` : ""}; nothing changed.`
        : actionOutcome(action, item));
      pendingFocus.current = nextFocusId(items.map((i) => i.id), item.id);
      // The item leaves the list at once; the refetch below confirms it.
      if (!linkMode) {
        queryClient.setQueryData<QueueData>(["drafts-queue", q, page], (old) => old
          ? { ...old, items: old.items.filter((i) => i.id !== item.id), total: Math.max(0, old.total - 1) }
          : old);
      }
      void queryClient.invalidateQueries({ queryKey: ["drafts-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["drafts-link"] });
      void queryClient.invalidateQueries({ queryKey: ["drafts-count"] });
      void queryClient.invalidateQueries({ queryKey: ["traces"] });
    },
    onError: (err) => {
      setAnnouncement("");
      setActionError(err instanceof Error ? err.message : String(err));
      void queryClient.invalidateQueries({ queryKey: ["drafts-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["drafts-link"] });
    },
  });

  async function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const next = draftQuery.trim();
    try {
      // Fetch first: an invalid query shows the parser's error and keeps the
      // last good list (S3-Q6).
      await queryClient.fetchQuery({ retry: false, queryKey: ["drafts-queue", next, 1], queryFn: () => fetchQueue(next, 1) });
      setQueryError(null);
      void navigate({ to: "/app/drafts", search: (next ? { q: next } : {}) as never });
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : String(err));
    }
  }

  const heading = linkMode ? "Drafts your agent linked" : "Drafts awaiting your review";

  return (
    <div>
      <header style={{ marginBottom: "var(--space-md)" }}>
        <h1 ref={headingRef} tabIndex={-1} className={styles["heading"]}>{heading}</h1>
      </header>
      <p className={styles["intro"]}>
        Your agents parked these hypotheses about your taste and judgment because they could not ask you.
        Confirming publishes a draft to its recipe book, where collaborators can find it; rejecting it or
        marking it not chosen keeps it private to you and your agents. Each choice is final.
      </p>

      {linkMode ? (
        <p className={styles["hint"]}>
          <Link to="/app/drafts" search={{} as never}>Show every draft awaiting review</Link>
        </p>
      ) : (
        <form className={styles["search"]} onSubmit={(e) => void submitSearch(e)} role="search">
          <div className={styles["searchField"]}>
            <label htmlFor="draft-search">Search your drafts</label>
            <input
              id="draft-search"
              type="search"
              value={draftQuery}
              onChange={(e) => setDraftQuery(e.target.value)}
              placeholder="impact:high cache strategy"
              aria-describedby="draft-search-hint"
            />
          </div>
          <button type="submit">Search</button>
        </form>
      )}
      {!linkMode && (
        <p id="draft-search-hint" className={styles["hint"]}>
          Same syntax as agent search: words search by meaning, <code>"quoted terms"</code> match exactly,
          and <code>impact:</code> / <code>uncertainty:</code> (low, medium, high) or <code>after:</code> narrow the list.
          Only your drafts are listed.
        </p>
      )}
      <div role="alert" className={styles["error"]}>{queryError ?? actionError ?? ""}</div>
      <p role="status" aria-live="polite" className={styles["status"]}>{announcement}</p>

      {loading && <p>Loading…</p>}
      {loadError && !loading && (
        <p className={styles["error"]}>{loadError instanceof Error ? loadError.message : "Could not load your drafts."}</p>
      )}

      {!loading && !loadError && (
        <>
          {linkMode && linkQuery.data && linkNotShownText(linkQuery.data.notShown, linkQuery.data.truncated) && (
            <p className={styles["hint"]}>{linkNotShownText(linkQuery.data.notShown, linkQuery.data.truncated)}</p>
          )}
          {!linkMode && queueQuery.data && (
            <p className={styles["hint"]} data-testid="queue-total">
              {q ? `${queueQuery.data.total} matching ${queueQuery.data.total === 1 ? "draft" : "drafts"}.` : queueTotalText(queueQuery.data.total)}
              {queueQuery.data.order === "triage" && queueQuery.data.total > 1 ? " Highest stakes and least certain first." : ""}
            </p>
          )}

          {items.length === 0 ? (
            <p className={styles["empty"]} data-testid="queue-empty">
              {linkMode ? "None of the recipes in this link can be shown." : q ? "No drafts match this search." : "No drafts await your review."}
            </p>
          ) : (
            <ol className={styles["list"]} aria-label={heading}>
              {items.map((item) => (
                <li key={item.id}>
                  <article
                    className={styles["item"]}
                    tabIndex={-1}
                    aria-labelledby={`draft-${item.id}`}
                    ref={(el) => {
                      if (el) itemRefs.current.set(item.id, el);
                      else itemRefs.current.delete(item.id);
                    }}
                    data-testid="queue-item"
                  >
                    <p id={`draft-${item.id}`} className={styles["recipe"]}>{item.recipe}</p>
                    {stateLabel(item.state) && <p className={styles["state"]}>{stateLabel(item.state)}</p>}
                    <p className={styles["meta"]}>
                      <span>Recipe book: {item.recipeBook.name}</span>
                      <span>{queueRatingsText(item)}</span>
                      <span>{depositedText(item)}</span>
                    </p>
                    {item.firstInterpretation && (
                      <p className={styles["why"]}>
                        <span className={styles["whyLabel"]}>{whyLabel(item.state)} </span>
                        {item.firstInterpretation}
                      </p>
                    )}
                    {item.state === "unverified" && !item.canResolve && item.blockedReason && (
                      <p className={styles["blocked"]}>{item.blockedReason}</p>
                    )}
                    <div className={styles["actions"]}>
                      {item.canResolve && QUEUE_ACTIONS.map((action) => (
                        <button
                          key={action}
                          type="button"
                          className={action === "confirm" ? "btn-primary" : "btn-secondary"}
                          aria-label={actionAccessibleName(action, item)}
                          disabled={mutation.isPending}
                          onClick={() => mutation.mutate({ action, item })}
                        >
                          {actionLabel(action, item)}
                        </button>
                      ))}
                      <Link
                        to="/app/traces/$traceId"
                        params={{ traceId: item.id }}
                        className={styles["detailLink"]}
                        aria-label={`Open recipe: ${excerpt(item.recipe)}`}
                      >
                        Open recipe
                      </Link>
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          )}

          {!linkMode && queueQuery.data && queueQuery.data.total > queueQuery.data.perPage && (
            <AdminPagination
              total={queueQuery.data.total}
              offset={(queueQuery.data.page - 1) * queueQuery.data.perPage}
              pageSize={queueQuery.data.perPage}
              onOffsetChange={(offset) => {
                const nextPage = Math.floor(offset / queueQuery.data!.perPage) + 1;
                void navigate({ to: "/app/drafts", search: { ...(q ? { q } : {}), page: nextPage } as never });
                headingRef.current?.focus();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
