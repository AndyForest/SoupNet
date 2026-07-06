import { Link } from "@tanstack/react-router";
import { MarkdownContent } from "../components/LegalPage.js";
import { AgentTypePicker } from "../components/AgentTypePicker.js";
import { CopyBriefingButton } from "../components/CopyBriefingButton.js";
import { isLoggedIn } from "../auth.js";
// Source of truth: docs/connectors/index.md. Vite's ?raw query inlines
// the file content as a string at build time. Editing the .md file is
// the only way to change the live page prose.
//
// The interactive agent-type picker (shared with the dashboard's zero-checks
// empty state) is spliced in at the <!-- agent-type-picker --> marker: intro
// prose above, picker, then the full per-client reference below. The picker
// curates those sections; it doesn't replace them.
import connectContent from "../../../../docs/connectors/index.md?raw";

const PICKER_MARKER = "<!-- agent-type-picker";
const COMMENT_CLOSE = "-->";

export function ConnectPage() {
  const markerIndex = connectContent.indexOf(PICKER_MARKER);
  const closeIndex = markerIndex >= 0
    ? connectContent.indexOf(COMMENT_CLOSE, markerIndex)
    : -1;
  // If the marker ever disappears from the .md, degrade to prose-then-picker
  // rather than losing either. The marker comment itself is stripped so no
  // raw HTML reaches react-markdown.
  const hasMarker = markerIndex >= 0 && closeIndex >= 0;
  const before = hasMarker ? connectContent.slice(0, markerIndex) : connectContent;
  const after = hasMarker ? connectContent.slice(closeIndex + COMMENT_CLOSE.length) : "";

  return (
    <div style={{
      maxWidth: 760,
      margin: "0 auto",
      padding: "var(--space-2xl) var(--space-xl)",
      lineHeight: 1.65,
      color: "var(--color-on-surface)",
    }}>
      <p style={{ marginBottom: "var(--space-lg)", fontSize: "0.9rem" }}>
        <Link to="/">← Back to soup.net</Link>
      </p>

      <MarkdownContent content={before} />

      <div style={{ margin: "var(--space-xl) 0 var(--space-2xl)" }}>
        <AgentTypePicker
          briefingSlot={
            isLoggedIn() ? (
              <CopyBriefingButton
                label={`Connect page briefing — ${new Date().toISOString().slice(0, 10)}`}
                style={{ width: "100%" }}
              />
            ) : (
              <p className="text-sm" style={{ margin: 0, color: "var(--color-on-surface-variant)" }}>
                <Link to="/auth/login" style={{ color: "var(--color-primary)" }}>Sign in</Link>{" "}
                or{" "}
                <Link to="/auth/register" style={{ color: "var(--color-primary)" }}>create a free account</Link>{" "}
                to copy your agent briefing — it carries your key, your recipe
                books, and the recipe-check instructions.
              </p>
            )
          }
          footnote={<>Detailed steps for every client continue below.</>}
        />
      </div>

      <MarkdownContent content={after} />
    </div>
  );
}
