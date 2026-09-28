# PR review helpers research, track 3: the human side of review

Research track for the PR review helpers plan: what human code review actually achieves, how reviewers get matched to changes, what attention and latency research says, how teams receive AI review comments, and why design rationale capture keeps failing. Every fact below is a verbatim quote with a link. Interpretation is marked as such. Anything not verified against the primary text is marked "unverified".

## Key findings for the plan

- **Review's realized value is understanding and rationale, not defect finding, so a sweep agent's questions should target the "why".** Microsoft found reviews "are less about defects than expected" and that "code and change understanding is the key aspect of code reviewing" ([Bacchelli and Bird 2013](https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/)). Google names missing rationale as a breakdown: "misunderstandings can arise based on not knowing what gave rise to the change" ([Sadowski et al. 2018](https://sback.it/publications/icse2018seip.pdf)). A draft recipe is a question about exactly that gap.
- **The comments AI reviewers get wrong are disproportionately judgment calls, which is the niche drafts fill.** Across 54,791 agent comments, unresolved ones were most often "*incorrect suggestions* and *intentional design decisions*" ([Cynthia et al. 2026](https://arxiv.org/abs/2607.21997v1)); CodeRabbit rejections tied to "misalignment with developer intent and coding practices" ([Lin et al. 2026](https://arxiv.org/abs/2607.03316)); design comments resolve less often than readability and bug comments ([Goldman et al. 2025](https://arxiv.org/abs/2510.05450)). Better approach: when the sweep agent meets an intentional-looking deviation, it asks the decider (draft) instead of posting a correction comment, and the answer suppresses the same question on the next PR.
- **Noise spends trust faster than signal earns it, so precision beats coverage.** Google calibrated ML review edits to "a target precision of 50%" because "Incorrect suggested edits take the developers time and reduce the developers' trust in the feature" ([Google Research blog](https://research.google/blog/resolving-code-review-comments-with-ml/)). CodeRabbit comments: "36.4% were accepted and 7.3% triggered discussion, while 56.3% were rejected" ([Lin et al. 2026](https://arxiv.org/abs/2607.03316)). Developers: "46% of developers said they don't trust the accuracy of the output from AI tools" ([Stack Overflow 2025](https://stackoverflow.co/company/press/archive/stack-overflow-2025-developer-survey/)).
- **Short, concrete, answerable questions get acted on; long ones do not.** "the presence of an inline *code suggestion* is the strongest predictor of comment resolution, while lengthy and complex comments are less likely to be acted upon" ([Cynthia et al. 2026](https://arxiv.org/abs/2607.21997v1)). Each draft should carry one hypothesis the person can confirm or reject in one step, with the diff hunk and verbatim evidence attached, which also meets the operator's standing requirement that automated review be "observable, understandable, verifyable" (recipe [0960a183](https://www.soup.net/traces/0960a183-595e-464e-be67-ba5df4de6a70)).
- **Reviewer attention is scarce and getting scarcer, so questions must be budgeted, batched, and ranked.** At Meta "per-developer diff volume rose 51%, with agentic AI responsible for over 80% of that growth" ([Adams et al. 2026](https://arxiv.org/abs/2605.30208)); "the more files that are in a change, the lower the proportion of comments in the code review that will be of value" ([Bosu et al. 2015](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/bosu2015useful.pdf)); "A programmer takes between 10-15 minutes to start editing code after resuming work from an interruption" ([Parnin, ninlabs](https://blog.ninlabs.com/blog/programmer-interrupted/)). No study gives a right number of questions; the plan needs a small, tunable per-person budget ordered by impact times uncertainty (the queue ordering already chosen in recipe [6fa4a9c9](https://www.soup.net/traces/6fa4a9c9-050d-49fe-b884-863cd49c7410)).
- **Route to a named individual with file experience, and spend recommender effort on gaps, not the obvious owner.** Named individuals beat team assignment: Meta found "a large decrease in the amount of time it took for diffs to be reviewed when a recommended individual was explicitly assigned" ([Meta 2023, arXiv 2312.17169](https://arxiv.org/abs/2312.17169)). Recommenders for the obvious pick add little: "reviewer recommendations rarely provide additional value" ([Kovalenko et al. 2018](https://zenodo.org/records/1404814)). The value is in knowledge concentration: route to "experts with low active review workload" and, "when knowledge is concentrated on one developer," to others "to spread knowledge" ([Mirsaeedi and Rigby / Hajari et al.](https://arxiv.org/abs/2312.17236)).
- **Rationale capture fails when it is a separate chore; answering a question inside an existing conversation is the cheapest capture moment.** "The more intrusive the capture process, the more designer resistance will be encountered" and capture "is viewed as expendable if deadlines are an issue" ([Burge and Brown 2000](http://web.cs.wpi.edu/~dcb/Papers/AID00-janet.pdf)). ADRs on GitHub: adoption "is still low" ([Buchgeher et al. 2023](https://se.jku.at/using-architecture-decision-records-in-open-source-projects-an-msr-study-on-github/)). This supports "helpers, not another workflow": the person's own agent asks at a natural break, and the web queue is the fallback.

## 1. What code review actually achieves

**Understanding and knowledge transfer outrank defects.** Microsoft (observation, interviews, surveys, hundreds of classified comments):

> "Our study reveals that while finding defects remains the main motivation for review, reviews are less about defects than expected and instead provide additional benefits such as knowledge transfer, increased team awareness, and creation of alternative solutions to problems. Moreover, we find that code and change understanding is the key aspect of code reviewing and that developers employ a wide range of mechanisms to meet their understanding needs, most of which are not met by current tools."
> -- [Bacchelli and Bird, ICSE 2013](https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/)

**Google: education and norms.** From 12 interviews, a survey, and logs of about nine million changes:

> "we identified four key themes for what Google developers expect from code reviews: education, maintaining norms, gatekeeping, and accident prevention."
> -- [Sadowski et al., ICSE-SEIP 2018](https://sback.it/publications/icse2018seip.pdf)

> "norms refer to an organization preference for a discretionary choice (e.g., formatting or API usage patterns)"
> -- same source (the PDF text extraction splits "e.g." across a sentence boundary; wording otherwise verbatim)

> "At Google, knowledge transfer is part of the educational motivation for code review."
> -- same source

Interpretation: "maintaining norms" as Google defines it, a preference for a discretionary choice, is close to what Soup.net calls a recipe. Review is already where teams transmit taste and judgment; it just leaves no queryable record.

**Missing rationale and design disagreements are named breakdowns.**

> "Context: Interviewees allowed us to see that misunderstandings can arise based on not knowing what gave rise to the change; for example, if the rationale for a change was an urgent fix to a production problem or a "nice to have" improvement."
> -- [Sadowski et al. 2018](https://sback.it/publications/icse2018seip.pdf)

> "Review subject: The interviews referenced disagreements as to whether code review was the most suitable context for reviewing certain aspects, particularly design reviews."
> -- same source

**Knowledge spreading is measurable.**

> "Our knowledge sharing measure shows that conducting peer review increases the number of distinct files a developer knows about by 66% to 150% depending on the project."
> -- [Rigby and Bird, ESEC/FSE 2013](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/rigby2013convergent.pdf)

**What authors count as useful.** Microsoft's usefulness study judged comments by the change author:

> "The interviewees rated almost 69% comments as either useful or somewhat useful."
> -- [Bosu, Greiler and Bird, MSR 2015](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/bosu2015useful.pdf)

> "Other comments may contain incorrect information or may ask questions that are not relevant and require the author's time to respond to without improving the code."
> -- same source

> "comments whose sole purpose can be attributed to knowledge dissemination and team awareness are perceived as less useful by developers."
> -- same source

> "If immediate actions based on these comments are not foreseeable, authors rated such comments as not useful."
> -- same source

Interpretation: there is a tension here that matters for drafts. The research says review's biggest outcome is shared understanding, yet authors rate understanding-only comments as not useful. A question posted on the PR ("why did you do X?") costs the author and reads as noise; the same question asked privately by the author's own agent, whose answer is logged where future reviewers and agents find it, turns understanding into a durable artifact without taxing the PR thread.

## 2. Reviewer assignment and expertise

**Ownership files make the obvious routing trivial.**

> "Code owners are automatically requested for review when someone opens a pull request that modifies code that they own."
> -- [GitHub Docs, About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)

> "Detecting the right reviewer does not seem problematic in practice at Google, in fact the model of recommendation implemented is straightforward since it can programmatically identify owners."
> -- [Sadowski et al. 2018](https://sback.it/publications/icse2018seip.pdf)

**GitHub's load balancing is workload-aware, not expertise-aware.**

> "The round robin algorithm chooses reviewers based on who's received the least recent review request, focusing on alternating between all members of the team regardless of the number of outstanding reviews they currently have."
> "The load balance algorithm chooses reviewers based on each member's total number of recent review requests and considers the number of outstanding reviews for each member."
> -- [GitHub Docs, Managing code review settings for your team](https://docs.github.com/en/organizations/organizing-members-into-teams/managing-code-review-settings-for-your-team)

**File experience predicts useful comments.**

> "The developers who had made prior changes to files in a change under review had a higher proportion of useful comments in four out of the five projects (all but Exchange which shows marginal increases), but we did not see a difference in effectiveness based on the number of times that a developer had worked on a file."
> -- [Bosu et al. 2015](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/bosu2015useful.pdf)

> "the proportion of useful comments made by a reviewer increases dramatically in the first year that he or she is at Microsoft but tends to plateau afterwards."
> -- same source

**Recommending the obvious pick adds little.**

> "Having found no evidence of influence, we turn to the users of the recommender. Through interviews and a survey we find that, though perceived as relevant, reviewer recommendations rarely provide additional value for the respondents."
> -- [Kovalenko et al., TSE 2018](https://zenodo.org/records/1404814)

**Expertise, workload, and knowledge concentration are a joint problem.**

> "Even though review workload is highly concentrated, we show that code review natural spreads knowledge thereby reducing the files at risk to turnover."
> "Combining recommenders, we develop the SofiaWL recommender that suggests experts with low active review workload when none of the files under review are known by only one developer. In contrast, when knowledge is concentrated on one developer, it sends the review to other reviewers to spread knowledge."
> -- [Hajari, Malmir, Mirsaeedi and Rigby, arXiv 2312.17236](https://arxiv.org/abs/2312.17236)

> "Bus factor is a metric that identifies how resilient is the project to the sudden engineer turnover."
> -- [Jabrayilzade et al., ICSE-SEIP 2022](https://arxiv.org/abs/2202.01523)

**Assign a person, not a team (bystander effect).**

> "Expt 2. Reviewer workload is not evenly distributed, our goal was to reduce the workload of top reviewers. We then ran an A/B test on 28k diff authors in Winter 2023 on a workload balanced recommender. Our A/B test led to mixed results. Expt 3. We suspected the bystander effect might be slowing down reviews of diffs where only a team was assigned. We conducted an A/B test on 12.5k authors in Spring 2023 and found a large decrease in the amount of time it took for diffs to be reviewed when a recommended individual was explicitly assigned."
> -- [Meta, arXiv 2312.17169](https://arxiv.org/abs/2312.17169)

**Risk-targeted extra reviewer.** A 2026 Meta paper assigns an additional recommended reviewer to high-risk diffs and weights "file experience, author collaboration, interaction quality, and recency" ([doi 10.1145/3803437.3805220](https://doi.org/10.1145/3803437.3805220)). Unverified: taken from a search-result summary, not the paper text.

**How many reviewers.**

> "At Google, by contrast, fewer than 25% of changes have more than one reviewer, and over 99% have at most five reviewers with a median reviewer count of 1."
> -- [Sadowski et al. 2018](https://sback.it/publications/icse2018seip.pdf) (a footnote marker between "reviewer" and the comma is dropped)

> "[19] found that two reviewers discovered as many defects as four reviewers."
> -- [Rigby and Bird 2013](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/rigby2013convergent.pdf)

## 3. Attention, fatigue, and latency

**Review volume and size.**

> "the median for changes reviewed by developers per week is 4, and 80 percent of reviewers review fewer than 10 changes a week."
> "The overall (all code sizes) median latency for the entire review process is under 4 hours."
> "The majority of changes are small, have one reviewer and no comments other than the authorization to commit."
> -- [Sadowski et al. 2018](https://sback.it/publications/icse2018seip.pdf)

> "In contrast, we found that the more files that are in a change, the lower the proportion of comments in the code review that will be of value to the author of the change."
> -- [Bosu et al. 2015](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/bosu2015useful.pdf)

The widely repeated "400 lines" review-size ceiling traces to a vendor study of a Cisco team; I did not reach the primary text, so it is left out as a fact (unverified).

**AI is raising the volume reviewers face.**

> "At Meta, significant lines of code per human-landed diff grew by 105.9% year over year and per-developer diff volume rose 51%, with agentic AI responsible for over 80% of that growth."
> -- [Adams et al., arXiv 2605.30208, 2026](https://arxiv.org/abs/2605.30208)

**Slow tails drive dissatisfaction; nudges and queueing help.**

> "The longer someone's slowest 25 percent of diffs take to review, the less satisfied they were by their code review process."
> "The average Time In Review for all diffs dropped 7 percent (adjusted to exclude weekends) and the proportion of diffs that waited longer than three days for review dropped 12 percent!"
> "This feature resulted in a 17 percent overall increase in review actions per day (such as accepting a diff, commenting, etc.) and that engineers that use this flow perform 44 percent more review actions than the average reviewer!"
> -- [Meta Engineering, "Move faster, wait less", 2022](https://engineering.fb.com/2022/11/16/culture/meta-code-review-time-improving/) (the last quote is about the "Next Reviewable Diff" queue)

> "quick reaction time is of utmost importance and applies to the tooling infrastructure and the behavior of other engineers"
> -- [“Does code review speed matter for practitioners?”, arXiv 2311.02489](https://arxiv.org/abs/2311.02489)

**Interruption cost.**

> "A programmer takes between 10-15 minutes to start editing code after resuming work from an interruption."
> "When interrupted during an edit of a method, only 10% of times did a programmer resume work in less than a minute."
> -- [Parnin, "Programmer, Interrupted"](https://blog.ninlabs.com/blog/programmer-interrupted/)

> "self-interruptions (i.e. voluntary task switchings) are more disruptive than external interruptions"
> -- [Abad et al., arXiv 1805.05508](https://arxiv.org/abs/1805.05508) (quoted via an abstract fetch; unverified against the PDF)

Interpretation: a question that arrives mid-task costs far more than the seconds it takes to answer. The person's own agent should hold drafts until a natural break (session start, after a commit, when the person asks "anything for me?"), not push them mid-flow.

## 4. How teams receive AI review comments

**Resolution and rejection rates.**

> "Through the offline, online, user feedback evaluations over a one-year period, we conclude that RovoDev Code Reviewer is effective in generating code review comments that could lead to code resolution for 38.70% (i.e., comments that triggered code changes in the subsequent commits); and offers the promise of accelerating feedback cycles (i.e., decreasing the PR cycle time by 30.8%), alleviating reviewer workload (i.e., reducing the number of human-written comments by 35.6%)"
> -- [RovoDev Code Reviewer, Atlassian, arXiv 2601.01129](https://arxiv.org/abs/2601.01129)

> "our results show that agentic reviews receive mixed reception: 36.4% were accepted and 7.3% triggered discussion, while 56.3% were rejected. Rejections were primarily associated with invalid suggestions that were false positives, redundant, or out of scope, as well as misalignment with developer intent and coding practices."
> -- [Lin et al., CodeRabbit study, arXiv 2607.03316, 2026](https://arxiv.org/abs/2607.03316)

> "Through open card sorting of 470 unresolved comment discussions, we identify *ten* discussion patterns explaining why comments remain unresolved, with *incorrect suggestions* and *intentional design decisions* being the most prevalent. Finally, our analysis reveals that the presence of an inline *code suggestion* is the strongest predictor of comment resolution, while lengthy and complex comments are less likely to be acted upon."
> -- [Cynthia et al., "Go Home Copilot, You're Drunk", arXiv 2607.21997, 2026](https://arxiv.org/abs/2607.21997v1)

> "readability, bugs, and maintainability-related comments had higher resolution rates than those focused on code design."
> -- [Goldman et al., Atlassian, arXiv 2510.05450](https://arxiv.org/abs/2510.05450)

> "CRA-only PRs achieve a 45.20% merge rate, 23.17 percentage points lower than human-only PRs (68.37%)."
> -- [Chowdhury et al., MSR 2026, arXiv 2604.03196](https://arxiv.org/abs/2604.03196) (quoted via an abstract fetch)

**Precision calibration as a trust lever.**

> "The final model was calibrated for a target precision of 50%. That is, we tuned the model and the suggestions filtering, so that 50% of suggested edits on our evaluation dataset are correct."
> "Incorrect suggested edits take the developers time and reduce the developers' trust in the feature"
> "40% to 50% of all previewed suggested edits are applied by code authors"
> -- [Google Research, "Resolving code review comments with ML"](https://research.google/blog/resolving-code-review-comments-with-ml/)

**Trust in AI output, developer survey.**

> "46% of developers said they don't trust the accuracy of the output from AI tools"
> "45% of respondents was that debugging AI-generated code is time-consuming"
> -- [Stack Overflow 2025 Developer Survey press release](https://stackoverflow.co/company/press/archive/stack-overflow-2025-developer-survey/)

The survey's AI page lists the top frustration as "AI solutions that are almost right, but not quite", and "When I don't trust AI's answers" as the top reason to still ask a person ([survey.stackoverflow.co/2025/ai](https://survey.stackoverflow.co/2025/ai)). The percentages attached to those two items came back through a summarizing fetch and are unverified here. The 2026 survey opened in June 2026 ([Stack Overflow blog](https://stackoverflow.blog/2026/06/23/the-2026-developer-survey-is-now-open-for-human-developers-only/)); I did not find published results.

**Where agents should interrupt at all.** A 2026 position paper frames the core agent capability as deciding "when to interrupt" and evaluating "the policy that decides what matters next, what evidence supports it, whether to show it, and how to adapt after feedback" ([Bui and Evangelopoulos, arXiv 2605.06717](https://arxiv.org/abs/2605.06717); quoted via an abstract fetch).

## 5. Why design rationale capture fails

> "Recording all decisions made, as well as those rejected, can be time consuming and expensive. The more intrusive the capture process, the more designer resistance will be encountered."
> "Because it is time consuming and viewed as documentation, DR capture is viewed as expendable if deadlines are an issue (Conklin and Burgess-Yakemovic, 1995)."
> -- [Burge and Brown, "Reasoning with design rationale", AID 2000](http://web.cs.wpi.edu/~dcb/Papers/AID00-janet.pdf)

> "Architecture decision records (ADRs) have been proposed as a resource-efficient means for capturing architectural design decisions (ADDs), and have received attention not only from researchers but also from practitioners."
> -- [Buchgeher et al., IEEE Access 2023](https://se.jku.at/using-architecture-decision-records-in-open-source-projects-an-msr-study-on-github/)

The same study reports that adoption "is still low" and that about half of repositories with ADRs hold only one to five of them (per the search-result abstract; the project page paraphrases this, so treat the one-to-five figure as unverified).

> "Our results show that practitioners face challenges related to the documentation culture, knowledge transfer, prioritization of information to be documented, as well as handling documentation for shared and distributed components."
> "At the same time, the decision on where documentation is stored has a massive influence on its perceived usefulness."
> -- [Ahmeti et al., "Architecture Decision Records in Practice: An Action Research Study", ECSA 2024](https://rebekkaa.github.io/files/2024_ECSA.pdf)

Tang et al.'s 2006 survey of 81 architects found practitioners value rationale but document it unevenly ([Journal of Systems and Software](https://www.sciencedirect.com/science/article/abs/pii/S0164121206001415)); the abstract could not be fetched (403), so no quote is given.

Interpretation: every failure mode here is a cost placed on the decider at the wrong moment (intrusive, expendable under deadline, unclear what to write, stored where no one looks). A draft inverts that: the agent writes the hypothesis and the evidence, the person spends one confirm or one sentence of correction, and storage is the place future agents already search.

## Implications for the plan

**What a sweep agent should surface to humans.**

- Issue: generic AI review comments are resolved at 36 to 39 percent in the studies above and are most often rejected for "intentional design decisions" or "misalignment with developer intent". Better approach: the sweep agent posts nothing about defects it can verify (that is the existing AI reviewer's job) and drafts only the calls where the diff departs from a pattern, a logged recipe, or a sibling file, and the departure looks deliberate. Benefit: drafts land in the one category AI reviewers are worst at and the corpus is best at, and each confirmed answer removes a future false positive.
- Issue: authors rate "why" questions on the PR thread as not useful, yet understanding is review's main outcome. Better approach: keep the question off the PR thread and ask the decider privately through their own agent; publish the answer as a confirmed recipe that the next reviewer's agent retrieves. Benefit: knowledge transfer without taxing the thread.
- Issue: long, abstract comments are ignored; inline concrete suggestions are acted on. Better approach: every draft is one hypothesis in the recipe format, with the diff hunk link and a verbatim quote, answerable as confirm, reject, or a one-line correction. Benefit: matches the strongest resolution predictor found and meets the verifiability requirement in recipe [0960a183](https://www.soup.net/traces/0960a183-595e-464e-be67-ba5df4de6a70).
- Issue: incorrect output erodes trust faster than correct output builds it. Better approach: set an explicit precision target for drafts (Google used 50 percent for edits) and measure it from confirm and reject rates; when a person's reject rate climbs, the sweep asks that person fewer questions. Benefit: the helper earns its attention budget instead of assuming it.

**How many questions is too many.** No study found gives a number for questions to a human per PR or per week. Proxies: Google's median reviewer reviews 4 changes a week; RovoDev averaged 2.1 comments per PR ([arXiv 2601.01129 HTML](https://arxiv.org/html/2601.01129v2), from a search summary, unverified); usefulness falls as change size grows; an interruption costs 10 to 15 minutes to recover from. Recommendation (a judgment call, not a finding): a small per-person budget per sweep, ordered by impact times uncertainty with the existing queue ordering, the overflow left visible in the web queue rather than pushed, and delivery held for natural breaks. The budget should be a setting with a conservative default and should adapt to each person's confirm and reject history.

**How expertise routing should work.**

- Issue: owners are already auto-requested, and recommenders for the obvious pick add little. Better approach: reuse CODEOWNERS and git history as the default route and do not build a new expertise model for the common case. Benefit: no competing source of truth, "helpers, not another workflow".
- Issue: the question a draft asks is about a decision, and the decider may not be the owner. Better approach: route first to the PR author (the person who made the call), then to people whose own recipes are nearest to the question in the corpus (a signal no file-based recommender has), then to file owners. Benefit: questions reach the person who holds the taste and judgment in question, not only the one who holds the file.
- Issue: team-level assignment slows response (bystander effect). Better approach: every draft names exactly one person to ask, with others visible as watchers. Benefit: matches the Meta A/B result.
- Issue: the operator wants people to take "PR Sweep" duty in their areas, and gaps. Better approach: treat duty as an opt-in claim over paths or topics, and have the sweep report two kinds of gap: areas with no claimant, and areas where one person holds all the related recipes (the SofiaWL "knowledge concentrated on one developer" case), where it routes a confirmed answer to a second person as a read, not a question. Benefit: duty follows expertise, and the corpus becomes a bus-factor signal.

## Soup.net use

- Agent id: `a-pr-review-research-human-2026-09-27`
- Intent: `int_NbPRwJNgjh9j8oHXGV9UB15g`
- Searches (all `author:anyone`):
  - `af6caa98-c47d-4f29-a026-9e77c3d20629`, review, expertise routing, sweep agent questions. Surfaced 0960a183 (automated review must be verifiable), 94e8f123 (decision-extraction as the PR retrieval unit), 60854a1e (review queue ranked by materiality times uncertainty), 985afff8 (draft-PR flow).
  - `31802032-798a-4d88-914a-d1a36ce9666a`, AI review noise and drafts queue. Surfaced 0e3cb40e (draft separate from on-behalf-of), 6fa4a9c9 (is:draft queue sorted by impact times uncertainty), 030e6e2d (one-click review labels), 20640ed5 (rejection reason codes).
  - `b0d32752-eef8-4377-bf3c-9230bbd731b3`, rationale capture. Surfaced b84405a3 (decision log designed for agent capabilities rather than human attention), 2e178ef6 (reminder friction).
- Checks: none. The findings are research, and the judgment calls below are the planner's to make.
- Feedback rows (one per search): 92937fe9 (search af6caa98, subtle, proceeded), 89d51953 (search 31802032, partial: no corpus precedent on a question budget), 4fede031 (search b0d32752, confirmed framing).
