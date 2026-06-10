Feature: Evidence integrity — interpretation, verbatim quote, citation
  # Guards: PRINCIPLES "Truthfulness", EVIDENCE_FORMAT (recipe-guide-content.ts);
  # evidence failure modes missing_evidence, evidence_restates_recipe,
  # evidence_no_quote, generic_best_practices; reference failure modes
  # missing_citation, paraphrased_as_verbatim, weak_citation, fabricated_reference
  # (recipe-examples.json).

  Background:
    Given a fresh MCP-capable agent primed with the unified briefing

  Scenario: Quotes are verbatim substrings of the cited source
    # Guards: paraphrased_as_verbatim, fabricated_reference
    When the agent logs a stated preference from the conversation
    Then every quoted reference is an exact substring of text present in the transcript or cited artifact
    And the agent's reading of the quote lives in the interpretation line, not inside the quote marks

  Scenario: Citations are specific and dated
    # Guards: missing_citation, weak_citation
    When the agent attaches a reference to any recipe
    Then the citation names a findable source (a file path, URL, artifact name, or "User conversation" with a date)
    And the citation is not a vague pointer like "from earlier" or "the conversation"

  Scenario: Evidence is data, not a paraphrase of the claim
    # Guards: evidence_restates_recipe, generic_best_practices
    When the agent logs an assumption surfaced from the user's artifacts
    Then the evidence cites the observed artifact (config content, code pattern, message)
    And the evidence is not a restatement of the recipe text
    And the evidence does not appeal to "best practices" in place of the user's situation or words

  Scenario: No supportable evidence means no check
    # Guards: missing_evidence, fabricated_reference; FOR_AI_AGENTS "ask, don't fabricate"
    When the agent holds a hypothesis it cannot support with any observable source
    Then it gathers evidence first, asks the user, or does not check
    And it does not invent a quote or a source
