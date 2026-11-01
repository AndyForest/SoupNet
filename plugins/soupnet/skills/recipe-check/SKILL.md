---
name: recipe-check
description: Check and record the person's taste and judgment with Soup.net. Use before a judgment call (naming, wording, design, architecture, a product trade-off), after the person makes a decision worth keeping, and when you need calls they or their collaborators already made. Covers when to check, how to write a recipe in the person's voice, drafts, search, and feedback.
---

# Recipe checks with Soup.net

Soup.net is the log of calls a person and their agents made, with the reasons and the evidence. A recipe check compares your read of the person's position against that log and returns their related past calls; the check itself is recorded, so the next agent starts from what you learned. Read the results as context for your next call, not as rules: when nothing new is on the table, a past call usually stands; when something is, decide, and record your call beside the old one with its own reason.

## Start with the briefing

Call `get_briefing` once at the start of a session. It returns the canonical recipe format, the person's recipe books, and a sample of their recipes, and it is the source of truth when it and this skill differ. Call `list_my_recipe_books` when the topic shifts and you need a different book.

## When to check

1. **Before starting a task.** A broad discovery check: "As a [role] about to work on [topic], I want my AI agent to surface relevant context and suggest approaches before I make decisions."
2. **At a judgment call.** Check the specific decision, with evidence for the position you think the person holds.
3. **After meaningful work.** Record what was chosen and why. This is how the log grows.
4. **Before you wrap up or hand off.** Sweep for related earlier calls the session didn't surface; that is the cheapest moment to catch a contradiction.

Checks are meant to be frequent: reach for one whenever a call comes up, not only for big decisions. Each check records a recipe; the same recipe text, book and key return the recipe already recorded rather than a second one. The one thing to avoid is checking a recipe you don't believe; that degrades results for everyone who reads the log.

## Writing a recipe

A recipe is the person's taste and judgment, not yours:

> As a [role] working on [goal], I [prefer/chose] [position] so that [reason].

- **Role:** the person's functional role, transferable across projects ("a product owner", "a backend maintainer"), not their name and not a project name the book already implies.
- **One judgment per recipe.** Split a sentence that carries two calls.
- **Evidence** says what the claim rests on, so a reader who wasn't there can check it. Each entry is your interpretation, then `> "a direct quote"`, then `-- where it was said`, separated by blank lines. Good evidence: the person's own words, quoted, with where; a recipe that quotes them, by id; a document they approved; their code or artifacts. Your own inference is allowed when you name it as inference.
- **Dated decisions.** When you find a past decision in a dated artifact (a decision record, a commit), set `decided_at` to the artifact's date.

## Drafts

When a call is high-impact and you can't settle it from the context you hold, check it with `draft: true`. A draft is a hypothesis you wouldn't act on without the answer, so don't treat one as confirmed, yours or anyone's; only the person and their agents see it until it is resolved. In the first evidence entry, say why it's a draft rather than a check and what would settle it. When you or another agent acting for the person can settle a draft, resolve it with `verify_draft` (verified, rejected, or not chosen) and new evidence; otherwise hand the person their review queue link from the deposit notice.

## Search versus check

Use `search_recipes` when you need calls already logged, the person's or their collaborators', without a hypothesis of your own: it logs no recipe. Soup.net records the call and what it showed, and an intent you pass is registered or marked as used. Use `get_recipes` to read recipes by id. Use `check_recipe` when you hold a genuine hypothesis about the person's position.

## Close the loop

When a check's results shape a decision, or fail to, record that: attach a feedback row to your next `check_recipe` through its `feedback` parameter, or call `log_feedback` at the end of the work. Confirmations, contradictions, and "nothing relevant came back" are all worth a row; they show the person which recipes earned their keep and help the next agent weigh results.

## Agents you start

If you hand judgment-laden work to another agent, pass these instructions on, with the recipe book in scope, and ask it to report which checks it made and which calls it proceeded on versus left for the person.
