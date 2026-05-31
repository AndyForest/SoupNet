/**
 * Evidence markdown parser.
 *
 * Parses a freeform evidence textarea into structured entries.
 * Each entry is separated by a blank line and contains:
 *   - Interpretation text (plain lines)
 *   - A direct quote (lines starting with `>`)
 *   - A source citation (lines starting with `--`, `- `, or em-dash)
 *
 * A blank line between an interpretation and its quote/source block does NOT
 * split them: a citation-only block folds back into the preceding entry. See
 * parseEvidenceMarkdown for the exact (conservative) folding rule.
 */

export interface EvidenceEntry {
  interpretation: string;
  quote: string;
  source: string;
}

/**
 * Parse evidence markdown text into structured entries.
 *
 * Format per entry (separated by blank lines):
 * ```
 * Your interpretation of how this supports the claim.
 * > "Direct quote from the source"
 * — Source citation or URL
 * ```
 */
export function parseEvidenceMarkdown(text: string): EvidenceEntry[] {
  if (!text || !text.trim()) return [];

  // Split on blank lines (one or more empty lines)
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim());

  const entries: EvidenceEntry[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const interpretationLines: string[] = [];
    const quoteLines: string[] = [];
    let source = "";

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();

      if (/^\s*>/.test(line)) {
        // Quote line — strip leading whitespace and `>` prefix
        const content = line.replace(/^\s*>\s?/, "").trim();
        if (content) quoteLines.push(content);
      } else if (/^\s*(\u2014|--|[-] )/.test(line)) {
        // Source citation — em dash (U+2014), double dash, or "- "
        source = line.replace(/^\s*(\u2014|--|[-] )\s?/, "").trim();
      } else {
        const trimmed = line.trim();
        if (trimmed) interpretationLines.push(trimmed);
      }
    }

    const entry: EvidenceEntry = {
      interpretation: interpretationLines.join(" "),
      quote: stripOuterQuotes(quoteLines.join(" ")),
      source,
    };

    // Fold an orphaned citation block (quote/source, no interpretation) into
    // the preceding entry when that entry hasn't claimed a citation yet. This
    // keeps the natural Markdown shape — interpretation paragraph, blank line,
    // then its `> quote` / `-- source` block — from fragmenting into an
    // interpretation-only entry plus a "(no interpretation)" orphan. Stays
    // conservative: a further orphaned citation, or one with no preceding
    // entry, is kept standalone so no reference is ever clobbered or dropped.
    const prev = entries[entries.length - 1];
    const isOrphanCitation = !entry.interpretation && Boolean(entry.quote || entry.source);
    if (prev && isOrphanCitation && !prev.quote && !prev.source) {
      prev.quote = entry.quote;
      prev.source = entry.source;
      continue;
    }

    entries.push(entry);
  }

  return entries;
}

/**
 * Strip a single pair of outer matching double-quote marks from a quote
 * string. The canonical evidence format is `> "Direct quote"`, where the
 * surrounding `"` characters are markdown, not content. Storing them in the
 * data means every renderer that wraps with `"..."` produces a doubled
 * `""quote""`. Normalize here so downstream renderers can wrap consistently.
 *
 * Only strips when both ends match — quotes that already lack surrounding
 * marks (some LLMs write `> Direct quote`) are returned unchanged.
 */
function stripOuterQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}
