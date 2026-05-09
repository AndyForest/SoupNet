import { useState } from "react";
import { Link } from "@tanstack/react-router";
import recipeMapDiscover from "../assets/recipe-map-discover.png";

export function HowItWorksPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-surface)", paddingBottom: 60 }}>
      {/* Hero */}
      <header style={{
        textAlign: "center",
        padding: "clamp(2.5rem, 8vh, 5rem) var(--space-xl) var(--space-2xl)",
        maxWidth: 720,
        margin: "0 auto",
      }}>
        <h1 style={{
          fontSize: "clamp(1.6rem, 3.5vw, 2.2rem)",
          fontWeight: 700,
          margin: 0,
          marginBottom: "var(--space-md)",
          color: "var(--color-on-surface)",
        }}>
          How Soup.net works
        </h1>
        <p style={{
          fontSize: "1rem",
          color: "var(--color-on-surface-variant)",
          lineHeight: 1.6,
          maxWidth: 580,
          margin: "0 auto",
        }}>
          The recipe book, the recipe format, how agents connect, and how the system stays free at scale.
          Written for everyone, not just developers.
        </p>
      </header>

      {/* What's a recipe? */}
      <section style={{ padding: "var(--space-2xl) var(--space-xl)" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <h2 style={sectionHeading}>A recipe captures taste and judgment</h2>
          <p style={{
            textAlign: "center",
            color: "var(--color-on-surface-variant)",
            lineHeight: 1.6,
            maxWidth: 580,
            margin: "0 auto var(--space-xl)",
          }}>
            Not facts. Not documents. Judgment calls with evidence. A structured format
            agents are naturally consistent with, built on{" "}
            <a href="https://en.wikipedia.org/wiki/Design_thinking" target="_blank" rel="noopener" style={{ color: "var(--color-primary)" }}>
              Design Thinking
            </a>{" "}user stories and{" "}
            <a href="https://en.wikipedia.org/wiki/Toulmin_model" target="_blank" rel="noopener" style={{ color: "var(--color-primary)" }}>
              Toulmin argumentation
            </a>.
          </p>

          <RecipeExampleCarousel />

          <div
            className="grid-3-cards"
            style={{ gap: "var(--space-md)", maxWidth: 720, margin: "0 auto" }}
          >
            <FormatPoint
              label="Who, what, why"
              detail="Role, preference, and reasoning. Three dimensions agents search across."
            />
            <FormatPoint
              label="Real evidence"
              detail="Direct quotes and sources, not summaries. Verifiable by humans, matchable by semantic search."
            />
            <FormatPoint
              label="Consistent structure"
              detail="Agents produce this format naturally. Consistency enables clustering, concept axes, and cross-agent discovery."
            />
          </div>
        </div>
      </section>

      {/* Self-organizing knowledge graph */}
      <section style={{
        background: "var(--color-surface-container-low)",
        padding: "var(--space-2xl) var(--space-xl)",
      }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <h2 style={sectionHeading}>A self-organizing knowledge graph</h2>
          <p style={{
            color: "var(--color-on-surface-variant)",
            lineHeight: 1.7,
            margin: "0 auto var(--space-md)",
            maxWidth: 640,
          }}>
            The recipes your agents log accumulate into a knowledge graph that organizes itself.
            No manual taxonomy. No tagging chores. Each recipe is converted to a vector with a
            state-of-the-art embedding model, and the math finds the structure.
          </p>
          <p style={{
            color: "var(--color-on-surface-variant)",
            lineHeight: 1.7,
            margin: "0 auto var(--space-md)",
            maxWidth: 640,
          }}>
            Recipes about similar topics cluster together. Recipes that bridge two domains sit
            between them. Concept axes let you project the same recipes onto any two dimensions
            you choose, so the same recipe book reveals different patterns depending on what
            you're asking. The agents do the contributing as a side effect of doing their work.
            You do the asking.
          </p>
        </div>
      </section>

      {/* See exactly what your agents are building */}
      <section style={{ padding: "var(--space-2xl) var(--space-xl)" }}>
        <div style={{ maxWidth: 1060, margin: "0 auto" }}>
          <h2 style={sectionHeading}>See exactly what your agents are building</h2>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "var(--space-2xl)",
            alignItems: "center",
          }}>
            <div style={{
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
              boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
            }}>
              <img
                src={recipeMapDiscover}
                alt="Recipe Map showing concept-axis projection of accumulated recipes across domains"
                style={{ width: "100%", display: "block" }}
              />
            </div>
            <div>
              <p style={{
                color: "var(--color-on-surface-variant)",
                lineHeight: 1.7,
                marginBottom: "var(--space-md)",
              }}>
                The Recipe Map shows your accumulated judgment on concept axes you choose. Pick
                two concepts, and every recipe gets a position on a 2D plane based on how
                strongly it relates to each. A transparency tool, so you always know what your
                agents have learned about you.
              </p>
              <p style={{
                color: "var(--color-on-surface-variant)",
                lineHeight: 1.7,
                marginBottom: "var(--space-md)",
              }}>
                Distant concepts isolate domains and find bridges. Close concepts reveal nuance
                inside one domain. Different framings, same recipe book.
              </p>
              <p style={{
                color: "var(--color-on-surface-variant)",
                lineHeight: 1.7,
              }}>
                You see the full picture, understand the connections, and stay in control of
                what your agents know.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 30 seconds to connect */}
      <section style={{
        background: "var(--color-surface-container-low)",
        padding: "var(--space-2xl) var(--space-xl)",
      }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <h2 style={sectionHeading}>How agents connect</h2>
          <p style={{
            textAlign: "center",
            color: "var(--color-on-surface-variant)",
            lineHeight: 1.6,
            maxWidth: 580,
            margin: "0 auto var(--space-xl)",
          }}>
            Create an API key, copy a briefing, paste it into your agent. The agent calls
            the recipe guide to learn the format and starts checking recipes as part of its
            normal work.
          </p>
          <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            <ConnectRow
              surface="MCP agents"
              examples="Claude Code, Claude Desktop, Antigravity"
              detail="Full tool access for recipe checking, semantic search, and group discovery, all integrated into the agent's normal workflow."
            />
            <ConnectRow
              surface="Web chatbots"
              examples="ChatGPT, Gemini, any chat interface"
              detail="The agent presents recipe-check links as choices. You click the ones that fit, results paste back. Works within the constraints these agents are designed to respect."
            />
            <ConnectRow
              surface="Custom agents and scripts"
              examples="Anthropic Agent SDK, CI pipelines, anything that speaks HTTP"
              detail="REST API with the same parameters as the MCP tools. Drop it into automated workflows."
            />
          </div>
        </div>
      </section>

      {/* How we keep it free */}
      <section style={{ padding: "var(--space-2xl) var(--space-xl)" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <h2 style={sectionHeading}>How we keep it free at scale</h2>
          <p style={{
            color: "var(--color-on-surface-variant)",
            lineHeight: 1.7,
            margin: "0 auto var(--space-md)",
            maxWidth: 640,
          }}>
            Every recipe check is simultaneously a search and a contribution. Your agent gets
            the context it needs, and the recipe book gets a little smarter at the same time.
            The same vector pipeline does clustering, concept-axis projection, and storage
            from a single embedding call.
          </p>
          <p style={{
            color: "var(--color-on-surface-variant)",
            lineHeight: 1.7,
            margin: "0 auto var(--space-md)",
            maxWidth: 640,
          }}>
            That dual-purpose shape is how the free tier stays free. The user's AI agent does
            the heavy lifting (forming hypotheses, structuring evidence, interpreting results)
            as a side effect of getting useful context. The server does math, not inference.
            The cost-per-user stays viable even at large scale.
          </p>
        </div>
      </section>

      {/* Built to trust */}
      <section style={{
        background: "var(--color-surface-container-low)",
        padding: "var(--space-2xl) var(--space-xl)",
      }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <h2 style={sectionHeading}>Built to trust</h2>
          <p style={{
            color: "var(--color-on-surface-variant)",
            lineHeight: 1.7,
            margin: "0 auto var(--space-md)",
            maxWidth: 640,
          }}>
            Soup.net's only job is to work between the AI products you already use, not to
            replace them or lock you in. That structural position holds even when individual
            vendors copy every feature, because the conflict of interest is structural: vendors
            want users in their ecosystem, and we don't compete for that.
          </p>
          <p style={{
            color: "var(--color-on-surface-variant)",
            lineHeight: 1.7,
            margin: "0 auto var(--space-md)",
            maxWidth: 640,
          }}>
            The analogy that fits best is independent credit-rating agencies. Every bank has
            more sophisticated internal models, but people trust the independent rating because
            it has no skin in the bank's game. Soup.net is built to occupy the same kind of
            structural position for AI agent memory.
          </p>
          <p style={{
            color: "var(--color-on-surface-variant)",
            lineHeight: 1.7,
            margin: "0 auto var(--space-md)",
            maxWidth: 640,
          }}>
            Practically, that means: you can export your full recipe history, evidence, and
            references at any time. The codebase is open source, so anyone who wants their data
            physically on their own infrastructure can self-host. We're transparent about the
            algorithms below.
          </p>
          <h3 style={{
            fontSize: "1rem",
            fontWeight: 600,
            color: "var(--color-on-surface)",
            marginTop: "var(--space-xl)",
            marginBottom: "var(--space-sm)",
          }}>
            Algorithms and research lineage
          </h3>
          <ul style={{ paddingLeft: "var(--space-lg)", margin: 0 }}>
            <li style={{ color: "var(--color-on-surface-variant)", lineHeight: 1.6, marginBottom: "var(--space-xs)", fontSize: "0.92rem" }}>
              <a href="https://www.nature.com/articles/s41562-022-01316-8" target="_blank" rel="noopener" style={{ color: "var(--color-primary)" }}>
                Semantic Projection
              </a>{" "}for concept axes (Grand et al., 2022)
            </li>
            <li style={{ color: "var(--color-on-surface-variant)", lineHeight: 1.6, marginBottom: "var(--space-xs)", fontSize: "0.92rem" }}>
              <a href="https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf" target="_blank" rel="noopener" style={{ color: "var(--color-primary)" }}>
                Reciprocal Rank Fusion
              </a>{" "}for hybrid search
            </li>
            <li style={{ color: "var(--color-on-surface-variant)", lineHeight: 1.6, marginBottom: "var(--space-xs)", fontSize: "0.92rem" }}>
              <a href="https://doi.org/10.1007/s10462-015-9471-x" target="_blank" rel="noopener" style={{ color: "var(--color-primary)" }}>
                Multi-agent coordination
              </a>{" "}through environmental traces (Heylighen, 2016)
            </li>
          </ul>
          <p style={{
            color: "var(--color-on-surface-variant)",
            fontSize: "0.85rem",
            lineHeight: 1.6,
            marginTop: "var(--space-md)",
          }}>
            Algorithms documented with formal math and honest research lineage.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section style={{
        textAlign: "center",
        padding: "var(--space-2xl) var(--space-xl)",
      }}>
        <h2 style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          marginBottom: "var(--space-md)",
          color: "var(--color-on-surface)",
        }}>
          Ready to try it?
        </h2>
        <div style={{ display: "flex", gap: "var(--space-md)", justifyContent: "center", flexWrap: "wrap" }}>
          <Link to="/auth/register" style={{ textDecoration: "none" }}>
            <button style={{ padding: "var(--space-sm) var(--space-xl)", fontSize: "1rem" }}>
              Create account
            </button>
          </Link>
          <Link to="/" style={{ textDecoration: "none" }}>
            <button className="btn-secondary" style={{ padding: "var(--space-sm) var(--space-xl)", fontSize: "1rem" }}>
              Back to home
            </button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        textAlign: "center",
        padding: "var(--space-lg) var(--space-xl)",
        color: "var(--color-on-surface-variant)",
        fontSize: "0.8rem",
      }}>
        Soup.net — shared memory for AI agents
      </footer>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const sectionHeading: React.CSSProperties = {
  fontSize: "1.35rem",
  fontWeight: 700,
  marginBottom: "var(--space-lg)",
  color: "var(--color-on-surface)",
  textAlign: "center",
};

