import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { authFetch, API_BASE } from "../auth.js";
import { Icon } from "../components/Icon.js";
import { RecipeInstructions } from "../components/RecipeInstructions.js";

// Supported media types (duplicated from @soupnet/domain — frontend doesn't depend on it)
const ALLOWED_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp",
  "video/mp4", "video/quicktime",
  "audio/mpeg", "audio/wav", "audio/flac", "audio/ogg",
  "application/pdf",
]);
const HTML_ACCEPT_TYPES = [...ALLOWED_MIME_TYPES].join(",");
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

// ── Types matching /check?format=json response ──────────────────────────────

interface Reference {
  quote: string;
  source: string;
  fileUrl?: string;
  fileMimeType?: string;
}

interface Evidence {
  interpretation: string;
  references: Reference[];
}

interface ResultScore {
  combined: number;
  semantic: number;
  lexical: number;
}

interface CheckResult {
  id: string;
  recipe: string;
  createdAt: string;
  score: ResultScore;
  evidence: Evidence[];
  clusterSize?: number;
}

interface RelatedEvidence {
  evidenceId: string;
  parentRecipe: string;
  evidence: string;
  similarity: number;
  strategy: string;
}

interface CheckResponse {
  ok: boolean;
  error?: string;
  formatWarning?: string;
  data?: {
    recipeId: string;
    searchMode: string;
    clustered: boolean;
    results: CheckResult[];
    relatedEvidence?: RelatedEvidence[];
    totalResults: number;
    page: number;
    totalPages: number;
  };
}

// ── Component ───────────────────────────────────────────────────────────────

/** Split a combined recipe+evidence text on the first blank line. */
function splitRecipeEvidence(text: string): { recipe: string; evidence: string } {
  const parts = text.split(/\n\s*\n/);
  if (parts.length >= 2) {
    return { recipe: parts[0]!.trim(), evidence: parts.slice(1).join("\n\n").trim() };
  }
  return { recipe: text.trim(), evidence: "" };
}

