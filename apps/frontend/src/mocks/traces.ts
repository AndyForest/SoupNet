/**
 * Realistic mock trace data for development.
 * Used as fallback when the /traces endpoint isn't available yet.
 */

export interface MockTrace {
  id: string;
  claimText: string;
  groupId: string;
  apiKeyId: string | null;
  formatAdherenceScore: number | null;
  createdAt: string;
  updatedAt: string;
  evidenceCount: number;
  referenceCount: number;
  groupName: string;
  apiKeyLabel: string | null;
}

export const mockTraces: MockTrace[] = [
  {
    id: "a1b2c3d4-0001-4000-8000-000000000001",
    claimText: "As a frontend developer, I prefer Radix primitives over Material UI because they give styling control without fighting the framework's opinions",
    groupId: "g1",
    apiKeyId: "k1",
    formatAdherenceScore: 0.92,
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    evidenceCount: 3,
    referenceCount: 4,
    groupName: "Default",
    apiKeyLabel: "Claude (VS Code)",
  },
  {
    id: "a1b2c3d4-0001-4000-8000-000000000002",
    claimText: "Our brand voice should feel like a knowledgeable friend, not a corporate advisor — warm but precise",
    groupId: "g1",
    apiKeyId: "k2",
    formatAdherenceScore: 0.88,
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    evidenceCount: 5,
    referenceCount: 2,
    groupName: "Brand Team",
    apiKeyLabel: "GPT-4 (Cursor)",
  },
  {
    id: "a1b2c3d4-0001-4000-8000-000000000003",
    claimText: "For data tables with more than 50 rows, virtual scrolling outperforms pagination in user satisfaction",
    groupId: "g1",
    apiKeyId: "k1",
    formatAdherenceScore: 0.85,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    evidenceCount: 3,
    referenceCount: 5,
    groupName: "Default",
    apiKeyLabel: "Claude (CLI)",
  },
  {
    id: "a1b2c3d4-0001-4000-8000-000000000004",
    claimText: "Muted earth tones tested better than bright primaries for professional service websites targeting 35-55 age group",
    groupId: "g1",
    apiKeyId: "k1",
    formatAdherenceScore: 0.79,
    createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    evidenceCount: 2,
    referenceCount: 3,
    groupName: "Default",
    apiKeyLabel: "Claude (VS Code)",
  },
  {
    id: "a1b2c3d4-0001-4000-8000-000000000005",
    claimText: "Interview transcripts should be stored as indexed references, not full content — the source recording is the truth",
    groupId: "g2",
    apiKeyId: "k2",
    formatAdherenceScore: 0.91,
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    evidenceCount: 4,
    referenceCount: 2,
    groupName: "Research",
    apiKeyLabel: "GPT-4 (API)",
  },
];

export interface MockTraceDetail {
  id: string;
  claimText: string;
  groupId: string;
  apiKeyId: string | null;
  formatAdherenceScore: number | null;
  createdAt: string;
  updatedAt: string;
  groupName: string;
  apiKeyLabel: string | null;
  evidence: Array<{
    id: string;
    content: string;
    createdAt: string;
  }>;
  references: Array<{
    id: string;
    quote: string;
    source: string;
    createdAt: string;
  }>;
  evidenceReferences: Array<{
    evidenceId: string;
    referenceId: string;
  }>;
}

export const mockTraceDetail: MockTraceDetail = {
  id: "a1b2c3d4-0001-4000-8000-000000000001",
  claimText: "As a frontend developer, I prefer Radix primitives over Material UI because they give styling control without fighting the framework's opinions",
  groupId: "g1",
  apiKeyId: "k1",
  formatAdherenceScore: 0.92,
  createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  groupName: "Default",
  apiKeyLabel: "Claude (VS Code)",
  evidence: [
    {
      id: "e1",
      content: "Radix components ship unstyled, which means your design system isn't fighting two opinion layers",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "e2",
      content: "Material UI's theme override system creates coupling between component internals and your customization",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "e3",
      content: "Accessibility is built into Radix primitives without requiring manual ARIA attribute management",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "e4",
      content: "Material UI has a larger ecosystem with more pre-built components and community resources",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
  ],
  references: [
    {
      id: "r1",
      quote: "Radix Primitives are unstyled, accessible components for building high-quality design systems and web apps in React.",
      source: "radix-ui.com/primitives/docs/overview/introduction",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "r2",
      quote: "To customize a specific part of a component, you can use the class name provided by Material UI inside the sx prop or styled().",
      source: "mui.com/material-ui/customization/how-to-customize",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
  ],
  evidenceReferences: [
    { evidenceId: "e1", referenceId: "r1" },
    { evidenceId: "e2", referenceId: "r2" },
  ],
};
