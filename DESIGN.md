---
name: Soup.net — Garden Gallery
colors:
  surface: "#fbfaee"
  surface-dim: "#dddcd0"
  surface-bright: "#ffffff"
  surface-container-lowest: "#ffffff"
  surface-container-low: "#f6f3ea"
  surface-container: "#f0efe3"
  surface-container-high: "#e9e9dd"
  surface-container-highest: "#e4e3d7"
  on-surface: "#1b1c15"
  on-surface-variant: "#5f5e5e"
  inverse-surface: "#1b1c15"
  inverse-on-surface: "#fbfaee"
  outline: "#8a8a7a"
  outline-variant: "#c4c4b4"
  surface-tint: "#051a0f"
  primary: "#051a0f"
  on-primary: "#ffffff"
  primary-container: "#1a2f23"
  on-primary-container: "#ffffff"
  inverse-primary: "#c8d9cf"
  secondary: "#974730"
  on-secondary: "#ffffff"
  secondary-container: "#f4ddd3"
  on-secondary-container: "#3b1a10"
  tertiary: "#2d6a2e"
  on-tertiary: "#ffffff"
  tertiary-container: "#d4e7d4"
  on-tertiary-container: "#0f2a10"
  error: "#ba1a1a"
  on-error: "#ffffff"
  error-container: "#ffdad6"
  on-error-container: "#410002"
  success: "#2d6a2e"
  on-success: "#ffffff"
  background: "#fbfaee"
  on-background: "#1b1c15"
  surface-variant: "#e9e9dd"
  cluster-blue: "#b6c6d8"
  cluster-green: "#c7d9bd"
  cluster-rose: "#e8b9bc"
  cluster-amber: "#e9c79a"
  cluster-teal: "#bfd6d1"
typography:
  display-hero:
    fontFamily: Newsreader
    fontSize: 56px
    fontWeight: "800"
    lineHeight: 62px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Newsreader
    fontSize: 32px
    fontWeight: "700"
    lineHeight: 38px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Newsreader
    fontSize: 24px
    fontWeight: "700"
    lineHeight: 30px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Newsreader
    fontSize: 18px
    fontWeight: "700"
    lineHeight: 24px
  title-md:
    fontFamily: Newsreader
    fontSize: 16px
    fontWeight: "600"
    lineHeight: 22px
  body-lg:
    fontFamily: Newsreader
    fontSize: 18px
    fontWeight: "400"
    lineHeight: 30px
  body-md:
    fontFamily: Newsreader
    fontSize: 16px
    fontWeight: "400"
    lineHeight: 26px
  body-sm:
    fontFamily: Newsreader
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 22px
  label-md:
    fontFamily: Newsreader
    fontSize: 14px
    fontWeight: "600"
    lineHeight: 20px
  label-sm:
    fontFamily: Newsreader
    fontSize: 12px
    fontWeight: "600"
    lineHeight: 16px
  eyebrow:
    fontFamily: Newsreader
    fontSize: 11px
    fontWeight: "600"
    lineHeight: 14px
    letterSpacing: 0.06em
    textTransform: uppercase
  mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: "400"
    lineHeight: 20px
rounded:
  sm: 0.5rem
  DEFAULT: 0.75rem
  md: 0.75rem
  lg: 1rem
  xl: 1rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 44px
  3xl: 64px
  gutter: 24px
  section: 44px
  sidebar-width: 220px
  content-max-width: 960px
elevation:
  level-0:
    backgroundColor: "{colors.surface}"
    shadow: none
  level-1:
    backgroundColor: "{colors.surface-container-low}"
    shadow: none
  level-2:
    backgroundColor: "{colors.surface-container-lowest}"
    shadow: 0 2px 12px rgba(27, 28, 21, 0.04)
  level-focus:
    shadow: 0 0 0 2px rgba(5, 26, 15, 1)
motion:
  duration-fast: 150ms
  easing-standard: cubic-bezier(0.2, 0, 0, 1)
  easing-default: ease
  transition-default: 150ms ease
