import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { authFetch } from "../auth.js";
import { Icon } from "../components/Icon.js";

interface TableCount {
  table_name: string;
  row_count: number;
}

interface Queue {
  name: string;
  policy: string | null;
  retryLimit: number | null;
  retryDelay: number | null;
  retryBackoff: boolean | null;
  expireSeconds: number | null;
  retentionMinutes: number | null;
  deadLetter: string | null;
  createdOn: string;
  updatedOn: string;
  jobCount: number;
}

interface StateDistribution {
  state: string;
  count: number;
}

interface Schedule {
  name: string;
  cron: string;
  timezone: string | null;
  data: unknown;
  options: unknown;
  createdOn: string;
  updatedOn: string;
}

interface ActiveJob {
  name: string;
  count: number;
  oldestStartedOn: string;
}

interface BacklogAge {
  name: string;
  backlogCount: number;
  oldestPending: string;
}

interface CompletionTime {
  name: string;
  sampleSize: number;
  avgMs: number;
  p95Ms: number;
}

interface RecentFailure {
  name: string;
  count: number;
}

interface QueuesResponse {
  ok: boolean;
  data: {
    tableCounts: TableCount[];
    queues: Queue[];
    stateDistribution: StateDistribution[];
    schedules: Schedule[];
    currentlyActive: ActiveJob[];
    backlogAge: BacklogAge[];
    completionTimes: CompletionTime[];
    recentFailures: RecentFailure[];
    queueDescriptions: Record<string, { summary: string; details: string; status: string }>;
    queriedAt: string;
  };
}

interface JobRow {
  id: string;
  name: string;
  state: string;
  priority: number;
  retryCount: number;
  retryLimit: number;
  createdOn: string;
  startedOn: string | null;
  completedOn: string | null;
  keepUntil: string;
  expireIn: string;
  singletonKey: string | null;
  deadLetter: string | null;
  policy: string | null;
  data: unknown;
  output: unknown;
}

interface JobsResponse {
  ok: boolean;
  data: {
    jobs: JobRow[];
    total: number;
    limit: number;
    offset: number;
    sortBy: string;
    sortDir: string;
    queriedAt: string;
  };
}

const STATE_COLORS: Record<string, string> = {
  created: "#888",
  retry: "#f59e0b",
  active: "#3b82f6",
  completed: "#22c55e",
  failed: "#ef4444",
  cancelled: "#888",
  expired: "#888",
};

