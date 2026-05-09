import { Link } from "@tanstack/react-router";
import { StoryCarousel } from "../components/StoryCarousel.js";
import illustrationBlankSlate from "../assets/illustration-blank-slate.png";
import illustrationNewTeam from "../assets/illustration-new-team.png";
import soupnetLogo from "../assets/soupnet-logo.png";

export function LandingPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-surface)", paddingBottom: 60 }}>
      {/* Hero */}
      <header style={{
        textAlign: "center",
        padding: "clamp(3rem, 10vh, 6rem) var(--space-xl) var(--space-2xl)",
        maxWidth: 720,
        margin: "0 auto",
      }}>
        <h1 style={{
          margin: 0,
          marginBottom: "var(--space-md)",
          display: "flex",
          justifyContent: "center",
        }}>
          <img
            src={soupnetLogo}
            alt="Soup.net"
            style={{
              width: "clamp(280px, 50vw, 460px)",
              height: "auto",
              display: "block",
            }}
          />
        </h1>
        <p style={{
          fontSize: "clamp(1.2rem, 2.6vw, 1.5rem)",
          color: "var(--color-on-surface)",
          lineHeight: 1.4,
          marginBottom: "var(--space-md)",
          fontFamily: "var(--font-headline)",
        }}>
          Your taste and judgment, in every AI agent you use.
        </p>
        <p style={{
          fontSize: "1rem",
          color: "var(--color-on-surface-variant)",
          lineHeight: 1.6,
          maxWidth: 580,
          margin: "0 auto var(--space-xl)",
        }}>
          You make the calls. Your AI agents capture them as they work, then bring them back
          in your next session, on a different tool, or to a teammate joining the project.
          The recipe book builds itself.
        </p>
        <div style={{ display: "flex", gap: "var(--space-md)", justifyContent: "center", flexWrap: "wrap" }}>
          <Link to="/auth/login" style={{ textDecoration: "none" }}>
            <button style={{ padding: "var(--space-sm) var(--space-xl)", fontSize: "1rem" }}>
              Sign in
            </button>
          </Link>
          <Link to="/auth/register" style={{ textDecoration: "none" }}>
            <button className="btn-secondary" style={{ padding: "var(--space-sm) var(--space-xl)", fontSize: "1rem" }}>
              Create account
            </button>
          </Link>
        </div>
      </header>

      {/* Pillar 1 — individual cross-vendor portability */}
      <PillarSection
        heading="One recipe book, every agent you use"
        body="Phone chatbot at lunch, coding agent at your desk, design tool in the evening. They all draw from the same recipe book you control. Equip every agent with what makes you you, once. Less time correcting and re-briefing them, more time on the long-running work that's the point of having agents in the first place. And every check makes the next one smarter."
        bullets={[
          "Works with MCP-native agents like Claude Code, web chatbots like ChatGPT and Gemini, and any custom agent that speaks HTTP. The Soup.net briefing teaches each one how to participate.",
          "Vendor memory stays inside one ecosystem. Soup.net's shared judgment doesn't.",
        ]}
        image={illustrationBlankSlate}
        imageAlt="A person at a desk with the surrounding tools (phone, laptop, sketchpad) all aware of their working preferences. Context flowing freely between every agent they use."
        imageSide="right"
      />

      {/* Pillar 2 — team scale + AI maturity gap */}
      <PillarSection
        heading="Onboard teammates. Their agent does the work."
        body="Invite a collaborator to a recipe book and their agent picks up the shared taste and judgment immediately. Whatever tool they use, whatever AI experience they have, they don't have to learn a new system. Sharing across ecosystems requires a neutral system across them, which no single AI vendor can offer."
        bullets={[
          "Onboard teammates without expecting them to be AI experts. Whatever tool they're already comfortable with, the heavy lifting happens between agents.",
          "Recipe books are scoped: personal recipes stay personal, team decisions stay visible to the team.",
        ]}
        image={illustrationNewTeam}
        imageAlt="Two collaborators at different points in their AI maturity journey, with their agents handing accumulated context between them so the humans don't have to."
        imageSide="left"
        background="var(--color-surface-container-low)"
      />

      {/* See it in action — the carousel */}
      <section style={{ padding: "var(--space-2xl) var(--space-xl)" }}>
        <div style={{ maxWidth: 1060, margin: "0 auto" }}>
          <h2 style={sectionHeading}>See it in action</h2>
          <p style={{
            textAlign: "center",
            color: "var(--color-on-surface-variant)",
            lineHeight: 1.6,
            maxWidth: 620,
            margin: "0 auto var(--space-xl)",
          }}>
            A real project: father and son making a game mod across three AI tools. Each
            agent picks up the previous session's taste. No correcting, no re-briefing.
          </p>
          <StoryCarousel />
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
          Make decisions, not documentation.
        </h2>
        <p style={{
          color: "var(--color-on-surface-variant)",
          marginBottom: "var(--space-lg)",
        }}>
          Free during early access. Want the deep version first?{" "}
          <Link to="/info/how-it-works" style={{ color: "var(--color-primary)" }}>
            See how it works.
          </Link>
        </p>
        <div style={{ display: "flex", gap: "var(--space-md)", justifyContent: "center", flexWrap: "wrap" }}>
          <Link to="/auth/register" style={{ textDecoration: "none" }}>
            <button style={{ padding: "var(--space-sm) var(--space-xl)", fontSize: "1rem" }}>
              Create account
            </button>
          </Link>
          <Link to="/auth/login" style={{ textDecoration: "none" }}>
            <button className="btn-secondary" style={{ padding: "var(--space-sm) var(--space-xl)", fontSize: "1rem" }}>
              Sign in
            </button>
          </Link>
        </div>
      </section>

      {/* Sticky bottom CTA bar */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "var(--color-surface)",
        borderTop: "1px solid var(--color-outline-variant, #ddd)",
        padding: "var(--space-sm) var(--space-xl)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: "var(--space-md)",
        zIndex: 100,
        boxShadow: "0 -2px 12px rgba(0,0,0,0.06)",
      }}>
        <span style={{ color: "var(--color-on-surface-variant)", fontSize: "0.85rem" }}>
          Free during early access
        </span>
        <Link to="/auth/register" style={{ textDecoration: "none" }}>
          <button style={{ padding: "var(--space-xs) var(--space-lg)", fontSize: "0.85rem" }}>
            Get started
          </button>
        </Link>
        <Link to="/auth/login" style={{ textDecoration: "none" }}>
          <button className="btn-ghost" style={{ padding: "var(--space-xs) var(--space-md)", fontSize: "0.85rem" }}>
            Sign in
          </button>
        </Link>
      </div>

      {/* Footer */}
      <footer style={{
        textAlign: "center",
        padding: "var(--space-lg) var(--space-xl)",
        color: "var(--color-on-surface-variant)",
        fontSize: "0.8rem",
      }}>
        Soup.net <Link to="/info/how-it-works" style={{ color: "var(--color-on-surface-variant)", marginLeft: "var(--space-md)" }}>How it works</Link>
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