export function CheckRecipePage() {
  const [recipeText, setRecipeText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [response, setResponse] = useState<CheckResponse | null>(null);
  const [agentLinkOpened, setAgentLinkOpened] = useState(false);

  const keyQuery = useQuery({
    queryKey: ["check-key"],
    queryFn: async () => {
      const res = await authFetch("/keys/daily", { method: "POST" });
      const json = (await res.json()) as { ok: boolean; data?: { key: string } };
      if (!json.ok || !json.data) throw new Error("Failed to get API key");
      return json.data.key;
    },
    staleTime: 1000 * 60 * 60,
    retry: 1,
  });

  const checkMutation = useMutation({
    mutationFn: async () => {
      const key = keyQuery.data;
      if (!key) throw new Error("No API key available");

      const { recipe, evidence } = splitRecipeEvidence(recipeText);

      let res: Response;
      if (file) {
        // Use FormData POST for file uploads
        const formData = new FormData();
        formData.append("key", key);
        formData.append("trace", recipe);
        formData.append("format", "json");
        if (evidence) formData.append("ef", evidence);
        formData.append("image", file);
        res = await fetch(`${API_BASE}/check`, { method: "POST", body: formData });
      } else {
        const params = new URLSearchParams({ key, trace: recipe, format: "json" });
        if (evidence) params.set("ef", evidence);
        res = await fetch(`${API_BASE}/check?${params.toString()}`);
      }
      return (await res.json()) as CheckResponse;
    },
    onSuccess: (data) => setResponse(data),
  });

  const agentLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/keys/daily", { method: "POST" });
      const json = (await res.json()) as { ok: boolean; data?: { searchUrl: string } };
      if (!json.ok || !json.data) throw new Error("Failed to generate link");
      return json.data;
    },
    onSuccess: (data) => {
      window.open(data.searchUrl, "_blank");
      setAgentLinkOpened(true);
      setTimeout(() => setAgentLinkOpened(false), 2500);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { recipe, evidence } = splitRecipeEvidence(recipeText);
    if (!recipe || !evidence) return;
    checkMutation.mutate();
  }

  const results = response?.data?.results;
  const related = response?.data?.relatedEvidence;

  return (
    <div>
      <header style={{ marginBottom: "var(--space-xl)" }}>
        <h1>Check Recipe</h1>
        <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
          Compare your recipe against accumulated taste and judgment. Your check is also logged — this is how your recipe book grows.
        </p>
      </header>

      {/* Instructions */}
      <RecipeInstructions />

      {/* Agent link */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "var(--space-md)",
          marginBottom: "var(--space-xl)",
          padding: "var(--space-md) var(--space-lg)",
          background: "var(--color-surface-container-low)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <div style={{ flex: 1 }}>
          <p className="text-sm" style={{ color: "var(--color-on-surface-variant)" }}>
            AI agents use a dedicated page optimized for minimal tokens. Generate a 24-hour link and share it with any agent.
          </p>
        </div>
        <button
          className="btn-secondary"
          onClick={() => agentLinkMutation.mutate()}
          disabled={agentLinkMutation.isPending}
          style={{ flexShrink: 0 }}
        >
          <Icon name="external-link" size={16} />
          {agentLinkOpened ? "Opened!" : agentLinkMutation.isPending ? "Generating..." : "Go to daily recipe check link for agents"}
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ marginBottom: "var(--space-2xl)" }}>
        <div style={{ marginBottom: "var(--space-md)" }}>
          <label htmlFor="check-recipe">Recipe with evidence</label>
          <textarea
            id="check-recipe"
            rows={6}
            value={recipeText}
            onChange={(e) => setRecipeText(e.target.value)}
            placeholder={'As a [role] working on [goal], I [prefer/chose] so that [reason]\n\nYour interpretation of the evidence\n> "direct quote from source"\n-- source citation'}
            style={{ resize: "vertical" }}
          />
          <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
            First paragraph is the recipe. After a blank line, supporting evidence: your interpretation, then <code>&gt; "quote"</code> and <code>-- source</code>.
          </p>
        </div>

        <div style={{ marginBottom: "var(--space-md)" }}>
          <label htmlFor="check-file">File evidence (optional)</label>
          <input
            id="check-file"
            type="file"
            accept={HTML_ACCEPT_TYPES}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFileError(null);
              if (f) {
                if (!ALLOWED_MIME_TYPES.has(f.type)) {
                  setFileError("Unsupported file type.");
                  setFile(null);
                  return;
                }
                if (f.size > MAX_UPLOAD_BYTES) {
                  setFileError("File exceeds 20MB limit.");
                  setFile(null);
                  return;
                }
              }
              setFile(f);
            }}
            style={{ padding: "var(--space-sm) 0" }}
          />
          <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
            PNG, JPEG, WebP, MP4, MOV, MP3, WAV, FLAC, OGG, or PDF. Max 20MB.
          </p>
          {fileError && (
            <p style={{ color: "var(--color-error)", fontSize: "0.875rem", marginTop: "var(--space-xs)" }}>
              {fileError}
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-end" }}>
          <button type="submit" disabled={checkMutation.isPending || !splitRecipeEvidence(recipeText).recipe || !splitRecipeEvidence(recipeText).evidence}>
            <Icon name="clipboard-check" size={16} />
            {checkMutation.isPending ? "Checking..." : "Check"}
          </button>
        </div>

        {checkMutation.isError && (
          <p style={{ color: "var(--color-error)", fontSize: "0.875rem", marginTop: "var(--space-sm)" }}>
            Check failed. {keyQuery.isError ? "Could not generate API key." : "Please try again."}
          </p>
        )}

        {response && !response.ok && response.error && (
          <p style={{ color: "var(--color-error)", fontSize: "0.875rem", marginTop: "var(--space-sm)" }}>
            {response.error}
          </p>
        )}
      </form>

      {/* Format warning */}
      {response?.formatWarning && (
        <div
          className="card"
          style={{
            marginBottom: "var(--space-lg)",
            borderLeft: "3px solid var(--color-secondary)",
            padding: "var(--space-md) var(--space-lg)",
            background: "var(--color-surface-container-low)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--color-secondary)" }}>
            {response.formatWarning}
          </p>
        </div>
      )}

      {/* Results */}
      {results !== undefined && (
        <section style={{ marginBottom: "var(--space-2xl)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-md)", marginBottom: "var(--space-md)" }}>
            <h2 style={{ fontSize: "1.15rem" }}>
              {results.length === 0
                ? "No similar recipes found"
                : `${response?.data?.totalResults ?? results.length} similar recipe${(response?.data?.totalResults ?? results.length) === 1 ? "" : "s"}`}
            </h2>
            {response?.data?.clustered && results.length > 0 && (
              <span className="pill" style={{ fontSize: "0.65rem" }}>
                clustered to {results.length} exemplar{results.length === 1 ? "" : "s"}
              </span>
            )}
            {response?.data?.searchMode && (
              <span className="pill" style={{ fontSize: "0.65rem" }}>
                {response.data.searchMode}
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            {results.map((result) => (
              <ResultCard key={result.id} result={result} />
            ))}
          </div>

          {/* Pagination */}
          {response?.data && response.data.totalPages > 1 && (
            <p className="text-sm" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-md)" }}>
              Page {response.data.page} of {response.data.totalPages}
            </p>
          )}
        </section>
      )}

      {/* Related evidence */}
      {related && related.length > 0 && (
        <section>
          <h2 style={{ fontSize: "1.15rem", marginBottom: "var(--space-md)" }}>
            Related Evidence
          </h2>
          <p className="text-sm" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-md)" }}>
            Evidence from other recipes that may be relevant to yours.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {related.map((re) => (
              <div
                key={re.evidenceId}
                className="card"
                style={{
                  padding: "var(--space-md) var(--space-lg)",
                  borderLeft: "3px solid var(--color-outline-variant)",
                }}
              >
                <p className="text-sm" style={{ lineHeight: 1.5 }}>{re.evidence}</p>
                <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
                  from: {re.parentRecipe.length > 100 ? re.parentRecipe.slice(0, 100) + "..." : re.parentRecipe}
                </p>
                <span className="pill" style={{ marginTop: "var(--space-xs)", fontSize: "0.6rem" }}>
                  {Math.round(re.similarity * 100)}% similar
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Result card ─────────────────────────────────────────────────────────────

function ResultCard({ result }: { result: CheckResult }) {
  const score = result.score;
  const pct = Math.round((score.combined ?? score.semantic ?? 0) * 100);

  return (
    <div className="card" style={{ padding: "var(--space-md) var(--space-lg)" }}>
      {/* Header: recipe text + score */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)" }}>
        <p style={{ flex: 1, lineHeight: 1.5 }}>{result.recipe}</p>
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <span className="pill-primary" style={{ padding: "0.2rem 0.6rem" }}>
            {pct}%
          </span>
          {result.clusterSize && result.clusterSize > 1 && (
            <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
              {result.clusterSize} similar
            </p>
          )}
        </div>
      </div>

      {/* Score breakdown */}
      {score.semantic !== undefined && score.lexical !== undefined && (
        <div style={{ display: "flex", gap: "var(--space-md)", marginTop: "var(--space-sm)" }}>
          <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
            semantic {Math.round(score.semantic * 100)}%
          </span>
          <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
            lexical {Math.round(score.lexical * 100)}%
          </span>
        </div>
      )}

      {/* Evidence */}
      {result.evidence.length > 0 && (
        <div style={{ marginTop: "var(--space-sm)" }}>
          {result.evidence.map((ev, j) => (
            <EvidenceBlock key={j} evidence={ev} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Evidence block ──────────────────────────────────────────────────────────

function EvidenceBlock({ evidence }: { evidence: Evidence }) {
  const accentColor = "var(--color-success)";

  return (
    <div
      style={{
        borderLeft: `2px solid ${accentColor}`,
        paddingLeft: "var(--space-md)",
        marginTop: "var(--space-xs)",
      }}
    >
      <p className="text-sm" style={{ lineHeight: 1.5, color: "var(--color-on-surface)" }}>
        {evidence.interpretation}
      </p>
      {evidence.references.map((ref, k) => (
        <div key={k} style={{ marginTop: "var(--space-xs)" }}>
          {ref.quote && (
            <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", fontStyle: "italic" }}>
              {ref.quote}
            </p>
          )}
          {ref.source && (
            <p className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
              &mdash; {ref.source}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
