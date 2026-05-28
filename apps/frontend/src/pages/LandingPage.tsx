import { Link } from "@tanstack/react-router";
import { StoryCarousel } from "../components/StoryCarousel.js";
import illustrationBlankSlate from "../assets/illustration-blank-slate.png";
import illustrationNewTeam from "../assets/illustration-new-team.png";
import illustrationBriefingHandoff from "../assets/illustration-briefing-handoff.png";
import illustrationChecksInMotion from "../assets/illustration-checks-in-motion.png";
import illustrationContextReturning from "../assets/illustration-context-returning.png";
import illustrationSharedBook from "../assets/illustration-shared-book.png";
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
          in your next session, on a different tool, or to a collaborator joining the project.
          The recipe book builds itself.
        </p>
        <div style={{ display: "flex", gap: "var(--space-md)", justifyContent: "center", flexWrap: "wrap" }}>
          <Link to="/auth/register" style={{ textDecoration: "none" }}>
            <button style={{ padding: "var(--space-sm) var(--space-xl)", fontSize: "1rem" }}>
              Create Free Account
            </button>
          </Link>
          <Link to="/auth/login" style={{ textDecoration: "none" }}>
            <button className="btn-secondary" style={{ padding: "var(--space-sm) var(--space-xl)", fontSize: "1rem" }}>
              Sign In
            </button>
          </Link>
        </div>
      </header>

      {/* Pillar 1 — individual cross-vendor portability */}
      <PillarSection
        heading="One recipe book, every agent you use"
        body="Phone chatbot at lunch, coding agent at your desk, design tool in the evening — they all draw from the same recipe book you control. Whether it's Claude Code, ChatGPT, Gemini, or a custom one your team wrote in-house, the Soup.net briefing teaches each one how to participate. Vendor memory stays inside one ecosystem. Your taste and judgment travel with you. Equip every agent with what makes you you, once. Less time correcting and re-briefing them, more time on the long-running work that's the point of having agents in the first place — and every recipe check makes the next one smarter."
        image={illustrationBlankSlate}
        imageAlt="Watercolor: a person at a desk surrounded by their AI tools — phone, laptop, sketchpad — each one starting from a blank slate every session."
        imageCaption="Every new agent, every new session — starting from scratch."
        imageSide="right"
      />

      {/* Pillar 2 — collaboration that travels across people and AI-maturity levels */}
      <PillarSection
        heading="Invite a collaborator — their agent does the work"
        body="Invite a collaborator to a recipe book and their agent picks up the shared taste and judgment immediately — whatever tool they use, whatever AI experience they have. Personal recipes stay personal; shared decisions stay visible to that book's members. Sharing across vendors requires a neutral system across them, which no single AI vendor can offer. And for collaborators who'd never sign up themselves — friends, family, anyone whose AI is the free tier of ChatGPT or Gemini web — the same recipe book reaches them through clickable links. They click; their agent gets the context."
        image={illustrationNewTeam}
        imageAlt="Watercolor: two collaborators at different points in their AI experience, beginning a shared project — their AI agents present, ready to participate."
        imageCaption="Each collaborator's context, locked in their own session."
        imageSide="left"
        background="var(--color-surface-container-low)"
      />

      {/* How a recipe check works — sequential walkthrough; heading does the
          anchoring to the pillars and names the mechanism, so no intro paragraph
          is needed between heading and steps. */}
      <section style={{ padding: "var(--space-2xl) var(--space-xl)" }}>
        <div style={{ maxWidth: 880, margin: "0 auto" }}>
          <h2 style={sectionHeading}>How a recipe check works</h2>
          <div style={{ display: "grid", gap: "var(--space-md)" }}>
            <Step
              marker={1}
              title="Give your agent the briefing."
              body="One short document teaches any agent how to recipe-check, and shows it a representative sample of the taste and judgment you've already captured. MCP-capable agents configure themselves from it. Web chatbots take it as a first message and continue normally."
              illustration={illustrationBriefingHandoff}
              illustrationAlt="Watercolor: a person handing a small open briefing booklet to a soft agent figure, with faint outlines of the tools the agent will use around them."
              details={[
                {
                  q: "What's actually in the briefing?",
                  a: (
                    <>
                      Two sections.
                      <br /><br />
                      <strong>1. How to recipe-check.</strong> The agent learns the recipe format with annotated examples, the principles for writing recipes that future agents will actually find (only quote what's genuinely in the source; phrase decisions as transferable roles rather than personal names; treat the record as something other agents read), and the three moments to recipe-check — starting a task, facing a judgment call, after meaningful work. Written using technical terms the AI agent already understands, so the briefing stays compact and the agent picks it up fast.
                      <br /><br />
                      <strong>2. Your recipes.</strong> Your identity, your recipe books with the descriptions you've written for each (so the agent picks the right one to write to), and a representative sample of recipes from those books — clustered to cover the variety of taste you've already captured rather than just the most recent. Your agent gets oriented in your accumulated judgment without needing to read everything.
                    </>
                  ),
                },
                {
                  q: "What if I'm just starting and have no recipes yet?",
                  a: "Day one is fine — you don't have to teach Soup.net anything before you start. Give your agent the briefing and carry on with the work you'd be doing anyway. The briefing alone teaches your agent how to participate; your recipe books fill up from the first recipe check, and every check after that has more to find. There's no taxonomy to build, no fields to fill in, nothing to maintain. The shape grows from real work.",
                },
                {
                  q: "How does the workflow play out for a web chatbot with no MCP?",
                  a: "The briefing teaches a workflow that doesn't require tool calling. The chatbot takes the briefing as a first message. As the work proceeds, it surfaces taste-and-judgment calls as clickable recipe-check links — each link is a pre-filled recipe at the soup.net check page. You click the option that fits; the result page shows matching recipes from your books and a \"copy results for AI agent\" button gathers them. You paste the result back into the chat. That paste carries two signals at once: which option you chose, and what came back for it. A few clicks per major taste-and-judgment call, no signup, no tool-calling.",
                },
              ]}
            />
            <Step
              marker={2}
              title="As your agent works, it does recipe checks."
              body="A recipe check is a hypothesis your agent is already forming — about your taste and judgment, a past decision, or what would fit. The check is concurrent, fast, and never destructive. Past recipes that come back become context for the work your agent is about to do."
              illustration={illustrationChecksInMotion}
              illustrationAlt="Watercolor: the person at work with the agent alongside, small marks rising from the work toward a soft glowing vessel — recipe checks happening as a side effect."
              details={[
                {
                  q: "How does the agent phrase a recipe check, and why that shape?",
                  a: "As a [role] working on [goal], I prefer [X] so that [Y] — with supporting evidence: an interpretation, a direct quote from where the call came from, and a source citation. Each part earns its keep. The role is what semantic search matches against, so keeping it generalizable (\"front-end React developer\" rather than \"Soup.net developer\") means taste and judgment captured in one project shows up usefully in another. Verbatim quotes make the record checkable — anything that can't be quoted from a real source is interpretation, not evidence. And the shape forces the agent to put the meaningful context inside the recipe itself, which is the quiet failure mode of most AI memory systems: they store loose facts that drift from their original meaning.",
                },
                {
                  q: "I don't want to learn another AI tool.",
                  a: "You don't have to. Most AI tools require you to coax your agent into using them for a specific task — \"use this MCP server for this\" — which narrows what the agent is working on. Soup.net is the opposite shape: the briefing teaches your agent how to participate, and from then on it recipe-checks as a side effect of whatever you're already doing together. You don't tell it when to check or what to write. It picks the moments and the framing on its own, as part of work it would have done anyway.",
                },
                {
                  q: "Doesn't this slow my agent down?",
                  a: "Recipe checks run concurrently with the work, not in front of it. Capable agents call them as a sub-agent — the result comes back while the main work continues. If something useful surfaces, your agent integrates it; if not, the work proceeds without ever pausing. Soup.net is built for the agent to use freely, not to interrupt your attention.",
                },
                {
                  q: "How is this different from the memory my AI vendor already has?",
                  a: "Vendor memory (Claude Projects, ChatGPT Memory, Gemini context) follows specific tasks inside one vendor's product, and it's good at that. Soup.net is the layer above — your transferable taste and judgment calls, the kind that should apply whether you're in Claude this morning, ChatGPT this afternoon, or a custom agent tonight. They're complementary, not competing. Vendor memory remembers the specifics inside their product. Soup.net carries your general taste and judgment across all of them, including agents you haven't tried yet.",
                },
              ]}
            />
            <Step
              marker={3}
              title="Your past taste and judgment calls come back as context, not directives."
              body="Your agent reads what comes back from your recipe books and decides whether it changes the approach. Most of the time past calls confirm and your agent continues; sometimes one contradicts the current move and the agent flags it for you."
              illustration={illustrationContextReturning}
              illustrationAlt="Watercolor: the same scene with marks flowing back, settling around the agent; one or two glow brighter — context returning gently as the work continues."
              details={[
                {
                  q: "What about decisions that differ across projects?",
                  a: "Recipe books scope the context. Personal taste and judgment stay in your personal book; project decisions go in the project's book. Each book has a description telling agents what kinds of decisions belong there — and an MCP-capable agent can update that description as the project's scope evolves.",
                },
                {
                  q: "Don't old recipes get irrelevant over time?",
                  a: "Every result comes back with where the taste-and-judgment call came from — the agent's interpretation at the time, a verbatim quote from the source, and a citation. Your agent reads that context and decides whether the call still holds. This is the difference from typical AI memory systems, where assumptions ossify into \"facts\" that get repeated for years without being questioned (the moment you open your AI agent's memory file and find six things that were true once, in one context, but aren't now). Soup.net is self-cleaning because every recipe carries the evidence to evaluate whether it's still true — and the agent treats results as context to weigh, not facts to obey. Each result also surfaces its date and the size of the cluster around it so freshness is visible at a glance.",
                },
                {
                  q: "What if my agent writes a bad recipe? Can I fix or delete it?",
                  a: "Usually you don't need to. Tell your agent your updated taste and have it log a fresh recipe with current evidence; the system surfaces the newer recipe alongside the old one, weighted higher because the evidence is fresher. The old one becomes context, not a directive — exactly like the answer above. If a recipe is genuinely wrong (malformed, hallucinated evidence, a recipe that was never a real human judgment), you can delete it from the trace detail page in your dashboard.",
                },
                {
                  q: "Can I see what my agents have learned about me?",
                  a: "Yes. The Recipe Map on your dashboard plots every recipe in any book you can read on two concept axes you choose (\"accessibility\" vs. \"performance,\" \"design taste\" vs. \"technical decisions,\" anything you can name). You see the shape of what's accumulated, click into any recipe to read its evidence, and stay in control of what's there. The dashboard also shows a running log of every recipe check your agents make. More detail in How it works below.",
                },
              ]}
            />
            <Step
              marker="+"
              outlined
              title="And the same for every collaborator's agent."
              body="The same three steps work on shared recipe books. Your agent's recipe checks find what other members' agents have logged; theirs find yours. Even collaborators who'd never sign up themselves can participate through clickable links — no MCP, no account needed."
              illustration={illustrationSharedBook}
              illustrationAlt="Watercolor: two collaborators at their own workspaces in mirrored composition, each with their own agent, a shared constellation of recipes connecting them through the center — the puzzle pieces from Pillar 2 now finding each other."
              details={[
                {
                  q: "Who can actually see my recipes?",
                  a: "Personal recipes can only be read by your own agents — the ones using API keys you create. Shared recipe books can only be read by the members of that book and their agents. Nothing in Soup.net is public unless you create a public recipe book on purpose. Your data is exportable in full at any time, and the codebase is open source for anyone who wants the data physically on their own servers.",
                },
                {
                  q: "What if a collaborator can't or won't use MCP?",
                  a: "Free-tier ChatGPT, Gemini web, and Claude web can participate in a shared recipe book through clickable recipe-check links. The MCP path is the primary one and far smoother. The web path is what reaches collaborators who use whatever AI tool they already have, and never sign up themselves — the friend or family member you want to bring into a decision.",
                },
              ]}
            />
          </div>

          {/* HowItWorks teaser card — replaces the tiny inline link previously
              hidden in the CTA paragraph, so the deep-version path is visible
              to readers who got hooked by the walkthrough above. */}
          <Link to="/info/how-it-works" style={{ textDecoration: "none" }}>
            <div
              className="how-it-works-teaser"
              style={{
                marginTop: "var(--space-2xl)",
                background: "var(--color-surface-container-low)",
                borderRadius: "var(--radius-lg)",
                padding: "var(--space-lg) var(--space-xl)",
                border: "1px solid var(--color-outline-variant, #e0e0e0)",
                display: "flex",
                gap: "var(--space-lg)",
                alignItems: "center",
                flexWrap: "wrap",
                cursor: "pointer",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                <h3 style={{
                  fontSize: "1.05rem",
                  fontWeight: 700,
                  color: "var(--color-on-surface)",
                  margin: 0,
                  marginBottom: "var(--space-xs)",
                  fontFamily: "var(--font-headline)",
                }}>
                  Go deeper into how it works →
                </h3>
                <p style={{
                  color: "var(--color-on-surface-variant)",
                  lineHeight: 1.55,
                  margin: 0,
                  fontSize: "0.9rem",
                }}>
                  The recipe format with annotated examples. The Recipe Map and concept-axis projection. How the system stays free at scale. Why the structural position is durable.
                </p>
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* See it in action — the carousel */}
      <section style={{
        background: "var(--color-surface-container-low)",
        padding: "var(--space-2xl) var(--space-xl)",
      }}>
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
            agent picks up the previous session's taste and judgment. No correcting, no re-briefing.
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
          AI agents are doing more on their own. Give yours something to align with.
        </h2>
        <p style={{
          color: "var(--color-on-surface-variant)",
          marginBottom: "var(--space-lg)",
        }}>
          Start your first recipe book — free.
        </p>
        <div style={{ display: "flex", gap: "var(--space-md)", justifyContent: "center", flexWrap: "wrap" }}>
          <Link to="/auth/register" style={{ textDecoration: "none" }}>
            <button style={{ padding: "var(--space-sm) var(--space-xl)", fontSize: "1rem" }}>
              Create Free Account
            </button>
          </Link>
          <Link to="/auth/login" style={{ textDecoration: "none" }}>
            <button className="btn-secondary" style={{ padding: "var(--space-sm) var(--space-xl)", fontSize: "1rem" }}>
              Sign In
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
        <Link to="/auth/register" style={{ textDecoration: "none" }}>
          <button style={{ padding: "var(--space-xs) var(--space-lg)", fontSize: "0.85rem" }}>
            Create Free Account
          </button>
        </Link>
        <Link to="/auth/login" style={{ textDecoration: "none" }}>
          <button className="btn-secondary" style={{ padding: "var(--space-xs) var(--space-md)", fontSize: "0.85rem" }}>
            Sign In
          </button>
        </Link>
      </div>

      {/* Universal footer (Soup.net, How it works, Privacy, Terms) is mounted
          by AppShell, not inline here. */}
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

// ── Step (numbered row with expandable Q&A details) ──────────────────────────

function Step({ marker, outlined, title, body, details, illustration, illustrationAlt }: {
  marker: number | string;
  outlined?: boolean;
  title: string;
  body: string;
  details: { q: string; a: React.ReactNode }[];
  illustration?: string;
  illustrationAlt?: string;
}) {
  return (
    <div style={{
      display: "flex",
      gap: "var(--space-lg)",
      alignItems: "flex-start",
      flexWrap: "wrap",
    }}>
      <div style={{
        flex: "0 0 auto",
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: outlined ? "transparent" : "var(--color-primary)",
        color: outlined ? "var(--color-primary)" : "var(--color-on-primary, #fff)",
        border: outlined ? "2px solid var(--color-primary)" : "none",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: "1.1rem",
        fontFamily: "var(--font-headline)",
      }}>
        {marker}
      </div>
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <h3 style={{
          fontSize: "1.1rem",
          fontWeight: 700,
          color: "var(--color-on-surface)",
          margin: 0,
          marginBottom: "var(--space-xs)",
          fontFamily: "var(--font-headline)",
        }}>
          {title}
        </h3>
        <p style={{
          color: "var(--color-on-surface-variant)",
          lineHeight: 1.6,
          marginTop: 0,
          marginBottom: details.length > 0 ? "var(--space-sm)" : 0,
        }}>
          {body}
        </p>
        {details.map((d, i) => (
          <details key={i} style={{ marginBottom: "var(--space-xs)" }}>
            <summary style={{
              cursor: "pointer",
              color: "var(--color-primary)",
              fontSize: "0.9rem",
              fontWeight: 500,
              padding: "var(--space-xs) 0",
              listStyle: "revert",
            }}>
              {d.q}
            </summary>
            <p style={{
              color: "var(--color-on-surface-variant)",
              lineHeight: 1.55,
              fontSize: "0.9rem",
              paddingLeft: "var(--space-md)",
              borderLeft: "2px solid var(--color-outline-variant, #e0e0e0)",
              margin: 0,
              marginTop: "var(--space-xs)",
              marginBottom: "var(--space-sm)",
            }}>
              {d.a}
            </p>
          </details>
        ))}
      </div>
      {illustration ? (
        <div style={{
          flex: "1 1 220px",
          minWidth: 0,
          maxWidth: 280,
        }}>
          <img
            src={illustration}
            alt={illustrationAlt ?? ""}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--color-outline-variant, #e0e0e0)",
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

// ── Pillar section (image + text, alternating sides) ─────────────────────────

function PillarSection({ heading, body, bullets, image, imageAlt, imageCaption, imageSide, background }: {
  heading: string;
  body: string;
  bullets?: string[];
  image: string;
  imageAlt: string;
  imageCaption?: string;
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
      {imageCaption ? (
        <p style={{
          marginTop: "var(--space-xs)",
          marginBottom: 0,
          fontSize: "0.85rem",
          fontStyle: "italic",
          color: "var(--color-on-surface-variant)",
          textAlign: "center",
          lineHeight: 1.4,
        }}>
          {imageCaption}
        </p>
      ) : null}
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
      {bullets && bullets.length > 0 ? (
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
      ) : null}
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
