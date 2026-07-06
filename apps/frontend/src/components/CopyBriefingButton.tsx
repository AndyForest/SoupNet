import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { authFetch } from "../auth.js";
import { useClipboard } from "../hooks/useClipboard.js";
import { substituteBriefingKey } from "../lib/briefing-key.js";
import { Icon } from "./Icon.js";

interface CopyBriefingButtonProps {
  /**
   * Optional recipe book id the minted daily key writes to. When omitted the
   * backend uses the user's configured daily_write books (the same rule as
   * every other Copy-briefing button).
   */
  writeRecipeBookId?: string | undefined;
  /**
   * Human-facing label stamped on the minted daily key (e.g. "Dashboard
   * briefing — 2026-07-05"). Shows up in the API Keys list and the trace
   * attribution instead of "(unlabeled)" (2026-07-05 journey-eval defect
   * #7b). Optional — omitted entirely for callers that don't have a
   * meaningful context to name (the label column already tolerates null).
   */
  label?: string | undefined;
  style?: React.CSSProperties;
}

/**
 * The standard "Copy agent briefing" button: mints a 24-hour daily key, then
 * copies the unified briefing (POST /keys/briefing) to the clipboard. Same
 * flow as the API Keys / Recipe Books / Recipe Map briefing buttons — one
 * artifact, no variants.
 *
 * The server response carries only the YOUR_API_KEY placeholder (raw keys
 * never appear in briefing responses or URLs); substituteBriefingKey splices
 * the freshly minted key in client-side so the copied artifact works
 * standalone.
 *
 * The fetch runs inside copyAsync so the ClipboardItem Promise keeps iOS
 * Safari's user-gesture context alive across both awaits — a copy after a
 * plain awaited fetch would silently no-op on iPhone.
 */
export function CopyBriefingButton({ writeRecipeBookId, label, style }: CopyBriefingButtonProps) {
  const queryClient = useQueryClient();
  const { copyAsync, copied } = useClipboard(2500);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchBriefingText(): Promise<string> {
    const body: Record<string, string> = {};
    if (writeRecipeBookId) body["writeRecipeBookId"] = writeRecipeBookId;
    if (label) body["label"] = label;
    const hasBody = Object.keys(body).length > 0;
    const keyRes = await authFetch("/keys/daily", {
      method: "POST",
      ...(hasBody ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const keyJson = (await keyRes.json()) as {
      ok: boolean;
      error?: string;
      data?: { key: string; searchUrl: string };
    };
    if (!keyJson.ok || !keyJson.data) {
      throw new Error(keyJson.error ?? "Failed to generate key");
    }

    const briefRes = await authFetch("/keys/briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: keyJson.data.key }),
    });
    const briefJson = (await briefRes.json()) as { ok: boolean; data?: { text: string } };
    if (!briefJson.ok || !briefJson.data) throw new Error("Failed to get briefing");

    void queryClient.invalidateQueries({ queryKey: ["keys"] });
    return substituteBriefingKey(briefJson.data.text, keyJson.data.key);
  }

  async function handleCopy() {
    setPending(true);
    setError(null);
    try {
      await copyAsync(() => fetchBriefingText(), "briefing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Copy failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        onClick={() => void handleCopy()}
        disabled={pending}
        style={{ justifyContent: "center", fontSize: "0.85rem", ...style }}
      >
        <Icon name="copy" size={14} />
        {copied === "briefing" ? "Copied!" : pending ? "Generating..." : "Copy agent briefing"}
      </button>
      {error && (
        <p className="text-xs" style={{ color: "var(--color-error, #b3261e)", marginTop: "var(--space-xs)" }}>
          {error === "no_write_recipe_books_configured" ? (
            <>
              No recipe book is set for daily writes yet — include one on the{" "}
              <Link to="/app/recipe-books" style={{ color: "inherit" }}>Recipe Books page</Link>, then try again.
            </>
          ) : (
            error
          )}
        </p>
      )}
    </>
  );
}