components:
  app-shell-sidebar:
    backgroundColor: "{colors.surface-container-low}"
    textColor: "{colors.on-surface-variant}"
    width: 220px
    padding: 24px 0
  app-shell-main:
    backgroundColor: "{colors.surface}"
    padding: 32px
    maxWidth: 960px
  nav-link:
    backgroundColor: transparent
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    padding: 9px 16px
  nav-link-hover:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-surface}"
  nav-link-active:
    backgroundColor: "{colors.surface-container-lowest}"
    textColor: "{colors.primary}"
    fontWeight: "600"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    padding: 10px 20px
  button-primary-hover:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    padding: 10px 20px
  button-secondary-hover:
    backgroundColor: "{colors.surface-dim}"
    textColor: "{colors.on-surface}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.secondary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    padding: 6px 12px
  button-ghost-hover:
    backgroundColor: "{colors.surface-container-low}"
    textColor: "{colors.secondary}"
  button-danger:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-error}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    padding: 10px 20px
  input-field:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 10px 14px
    border: none
  input-field-focus:
    backgroundColor: "{colors.surface-container-lowest}"
    shadow: 0 0 0 2px rgba(5, 26, 15, 1)
  input-placeholder:
    textColor: "{colors.outline-variant}"
  form-label:
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
    fontWeight: "500"
  card:
    backgroundColor: "{colors.surface-container-lowest}"
    rounded: "{rounded.lg}"
    padding: 24px
    shadow: none
  card-elevated:
    backgroundColor: "{colors.surface-container-lowest}"
    rounded: "{rounded.lg}"
    padding: 24px
    shadow: 0 2px 12px rgba(27, 28, 21, 0.04)
  callout-panel:
    backgroundColor: "{colors.surface-container-low}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 16px 20px
  metric-tile:
    backgroundColor: "{colors.surface-container-lowest}"
    rounded: "{rounded.lg}"
    padding: 20px
    labelColor: "{colors.on-surface-variant}"
    valueColor: "{colors.primary}"
  metric-label:
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.eyebrow}"
  metric-value:
    textColor: "{colors.primary}"
    typography: "{typography.headline-lg}"
    fontWeight: "700"
  pill:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 2px 10px
  pill-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  pill-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
  segmented-control:
    backgroundColor: transparent
    rounded: "{rounded.full}"
    gap: 4px
  segmented-control-item:
    backgroundColor: transparent
    textColor: "{colors.secondary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    padding: 6px 14px
  segmented-control-item-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  code-block:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-surface}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.md}"
    padding: 16px 20px
  inline-code:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.on-surface}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.sm}"
    padding: 1px 6px
  auth-card:
    backgroundColor: "{colors.surface-container-lowest}"
    rounded: "{rounded.lg}"
    padding: 32px
    maxWidth: 380px
  list-row:
    backgroundColor: transparent
    padding: 14px 0
    borderBottom: 1px solid rgba(196, 196, 180, 0.4)
  list-row-hover:
    backgroundColor: "{colors.surface-container-low}"
  map-cluster-circle:
    fillColor: transparent
    strokeWidth: 1.5px
    strokeOpacity: 0.9
    fillOpacity: 0.35
    labelColor: "{colors.on-surface-variant}"
    labelTypography: "{typography.mono-sm}"
  agent-page-shell:
    backgroundColor: "{colors.surface}"
    maxWidth: 720px
    padding: 32px 24px
    typography: "{typography.body-md}"
  agent-page-header:
    textAlign: center
    typography: "{typography.headline-lg}"
    textColor: "{colors.primary}"
    paddingBottom: 24px
---

## Brand & Style

Soup.net is a stigmergic search engine for the taste and judgment of AI agents — a corpus that grows every time an agent checks a recipe. The product sits at the intersection of "tool for technical people" and "reference library you'd actually want to spend time in." The design system is named **Garden Gallery** — a warm, editorial interface that treats recipes as artefacts worth displaying rather than records in a database.

The brand personality is **calm, literary, and unhurried**. Where most developer tools lean cool-blue and dense-grid, Soup.net leans warm-cream and generously-spaced. The single strongest style signal is the use of a serif (**Newsreader**) for both headlines and body — the page reads like a small-press journal rather than a dashboard. Color is low-saturation and earthy: dark-forest near-black, a single terracotta accent, and a cream canvas that recalls aged paper. Emotionally the interface should feel like a garden gallery at the quiet edge of opening hours: curated, intentional, with room to think.

## Colors

The palette is deliberately small. One dark neutral does the work of "primary" and all strong typography; one warm accent does the work of every interactive link and secondary brand moment; everything else is tonal variants of the cream surface.

