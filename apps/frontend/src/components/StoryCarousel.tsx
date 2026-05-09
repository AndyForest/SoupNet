import { useState, useCallback } from "react";
import storyFrame1 from "../assets/story-frame1-divergent.png";
import storyFrame2GeminiPivot from "../assets/story-frame2-gemini-pivot.png";
import storyFrame2GeminiResult from "../assets/story-frame2-gemini-result.png";
import storyFrame3ClaudeCode from "../assets/story-frame3-claude-code.png";

interface Callout {
  text: string;
  highlight?: boolean;
}

interface StoryFrame {
  /** Short label shown in the stepper above the carousel. */
  stepLabel: string;
  image?: string;
  imageAlt?: string;
  /**
   * The story-narrating headline for this frame. Should set up or advance the
   * arc so the user gets the gist from the title alone. Frames with side-by-side
   * images skip the supplementary callouts list and rely on the title +
   * per-image captions.
   */
  title: string;
  /**
   * Supplementary callout list, used only by single-image frames. Side-by-side
   * frames render their captions on the images themselves and ignore this.
   */
  callouts?: Callout[];
  /** Placeholder text when image not yet captured */
  placeholder?: string;
  /**
   * Full-width side-by-side images instead of the default left-image /
   * right-callouts grid. Used for portrait screenshots that need both columns
   * (phone chats etc.).
   */
  images?: { src: string; alt: string; caption?: string }[];
}

const frames: StoryFrame[] = [
  {
    stepLabel: "Brainstorm with ChatGPT",
    image: storyFrame1,
    imageAlt: "ChatGPT presenting three divergent recipe-check hypotheses about a game mod's creative direction",
    title: "At dinner with your kid, you brainstorm a game mod with ChatGPT on your phone. The agent presents three creative directions and asks which one fits.",
    callouts: [
      { text: "Instead of guessing which direction you want, the agent forms 3 genuine hypotheses, each a real creative position it believes in. Logging them enriches your recipe book even as a search.", highlight: true },
      { text: "\"Click the one that resonates, or let me know if none fit.\" You pick one. That click logs your choice for every agent to find later." },
    ],
  },
  {
    stepLabel: "Image creation with Nano Banana",
    title: "ChatGPT's image attempts feel off, so you try Gemini's new Nano Banana model. The cozy framing carries over.",
    images: [
      {
        src: storyFrame2GeminiPivot,
        alt: "Gemini opens by acknowledging the prior framing was too grim and offers divergent recipe-check options before generating an image",
        caption: "Asks for direction first",
      },
      {
        src: storyFrame2GeminiResult,
        alt: "Gemini explains the recipe-check workflow, the user pastes results back, and Gemini generates a warm cozy 'Biter Buddies' title image",
        caption: "Lands on-tone",
      },
    ],
  },
  {
    stepLabel: "Code with Claude",
    image: storyFrame3ClaudeCode,
    imageAlt: "Claude Code in VS Code, responding to a one-line prompt with the new mod image. It runs three recipe checks against your recipe book, summarizes findings (tone alignment confirmed; a sprite-recoloring conflict flagged), and proposes a safe README edit before applying it.",
    title: "Later, at your desk, a one-line prompt with the new image is all Claude Code needs. Your recipe book carries everything else.",
    callouts: [
      { text: "Recipe checks return earlier decisions across your sessions: your kid's tone choice, the cozy framing, even an aesthetic preference from a different conversation entirely. No re-explaining.", highlight: true },
      { text: "Claude Code catches a conflict the prior agents couldn't see: the image hints at recolored buddies, but an earlier recipe preferred no explicit markings. It flags the call for you instead of guessing." },
    ],
  },
];