function StateBadge({ state, count, onClick }: { state: string; count?: number; onClick?: () => void }) {
  const color = STATE_COLORS[state] ?? "#888";
  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-block",
        padding: "2px var(--space-sm)",
        background: `${color}22`,
        color,
        borderRadius: "var(--radius-sm)",
        fontSize: "0.75rem",
        fontFamily: "var(--font-mono)",
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      {state}{count !== undefined ? `: ${count.toLocaleString()}` : ""}
    </span>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatAge(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return formatMs(ms);
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

// ── Health card components ────────────────────────────────────────────

function HealthCard({ title, empty, children }: { title: string; empty: string | null; children: React.ReactNode }) {
  return (
    <div style={{ padding: "var(--space-md)", background: "var(--color-surface-container-low)", borderRadius: "var(--radius-md)" }}>
      <div className="text-xs" style={{ color: "var(--color-on-surface-variant)", textTransform: "uppercase", marginBottom: "var(--space-sm)", letterSpacing: "0.05em" }}>
        {title}
      </div>
      {empty ? (
        <div className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>{empty}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function HealthRow({ name, value, subValue, valueColor }: { name: string; value: string; subValue?: string; valueColor?: string }) {
  return (
    <div style={{ borderTop: "1px solid var(--color-outline-variant)", paddingTop: "var(--space-xs)" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-on-surface-variant)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>
        {name}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", color: valueColor }}>
        {value}
        {subValue && <span style={{ color: "var(--color-on-surface-variant)", marginLeft: "var(--space-sm)", fontSize: "0.7rem" }}>{subValue}</span>}
      </div>
    </div>
  );
}

// ── Queue description block (used in queue detail + job drawer) ──────

function QueueDescriptionBlock({ description }: { description: { summary: string; details: string; status: string } }) {
  const statusColor = description.status === "live"
    ? "#22c55e"
    : description.status === "orphaned"
      ? "#ef4444"
      : "#f59e0b";

  return (
    <div style={{
      background: "var(--color-surface-container-low)",
      borderLeft: `3px solid ${statusColor}`,
      padding: "var(--space-md)",
      borderRadius: "var(--radius-sm)",
      marginBottom: "var(--space-md)",
      fontSize: "0.85rem",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-xs)" }}>
        <span style={{
          padding: "1px var(--space-sm)",
          background: `${statusColor}22`,
          color: statusColor,
          borderRadius: "var(--radius-sm)",
          fontSize: "0.65rem",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}>
          {description.status}
        </span>
        <span style={{ fontWeight: 600 }}>{description.summary}</span>
      </div>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, color: "var(--color-on-surface-variant)" }}>
        {description.details}
      </div>
    </div>
  );
}

// ── Job Detail Drawer ────────────────────────────────────────────────

interface QueueDescription {
  summary: string;
  details: string;
  status: string;
}

function JobDetailDrawer({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const detailQuery = useQuery({
    queryKey: ["admin", "queues", "jobs", jobId],
    queryFn: async () => {
      const res = await authFetch(`/admin/queues/jobs/${jobId}`);
      return (await res.json()) as { ok: boolean; data: { job: JobRow; queueDescription: QueueDescription | null } };
    },
  });

  const job = detailQuery.data?.data.job;
  const queueDescription = detailQuery.data?.data.queueDescription;

  return (
    <div style={{
      position: "fixed",
      top: 0,
      right: 0,
      width: "min(700px, 90vw)",
      height: "100vh",
      background: "var(--color-surface-container-lowest)",
      borderLeft: "1px solid var(--color-outline-variant)",
      boxShadow: "-4px 0 24px rgba(0,0,0,0.2)",
      overflow: "auto",
      padding: "var(--space-lg)",
      zIndex: 100,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-md)" }}>
        <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Job Detail</h2>
        <button onClick={onClose} className="btn-ghost" style={{ padding: "var(--space-xs)" }}>
          <Icon name="x" size={16} />
        </button>
      </div>

      {detailQuery.isLoading && <p>Loading...</p>}

      {job && queueDescription && (
        <div style={{ marginBottom: "var(--space-md)" }}>
          <div className="text-xs" style={{ color: "var(--color-on-surface-variant)", textTransform: "uppercase", marginBottom: "var(--space-xs)", letterSpacing: "0.05em" }}>
            Queue: {job.name}
          </div>
          <QueueDescriptionBlock description={queueDescription} />
        </div>
      )}

      {job && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
          <div className="text-xs" style={{ color: "var(--color-on-surface-variant)", textTransform: "uppercase", marginBottom: "var(--space-sm)", letterSpacing: "0.05em", fontFamily: "var(--font-headline)" }}>
            Row data
          </div>
          {Object.entries(job).map(([key, value]) => (
            <div key={key} style={{ marginBottom: "var(--space-sm)" }}>
              <div style={{ color: "var(--color-on-surface-variant)", fontSize: "0.7rem", textTransform: "uppercase", marginBottom: 2 }}>
                {key}
              </div>
              <div style={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}>
                {value === null
                  ? "null"
                  : typeof value === "object"
                    ? JSON.stringify(value, null, 2)
                    : String(value)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sort header ────────────────────────────────────────────

function SortHeader({
  label, column, currentSort, currentDir, onSort,
}: {
  label: string;
  column: string;
  currentSort: string;
  currentDir: string;
  onSort: (column: string) => void;
}) {
  const isActive = currentSort === column;
  const arrow = isActive ? (currentDir === "asc" ? "↑" : "↓") : "";
  return (
    <th
      onClick={() => onSort(column)}
      style={{
        textAlign: "left",
        padding: "var(--space-sm)",
        cursor: "pointer",
        userSelect: "none",
        color: isActive ? "var(--color-primary)" : undefined,
      }}
    >
      {label} {arrow}
    </th>
  );
}

// ── Jobs Explorer ────────────────────────────────────────────

interface JobsExplorerProps {
  queues: Queue[];
  initialState?: string;
}

function JobsExplorer({ queues, initialState = "" }: JobsExplorerProps) {
  const [queueFilter, setQueueFilter] = useState<string>("");
  const [stateFilter, setStateFilter] = useState<string>(initialState);
  const [fromFilter, setFromFilter] = useState<string>("");
  const [toFilter, setToFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("createdOn");
  const [sortDir, setSortDir] = useState<string>("desc");
  const [offset, setOffset] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const limit = 50;
  const explorerRef = useRef<HTMLElement>(null);

  // External state filter changes (from clicking state badges in the parent)
  useEffect(() => {
    if (initialState && initialState !== stateFilter) {
      setStateFilter(initialState);
      setOffset(0);
      explorerRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    // Intentionally only depending on initialState — we want this to fire when
    // the parent passes a new value, not when the user manually changes stateFilter.
  }, [initialState]);

  function handleSort(column: string) {
    if (sortBy === column) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDir("desc");
    }
    setOffset(0);
  }

  const params = new URLSearchParams();
  if (queueFilter) params.set("queue", queueFilter);
  if (stateFilter) params.set("state", stateFilter);
  if (fromFilter) params.set("from", new Date(fromFilter).toISOString());
  if (toFilter) params.set("to", new Date(toFilter).toISOString());
  params.set("sortBy", sortBy);
  params.set("sortDir", sortDir);
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  const jobsQuery = useQuery({
    queryKey: ["admin", "queues", "jobs", queueFilter, stateFilter, fromFilter, toFilter, sortBy, sortDir, offset],
    queryFn: async () => {
      const res = await authFetch(`/admin/queues/jobs?${params.toString()}`);
      return (await res.json()) as JobsResponse;
    },
    refetchInterval: 10_000,
  });

  const jobs = jobsQuery.data?.data.jobs ?? [];
  const total = jobsQuery.data?.data.total ?? 0;

  const hasFilters = !!(queueFilter || stateFilter || fromFilter || toFilter);

  return (
    <section ref={explorerRef} style={{ marginTop: "var(--space-xl)" }}>
      <h2 style={{ fontSize: "1.1rem" }}>pgboss.job</h2>
      <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)" }}>
        Live job records. Filter by queue, state, or datetime range. Click a column header to sort. Click a row to see full payload + output.
      </p>

      {/* Filter controls */}
      <div style={{ display: "flex", gap: "var(--space-sm)", marginBottom: "var(--space-sm)", alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={queueFilter}
          onChange={(e) => { setQueueFilter(e.target.value); setOffset(0); }}
          style={{ fontSize: "0.8rem", padding: "3px var(--space-sm)" }}
        >
          <option value="">All queues</option>
          {queues.map((q) => (
            <option key={q.name} value={q.name}>{q.name}</option>
          ))}
        </select>

        <select
          value={stateFilter}
          onChange={(e) => { setStateFilter(e.target.value); setOffset(0); }}
          style={{ fontSize: "0.8rem", padding: "3px var(--space-sm)" }}
        >
          <option value="">All states</option>
          <option value="created">created</option>
          <option value="retry">retry</option>
          <option value="active">active</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
          <option value="cancelled">cancelled</option>
          <option value="expired">expired</option>
        </select>

        <label className="text-xs" style={{ color: "var(--color-on-surface-variant)", display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
          From:
          <input
            type="datetime-local"
            value={fromFilter}
            onChange={(e) => { setFromFilter(e.target.value); setOffset(0); }}
            style={{ fontSize: "0.75rem", padding: "2px var(--space-sm)" }}
          />
        </label>

        <label className="text-xs" style={{ color: "var(--color-on-surface-variant)", display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
          To:
          <input
            type="datetime-local"
            value={toFilter}
            onChange={(e) => { setToFilter(e.target.value); setOffset(0); }}
            style={{ fontSize: "0.75rem", padding: "2px var(--space-sm)" }}
          />
        </label>

        {hasFilters && (
          <button
            onClick={() => { setQueueFilter(""); setStateFilter(""); setFromFilter(""); setToFilter(""); setOffset(0); }}
            className="btn-ghost"
            style={{ fontSize: "0.7rem", padding: "2px var(--space-sm)" }}
          >
            Clear filters
          </button>
        )}

        <span className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginLeft: "auto", fontFamily: "var(--font-mono)" }}>
          {total.toLocaleString()} rows
        </span>
      </div>

      {jobsQuery.isLoading && <p>Loading...</p>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
              <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>id</th>
              <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>name</th>
              <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>state</th>
              <th style={{ textAlign: "right", padding: "var(--space-sm)" }}>retries</th>
              <SortHeader label="created_on" column="createdOn" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="started_on" column="startedOn" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label="completed_on" column="completedOn" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
              <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>duration</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
                style={{ borderBottom: "1px solid var(--color-outline-variant)", cursor: "pointer" }}
              >
                <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
                  {job.id.slice(0, 8)}…
                </td>
                <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {job.name}
                </td>
                <td style={{ padding: "var(--space-sm)" }}>
                  <StateBadge state={job.state} />
                </td>
                <td style={{ padding: "var(--space-sm)", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                  {job.retryCount}/{job.retryLimit}
                </td>
                <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
                  {formatDateTime(job.createdOn)}
                </td>
                <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
                  {formatDateTime(job.startedOn)}
                </td>
                <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
                  {formatDateTime(job.completedOn)}
                </td>
                <td style={{ padding: "var(--space-sm)", color: "var(--color-on-surface-variant)" }}>
                  {formatDuration(job.startedOn, job.completedOn)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-md)", alignItems: "center" }}>
        <button
          onClick={() => setOffset(Math.max(0, offset - limit))}
          disabled={offset === 0}
          className="btn-ghost"
          style={{ fontSize: "0.75rem", padding: "var(--space-xs) var(--space-sm)" }}
        >
          ← Prev
        </button>
        <span className="text-xs" style={{ color: "var(--color-on-surface-variant)", fontFamily: "var(--font-mono)" }}>
          {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}
        </span>
        <button
          onClick={() => setOffset(offset + limit)}
          disabled={offset + limit >= total}
          className="btn-ghost"
          style={{ fontSize: "0.75rem", padding: "var(--space-xs) var(--space-sm)" }}
        >
          Next →
        </button>
      </div>

      {selectedJobId && (
        <JobDetailDrawer jobId={selectedJobId} onClose={() => setSelectedJobId(null)} />
      )}
    </section>
  );
}

// ── Queue Detail Drawer ────────────────────────────────────────

function QueueDetailDrawer({
  queue, description, onClose,
}: {
  queue: Queue;
  description: QueueDescription | null;
  onClose: () => void;
}) {
  return (
    <div style={{
      position: "fixed",
      top: 0,
      right: 0,
      width: "min(700px, 90vw)",
      height: "100vh",
      background: "var(--color-surface-container-lowest)",
      borderLeft: "1px solid var(--color-outline-variant)",
      boxShadow: "-4px 0 24px rgba(0,0,0,0.2)",
      overflow: "auto",
      padding: "var(--space-lg)",
      zIndex: 100,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-md)" }}>
        <h2 style={{ fontSize: "1.1rem", margin: 0, fontFamily: "var(--font-mono)" }}>{queue.name}</h2>
        <button onClick={onClose} className="btn-ghost" style={{ padding: "var(--space-xs)" }}>
          <Icon name="x" size={16} />
        </button>
      </div>

      {description ? (
        <QueueDescriptionBlock description={description} />
      ) : (
        <div style={{
          background: "var(--color-surface-container-low)",
          padding: "var(--space-md)",
          borderRadius: "var(--radius-sm)",
          marginBottom: "var(--space-md)",
          fontSize: "0.85rem",
          color: "var(--color-on-surface-variant)",
        }}>
          No description available for this queue. Add one in <code>packages/domain/src/queue-descriptions.ts</code>.
        </div>
      )}

      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
        <div className="text-xs" style={{ color: "var(--color-on-surface-variant)", textTransform: "uppercase", marginBottom: "var(--space-sm)", letterSpacing: "0.05em", fontFamily: "var(--font-headline)" }}>
          Queue config (pgboss.queue row)
        </div>
        {Object.entries(queue).map(([key, value]) => (
          <div key={key} style={{ marginBottom: "var(--space-sm)" }}>
            <div style={{ color: "var(--color-on-surface-variant)", fontSize: "0.7rem", textTransform: "uppercase", marginBottom: 2 }}>
              {key}
            </div>
            <div style={{ wordBreak: "break-all" }}>
              {value === null ? "null" : String(value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────

export function AdminQueuesPage() {
  const [explorerInitialState, setExplorerInitialState] = useState<string>("");
  const [selectedQueue, setSelectedQueue] = useState<Queue | null>(null);

  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await authFetch("/auth/me");
      const json = (await res.json()) as { ok: boolean; data?: { user: { id: string; email: string; role: string } } };
      if (!json.ok || !json.data) throw new Error("Failed");
      return json.data.user;
    },
  });

  const queuesQuery = useQuery({
    queryKey: ["admin", "queues"],
    queryFn: async () => {
      const res = await authFetch("/admin/queues");
      return (await res.json()) as QueuesResponse;
    },
    enabled: meQuery.data?.role === "system",
    refetchInterval: 10_000,
  });

  if (meQuery.isLoading) {
    return <div style={{ padding: "var(--space-lg)" }}>Loading...</div>;
  }

  if (meQuery.data?.role !== "system") {
    return (
      <div style={{ padding: "var(--space-lg)", maxWidth: 600 }}>
        <h1>Admin</h1>
        <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-md)" }}>
          You don't have access to this page. System admin role required.
        </p>
      </div>
    );
  }

  const tableCounts = queuesQuery.data?.data.tableCounts ?? [];
  const queues = queuesQuery.data?.data.queues ?? [];
  const stateDistribution = queuesQuery.data?.data.stateDistribution ?? [];
  const schedules = queuesQuery.data?.data.schedules ?? [];
  const currentlyActive = queuesQuery.data?.data.currentlyActive ?? [];
  const backlogAge = queuesQuery.data?.data.backlogAge ?? [];
  const completionTimes = queuesQuery.data?.data.completionTimes ?? [];
  const recentFailures = queuesQuery.data?.data.recentFailures ?? [];
  const queueDescriptions = queuesQuery.data?.data.queueDescriptions ?? {};

  const hasHealth = currentlyActive.length > 0 || backlogAge.length > 0 || recentFailures.length > 0 || completionTimes.length > 0;

  return (
    <div style={{ padding: "var(--space-lg)", maxWidth: 1200 }}>
      <div style={{ marginBottom: "var(--space-md)" }}>
        <Link to="/admin" style={{ color: "var(--color-primary)", fontSize: "0.85rem", textDecoration: "none" }}>
          <Icon name="arrow-left" size={14} /> Back to admin
        </Link>
      </div>

      <h1>pg-boss</h1>
      <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
        Data model view of the pg-boss schema. Tables, queues, jobs, schedules. Read-only.
      </p>
      {queuesQuery.data && (
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)", fontFamily: "var(--font-mono)" }}>
          Last updated: {new Date(queuesQuery.data.data.queriedAt).toLocaleTimeString()}
        </p>
      )}

      {queuesQuery.isLoading && <p>Loading...</p>}

      {/* ── Health overview ───────────────────── */}
      {hasHealth && (
        <section style={{ marginTop: "var(--space-xl)" }}>
          <h2 style={{ fontSize: "1.1rem" }}>Health</h2>
          <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)" }}>
            Current activity, backlog age, throughput, and recent failures across all queues.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--space-md)" }}>
            <HealthCard title="Currently active" empty={currentlyActive.length === 0 ? "No active jobs" : null}>
              {currentlyActive.map((a) => (
                <HealthRow key={a.name} name={a.name} value={`${a.count} jobs`} subValue={`oldest: ${formatAge(a.oldestStartedOn)}`} />
              ))}
            </HealthCard>

            <HealthCard title="Backlog (waiting jobs)" empty={backlogAge.length === 0 ? "No backlog" : null}>
              {backlogAge.map((b) => (
                <HealthRow key={b.name} name={b.name} value={`${b.backlogCount} jobs`} subValue={`oldest: ${formatAge(b.oldestPending)}`} />
              ))}
            </HealthCard>

            <HealthCard title="Completion time (last 100)" empty={completionTimes.length === 0 ? "No completed jobs" : null}>
              {completionTimes.map((t) => (
                <HealthRow key={t.name} name={t.name} value={`avg ${formatMs(t.avgMs)}`} subValue={`p95 ${formatMs(t.p95Ms)}`} />
              ))}
            </HealthCard>

            <HealthCard title="Failures (last hour)" empty={recentFailures.length === 0 ? "No recent failures" : null}>
              {recentFailures.map((f) => (
                <HealthRow key={f.name} name={f.name} value={`${f.count} failed`} valueColor="var(--color-error)" />
              ))}
            </HealthCard>
          </div>
        </section>
      )}

      {/* ── Schema overview: pgboss.* table sizes ───────────────────── */}
      <section style={{ marginTop: "var(--space-xl)" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Schema: pgboss.*</h2>
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)" }}>
          Top-level tables in the pg-boss schema with row counts.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", maxWidth: 500 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
              <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>Table</th>
              <th style={{ textAlign: "right", padding: "var(--space-sm)" }}>Rows</th>
            </tr>
          </thead>
          <tbody>
            {tableCounts.map((row) => (
              <tr key={row.table_name} style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
                <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)" }}>
                  pgboss.{row.table_name}
                </td>
                <td style={{ padding: "var(--space-sm)", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                  {row.row_count.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── pgboss.job state distribution ───────────────────── */}
      <section style={{ marginTop: "var(--space-xl)" }}>
        <h2 style={{ fontSize: "1.1rem" }}>pgboss.job state distribution</h2>
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)" }}>
          Aggregate of jobs by state across all queues. Click a badge to filter the explorer below.
        </p>
        <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
          {stateDistribution.map((s) => (
            <div
              key={s.state}
              onClick={() => setExplorerInitialState(s.state)}
              style={{
                padding: "var(--space-sm) var(--space-md)",
                background: "var(--color-surface-container-low)",
                borderRadius: "var(--radius-md)",
                minWidth: 120,
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: "0.7rem", color: "var(--color-on-surface-variant)" }}>
                <StateBadge state={s.state} />
              </div>
              <div style={{ fontSize: "1.2rem", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                {s.count.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── pgboss.queue ───────────────────── */}
      <section style={{ marginTop: "var(--space-xl)" }}>
        <h2 style={{ fontSize: "1.1rem" }}>pgboss.queue</h2>
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)" }}>
          Registered queues with config. Click a row to see the description and full row data. Status badge shows if the queue is live, legacy, or orphaned.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>name</th>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>status</th>
                <th style={{ textAlign: "right", padding: "var(--space-sm)" }}>jobs</th>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>policy</th>
                <th style={{ textAlign: "right", padding: "var(--space-sm)" }}>retry_limit</th>
                <th style={{ textAlign: "right", padding: "var(--space-sm)" }}>retention_min</th>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>dead_letter</th>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>updated_on</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => {
                const desc = queueDescriptions[q.name];
                const statusColor = desc?.status === "live"
                  ? "#22c55e"
                  : desc?.status === "orphaned"
                    ? "#ef4444"
                    : desc?.status === "legacy"
                      ? "#f59e0b"
                      : "#888";
                return (
                  <tr
                    key={q.name}
                    onClick={() => setSelectedQueue(q)}
                    style={{ borderBottom: "1px solid var(--color-outline-variant)", cursor: "pointer" }}
                  >
                    <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                      {q.name}
                    </td>
                    <td style={{ padding: "var(--space-sm)" }}>
                      <span style={{
                        padding: "1px var(--space-sm)",
                        background: `${statusColor}22`,
                        color: statusColor,
                        borderRadius: "var(--radius-sm)",
                        fontSize: "0.65rem",
                        fontFamily: "var(--font-mono)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}>
                        {desc?.status ?? "unknown"}
                      </span>
                    </td>
                    <td style={{ padding: "var(--space-sm)", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                      {q.jobCount.toLocaleString()}
                    </td>
                    <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
                      {q.policy ?? "—"}
                    </td>
                    <td style={{ padding: "var(--space-sm)", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
                      {q.retryLimit ?? "—"}
                    </td>
                    <td style={{ padding: "var(--space-sm)", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
                      {q.retentionMinutes ?? "—"}
                    </td>
                    <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
                      {q.deadLetter ?? "—"}
                    </td>
                    <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
                      {formatDateTime(q.updatedOn)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── pgboss.schedule ───────────────────── */}
      {schedules.length > 0 && (
        <section style={{ marginTop: "var(--space-xl)" }}>
          <h2 style={{ fontSize: "1.1rem" }}>pgboss.schedule</h2>
          <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)" }}>
            Recurring jobs registered via <code>boss.schedule()</code>.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>name</th>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>cron</th>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>timezone</th>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>updated_on</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.name} style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
                  <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                    {s.name}
                  </td>
                  <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)" }}>
                    {s.cron}
                  </td>
                  <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
                    {s.timezone ?? "UTC"}
                  </td>
                  <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
                    {formatDateTime(s.updatedOn)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Jobs Explorer (paginated, filterable, sortable) ──────────────────── */}
      <JobsExplorer queues={queues} initialState={explorerInitialState} />

      {/* Queue detail drawer */}
      {selectedQueue && (
        <QueueDetailDrawer
          queue={selectedQueue}
          description={queueDescriptions[selectedQueue.name] ?? null}
          onClose={() => setSelectedQueue(null)}
        />
      )}
    </div>
  );
}
