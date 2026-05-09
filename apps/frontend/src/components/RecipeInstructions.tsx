import { Link } from "@tanstack/react-router";

/**
 * Shared recipe instructions for the /check and /groups pages.
 * Keeps content DRY — groups page links here, check page embeds it.
 */
export function RecipeInstructions() {
  return (
    <details
      style={{
        marginBottom: "var(--space-xl)",
        background: "var(--color-surface-container-low)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-lg)",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontFamily: "var(--font-headline)",
          fontWeight: 600,
          fontSize: "1.05rem",
          color: "var(--color-on-surface)",
        }}
      >
        How recipe checking works
      </summary>

      <div style={{ marginTop: "var(--space-md)" }}>
        {/* What is a recipe check */}
        <section style={{ marginBottom: "var(--space-lg)" }}>
          <h4 style={{ marginBottom: "var(--space-xs)" }}>What is a recipe check?</h4>
          <p className="text-sm" style={{ color: "var(--color-on-surface-variant)", lineHeight: 1.6 }}>
            A recipe check compares your recipe against your accumulated recipe book and returns
            similar recipes with their evidence. As a side effect, your recipe is logged — this is
            how your recipe book grows and future checks get smarter. This is{" "}
            <strong>stigmergy</strong>: indirect coordination through environmental traces, like ants
            following and reinforcing pheromone trails. The more you check, the more useful the system
            becomes for everyone.
          </p>
        </section>

        {/* Recipe format */}
        <section style={{ marginBottom: "var(--space-lg)" }}>
          <h4 style={{ marginBottom: "var(--space-xs)" }}>Recipe format</h4>
          <p className="text-sm" style={{ color: "var(--color-on-surface-variant)", lineHeight: 1.6, marginBottom: "var(--space-sm)" }}>
            Recipes capture taste and judgment — your preferences and decisions with the reasoning behind them.
          </p>
          <pre style={{
            background: "var(--color-surface-container-high)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-md)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.8rem",
            lineHeight: 1.5,
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}>
{`As a [role] working on [goal], I [prefer/chose] so that [reason]

Supporting evidence:
  Your interpretation of how this supports the recipe.
  > "Direct quote from source"
  -- Source citation`}
          </pre>
        </section>

        {/* Who is this for */}
        <section>
          <h4 style={{ marginBottom: "var(--space-sm)" }}>Who is this for?</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <PersonaCard
              title="Solo developers and creators"
              description="Your taste persists across projects, sessions, and cloud environments. Every new agent session starts with your accumulated preferences — no re-explaining how you like error handling structured or which libraries you prefer."
            />
            <PersonaCard
              title="Non-technical decision makers"
              description="Your AI agent remembers your preferences and applies them to new decisions. Picked a bold poster layout? Next time it suggests options informed by that choice. Your taste compounds over time."
            />
            <PersonaCard
              title="Teams and collaborators"
              description={<>Share judgment within a project <Link to="/app/groups" style={{ color: "var(--color-primary)" }}>group</Link> that spans organizations. When one member checks a recipe, every member's agents can find it. Shared knowledge grows organically.</>}
            />
          </div>
        </section>
      </div>
    </details>
  );
}

function PersonaCard({ title, description }: { title: string; description: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--color-surface-container)",
      borderRadius: "var(--radius-md)",
      padding: "var(--space-md)",
    }}>
      <p style={{ fontWeight: 600, marginBottom: "var(--space-xs)", fontSize: "0.9rem" }}>{title}</p>
      <p className="text-sm" style={{ color: "var(--color-on-surface-variant)", lineHeight: 1.5 }}>
        {description}
      </p>
    </div>
  );
}
