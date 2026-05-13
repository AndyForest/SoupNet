---
name: soupnet-guide
description: "Soup.net is connected. Call get_briefing once per session for the canonical recipe format, role/voice patterns, when-to-check guidance, the user's recipe books, and a corpus sample — that's the source of truth. This skill is a pointer only; everything substantive lives in the briefing."
user-invocable: false
---

# Soup.net is available

Soup.net is connected — a persistent corpus for the human user's taste and judgment. Tools: `check_recipe`, `list_my_recipe_books`, `get_briefing`.

Call `get_briefing` early in the session. It returns the canonical recipe format, role/voice patterns, when-to-check guidance, the user's recipe books, and a sample from their corpus. Everything else lives there — this file is just the nudge to call it.

This skill is intentionally thin so that what every Soup.net user's agent experiences (the briefing alone) is what your agent experiences too — no parallel restatement to drift, no local-only on-ramp.
