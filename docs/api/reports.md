# Reports: reading your intents and feedback rows

Three read paths let a script, or an agent outside a session, report on what a person's agents did: which tasks they declared, which recipes each task was shown, and what feedback they logged. They were added in drafts-and-triage slice 9 ([build log](../planning/drafts-and-triage-build.md), "Slice 9 rubric"). There is no MCP tool for them; reports are made outside sessions.

| Path | Returns |
|---|---|
| `GET /intents` | Your intents, newest first |
| `GET /intents/:id` | One intent and a page of its lineage, oldest first |
| `GET /feedback/rows` | Your feedback rows, newest first, filtered |

The bare `GET /feedback` is a different thing: the URL-built way for web-only agents to write a feedback row. It is unchanged.

## Authentication and scope

Send your API key as `Authorization: Bearer <key>`. A `?key=` parameter is refused on these paths, because report URLs get pasted and logged.

- **Whose rows.** Only your own: intents your agents registered, and feedback rows written by your keys or by you on the web (a re-filing correction). A feedback row whose key has since been deleted (revoked, or an OAuth key swept after it expired) is no longer attributed to anyone and is not listed.
- **Which recipes.** Anything that names a recipe (a feedback row about a recipe, a recipe shown to an intent, a deposit, a related recipe id) is included only when the key you present can read that recipe now: its recipe book is in the key's books and, if it is a draft, you may read it. A key scoped to one book therefore reports on that book. Intents themselves belong to you, not to a book, so every key of yours lists all of them. A feedback row about a read-only search names no recipe and is listed for every key of yours.
- **Not found.** Another person's intent, an id that never existed, and a malformed id all answer `404 {"ok":false,"error":"Intent not found"}`. A filter that names something that is not yours (someone else's intent, an unreadable recipe or book) matches nothing and answers an empty page, the same as an id that never existed.

## Parameters

Every path takes `page` (from 1, default 1) and `per_page` (1 to 200, default 50). `GET /feedback/rows` also takes these filters, combined with AND:

| Filter | Value |
|---|---|
| `intent_id` | An intent id, `int_` and 24 letters or digits |
| `trace_id` (alias `recipe_id`) | A full recipe id (UUID) |
| `search_id` | A search id (UUID), as a search response gives it |
| `agent_id` | The agent id exactly as the agent sent it |
| `since` | An ISO 8601 date (`2026-10-24`) or date-time with an offset (`2026-10-24T09:30:00Z`), naming a real calendar day; rows created at or after it |
| `recipe_book` | A recipe book's slug or id |

`since` is inclusive: a sweep that stores the newest `createdAt` it saw and passes it back gets that row again rather than missing one created in the same instant.

An unknown parameter, a repeated one, or a value that does not parse is a `400` that names every failing parameter at once, with `fields` listing them:

```json
{ "ok": false, "error": "Invalid query parameters: intentid (unknown parameter; this path takes intent_id, trace_id, search_id, agent_id, since, recipe_book, page, per_page); per_page (a whole number from 1 to 200).", "fields": ["intentid", "per_page"] }
```

## Responses

Every list answers with its paging block: `total`, `page`, `perPage`, `totalPages`.

### `GET /intents`

```json
{ "ok": true, "data": {
  "items": [{
    "id": "int_…", "story": "As a … I want my agent to …", "agentId": "a-drafts-9", "apiKeyLabel": "laptop",
    "createdAt": "2026-10-24T09:30:00.000Z", "lastUsedAt": "2026-10-24T11:02:00.000Z",
    "counts": { "shown": 12, "deposits": 3, "feedback": 4 }
  }],
  "total": 1, "page": 1, "perPage": 50, "totalPages": 1
} }
```

`apiKeyLabel` is the label of the key that registered the intent, or null when that key is gone or had none. `lastUsedAt` is the last check, search or briefing that passed the intent's id; a feedback row carrying the id does not move it, because feedback only records an intent id and never resolves one. The counts follow the scope rules above, so two keys with different books can count the same intent differently.

### `GET /intents/:id`

```json
{ "ok": true, "data": {
  "intent": { "id": "int_…", "story": "…", "counts": { "shown": 2, "deposits": 1, "feedback": 1 } },
  "lineage": [
    { "type": "shown", "traceId": "…", "at": "…" },
    { "type": "deposit", "traceId": "…", "at": "…", "draftState": null },
    { "type": "feedback", "at": "…", "feedback": { "id": "…", "traceId": "…" } }
  ],
  "total": 4, "page": 1, "perPage": 50, "totalPages": 1
} }
```

The lineage is one timeline, oldest first, paged by `page` and `per_page`; `total` counts its entries. `shown` is a recipe whose full text a check, search, or briefing under this intent delivered. `deposit` is a recipe a check under this intent created (`draftState` as you may see it); deposits are recorded from drafts-and-triage slice 6a on, so an intent from before it shows none. `feedback` carries a feedback row shaped as below.

### `GET /feedback/rows`

```json
{ "ok": true, "data": {
  "items": [{
    "id": "…", "traceId": "…", "searchId": null, "intentId": "int_…", "sessionId": "…", "agentId": "a-drafts-9",
    "kind": "check-feedback", "impact": "subtle", "disposition": "proceeded", "storyFulfilled": "yes",
    "story": "…", "note": "…", "topSimilarity": 0.81, "model": "…", "harness": "claude-code", "harnessVersion": null,
    "relatedTraceIds": ["…"], "createdAt": "…", "apiKeyLabel": "laptop",
    "actorUserId": null, "actorEmail": null, "starCount": 0, "starredByMe": false, "isMine": true
  }],
  "total": 1, "page": 1, "perPage": 50, "totalPages": 1
} }
```

Each row has the fields the recipe detail page's feedback list gives (`GET /traces/:id/feedback`), plus `traceId` and `searchId`; exactly one of the two is set. `relatedTraceIds` lists only the recipes the presenting key may read. A human-origin row has `actorUserId` and `actorEmail` and no `apiKeyLabel`. `isMine` is always true here (every listed row is yours); the per-recipe route carries it too, where it is false for a collaborator's row.

## On the web and in the export

On a recipe's detail page, a feedback row that carries an intent id links to the intent's page, `/app/intents/<id>`, which shows the same lineage under your sign-in. `GET /auth/me/export` includes `intents` and `checkFeedback` (your own, as above). The delivery ledger behind `shown` is derived by the system and is not exported.