export function StoryCarousel() {
  const [activeFrame, setActiveFrame] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  const goToFrame = useCallback((index: number) => {
    setTransitioning(true);
    setTimeout(() => {
      setActiveFrame(index);
      setTransitioning(false);
    }, 300);
  }, []);

  const nextFrame = useCallback(() => {
    goToFrame((activeFrame + 1) % frames.length);
  }, [activeFrame, goToFrame]);

  const prevFrame = useCallback(() => {
    goToFrame((activeFrame - 1 + frames.length) % frames.length);
  }, [activeFrame, goToFrame]);

  const frame = frames[activeFrame]!;
  const hasImage = !!(frame.image || frame.placeholder);
  const hasSideBySide = !!(frame.images && frame.images.length > 0);
  const callouts = frame.callouts ?? [];

  return (
    <div style={{ position: "relative" }}>
      {/* Stepper — labeled buttons, one per frame. Wraps on narrow viewports. */}
      <div style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "var(--space-xs)",
        marginBottom: "var(--space-lg)",
      }}>
        {frames.map((f, i) => {
          const active = i === activeFrame;
          return (
            <button
              key={i}
              onClick={() => goToFrame(i)}
              aria-current={active ? "step" : undefined}
              aria-label={`Step ${i + 1}: ${f.stepLabel}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-xs)",
                padding: "var(--space-xs) var(--space-md)",
                borderRadius: 999,
                border: active
                  ? "1px solid var(--color-primary)"
                  : "1px solid var(--color-outline-variant, #d0d0d0)",
                background: active ? "var(--color-primary)" : "var(--color-surface)",
                color: active ? "var(--color-on-primary, #fff)" : "var(--color-on-surface-variant)",
                fontSize: "0.8rem",
                fontWeight: active ? 600 : 500,
                lineHeight: 1.2,
                cursor: "pointer",
                transition: "background 0.2s, color 0.2s, border-color 0.2s",
              }}
            >
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: active ? "rgba(255,255,255,0.2)" : "var(--color-surface-container-low)",
                fontSize: "0.7rem",
                fontWeight: 700,
              }}>
                {i + 1}
              </span>
              <span>{f.stepLabel}</span>
            </button>
          );
        })}
      </div>

      {/* Story row — prev | narrating title | next. The title carries the
          frame's narrative, so the rest of the slide doesn't have to repeat it. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: "var(--space-md)",
        marginBottom: "var(--space-xl)",
      }}>
        <button
          className="btn-ghost"
          onClick={prevFrame}
          aria-label="Previous step"
          style={{ padding: "var(--space-xs) var(--space-sm)", fontSize: "0.95rem", lineHeight: 1 }}
        >
          &larr;
        </button>
        <p style={{
          fontSize: "1.05rem",
          fontWeight: 500,
          color: "var(--color-on-surface)",
          textAlign: "center",
          lineHeight: 1.5,
          margin: 0,
          minHeight: "1.5em",
          transition: "opacity 0.3s",
          opacity: transitioning ? 0 : 1,
        }}>
          {frame.title}
        </p>
        <button
          className="btn-ghost"
          onClick={nextFrame}
          aria-label="Next step"
          style={{ padding: "var(--space-xs) var(--space-sm)", fontSize: "0.95rem", lineHeight: 1 }}
        >
          &rarr;
        </button>
      </div>

      {/* Content area */}
      <div style={{
        transition: "opacity 0.3s",
        opacity: transitioning ? 0 : 1,
        minHeight: 320,
      }}>
        {hasSideBySide ? (
          // Full-width row of phone screenshots, captions on the images. The
          // narrating title above carries the rest of the story; no extra
          // callout panels.
          <div style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "var(--space-xl)",
          }}>
            {frame.images!.map((img, i) => (
              <figure key={i} style={{
                flex: "1 1 280px",
                maxWidth: 380,
                margin: 0,
                textAlign: "center",
              }}>
                <div style={{
                  borderRadius: "var(--radius-lg)",
                  overflow: "hidden",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
                }}>
                  <img
                    src={img.src}
                    alt={img.alt}
                    style={{ width: "100%", display: "block" }}
                  />
                </div>
                {img.caption && (
                  <figcaption style={{
                    marginTop: "var(--space-sm)",
                    fontSize: "0.9rem",
                    color: "var(--color-on-surface-variant)",
                    fontStyle: "italic",
                  }}>
                    {img.caption}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        ) : hasImage ? (
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "var(--space-xl)",
            alignItems: "start",
          }}>
            {/* Screenshot or placeholder */}
            <div style={{
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
              boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
            }}>
              {frame.image ? (
                <img
                  src={frame.image}
                  alt={frame.imageAlt}
                  style={{ width: "100%", display: "block" }}
                />
              ) : (
                <div style={{
                  background: "#f0f0f0",
                  minHeight: 280,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "var(--space-lg)",
                }}>
                  <p style={{
                    color: "#888",
                    fontSize: "0.9rem",
                    textAlign: "center",
                    fontStyle: "italic",
                  }}>
                    Screenshot needed: {frame.placeholder}
                  </p>
                </div>
              )}
            </div>

            {/* Callouts */}
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-md)",
            }}>
              {callouts.map((callout, i) => (
                <div
                  key={i}
                  style={{
                    padding: "var(--space-md)",
                    borderRadius: "var(--radius-md)",
                    background: callout.highlight
                      ? "rgba(103, 80, 164, 0.08)"
                      : "#f5f5f0",
                    borderLeft: callout.highlight
                      ? "3px solid var(--color-primary)"
                      : "3px solid transparent",
                  }}
                >
                  <p style={{
                    color: "#1a1a1a",
                    fontSize: "0.88rem",
                    lineHeight: 1.55,
                    fontWeight: callout.highlight ? 500 : 400,
                  }}>
                    {callout.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