- **Primary — Ink (`#051a0f`)** is a near-black with a faint green cast. Used for logo wordmark, every headline, primary CTAs, focus rings, active nav state, and metric values. Its hover/pressed variant (`primary-container`, `#1a2f23`) is only a shade lighter — buttons feel weighted and quiet rather than springy.
- **Secondary — Terracotta (`#974730`)** is the only saturated hue that touches body text. Reserved for inline links, ghost buttons, small accent marks (the "Research →" link in the sidebar footer, the "Register" link inside the login card), and brand flourishes. It is never used as a fill on a large surface.
- **Surfaces** step through five cream tints from pure white (`surface-container-lowest`) up to a dusty oatmeal (`surface-container-highest`). The default canvas is `#fbfaee`, the sidebar sits one step lighter at `#f6f3ea`, cards sit on pure white, and inputs use `surface-container-high` so they feel recessed into the page rather than floated above it.
- **Data accents** (used only on the Recipe Map page) are muted pastels — sage green, dusty rose, slate blue, amber, and seafoam. They are drawn with semi-transparent fills and thin strokes so the map reads as a botanical plate rather than a data-viz dashboard.
- **Semantic** colors (`error`, `success`) are standard but used sparingly; most system feedback comes through copy rather than color.

Contrast targets: all body text sits on surface tints at or above WCAG AA (14pt+ large body meets AAA against `surface`). On-surface-variant (`#5f5e5e`) is the default for secondary copy and labels.

## Typography

The system uses **Newsreader** for everything that isn't code. Newsreader is a free contemporary serif optimised for on-screen reading — the characters have open counters and slightly mechanical terminals that keep a serif from feeling "old." Pairing it with itself across display and body is the signature move: no sans-serif escape hatch, no UI font.

- **Headlines** use weight 700–800 with tight tracking (−0.01 to −0.03em) and shorter line-heights (1.1–1.2) to let the serifs settle.
- **Body copy** is generous: 16px / 1.65 line-height by default, with long-form pages (Terms, Privacy, Docs) bumping body up to 18px / 1.65. The combination of serif + long leading is the main reason the app reads as "a document" rather than "a screen."
- **Labels and eyebrows** invert the feel: uppercase, 0.06em tracking, 600 weight, and the subdued `on-surface-variant` color. These pin down metric tiles and form fields.
- **Code** falls through to **JetBrains Mono** at ~13px. It appears in the recipe-format example on the landing page, in inline docs, and in the admin queues view.

Italics are used rarely, mostly for inline emphasis in landing copy and for the body tag of recipe examples.

## Layout & Spacing

The layout is a **fixed left sidebar + centred content column**, bounded to 960px on large screens. Negative space is the single most important layout tool — the content column rarely fills the viewport even at standard desktop sizes, and that emptiness is intentional.

- **Rhythm:** 8px base. The scale jumps 4 / 8 / 16 / 24 / 32 / 44 / 64, with 24 and 44 doing the heavy lifting. Card-internal padding is 24px; section separation is 44px.
- **Sidebar:** 220px fixed on desktop. On mobile it's replaced by a horizontal bottom bar at the viewport edge; there is no hamburger.
- **Content max-width:** 960px. Long-form pages (landing, terms) narrow further to ~720px for readability.
- **Auth cards and marketing cards** are centre-aligned within generous outer margins, so the cream background reads as a framed mount around the content.
- **Grid:** the dashboard and landing page use a simple 1 / 2 / 3-column responsive grid that collapses to a single column below 600px to prevent the 2+1 orphan layout.

## Elevation & Depth

Depth is expressed through **tonal surface layering**, not shadows and borders. A card is "above" its background because it is a shade lighter, not because it has a stroke or a drop-shadow. The design deliberately avoids the stacked-paper look; it reaches for the look of ink on a single sheet.

- **Level 0 — Canvas:** The page background (`surface`, `#fbfaee`). Never has content sit directly on it at close range; always step up.
- **Level 1 — Inset regions:** Sidebar and collapsed panels use `surface-container-low`. These are "lower" than the canvas only by a single tone shift and read as quiet recesses.
- **Level 2 — Cards:** Pure white (`surface-container-lowest`) with either no shadow or an almost-imperceptible one (`0 2px 12px rgba(27, 28, 21, 0.04)`). Cards are never stroked.
- **Focus ring:** a 2px solid Ink outline, inset via `box-shadow`, on inputs and interactive controls. This is the one place the primary color asserts itself at form-control scale.
- **Hover state:** for rows and nav, hover promotes the surface tint one step lighter toward white. For buttons, hover shifts `primary` to `primary-container` — a 5-point value change, barely visible but tactile.