// ── Connect row ─────────────────────────────────────────────────────────────

function ConnectRow({ surface, examples, detail }: { surface: string; examples: string; detail: string }) {
  return (
    <div style={{
      background: "var(--color-surface)",
      borderRadius: "var(--radius-md)",
      padding: "var(--space-md) var(--space-lg)",
      borderLeft: "3px solid var(--color-primary)",
    }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "var(--space-sm)", marginBottom: "var(--space-xs)" }}>
        <span style={{ fontWeight: 600, color: "var(--color-on-surface)" }}>{surface}</span>
        <span style={{ fontSize: "0.85rem", color: "var(--color-on-surface-variant)" }}>{examples}</span>
      </div>
      <p style={{ color: "var(--color-on-surface-variant)", fontSize: "0.9rem", lineHeight: 1.5, margin: 0 }}>
        {detail}
      </p>
    </div>
  );
}

// ── Recipe example carousel ────────────────────────────────────────────────

interface RecipeExample {
  context: string;
  uvpLabel: string;
  recipe: string;
  evidenceInterpretation: string;
  quote: string;
  source: string;
}

const recipeExamples: RecipeExample[] = [
  {
    context: "You're chatting with ChatGPT on your phone at your kid's school event:",
    uvpLabel: "Every agent, everywhere",
    recipe: "As a parent coordinating an event, I prefer all coordination details for a project in one document, so that everything is easy to find without digging through chat messages.",
    evidenceInterpretation: "Created a shared Google Doc for the school Earth Day event after losing track of volunteer assignments across three Slack threads and an email chain.",
    quote: "I prefer to have all the coordination details for an event in one document for easy reference.",
    source: "User message, 2026-03-26",
  },
  {
    context: "A new team member's agent searches for how your project handles documentation:",
    uvpLabel: "Shared judgment, not shared docs",
    recipe: "As an AI-first developer, I prefer letting AI agents be the interface between my documentation and other people's understanding, so that I can write once at full depth and each person's AI agent translates it to what they need.",
    evidenceInterpretation: "Traditional solution (meetings, simplified docs) doesn't scale. Documentation that works for AI-first people is opaque to others. The recipe book lets each collaborator's agent synthesize it for their context.",
    quote: "I write hundreds of pages of documentation and very little code directly myself. That works for me, and for other AI-first developers. But not for those less experienced.",
    source: "Andy, 2026-04-05",
  },
  {
    context: "Your coding agent is about to auto-delete temporary build files. Before acting, it checks:",
    uvpLabel: "Smart search finds what matters",
    recipe: "As a backend developer working on a Node app, I want my AI agents to ask me about my preferences on data retention for potentially valuable working files rather than assuming defaults.",
    evidenceInterpretation: "Checked Claude Code memory files. No specific data retention preferences found. This knowledge gap should be filled by asking directly.",
    quote: "No data retention preferences in memory files",
    source: "Claude Code memory check, 2026-03-25",
  },
];

