---
name: seed-from-history
description: Optional idea for giving a Soup.net recipe book a start from decisions already made, when the person asks to bring in past calls from notes, documents, commits or old conversations, or has a thin book and such material to hand. Covers dating, evidence and whose material it is. Not for logging a decision made now; check that as usual.
---

# Seeding a recipe book from history

A suggestion, for you and the person to weigh. Which sources, how much and how you go through them are yours to work out. An empty book returns nothing, so a few real past calls can make the next check useful straight away.

**Worth the person's say first.** Each check logs a real recipe, and everyone who reads that book can see it, so which book it goes to and what's in bounds are their call.

**What tends to be worth bringing in.** Dated choices with a reason, wherever they turn up: commit messages, decision records, review comments, notes. Facts and status belong in their own home; Soup.net holds the judgment about them.

**What makes a backfilled recipe hold up.**
- `decided_at` set to the artifact's date, so it reads as a past call. Left off, a recipe counts as decided now.
- The artifact quoted verbatim, with its date, hash or location as the citation, so a reader can check it.
- A reconstructed reason named as your inference. If you wouldn't act on the reading, `draft: true` leaves it for the person to settle.
- A later change of mind kept as its own recipe with its own reason, rather than merged into the old one.

**Other people's material.** A person's own words and choices are theirs to carry. A former employer's or client's code, data and internal details, and other people's names, usually aren't. Keeping the transferable role and technique, and asking where the line sits, tends to protect both.

**Trying a few first.** Showing the person a handful catches voice and scope problems cheaply. The same recipe text, book and key return the recipe already recorded, so re-running a source won't duplicate it.