There are effectively no drop shadows on the product. Modals and floating menus, when they appear, lean on the same tonal-lift pattern with a slightly stronger shadow (≤ 8% alpha).

## Shapes

The shape language is **softly rounded, non-geometric**. Radii are small enough to read as "considered corners" rather than "pillow buttons" — the design never looks inflated.

- **Buttons and nav items** use `rounded-md` (12px). Primary CTAs look like pebbles — rounded but still with a clear long axis.
- **Cards** use `rounded-lg` (16px).
- **Pills, segmented controls, and the logout button** use `rounded-full`.
- **Inputs** use `rounded-md` (12px).
- **Icons** are line-based, stroke-width 1.5–2px, rounded caps and joins. They match the 18px nav size and 14px inline size. Icon colour tracks the surrounding text colour (no standalone icon tints).

The segmented control on the Recipe Map (the Discovery / Concept Axes toggle) is the one place where the primary color takes a full fill — a small black pill inside a transparent track, with the inactive label rendered in the terracotta secondary.

## Motion

Motion is minimal. The system intentionally does not use page-level transitions or reveal animations; every change is instantaneous except for:

- **Hover / focus:** 150ms ease on `background`, `color`, and `box-shadow`. Nothing longer.
- **Links:** colour change only; no underline animation.
- **Map canvas:** physics-based repositioning of cluster circles when the cluster-count slider changes — the one place motion is actually expressive, and it's driven by data rather than decoration.

The emotional reading is "library, not app" — the interface is meant to feel still.

## Components

### Application shell

A two-part shell: a fixed 220px sidebar on the left and a centred content column on the right. The sidebar contains a wordmark logo at the top ("Soup.net", 800-weight serif, tight tracking), a column of nav links with inline 18px icons, and a footer with a small terracotta "Research →" link and a full-width dark "Sign out" pill. The active nav item inverts: white pill behind it, Ink text inside. On mobile the sidebar disappears entirely and is replaced by an icon-only bottom bar.

### Buttons

Four flavours — primary (Ink fill), secondary (`surface-container-high` fill, dark text), ghost (terracotta text on transparent), and danger (error fill). All use `rounded-md`, 10/20 padding, and the label type style. Primary CTAs pair almost exclusively with a secondary sibling in the same row ("Sign in / Create account", "Copy web briefing / Copy MCP briefing"); standalone primaries are rare.

### Inputs and forms

Inputs sit in `surface-container-high` with no border, a 12px radius, and a 14px body font. Focus promotes the background to pure white and adds the 2px Ink focus ring. Labels sit directly above at 85% of body size, 500 weight, in the muted `on-surface-variant` — they feel like captions rather than form furniture.

### Auth cards

Every auth state (login, register, forgot, reset, verify, verify-pending) uses the same white card on cream background, centred in the viewport, ~380px wide. The card's header is the Soup.net wordmark + the tagline "Taste and judgment for AI agents" in terracotta.

### Dashboard metric tiles

Three equal tiles across the top of the dashboard, each showing an uppercase eyebrow label ("RECIPES CHECKED", "ACTIVE KEYS", "GROUPS") in muted grey above a very large serif number in Ink. No units, no sparklines, no "vs last week" comparisons — just the count.

### Recipe check log / tables

Tabular content uses row-separator lines in `outline-variant` at 40% opacity rather than full-width dividers. No zebra striping. Row hover promotes the background to `surface-container-low`.

### Recipe Map

A canvas visualisation sitting inside a white card. Clusters are drawn as thin-stroked circles with 35%-opacity pastel fills (the five cluster accent colours), a central filled dot in the stroke colour, and a mono-font label below the circle ("103 recipes"). Zoom and download controls sit in the bottom-left as small square secondary buttons. A segmented control at the top toggles between "Discovery" (the default) and "Concept Axes" views; a slider controls the cluster count with a terracotta thumb on an Ink track.

### Pills and callouts