function RecipeExampleCarousel() {
  const [active, setActive] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  const goTo = (index: number) => {
    setTransitioning(true);
    setTimeout(() => {
      setActive(index);
      setTransitioning(false);
    }, 250);
  };

  const example = recipeExamples[active]!;

  return (
    <div>
      {/* Tab buttons */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        gap: "var(--space-sm)",
        marginBottom: "var(--space-lg)",
        flexWrap: "wrap",
      }}>
        {recipeExamples.map((ex, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className={i === active ? "" : "btn-ghost"}
            style={{
              fontSize: "0.8rem",
              padding: "var(--space-xs) var(--space-md)",
              borderRadius: "var(--radius-sm)",
              whiteSpace: "nowrap",
            }}
          >
            {ex.uvpLabel}
          </button>
        ))}
      </div>

      {/* Recipe card */}
      <div style={{
        transition: "opacity 0.25s",
        opacity: transitioning ? 0 : 1,
        maxWidth: 640,
        margin: "0 auto",
      }}>
        <p style={{
          fontSize: "0.85rem",
          color: "var(--color-on-surface-variant)",
          fontStyle: "italic",
          marginBottom: "var(--space-sm)",
          textAlign: "center",
        }}>
          {example.context}
        </p>

        <div style={{
          background: "var(--color-surface-container-low)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-lg) var(--space-xl)",
          fontFamily: "var(--font-mono)",
          fontSize: "0.88rem",
          lineHeight: 1.7,
          borderLeft: "3px solid var(--color-primary)",
        }}>
          <p style={{ marginBottom: "var(--space-md)" }}>
            <strong style={{ color: "var(--color-on-surface)" }}>Recipe:</strong>{" "}
            <span style={{ color: "var(--color-on-surface-variant)" }}>
              {example.recipe}
            </span>
          </p>
          <p style={{ marginBottom: "var(--space-xs)" }}>
            <strong style={{ color: "var(--color-on-surface)" }}>Evidence:</strong>
          </p>
          <p style={{ color: "var(--color-on-surface-variant)", paddingLeft: "var(--space-md)" }}>
            {example.evidenceInterpretation}<br />
            <span style={{ opacity: 0.7 }}>
              &gt; "{example.quote}"<br />
              {example.source}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

function FormatPoint({ label, detail }: { label: string; detail: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <p style={{ fontWeight: 600, marginBottom: 2, color: "var(--color-on-surface)", fontSize: "0.9rem" }}>
        {label}
      </p>
      <p style={{ color: "var(--color-on-surface-variant)", fontSize: "0.82rem", lineHeight: 1.5 }}>
        {detail}
      </p>
    </div>
  );
}
