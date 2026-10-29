---
name: ask-store-list-sql-traps
description: Adding a per-thread fact to the Ask thread list SQL (listThreads / listThreadsPage) — JSON-over-blocks traps, cost, and how to prove it
paths: src/core/ask/store.mjs, test/ask-api-threads.test.mjs
updated: 2026-10-29T20:05:31.376Z
author: Denislav Prinov
---
Facts about `ask_messages.blocks` the list queries can rely on (checked 2026-10-29, chats-kind icon review):
- `blocks` is NULL or compact `JSON.stringify` of an ARRAY of block objects (`str` at the top of store.mjs; every writer
  uses it or `JSON.stringify` directly), never `''`, never spaced. A card's `state` is on the BLOCK, `card.type` on the
  card; run cards have NO `type`; propose_workflow = `'workflow'`, build_workflow = `'workflow-build'`
  (`composer-payload.mjs`). A LIKE on `'%"type":"workflow%'` cannot match text content (quotes in strings are escaped).
- `json_each(CASE WHEN json_valid(x) THEN x END)` turns invalid JSON into 0 rows, BUT `json_extract(b.value, '$.k')`
  throws `malformed JSON` when an element is a STRING (json_each yields the bare text) or when `blocks` is an object
  (its values are strings). One such row fails the whole SELECT → every `GET /api/ask/threads` 500s. Guard with
  `b.type = 'object' AND …` before any `json_extract(b.value, …)`. (The same pattern lives in `deleteThread`.)
- Correlated select-list subqueries run for EVERY candidate thread, not the LIMIT page: nothing indexes
  `ORDER BY t.updated_at` / the paged `sort_key` expression, so SQLite computes the row before the temp B-tree sort.
  A subquery that reads message text therefore scans the whole DB per list call (82 MB of blocks → 21 ms vs 0.1 ms
  for the index-only link counts), on every 250 ms-debounced column refresh. Prefer index-only counts or a persisted
  per-thread flag for anything heavier than a LIKE prefilter.
- `listThreads` and `listThreadsPage` are two SELECTs; a fact must land in both (one shared fragment) and the API test
  must read it through all three modes: `?limit=`, `?show=all` (paged) and `?q=` (search joins `hit`).
- Prove it with an in-memory `node:sqlite` probe (`new DatabaseSync(':memory:')`, the real column names, the fragment
  verbatim) feeding string / number / null / object-shaped elements, and mutation-check each guard against
  `test/ask-api-threads.test.mjs`: a defensive clause with no fixture (a `kind='card'` test on a block that has no
  `card` object) survives silently.