Pills are used as group-access indicators ("read", "write", "default write target"), verification states, and plan markers. They are always type-label-sm, rounded-full, with a subdued surface fill. A "callout panel" variant (used for the "AI agents use a dedicated page…" notice on the Check page) uses `surface-container-low` as a tinted horizontal band with a single inline CTA, no border, no icon.

## Agent-Facing Surfaces

Soup.net has two consumers: humans browsing the SPA at `soup.net`, and AI agents reading backend HTML at `mcp.soup.net`. Both share the same Garden Gallery palette, type ramp, and emotional register — but the agent-facing surfaces are deliberately stripped of the chrome that humans need (sidebars, hover states, interactive widgets) because the consumer is `fetch` + parse, not eyes + cursor.

### Same language, different chrome

- **Same palette** — cream `surface`, Ink primary, terracotta secondary. No new colours; the agent-facing pages should look like they belong on the same shelf as the SPA.
- **Same typography** — Newsreader serif throughout, JetBrains Mono for code. Agents parse text either way; using the same fonts means a screenshot of either surface reads as the same brand.
- **Same flatness** — no drop shadows; tonal layering only. The agent-facing pages have less to layer (no cards, no popovers) so they read even flatter.

### What the agent-facing pages drop

- **The application shell.** No fixed sidebar, no nav, no footer. A single centred column maxed at ~720px (narrower than the SPA's 960px since these are dense long-form text).
- **Interactive widgets.** No pills, no segmented controls, no hover-promoted rows. Buttons exist on the recipe-check page but are simple form controls, not decorated CTAs.
- **Card containers.** Content sits directly on the cream canvas. Sections are separated by spacing, not by surface lifts.
- **Imagery.** No hand-drawn illustrations; no decorative motifs. The page is text-and-pre.

### What the agent-facing pages emphasize

- **Header** — centred wordmark + page title in `headline-lg`, sitting on a thin separator. The page title carries the en-dash separator from the wordmark ("Soup.net — Recipe Check Guide").
- **Content density** — body type holds the same size and leading as the SPA, but with no surrounding whitespace luxury. Pages are designed to be parsed in a single pass without scrolling fatigue.
- **Code and pre-blocks** carry the visible weight that buttons and metric tiles carry on the SPA. They use `surface-container` fill, JetBrains Mono, and clearly delineate copy-pasteable config from prose.
- **Tables and definition lists** appear where the SPA would use card grids. The shape language stays soft (`rounded-md` for code blocks; tables use the same row-separator pattern as SPA log tables), but the structure is denser.
- **Internal links** stay terracotta — agents read these as cross-references between docs (recipe-check guide → recipe scenarios → MCP setup → bootstrap), and the colour signals "go look here next."

The result is an aesthetic family: the SPA is a hardcover book, the agent-facing pages are the appendices in the same book — same paper, same ink, same typeface, less furniture.

## Iconography & Imagery

Icons follow a single Lucide-style line set: 1.5–2px stroke, rounded joins, 18px in navigation and 14–16px inline. Colour is always inherited from surrounding text; icons never introduce their own hue.

The landing page uses three hand-drawn-feeling illustrations (a person across a desk from a robot; three people holding puzzle pieces; a small story carousel of "divergent / results / synthesis" frames). They are tonally aligned with the cream-and-ink palette — muted ochre, sage, and terracotta line-work with minimal fills. The product pages contain no decorative imagery; all visual weight comes from typography and tonal layering.

## Tone notes for generative work

- **Do** lean into the serif. If a new screen is drafted in a sans, it will look wrong next to the rest of the system within two seconds.
- **Do** use tonal steps (lighter cream → white) in place of borders. Almost no element in this system has a stroke.
- **Do** keep CTAs paired and restrained. The rhythm across the product is "one primary, one quiet sibling."
- **Do** treat the agent-facing pages as part of the same family — don't reach for a different palette or font just because the consumer is a machine. The continuity is the brand.
- **Don't** introduce additional accent hues. The single terracotta is load-bearing; a second accent will immediately read as noise.
- **Don't** add drop shadows, gradients, or glassmorphism. The aesthetic is flat, warm, and physical in the "ink on paper" sense, not in the "frosted-glass iOS" sense.
- **Don't** use iconography as decoration. Icons are always alongside a text label and are sized to match the label's line height.
