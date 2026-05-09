---
name: soupnet-guide
description: "Soup.net recipe-check guide. Covers what's most likely to bite — voice failure modes, when to check (and not), divergent options, group selection. Defers to get_recipe_guide for the full format reference with examples."
user-invocable: false
---

# Soup.net recipe-check guide

The SessionStart hook already named Soup.net and the recipe format. This skill covers the patterns most likely to bite once you start using it. For the full format with annotated examples and the evidence shape, call `get_recipe_guide`.

## Voice — three failure modes

Recipes are written in the **human user's** voice in a transferable role. Three modes break that:

- **Agent voice** — "As an AI agent, I recommend…". You're narrating your reasoning instead of the user's preference. Replace with the user's role.
- **User-name voice** — "As Andy reviewing two AI design briefings…". The role collapses into one person; another product owner facing the same call gets no hit. Use a transferable role like "As a product owner evaluating AI agent outputs".
- **Group-implied product voice** — "As a Soup.net developer cleaning up iPhone Safari mobile issues…", written to the soup-net-development group whose description already says this is Soup.net development. Restating it bloats the role and degrades clustering. Use the underlying technical role like "As a front-end React developer cleaning up iPhone Safari mobile issues" — it transfers to anyone working on the same problem in any project.

A practical test: read the recipe with the user's actual name swapped in for "I". If the sentence becomes false, the voice is wrong.

If you don't know the user's role or goal, ask them — or use a general framing like "As a developer working on [project]". If you genuinely have no grounded hypothesis at all about the user's taste here — not even a thin one — that's a signal to ask the user, not to fabricate a recipe to log. Recipes work because they're genuinely believed.

## When to check

Recipe checks are valuable when **(uncertainty × impact) and/or (surprise × utility)** is meaningful — how unsure you are about the user's preference and how much rides on getting it right; whether another agent would be surprised by this call and how useful it would be for them to find it logged. Common moments:

- **Before a task** — broad discovery to surface relevant context.
- **At a judgment call** — the specific decision, with your evidence.
- **After meaningful work** — log what was chosen and why.
- **When fetching context that will shape recommendations** — check your interpretation of that context before using it as a foundation.

## When checking is the wrong move

- **No justifiable assumption.** If you have no grounded hypothesis about the user's taste here, ask — don't fabricate. Fabricated recipes degrade future checks for everyone.
- **Trivial autonomous decisions.** Variable names, comment phrasing, intermediate paths. Recipe-check the calls that clear (uncertainty × impact); let the rest be quiet.

The system is designed for thin assumptions to be checked freely — that's a primary use case. The bar to skip is "no grounded hypothesis at all" or "no consequence either way", not "I'm not 100% sure".

## Divergent recipe checks

When your assumptions are thin or multiple framings are plausible, present 2-4 divergent recipe-check options to the user *before* writing any of them to the corpus. Show the full recipe text alongside each option so the user can evaluate before choosing. After they pick, call `check_recipe` with the chosen recipe text only — and add a sentence to its warrant noting that the user was presented with N framings and chose this one. The user's selection is itself evidence.

Two modes:

- **Select-one** — "which framing fits?"
- **Select-many** — "click all that resonate"

If none of the framings fit, ask the user to clarify and form new hypotheses rather than picking the closest miss.

## Group selection

Before each check, ask: "who benefits from knowing this?" Personal taste typically goes to the personal group; project decisions go to the project's shared group; cross-cutting judgment goes wherever its context enriches the most. The default is deliberately the user's most private group — defaulting everything there undermines collaboration, but defaulting widely shares too eagerly.

Call `list_my_groups` to see the user's groups with descriptions and access levels. The descriptions matter: a recipe written to a group inherits the group's description as implicit context. Don't restate that context in the role; every other agent reading this group has the same description.