// ── Pillar section (image + text, alternating sides) ─────────────────────────

function PillarSection({ heading, body, bullets, image, imageAlt, imageSide, background }: {
  heading: string;
  body: string;
  bullets: string[];
  image: string;
  imageAlt: string;
  imageSide: "left" | "right";
  background?: string;
}) {
  const imageBlock = (
    <div style={{ flex: "1 1 360px", minWidth: 0 }}>
      <img
        src={image}
        alt={imageAlt}
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--color-outline-variant, #e0e0e0)",
        }}
      />
    </div>
  );
  const textBlock = (
    <div style={{ flex: "1 1 360px", minWidth: 0 }}>
      <h2 style={{
        fontSize: "1.35rem",
        fontWeight: 700,
        marginBottom: "var(--space-md)",
        color: "var(--color-on-surface)",
      }}>
        {heading}
      </h2>
      <p style={{
        color: "var(--color-on-surface-variant)",
        lineHeight: 1.6,
        marginBottom: "var(--space-md)",
      }}>
        {body}
      </p>
      <ul style={{ paddingLeft: "var(--space-lg)", margin: 0 }}>
        {bullets.map((b, i) => (
          <li key={i} style={{
            color: "var(--color-on-surface-variant)",
            lineHeight: 1.5,
            marginBottom: "var(--space-xs)",
            fontSize: "0.92rem",
          }}>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <section style={{
      background: background ?? "transparent",
      padding: "var(--space-2xl) var(--space-xl)",
    }}>
      <div style={{
        maxWidth: 1060,
        margin: "0 auto",
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--space-2xl)",
        alignItems: "center",
      }}>
        {imageSide === "left" ? imageBlock : textBlock}
        {imageSide === "left" ? textBlock : imageBlock}
      </div>
    </section>
  );
}
