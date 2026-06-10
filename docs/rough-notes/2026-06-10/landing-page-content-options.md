# Landing page — content options exploration

> **Rough note (2026-06-10).** Options for consideration, not decisions. Sources: operator feedback (2026-06-10 session), the shipped challenge section, direct examination of all six landing illustrations, the live nav/route inventory, and the existing corpus recipes that bear on landing framing (`3eb59c29` agent-as-primary-user, `934a4e72` Step 3 constellation).

## 1. The narrative arc as it stands today

| # | Section | Job it does | Framing |
|---|---|---|---|
| 1 | Hero | Identity + promise ("Your taste and judgment, in every AI agent you use") | Positive |
| 2 | **Challenge (new)** | Problem: agents work unattended for hours; judgment calls accumulate without you | **Negative → bridge** |
| 3 | Pillar 1 (cross-vendor) | Solution headline… on problem imagery (papers abandoned outside the door, robot agent) | **Mismatch** |
| 4 | Pillar 2 (collaboration) | Solution headline… on problem imagery (puzzle pieces that don't connect) | **Mismatch** |
| 5 | Walkthrough (3 steps + "+") | Mechanism, positive, glowing-agent visual language | Positive |
| 6 | HowItWorks teaser | Depth path | Neutral |
| 7 | Story carousel | Proof / demonstration | Positive |
| 8 | CTA | Close | Positive |

**The felt awkwardness, diagnosed.** Before the challenge section existed, the pillars carried the page's problem-framing — their negative images were load-bearing. Now the challenge section does that job better (it has the log as evidence), and the pillars read as a regression in the arc: problem → *problem again, under solution headlines* → solution. The captions sharpen the mismatch: Pillar 1's headline says "One recipe book, every agent you use" while its caption says "Every new agent, every new session — starting from scratch."

**Visual-language audit (from examining the actual PNGs):**

- **Pillar 1 (blank-slate):** man converses with a **hard white robot** at a laptop; his accumulated decision sheets (GRAPHIC DESIGN, Code Style, For Launch, Trusted Libraries) lie scattered on the floor *outside the door*. Strong problem image. But the robot predates the established agent motif — every walkthrough image renders the agent as a **soft glowing humanoid**. Two different "what an AI agent looks like" languages on one page.
- **Pillar 2 (new-team):** three humans hold puzzle pieces ("Preferences", "Decisions", a map) that don't connect. No agents anywhere in the art — **the alt text claims "their AI agents present, ready to participate," which the artwork doesn't depict** (alt-text drift; fix regardless of direction chosen).
- **Walkthrough 1-3 + "+":** consistent and good — glowing agent, golden marks flowing into a **soup bowl** (the vessel pun lands), then the constellation/cluster map (matches the logged Step-3 recipe `934a4e72`), then mirrored collaborators sharing a central constellation.
- **Notable:** the shared-book ("+") image is a *resolved* version of Pillar 2's puzzle problem — two people, their own agents, clusters connecting through the center. The solution image for Pillar 2 already exists; it's just being used five sections later.

## 2. Candidate key points — considered, rejected, and newly proposed

### 2a. What I considered and rejected for the shipped challenge section (and why each might deserve a comeback)

| Point | Why rejected | Why it might belong anyway |
|---|---|---|
| The word "stigmergy" on the landing page | Jargon; landing already avoids it | It's memorable and ownable; could live in a Q&A expander as a "for the curious" payoff |
| Naming memory competitors (Mem0, Zep, MemPalace, vendor products) | Dates fast; punches sideways; invites comparison-shopping | Concreteness converts; "the markdown memory file in your repo" already gestures there and tested fine |
| Agent-adoption statistics beyond METR | Unverifiable, churny | One well-sourced number anchors credibility — METR link covers this |
| Fear framing ("AI will drift from your values") | Alarmist, off-brand for warm watercolor identity | A *recognition* version (see "This happened to you?" below) gets the energy without the fear |
| The reasoning-trace gap as landing copy | Too technical for a first screen | Strongest possible content for HowItWorks; a one-line landing echo ("your agent's reasons evaporate one turn after it decides") is viable in an expander |
| Live check-log embed instead of static mock | Auth complexity, empty-state problem for visitors | A real log is the most honest proof; revisit post-signup (dashboard already has it) |

### 2b. Operator-proposed points, elaborated

**1. "The main user is your AI agent — you do almost nothing."**
The zero-effort property is arguably *the* adoption lesson of ChatGPT/Claude Code: instantly productive, no instructions, no setup ritual. The current hero gestures at it ("The recipe book builds itself") but doesn't claim it outright. Candidate copy: *"Soup.net's main user isn't you — it's your agents. They do the briefing, the checking, the logging. You just keep making the calls you were already making."* Risks: slight overclaim for the web-only path (humans click links); needs the agency point (below) alongside it or "you do nothing" reads as "you're not needed."
*Where:* hero subhead or challenge-section bridge sentence. Corpus support: recipe `3eb59c29` (agent as primary day-to-day user, human as overseer) — this point is already logged taste; the landing just doesn't say it loudly yet.

**2. "Empowered by AI vs replaced by AI = who makes the taste and judgment calls."**
The strongest new copy in the batch. It answers the anxiety the METR framing creates — the challenge section currently says "agents are doing more and more on their own" and resolves it with *alignment*; this resolves it with *agency*, which is more human and more differentiating (no memory product talks about agency). **Operator correction (2026-06-10, recipe `90f87ce6`): the framing must be compounding, not zero-sum.** "Don't sacrifice your agency for productivity — you can have both" implies you merely keep what automation would take; the real claim is that using Soup.net, exercising your taste and judgment is what makes your agents more productive — both rise together. Candidate copy in that spirit: *"Your judgment is what makes your agents good. Use it, and productivity and agency rise together."* Placements: CTA heading, the challenge section's closing line, or the hero. Risk: "agency" is slightly abstract for non-technical users — pair with the concrete version ("you make the calls; your agents carry them").

**3. The three deciders (UVP as decision frames).**
- *Might you ever try a different AI agent?* → start now; it collects your taste and judgment calls as you work, zero effort, and they travel with you.
- *Might you work with other people who use AI?* → start now; you'll have recipe books ready to share when it's useful.
- *Do you find yourself explaining your taste and judgment calls to other people?* → that's the signal your agent should be telling their agent directly.
These are the lasting-UVP items (cross-vendor portability, cross-vendor collaboration) rewritten as **questions a visitor can answer about themselves** — which is what a landing page needs deciders to be. The third one is new in kind: it's a *detector* ("if X keeps happening to you, this is for you"). Candidate: a compact "Is this for you?" strip of the three questions, possibly replacing or absorbing the pillar bodies. Also: these belong in design-thinking's UVP section regardless of landing use (rolled up separately — see §5).

**4. "This happened to you?" recognition hooks.**
*"Your agent assumed you wanted the generic version. Again."* / *"You've told it you prefer it this way. Three times."* Recognition beats explanation for hooking; these are the moments the blank-slate illustration depicts in still life. Options: (a) lead the challenge section's expanders with them, (b) a rotating one-liner above the log mock, (c) captions for problem imagery if it consolidates into the challenge section. Tone risk: snark — keep the warmth (the "Again." does the work; no exclamation marks).

**5. The AI-maturity journey (the "AI First developer" frustration).**
Partially captured in design-thinking §Bridging the AI maturity gap, but the operator's elaboration adds genuinely new elements that section lacks: collaborators must do **two things that are learn-by-doing, not learn-by-telling** (discover AI tools for their needs; develop workflows that integrate them); org-level directives are slow capacity-building; and the unlock is that **agents themselves are AI-capable with infinite patience** — they meet each person wherever they are on the journey. The concrete example: *you're looking at the end product — why is it green? Maybe the design doc says. If not, you know who to ask — but is that the best use of your limited time together? If you're AI-mature you send agents through the docs, email, Slack. What if you're not?* With Soup.net the answer arrives because the maturer collaborator's agent already logged the call, and your agent — whatever it is — finds it.
*Where:* design-thinking expansion (rolled up separately); on the landing page this is Pillar 2's real story, told from the frustrated power-user's side. Pillar 2's copy currently tells it abstractly; the green-button example would make it concrete.

**6. The software-bottleneck shift (the "why" behind the end product).**
As AI makes writing software cheap, the bottleneck moves to review, PRs, and the discussions about *what we want and why*. Documentation is a **golden-set** method — it records what's true now, expensively; PRs/ADRs record decisions only if the author thought to write them, and drift without a maintenance system; Jira/Notion hold transactional history but are **designed for human attention spans, cognitive limits, and UIs**. The agents doing the work have different capabilities and different limitations — Soup.net designs the decision log for *them*: cheap to write at the moment of decision, retrieved by meaning rather than by knowing where to look, carrying evidence so staleness is assessable. This also explains why decision archaeology (git blame → `decided_at`) works: the transactional history was always there; it just wasn't queryable by judgment.
*Where:* design-thinking §Strategic Differentiation (rolled up separately); HowItWorks deserves the full version; landing gets at most one expander line for the dev audience — see the persona tension below.

**7. Laser-targeting taste/judgment as a deliberate scope choice.**
"Memory systems try to persist everything; we persist the one thing that can't be regenerated — the call you made and why." Already half-present in the challenge section's memory expander; could be promoted to body copy. Pairs with the architecture point (next).

**8. The architecture honesty point (agents do the heavy lifting; server does cheap math).**
Design choice: no LLM on the server, computationally cheap embeddings, maximize utility per cost — that's *why* it's free at scale, and why "your agent does all the work" is literal. Future: optional server-side LLM librarian/research-assistant for agents (already sketched in monetization hypotheses). *Where:* HowItWorks already has "How we keep it free at scale"; landing could add a single expander Q ("How is this free?") since cost-suspicion is a real adoption objection.

**9. Persona check: does everyone see themselves?**
Current landing voice skews technical: hero mentions Claude Code/ChatGPT/Gemini (good — recognizable), but the challenge log mock is 3 developer entries + 1 product-copy + 1 typography. The corpus's own exemplars are richer (fundraiser coordination, birthday party, design taste). Options: (a) diversify the log mock (swap one dev entry for the fundraiser-poster recipe and one for a family/event call), (b) ensure each expander has one non-code example, (c) audit "is it too hard to set up?" objection — the walkthrough's "What if I'm just starting?" answer covers it but is buried in Step 1; the concierge idea (see backlog) is the real fix.

## 3. Composition options for the pillar problem

**Option A — Surgical consolidation (recommended).**
Move problem imagery into the problem section; give solution sections solution imagery:
1. Challenge section gains the **blank-slate** image (papers outside the door) beside or beneath the log mock — the log shows what accumulates *with* Soup.net; blank-slate shows the without. Caption: a "This happened to you?" hook.
2. Pillar 2 takes the **shared-book** image (it literally resolves Pillar 2's puzzle metaphor); Step "+" gets a new commission later (or temporarily goes text-only — its body already says "the same three steps").
3. Pillar 1 needs one new positive image (briefing/constellation family, glowing-agent motif): e.g., the same person at phone-laptop-tablet with one constellation spanning all three. Until commissioned, Pillar 1 could run imageless or borrow context-returning… borrowing weakens Step 3; prefer commissioning one image.
4. Retire the robot entirely (visual-language consistency: agents are glowing figures) and the new-team puzzle image (or keep it in HowItWorks where fuller explanation supports it).
Effort: 1-2 new illustrations + copy/caption touch-ups. Keeps all section headlines and most copy.

**Option B — Reframe in place (cheapest).**
Keep both images where they are; change captions and the first body sentence to explicit before/after framing ("Without a shared recipe book: …"). Honest, fast, but preserves the arc regression and the robot inconsistency. Worth doing *only* as a stopgap if Option A's illustrations take time.

**Option C — Merge and rebuild (most out-of-the-box).**
Collapse Challenge + both pillars into one continuous "The situation → what changes" block: challenge text + log mock + blank-slate as the *situation*; then a tight three-card "what changes" row (one recipe book everywhere · collaborators' agents share it · meets everyone at their AI maturity) each with one line and one small positive visual, feeding directly into the walkthrough. Kills the duplicate problem-framing entirely and shortens the page. Effort: real restructuring + new art; the carousel and walkthrough stay. Choose this if the three-deciders strip (2b.3) is adopted — the cards and deciders merge naturally.

**Recommendation:** A now (with B's caption fix as the interim while art is commissioned), C as the shape to grow toward if/when the three-deciders strip is adopted.

**DECIDED (operator, 2026-06-10): Option A.** Additional decision in the same pass: the static check-log mock in the challenge section is rejected — "that's for agents, not humans; too technical, scary to show as the first thing" — an illustration replaces it. Image briefs are being written one at a time: [Brief 1 (challenge "unattended hours")](image-brief-1-challenge-unattended-work.md) is ready; Brief 2 (Pillar 1 positive, cross-vendor constellation) and Brief 3 (Step "+" replacement, AI-maturity variant) queued.

## 4. Illustration briefs implied (if A or C chosen)

1. **Pillar 1 positive:** one person, three devices (phone/laptop/tablet), one glowing constellation arcing across all three; glowing-agent motif optional; soup-bowl cameo welcome. Mood: the *with* version of blank-slate.
2. **Step "+" replacement (if shared-book moves to Pillar 2):** could go closer to the AI-maturity story — two collaborators at visibly different comfort levels (one at an IDE, one at a phone chat), both agents reaching the same constellation.
3. **Challenge-section hook art (optional):** blank-slate reused as-is, or a night-shift variant: glowing agent working alone at the desk, human's empty chair, decision marks rising with nowhere to land.

## 5. Roll-up destinations (tracked outside this note)

- Three deciders + agency framing + bottleneck-shift + maturity elaboration → `design-thinking.md` (UVP/Strategic Differentiation + maturity section).
- Concierge / setup wizard idea → backlog `[DESIGN]`.
- Nav rule-of-7 regrouping → backlog `[DESIGN]`.
- Alt-text drift on Pillar 2 → trivial fix with whichever composition option ships.
- Persona-diverse log mock entries → small copy PR, can ship independently.
