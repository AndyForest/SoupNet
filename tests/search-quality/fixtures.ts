export interface TestRecipe {
  tag: string; // human-readable identifier
  recipe: string;
  evidenceFor: string;
  category:
    | "design-taste"
    | "technical-judgment"
    | "cross-project"
    | "meta-hypothesis"
    | "cross-archetype";
}

export interface ExpectedMatch {
  queryTag: string;
  query: string; // recipe text used as the search query
  queryEvidenceFor: string;
  shouldMatchTags: string[]; // tags of recipes that should appear in top-5
}

export const TEST_RECIPES: TestRecipe[] = [
  {
    tag: "font-taste-sans-serif",
    recipe:
      "As a UI designer, I prefer sans-serif fonts like Inter and Helvetica for interface text because they feel clean and modern at small sizes.",
    evidenceFor:
      'Consistent preference across multiple web projects.\n> "I always reach for Inter or Helvetica Neue first"\n\u2014 Design system documentation, 2026-01',
    category: "design-taste",
  },
  {
    tag: "font-taste-monospace",
    recipe:
      "As a developer, I prefer JetBrains Mono for code editors because the ligatures improve readability of operators.",
    evidenceFor:
      'Used across VS Code, terminal, and browser dev tools.\n> "JetBrains Mono makes => and !== much easier to read"\n\u2014 Personal setup notes, 2026-02',
    category: "design-taste",
  },
  {
    tag: "coding-environment-preference",
    recipe:
      "As a developer setting up my daily coding environment, I prefer high-contrast themes so that syntax highlighting is immediately readable during long sessions.",
    evidenceFor:
      'Consistent preference across VS Code, terminal, and browser dev tools.\n> "Always configure high-contrast first thing when setting up a new environment"\n\u2014 Setup notes, 2026-02-15',
    category: "design-taste",
  },
  {
    tag: "typescript-judgment",
    recipe:
      "As a backend developer, I chose TypeScript over plain JavaScript for API development so that type errors are caught at compile time rather than runtime.",
    evidenceFor:
      'Multiple production incidents traced to missing type checks in JavaScript code.\n> "We had three outages last quarter caused by undefined being passed where a string was expected"\n\u2014 Incident retrospective, 2026-01-20',
    category: "technical-judgment",
  },
  {
    tag: "hono-over-express",
    recipe:
      "As a backend developer, I chose Hono over Express for new HTTP APIs so that the server stays lightweight and edge-deployable.",
    evidenceFor:
      'Benchmarks show significant throughput improvement with a smaller API surface.\n> "Hono handles requests with less overhead than Express on both Node and edge runtimes"\n\u2014 Internal benchmark, 2026-03-01',
    category: "technical-judgment",
  },
  {
    tag: "file-retention-design",
    recipe:
      "As a beginner designer working on a poster design for my yard sale, I want to keep all of my old working files even though I decided I don't like them so that I can compare my new designs to them and make sure I'm improving my design.",
    evidenceFor:
      'Learning from past iterations helps track improvement.\n> "I want to keep the old ones so I can see if the new ones are actually better"\n\u2014 User in design session, 2026-03-15',
    category: "cross-project",
  },
  {
    tag: "file-retention-dev",
    recipe:
      "As a backend developer working on a Node app, I want my AI agents to ask me about my preferences on data retention for potentially valuable working files rather than assuming defaults.",
    evidenceFor:
      'Checked Claude Code memory files \u2014 no specific data retention preferences found.\n> "No data retention preferences in memory files"\n\u2014 Claude Code memory check, 2026-03-25',
    category: "meta-hypothesis",
  },
  // Cross-archetype fixtures: same topic, different personas
  {
    tag: "color-taste-designer",
    recipe:
      "As a graphic designer, I prefer muted earth tones for professional documents because they convey trustworthiness without being boring.",
    evidenceFor:
      'Consistent across client presentations and marketing materials.\n> "Earth tones tested better than bright colors in our A/B test with corporate clients"\n— Design review, 2026-02',
    category: "cross-archetype",
  },
  {
    tag: "color-taste-teacher",
    recipe:
      "As an elementary school teacher, I prefer bright primary colors for classroom materials because they keep young children engaged and excited to learn.",
    evidenceFor:
      'Observed higher engagement with colorful worksheets.\n> "The kids always pick up the bright red and blue sheets first"\n— Classroom observation notes, 2026-01',
    category: "cross-archetype",
  },
  {
    tag: "color-taste-developer",
    recipe:
      "As a frontend developer, I prefer a neutral color palette with one accent color for admin dashboards because it reduces visual noise and highlights what matters.",
    evidenceFor:
      'User feedback on the analytics dashboard redesign.\n> "The old dashboard had too many colors — I couldn\'t tell what was important"\n— User interview, 2026-03',
    category: "cross-archetype",
  },
  {
    tag: "unrelated-developer-testing",
    recipe:
      "As a developer, I prefer integration tests over unit tests for database code because mocking the database hides real query issues.",
    evidenceFor:
      'Experienced false-positive test suites that passed with mocks but failed in production.\n> "Our mocked tests passed but the actual Postgres query had a type mismatch"\n— Incident postmortem, 2026-02',
    category: "technical-judgment",
  },
];

export const EXPECTED_MATCHES: ExpectedMatch[] = [
  {
    queryTag: "font-query",
    query:
      "As a developer setting up a new project, I want to choose good fonts for both the UI and the code editor.",
    queryEvidenceFor:
      'Looking for font preferences across design and development.\n> "Need to pick fonts for the new project"\n\u2014 Current task',
    shouldMatchTags: ["font-taste-sans-serif", "font-taste-monospace"],
  },
  {
    queryTag: "coding-environment-query",
    query:
      "As a developer setting up a new workstation, I want to find preferences for coding environment themes and display settings.",
    queryEvidenceFor:
      'Checking display preferences.\n> "Setting up new dev environment"\n\u2014 Current task',
    shouldMatchTags: ["coding-environment-preference"],
  },
  {
    queryTag: "file-retention-query",
    query:
      "As a developer, I want to understand preferences about keeping old working files versus cleaning them up.",
    queryEvidenceFor:
      'Data retention question.\n> "Should I keep or delete old files?"\n\u2014 Current task',
    shouldMatchTags: ["file-retention-design", "file-retention-dev"],
  },
  {
    queryTag: "color-cross-archetype-query",
    query:
      "As a project manager choosing colors for a client presentation, I want to find color preferences from people in different roles.",
    queryEvidenceFor:
      'Need to choose a color scheme that works across contexts.\n> "What colors do different people prefer and why?"\n\u2014 Current task',
    shouldMatchTags: [
      "color-taste-designer",
      "color-taste-teacher",
      "color-taste-developer",
    ],
    // Key test: all three color recipes should rank ABOVE unrelated-developer-testing
    // even though the query persona ("project manager") matches none of them.
    // Topic relevance (color preferences) should beat persona matching.
  },
];
