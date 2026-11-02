# Ticket updates PR 2 (Azure Boards and GitHub Issues) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** azure-boards-source and github-source speak PR 1's Ticket updates contract (`capabilities().ticketUpdates`, `listStatuses`, `legacyMove`, `reportResult`'s `move` and its `{ moved, note }` answer, `getTask`'s `meta.project`, github-source's `listProjects` over its repositories), so a saved Ticket updates rule moves an Azure work item or a GitHub issue when a run finishes, and the one comment ends with what happened. With nothing saved both plugins behave exactly as today; with the flag off nothing changes.

**Architecture:** Host code stays as PR 1 built it, with one change: a project key may be `owner/repo` (decision 1). Each plugin translates Worca's move into its tracker's terms inside its own connector, tested against an in-memory fake of its tracker's REST API (`test/helpers/fake-azure-boards.mjs`, `test/helpers/fake-github-issues.mjs`). GitHub's Repository input switches its `optionsFrom` to `listProjects`, so PR 1's New run filter applies to it without the host learning a GitHub op name (decision 7). PR 1's UI section is used unchanged; a jsdom test proves it for both plugins (decision 5).

**Tech Stack:** Node ESM, `node:test`, jsdom, Express (`ui/server.mjs`), the plugin shim (`WORCA_MOCK=1` canned answers), the connectors' injected `fetch` (`deps.fetch`) answered by fakes that return real `Response` objects.

**Spec:** `plans/ticket-updates-design.md` (D1–D18; §14 scopes PR 2; D1 decides Azure Boards' Resolved counts as in progress, so Any Done status means Completed; D9 says github-source's repositories join the projects filter). It is normative; this plan decides what the design leaves open (Decisions below) and follows PR 1's plan (`plans/ticket-updates-plan.md`, its Global Constraints, Deviation 3 and its "Decided 2026-10-30"). Base: `feat/ticket-updates` at 052500f33 (PR 1, #1072, not merged); this branch `feat/ticket-updates-pr2` stacks on it.

## Global Constraints

- One commit per task (review fixes as their own commits); subjects start `Ticket updates:`; every message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never rebase, amend, stash, reset, clean or check out; a merge of the base is a merge commit. Do not push.
- **Flag (D16):** everything here sits behind PR 1's Labs flag `ticketUpdates`; nothing about the flag changes. Off: no section, the routes 404, no filter, write-back passes no `move`, so both plugins run their old setting.
- **Plugin API stays 5 (D5):** every addition is optional. `WORCA_PLUGIN_API` and `WORCA_PLUGIN_APIS` do not change. azure-boards-source keeps `"worca-cc-api": ">=5 <6"`, github-source keeps `">=1 <2"` (the task-source protocol is unchanged across APIs; the shim child calls any op a connector exports).
- **Versions:** azure-boards-source `0.1.0` → `0.2.0` (Task 2); github-source `0.2.0` → `0.3.0` (Task 4). The Marketplace offers an update only for a higher manifest version (D18).
- **No new browser-callable op (D8):** `POST /api/sources/call`'s allowlist rule is unchanged (the three interface ops plus each input's `optionsFrom`). For github-source that rule now admits `listProjects` instead of `listRepos` (decision 7); it never admits `listStatuses` or `legacyMove`.
- **Legacy byte for byte (D4):** without a `move`, `reportResult` does exactly what it does today in both plugins (comment first, then `closeOnComplete`), and every existing `test/azure-boards-connector.test.mjs` and `test/github-source-connector.test.mjs` row passes unchanged except the two named in Tasks 2 and 4 (a `capabilities` and a `meta` `deepEqual` that gain a field).
- **Move first, then one comment ending with the line (D11):** `{ none: true }` reads nothing, moves nothing and adds no line. A 4xx refusal of the move other than 401 and 429 (and, for GitHub, not a rate limit) is a `Not moved: <Tracker> refused the move to <status>: <its message>.` line (`<Tracker> gave no reason` without one) and the comment is still posted; a refused token, a rate limit, a 5xx, a network error or a timeout throws, so the write-back fails and Report result retries (PR 1's Deviation 3).
- **No UI change (decision 5):** no file under `ui/` changes. The user requires an approved mock before any UI implementation; if Task 6's guard test fails, stop and report instead of changing the UI.
- **Copy:** comment lines are listed in Appendix B (invented copy, in the boards' voice). Statuses read "status" in Worca's words even where the tracker says "state".
- **Tests are hermetic:** one file at a time with `node tools/test.mjs test/<file>.test.mjs` (it sets an isolated `WORCA_HOME`). No real Azure DevOps, no real GitHub: connector tests inject the fakes' `fetch`; host tests run the server with `WORCA_MOCK=1`. A test that turns the flag on sets `process.env.WORCA_FLAGS` and restores it.
- **Platforms:** Windows and Linux. The working copy is CRLF, the repo stores LF: edit existing files with the Edit tool (it keeps line endings), never rewrite a whole existing file; new files may be written whole.
- Fixtures use "Acme", "Shop", "Ann Example"; no local machine paths and no real person's names in shipped files, tests, docs or plans. No `console.log`, `debugger`, `TODO` or `FIXME`.

## Decisions

Each is decided here; the ones marked **needs approval** are proposed and should be confirmed by the user or the design's owner before Task 1 (or the named task) runs.

1. **A project key may be `owner/repo` (needs approval: it relaxes PR 1's reviewed S9 key check).** `isProjectKey` (`src/core/ticket-updates.mjs`) allows at most one `/`, between two parts of 1 to 100 characters, neither `.` nor `..`; it still refuses `\`, `?`, `#`, `%` and control characters. Why this one: it is the smallest change that admits GitHub's real key while keeping every property S9 needed (no dot segment, nothing that decodes into one, no second slash), it stays provider-neutral (no host rule names GitHub), and keys keep travelling as they do today: query-string values the sheet encodes with `encodeURIComponent` and Express decodes once, never URL path segments in the host. Encoding the slash instead (e.g. `owner~repo`) was rejected: `listProjects`' values, `getTask`'s `meta.project` and New run's filter must all be the same string, so an encoding would leak into the plugin and the host's filter. Each plugin keeps its own stricter check: jira-source and azure-boards-source refuse any slash; github-source accepts only GitHub's `owner/repo` shape.
2. **GitHub's categories (D1) and no Projects v2.** `listStatuses({ project })` answers the same three for every repository, without a request: `open` "Open" (todo), `completed` "Closed" (done), `not_planned` "Closed as not planned" (cancelled). Reading an issue: open or reopened is Open; closed as completed or with no reason (older issues) is Closed; closed as not planned is cancelled; closed as a duplicate is cancelled ("Closed as duplicate"; read only, never offered as a target). Nothing is in progress. Projects (v2) status fields are out of scope: they are GraphQL-only (the connector is REST-only by design), they need a token scope beyond the plugin's Issues read/write, and an issue can sit on several boards with different Status fields, so "the ticket's status" would be ambiguous; a board picker would be new UI that needs a mock.
3. **Azure Boards' statuses and a status move.** `listStatuses({ project })` reads the project's work item types (`GET {project}/_apis/wit/workitemtypes`) and its type categories (`…/workitemtypecategories`), leaves out disabled types and those in `Microsoft.HiddenCategory` (Code Review Request, Test Plan, …), and lists every state once by name, in Azure's order, with D1's category (Proposed todo; InProgress and Resolved in_progress; Completed done; Removed cancelled). A state's value is its name (Azure has no state ids). **Any Done status** is the work item type's first Completed-category state (what `closeOnComplete` does today); an item already in a Completed or Removed state stays ("Already in …"); Removed is never chosen. **A status move** sets that state of the item's own type; if the type has no such state, the item does not move and the line says so (`Not moved: Shop's Task type has no status named Resolved.`), with no fallback to another state of the same category (predictable; Any Done status is the rule for mixed types). When no type of the project has the state any more, the line is PR 1's `Not moved: Shop has no status named Shipped any more.`
4. **`legacyMove()` and the carried-over display.** Both plugins answer `{ field: 'closeOnComplete', target: yes ? { category: 'done' } : null }`. PR 1's section already shows it: before the first save the All projects row reads **Any Done status** (or Don't move for "no") with the note "Filled in from the old **Close work item on completion** setting. …" (**Close issue on completion** for GitHub); after the first save the old select gives way to "Moved to Ticket updates." Task 6 proves both for a select field and a single-profile source.
5. **UI: no change.** PR 1's section works as it is for both plugins (Task 6 proves it in jsdom). Noticed and left alone, because each would need a mock or copy approval: the section's hint names Jira's Won't Do and Resolution for every tracker; Azure's popover rows show the project name twice (Azure's key is its name); possessives read "Azure Boards's" and "GitHub Issues's" ("Save this connection first…", "Getting …'s projects…"); a GitHub repository is called a project. **Needs the user's call** only if any of these should be polished (a follow-up with a mock), not for this PR.
6. **Versions, changelog, docs.** azure-boards-source 0.2.0, github-source 0.3.0 (Tasks 2, 4). The unreleased changelog's **Ticket updates** entry names both trackers and gains a pull-request line (Task 7). `docs/ticket-updates.md` gets the two trackers' behaviour and categories; both READMEs get a **Ticket updates** section and mark `closeOnComplete` as the old setting; the creating-plugins skill's `listProjects` row states the key shape.
7. **D9 for GitHub through `optionsFrom`, not a host op name.** github-source gains `listProjects` (its repositories, with `name`), and the manifest's Repository input changes `optionsFrom` from `listRepos` to `listProjects`. PR 1's `/api/sources/call` already filters `listProjects`, so the host does not change and never learns a GitHub op name. `listRepos` stays as an alias for any caller that names it. Deviation from D9's wording ("listRepos joins the filter"), same result.
8. **The ticket's project comes from the tracker's own record (D6).** github-source's `meta.project` is the repository from the issue's `repository_url` (GitHub's canonical case), else the id's repo; azure-boards-source's is the item's `System.TeamProject`, else the id's project. A pasted `acme/api#7` then still matches a rule saved for `Acme/API`.
9. **Reading fails loudly.** A failure reading the item or its type's states throws (the write-back fails and retries): in both trackers the same permission reads and comments, so a "could not read" line (Jira's) would never be posted anyway.
10. **Fakes are `fetch`, not HTTP servers.** Both connectors have a fixed host (`https://dev.azure.com`, `https://api.github.com`) and take `deps.fetch`; the fakes answer real `Response` objects (status, headers, JSON) and record every request, so no URL override enters shipped code and no port is opened.

## File structure

| File | Task | Responsibility |
|---|---|---|
| `src/core/ticket-updates.mjs` | 1 | `isProjectKey` admits `owner/repo` (decision 1) |
| `src/core/ticket-updates-routes.mjs` | 1 | the statuses route's comment names the new key rule (no code change) |
| `test/helpers/fake-azure-boards.mjs` (new) | 2 | an in-memory Azure DevOps (types, categories, states, items, comments, PATCH) |
| `plugins/azure-boards-source/connector/index.mjs` | 2, 3 | `categoryOf`, `listStatuses`, `legacyMove`, `capabilities`, `meta.project` (2); `applyMove`, `reportResult`'s move (3) |
| `plugins/azure-boards-source/connector/ado-api.mjs` | 2 | a refusal carries Azure's message alone (`detail`) |
| `plugins/azure-boards-source/worca-cc-plugin.json` | 2 | `0.2.0` |
| `plugins/azure-boards-source/README.md` | 3 | **Ticket updates** section; `closeOnComplete` the old setting |
| `test/helpers/fake-github-issues.mjs` (new) | 4 | an in-memory GitHub Issues API (repos, issues, comments, PATCH) |
| `plugins/github-source/connector/index.mjs` | 4, 5 | `STATUSES`, `statusOf`, `listProjects`, `listStatuses`, `legacyMove`, `capabilities`, `meta.project` (4); `applyMove`, `reportResult`'s move (5) |
| `plugins/github-source/connector/github-api.mjs` | 5 | a refusal carries GitHub's message alone (`detail`) |
| `plugins/github-source/worca-cc-plugin.json` | 4 | `0.3.0`; Repository `optionsFrom: "listProjects"` |
| `plugins/github-source/README.md` | 5 | **Ticket updates** section; `closeOnComplete` the old setting |
| `docs/ticket-updates.md`, `docs/changelog/unreleased.md`, `.claude/skills/creating-worca-cc-plugins/SKILL.md`, `plans/ticket-updates-design.md` | 7 | docs, changelog, the key shape, a pointer from §14 |

Tests: `test/ticket-updates.test.mjs`, `test/api-ticket-updates.test.mjs`, `test/api-ticket-updates-trackers.test.mjs` (new; 1, 4), `test/azure-boards-ticket-updates.test.mjs` (new; 2, 3), `test/azure-boards-connector.test.mjs` (2), `test/github-source-ticket-updates.test.mjs` (new; 4, 5), `test/github-source-connector.test.mjs` (4), `test/marketplace-ticket-updates-trackers.test.mjs` (new; 6).

## Review Focus

1. **Nothing changes without a save.** No `move` → both plugins' old paths, byte for byte (Tasks 3, 5: the "without a move" tests and the unchanged legacy rows).
2. **The key rule (decision 1).** Still no dot part, no `%`, no backslash, no second slash; each plugin checks its own shape before a request (Tasks 1, 2, 4).
3. **Never closes as cancelled by Any Done status.** Azure never picks Removed; GitHub never turns a not-planned issue into a completed one (Tasks 3, 5).
4. **Which failures are a line and which throw** (Tasks 3, 5), matching PR 1's Deviation 3.
5. **No UI change** (Task 6).

---

### Task 1: A project key may be `owner/repo`

Decision 1. **Needs approval before it runs.**

**Files:**
- Modify: `src/core/ticket-updates.mjs` (the `isProjectKey` comment and expression), `src/core/ticket-updates-routes.mjs` (one comment in the statuses route)
- Test: modify `test/ticket-updates.test.mjs` (import `isProjectKey`; one row; one new test), `test/api-ticket-updates.test.mjs` (the statuses route's refused keys); create `test/api-ticket-updates-trackers.test.mjs`

**Interfaces:**
- Produces: `isProjectKey(v) → boolean` (same name and export as PR 1): true for a string with no `\`, `?`, `#`, `%` or control character, split by `/` into one or two parts, each 1 to 100 characters and not only dots. `validateTicketUpdates` and the statuses route use it unchanged, so both now take `Acme/API`.
- `test/api-ticket-updates-trackers.test.mjs`: boots `ui/server.mjs` in mock mode with the flag on and github-source linked; Task 4 appends to it.

- [ ] **Step 1: Write the failing tests**

In `test/ticket-updates.test.mjs`, the import becomes:

```js
import {
  toMove, moveFor, validateTicketUpdates, projectFilter, filterProjects, describeMove, TU_LIMITS, TicketUpdatesError, isProjectKey,
} from '../src/core/ticket-updates.mjs';
```

Replace the row

```js
    { name: 'a rule project is a key: not an object, null or a boolean; project values and rule projects refuse a/b', run: () => {
      for (const project of [{}, null, true, ['SHOP']]) refused({ projects: [], rules: [NONE_ALL, { ...RULE('x', '', { kind: 'none' }), project }] }, /project must be a project key/);
      refused({ projects: [{ value: 'a/b' }], rules: [NONE_ALL] }, /is not a project key/);
      refused({ projects: [], rules: [NONE_ALL, RULE('a/b', '', { kind: 'none' })] }, /is not a project key/);
    } },
```

with

```js
    { name: 'a rule project is a key: not an object, null or a boolean; owner/repo is a key, any other slash is not (PR 2, decision 1)', run: () => {
      for (const project of [{}, null, true, ['SHOP']]) refused({ projects: [], rules: [NONE_ALL, { ...RULE('x', '', { kind: 'none' }), project }] }, /project must be a project key/);
      for (const bad of ['a/b/c', '/a', 'a/', 'a//b', 'a/..', './a']) {
        refused({ projects: [{ value: bad }], rules: [NONE_ALL] }, /is not a project key/);
        refused({ projects: [], rules: [NONE_ALL, RULE(bad, '', { kind: 'none' })] }, /is not a project key/);
      }
      const ok = validateTicketUpdates({ projects: [{ value: 'Acme/API', label: 'API' }], rules: [NONE_ALL, RULE('Acme/API', 'API', { kind: 'none' })] });
      assert.deepEqual([ok.projects, ok.rules[1].project], [[{ value: 'Acme/API', label: 'API' }], 'Acme/API']);
    } },
```

and add, right after the `validateTicketUpdates` test that holds that row:

```js
test('isProjectKey (PR 2, decision 1): at most one slash between two parts (owner/repo); never a dot part, %, \\, ?, # or a control character', () => {
  for (const ok of ['SHOP', 'My Project', 'Acme/API', 'acme/web.site', `${'o'.repeat(39)}/${'r'.repeat(100)}`, 'X'.repeat(100)]) {
    assert.equal(isProjectKey(ok), true, ok);
  }
  for (const bad of ['', '.', '..', 'a/b/c', '/a', 'a/', 'a//b', 'a/..', './a', 'a/.', 'X'.repeat(101), `a/${'r'.repeat(101)}`, 'a%2eb',
    'a\\b', 'a?b', 'a#b', 'a\u0001b', null, 7]) {
    assert.equal(isProjectKey(bad), false, String(bad));
  }
});
```

In `test/api-ticket-updates.test.mjs`, the refused keys of the statuses route (`for (const bad of ['..', '.', 'A/B', …`) become:

```js
  for (const bad of ['..', '.', 'A/B/C', 'A/..', '/A', 'A%5CB', 'A%3FB', 'X'.repeat(101), '%252e%252e', '.%252e', 'A%01B', 'A%7FB']) {
```

Create `test/api-ticket-updates-trackers.test.mjs`:

```js
// test/api-ticket-updates-trackers.test.mjs — Ticket updates' routes and New run's project list for github-source
// (plans/ticket-updates-pr2-plan.md decisions 1 and 7) on the real server in mock mode: GitHub keys a project as owner/repo, a
// single-profile source saves under `default`, and the Repository input lists the projects you work on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { readTicketUpdates } from '../src/core/plugin-config.mjs';
import { setMockSourceResponses } from '../src/core/plugin-shim.mjs';

useTempHome(after, 'worca-tu-trackers-');
const prev = { flags: process.env.WORCA_FLAGS, mock: process.env.WORCA_MOCK };
process.env.WORCA_FLAGS = 'ticketUpdates';
process.env.WORCA_MOCK = '1';
const GITHUB = fileURLToPath(new URL('../plugins/github-source', import.meta.url));
let srv; let base;

before(async () => {
  await linkPlugin('github-source', GITHUB);
  ({ server: srv } = await import('../ui/server.mjs'));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await new Promise((r) => srv.close(r));
  for (const [k, v] of [['WORCA_FLAGS', prev.flags], ['WORCA_MOCK', prev.mock]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setMockSourceResponses(null);
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const raw = await r.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { json = null; }
  return { status: r.status, json };
};
const TU = '/api/plugins/github-source/ticket-updates';
const enc = encodeURIComponent;
const NONE_ALL = { project: '', moment: 'finished', target: { kind: 'none' } };
const NOT_PLANNED = { kind: 'status', value: 'not_planned', label: 'Closed as not planned', category: 'cancelled' };

test('decision 1: a project may be owner/repo: its statuses, a save and the GET take it; any other slash is refused', async () => {
  setMockSourceResponses(null);
  assert.equal((await call('GET', `${TU}/statuses?sourceId=github&project=${enc('Acme/API')}`)).status, 200);
  const rules = [NONE_ALL, { project: 'Acme/API', label: 'API', moment: 'finished', target: NOT_PLANNED }];
  assert.deepEqual((await call('PUT', TU, { sourceId: 'github', projects: [{ value: 'Acme/API', label: 'API' }], rules })).json, { ok: true });
  const rec = readTicketUpdates('github-source', 'default', 'github');
  assert.deepEqual([rec.projects, rec.rules], [[{ value: 'Acme/API', label: 'API' }], rules], 'a single-profile source saves under default');
  const got = (await call('GET', `${TU}?sourceId=github`)).json;
  assert.deepEqual([got.available, got.connection, got.profile, got.saved, got.rules[1].project],
    [true, 'saved', { id: 'default', label: 'GitHub Issues' }, true, 'Acme/API']);
  // %252e%252e arrives as "%2e%2e": a key never has "%", and no part of it is "." or ".."
  for (const bad of ['a/b/c', '/a', 'a/', 'a//b', 'a/..', './a', 'a/%252e%252e', 'a\\b/c']) {
    assert.deepEqual(await call('GET', `${TU}/statuses?sourceId=github&project=${bad.includes('%') ? bad : enc(bad)}`).then((x) => [x.status, x.json]),
      [400, { error: 'project is not a project key' }], bad);
  }
  assert.equal((await call('PUT', TU, { sourceId: 'github', projects: [{ value: 'a/b/c' }], rules: [NONE_ALL] })).status, 400);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/ticket-updates.test.mjs test/api-ticket-updates.test.mjs test/api-ticket-updates-trackers.test.mjs`
Expected: FAIL — `isProjectKey('Acme/API')` is false; `validateTicketUpdates` refuses `Acme/API` ("Acme/API is not a project key."); the trackers test's statuses call answers 400 where 200 is expected. (The first server boot in a file can take a minute on Windows: `ui/server.mjs`' import.)

- [ ] **Step 3: Implement**

In `src/core/ticket-updates.mjs`, replace

```js
/** A project key as a tracker names it: 1 to 100 characters, never "." or "..", no slash, backslash, "?", "#", "%" or control
 *  character (it lands in a URL path in the plugin, where "%2e%2e" or ".%2e" reads as ".."; Jira keys are [A-Z][A-Z0-9_]*).
 *  jira-source checks the same in statusesOf. */
export const isProjectKey = (v) => typeof v === 'string' && v.length > 0 && v.length <= 100 && !/^\.+$/.test(v)
  && !/[/\\?#%\u0000-\u001f\u007f]/.test(v);
```

with

```js
/** A project key as a tracker names it: no backslash, "?", "#", "%" or control character, and at most one "/" between two parts
 *  of 1 to 100 characters, neither "." nor ".." (it lands in a URL path in the plugin, where "%2e%2e" or ".%2e" reads as "..").
 *  Jira keys are [A-Z][A-Z0-9_]*; GitHub keys a repository as owner/repo (plans/ticket-updates-pr2-plan.md decision 1). Each
 *  plugin checks its own shape too: jira-source and azure-boards-source refuse any slash, github-source wants owner/repo. */
export const isProjectKey = (v) => typeof v === 'string' && !/[\\?#%\u0000-\u001f\u007f]/.test(v)
  && v.split('/').length <= 2 && v.split('/').every((part) => part.length > 0 && part.length <= 100 && !/^\.+$/.test(part));
```

In `src/core/ticket-updates-routes.mjs`, the comment above `if (!isProjectKey(project))` becomes:

```js
    // A project is a key, never a path: a "." or ".." part, a second slash, "%" or a backslash would let the plugin's URL reach
    // another tracker endpoint. One slash is GitHub's owner/repo (PR 2, decision 1); each plugin checks its own shape again.
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/ticket-updates.test.mjs test/api-ticket-updates.test.mjs test/api-ticket-updates-trackers.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/ticket-updates.mjs src/core/ticket-updates-routes.mjs test/ticket-updates.test.mjs test/api-ticket-updates.test.mjs test/api-ticket-updates-trackers.test.mjs
git commit -m "Ticket updates: a project key may be owner/repo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: azure-boards-source speaks the contract: `ticketUpdates`, `listStatuses`, `legacyMove`, `meta.project`; version 0.2.0

D1 (Azure's mapping), D4, D5, D6; decisions 3, 4, 8, 10. `reportResult` is Task 3.

**Files:**
- Create: `test/helpers/fake-azure-boards.mjs`, `test/azure-boards-ticket-updates.test.mjs`
- Modify: `plugins/azure-boards-source/connector/index.mjs`, `plugins/azure-boards-source/connector/ado-api.mjs`, `plugins/azure-boards-source/worca-cc-plugin.json` (`"version": "0.2.0"`), `test/azure-boards-connector.test.mjs` (the `capabilities` `deepEqual`)

**Interfaces:**
- Produces (connector): exported `categoryOf(state) → 'todo'|'in_progress'|'done'|'cancelled'`; `capabilities() → { writeBack: true, incrementalSync: false, ticketUpdates: true }`; `listStatuses({ project }) → [{ value: <state name>, label: <state name>, category }]`; `legacyMove() → { field: 'closeOnComplete', target: { category: 'done' } | null }`; `getTask(id).meta.project` = `System.TeamProject`.
- Inside `createTaskSource` (Task 3 uses them): `lc(s)`, `projectOf(project)`, `azureSaid(err)`, `ownWords(err)`, `statesOfProject(project)`.
- `adoFetch` errors of kind `plugin` gain `detail` (Azure's `message` alone, `''` without one).
- `fakeAzureBoards({ token, projects, types, hidden, items, refusePatch }) → { fetch, items, requests }`; exported `AGILE` (the types of an Agile project, plus a custom type, a hidden one and a disabled one).

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/fake-azure-boards.mjs`:

```js
// test/helpers/fake-azure-boards.mjs — a fake Azure DevOps (Boards REST 7.1) for azure-boards-source's Ticket updates
// (plans/ticket-updates-pr2-plan.md): one organization ("acme"), in memory, every request recorded. The connector's host
// (https://dev.azure.com) is fixed and it takes an injected `fetch`, so the fake is that fetch: it answers real `Response`
// objects (status, headers, JSON body) and opens no port. Never a real Azure DevOps.
const st = (name, category) => ({ name, category });
/** An Agile-process project: its work item types and their states (category per state), a custom type with a state only it
 *  has, a hidden type and a disabled one (neither is listed). */
export const AGILE = [
  { name: 'Bug', states: [st('New', 'Proposed'), st('Active', 'InProgress'), st('Resolved', 'Resolved'), st('Closed', 'Completed')] },
  { name: 'Task', states: [st('New', 'Proposed'), st('Active', 'InProgress'), st('Closed', 'Completed'), st('Removed', 'Removed')] },
  { name: 'User Story', states: [st('New', 'Proposed'), st('Active', 'InProgress'), st('Resolved', 'Resolved'), st('Closed', 'Completed'),
    st('Removed', 'Removed')] },
  { name: 'Shipping Note', states: [st('Draft', 'Proposed'), st('Shipped', 'Completed')] },
  { name: 'Idea', states: [st('Proposed', 'Proposed'), st('Dropped', 'Removed')] },
  { name: 'Code Review Request', states: [st('Requested', 'Proposed'), st('Closed', 'Completed')] },
  { name: 'Old Type', isDisabled: true, states: [st('Parked', 'Proposed')] },
];
const ORG = 'acme';

/**
 * @param {{token?:string, projects?:string[], types?:Record<string,object[]>, hidden?:Record<string,string[]>,
 *   items?:Array<{id:number, project:string, type:string, state:string}>, refusePatch?:{status:number, body:any}|null}} o
 */
export function fakeAzureBoards(o = {}) {
  const opt = { token: 'pat', projects: ['Shop'], types: { Shop: AGILE }, hidden: { Shop: ['Code Review Request'] }, items: [], refusePatch: null, ...o };
  const items = new Map(opt.items.map((w) => [w.id, { ...w, comments: [] }]));
  const requests = [];
  const auth = `Basic ${Buffer.from(`:${opt.token}`).toString('base64')}`;
  const answer = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  // Azure DevOps reads a project name case-insensitively in a URL
  const projectOf = (name) => Object.keys(opt.types).find((k) => k.toLowerCase() === String(name).toLowerCase());
  const view = (w) => ({ id: w.id, rev: 1, fields: { 'System.Id': w.id, 'System.Title': `Item ${w.id}`, 'System.State': w.state,
    'System.WorkItemType': w.type, 'System.TeamProject': w.project, 'System.Tags': '', 'System.ChangedDate': '2026-10-01T00:00:00Z' } });

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers });
    if (headers.authorization !== auth) return answer(401, null);
    const seg = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);   // [org, project | '_apis', …]
    if (seg[0] !== ORG) return answer(404, { message: `VS800001: The organization ${seg[0]} does not exist.` });
    if (seg[1] === '_apis' && seg[2] === 'projects') return answer(200, { count: opt.projects.length, value: opt.projects.map((name) => ({ name })) });
    const project = projectOf(seg[1]);
    if (!project) return answer(404, { message: `VS800075: The project with id '${seg[1]}' does not exist, or you do not have permission to access it.` });
    const types = opt.types[project];
    const rest = seg.slice(2).join('/');
    if (method === 'GET' && rest === '_apis/wit/workitemtypes') {
      return answer(200, { count: types.length, value: types.map((t) => ({ name: t.name, isDisabled: !!t.isDisabled, states: t.states.map((s) => ({ ...s, color: '007acc' })) })) });
    }
    if (method === 'GET' && rest === '_apis/wit/workitemtypecategories') {
      return answer(200, { count: 1, value: [{ name: 'Hidden Types Category', referenceName: 'Microsoft.HiddenCategory',
        workItemTypes: (opt.hidden[project] || []).map((name) => ({ name })) }] });
    }
    let m = /^_apis\/wit\/workitemtypes\/([^/]+)\/states$/.exec(rest);
    if (m && method === 'GET') {
      const t = types.find((x) => x.name.toLowerCase() === m[1].toLowerCase());
      return t ? answer(200, { count: t.states.length, value: t.states.map((s) => ({ ...s, color: '007acc' })) })
        : answer(404, { message: `VS402323: Work item type ${m[1]} does not exist.` });
    }
    m = /^_apis\/wit\/workitems\/(\d+)(\/comments)?$/i.exec(rest);
    const w = m && items.get(Number(m[1]));
    if (m && !w) return answer(404, { message: `TF401232: Work item ${m[1]} does not exist, or you do not have permissions to read it.` });
    if (m && m[2]) {
      if (method === 'POST') { w.comments.push(body.text); return answer(200, { id: w.comments.length, text: body.text }); }
      return answer(200, { totalCount: w.comments.length, comments: w.comments.map((text) => ({ text, createdBy: { displayName: 'Worca' }, createdDate: '2026-10-01T00:00:00Z' })) });
    }
    if (m && method === 'PATCH') {
      if (opt.refusePatch) return answer(opt.refusePatch.status, opt.refusePatch.body);
      const op = (Array.isArray(body) ? body : []).find((x) => x.path === '/fields/System.State');
      const t = types.find((x) => x.name === w.type);
      if (op && !t.states.some((s) => s.name === op.value)) {
        return answer(400, { message: 'TF401320: Rule Error for field State. Error code: Required, HasValues, LimitedToValues, AllowsOldValue, InvalidEmpty.' });
      }
      if (op) w.state = op.value;
      return answer(200, view(w));
    }
    if (m && method === 'GET') return answer(200, view(w));
    return answer(404, { message: `fake Azure DevOps: no route ${method} ${u.pathname}` });
  }
  return { fetch: fetchImpl, items, requests };
}
```

Create `test/azure-boards-ticket-updates.test.mjs`:

```js
// test/azure-boards-ticket-updates.test.mjs — azure-boards-source's Ticket updates (plans/ticket-updates-design.md D1, D4, D6,
// D11, §3; plans/ticket-updates-pr2-plan.md decisions 3 and 4) against a fake Azure DevOps: the capability, the old setting,
// a project's statuses with their categories, the ticket's project, and (Task 3) reportResult with a move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import createTaskSource, { categoryOf } from '../plugins/azure-boards-source/connector/index.mjs';
import { fakeAzureBoards } from './helpers/fake-azure-boards.mjs';

function site(o = {}) {
  const ado = fakeAzureBoards(o);
  const logs = [];
  const ctx = { apiVersion: 5, profile: 'work', log: (level, msg) => { logs.push(`${level} ${msg}`); },
    config: { organization: 'acme', token: 'pat', closeOnComplete: o.close ?? 'no' }, state: { get: async () => null, set: async () => {} } };
  return { ado, logs, src: createTaskSource(ctx, { fetch: ado.fetch }) };
}

test('capabilities: ticketUpdates; write-back as before', () => {
  assert.deepEqual(site().src.capabilities(), { writeBack: true, incrementalSync: false, ticketUpdates: true });
});

test('legacyMove (D4): closeOnComplete yes is Any Done status, no or unset is nothing', () => {
  assert.deepEqual(site({ close: 'yes' }).src.legacyMove(), { field: 'closeOnComplete', target: { category: 'done' } });
  assert.deepEqual(site({ close: 'no' }).src.legacyMove(), { field: 'closeOnComplete', target: null });
  assert.deepEqual(site({ close: '' }).src.legacyMove(), { field: 'closeOnComplete', target: null });
});

test("D1: Azure's state categories onto Worca's four; Resolved is in progress, Removed cancelled", () => {
  assert.deepEqual(['Proposed', 'InProgress', 'Resolved', 'Completed', 'Removed', 'Odd', undefined].map((category) => categoryOf({ category })),
    ['todo', 'in_progress', 'in_progress', 'done', 'cancelled', 'todo', 'todo']);
});

test("listStatuses: every state of the project's visible types once, in Azure's order, by name, with its category", async () => {
  const { src, ado } = site();
  assert.deepEqual(await src.listStatuses({ project: 'Shop' }), [
    { value: 'New', label: 'New', category: 'todo' }, { value: 'Active', label: 'Active', category: 'in_progress' },
    { value: 'Resolved', label: 'Resolved', category: 'in_progress' }, { value: 'Closed', label: 'Closed', category: 'done' },
    { value: 'Removed', label: 'Removed', category: 'cancelled' }, { value: 'Draft', label: 'Draft', category: 'todo' },
    { value: 'Shipped', label: 'Shipped', category: 'done' }, { value: 'Proposed', label: 'Proposed', category: 'todo' },
    { value: 'Dropped', label: 'Dropped', category: 'cancelled' }]);
  assert.deepEqual(ado.requests.map((r) => `${r.method} ${r.path}?api-version=${r.query['api-version']}`).sort(), [
    'GET /acme/Shop/_apis/wit/workitemtypecategories?api-version=7.1', 'GET /acme/Shop/_apis/wit/workitemtypes?api-version=7.1']);
  assert.equal((await src.listStatuses({ project: 'Shop' })).some((s) => s.value === 'Requested' || s.value === 'Parked'), false,
    'a hidden type (Code Review Request) and a disabled one add nothing');
});

test("listStatuses: a refusal says Azure's own words, not the REST URL; a bad token stays auth; a project is never a path", async () => {
  const { src, ado } = site();
  await assert.rejects(src.listStatuses({ project: 'Nope' }), (e) => e.kind === 'plugin'
    && e.message === "Azure Boards refused the request: VS800075: The project with id 'Nope' does not exist, or you do not have permission to access it."
    && !/https?:|_apis/.test(e.message));
  await assert.rejects(site({ token: 'other' }).src.listStatuses({ project: 'Shop' }), (e) => e.kind === 'auth');
  await assert.rejects(src.listStatuses({}), (e) => e.kind === 'plugin' && e.message === 'a project is required');
  const before = ado.requests.length;
  for (const project of ['..', '.', 'A/B', 'A\\B', 'A?B', 'A#B', 'X'.repeat(101)]) {
    await assert.rejects(src.listStatuses({ project }), (e) => e.kind === 'plugin' && e.message === 'a project name cannot be a path', project);
  }
  assert.equal(ado.requests.length, before, 'no request reached Azure DevOps');
});

test("getTask: meta.project is the work item's own project (System.TeamProject), as listProjects names it (D6)", async () => {
  const { src } = site({ items: [{ id: 12, project: 'Shop', type: 'Bug', state: 'Active' }] });
  const t = await src.getTask('acme/shop#12');
  assert.deepEqual(t.meta, { organization: 'acme', project: 'Shop', id: 12, type: 'Bug' });
  assert.deepEqual(await src.listProjects(), [{ value: 'Shop', label: 'Shop' }], 'listProjects: no `name`, the name is the key');
});
```

In `test/azure-boards-connector.test.mjs`, the last assertion of `'htmlToMarkdown, markdownToHtml, parseWorkItemRef, capabilities'` becomes:

```js
  assert.deepEqual(createTaskSource(makeCtx(), { fetch: fakeFetch([]) }).capabilities(), { writeBack: true, incrementalSync: false, ticketUpdates: true });
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/azure-boards-ticket-updates.test.mjs test/azure-boards-connector.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../plugins/azure-boards-source/connector/index.mjs' does not provide an export named 'categoryOf'`; the connector test's `capabilities` `deepEqual` lacks `ticketUpdates`.

- [ ] **Step 3: Implement**

In `plugins/azure-boards-source/worca-cc-plugin.json`: `"version": "0.2.0",`.

In `plugins/azure-boards-source/connector/ado-api.mjs`, replace

```js
  if (!res.ok) throw err('plugin', `Azure DevOps ${res.status}${json?.message ? `: ${json.message}` : ''} (${method} ${full})`, { status: res.status });
```

with

```js
  // `detail`: Azure's own message alone, for a Ticket updates line (index.mjs azureSaid)
  if (!res.ok) {
    throw err('plugin', `Azure DevOps ${res.status}${json?.message ? `: ${json.message}` : ''} (${method} ${full})`,
      { status: res.status, detail: typeof json?.message === 'string' ? json.message : '' });
  }
```

In `plugins/azure-boards-source/connector/index.mjs`, after the header's third line (`// Completed-category state on reportResult. Ids "org/project#123" round-trip. deps.fetch injected by tests.`) add:

```js
// Ticket updates (plans/ticket-updates-design.md §3, plans/ticket-updates-pr2-plan.md): Worca decides what happens to a work
// item when a run finishes and passes it as reportResult's `move`; this plugin maps Azure's state categories onto Worca's four
// (D1), lists a project's states, says what its old closeOnComplete setting means (legacyMove, D4), and without a `move`
// behaves exactly as before.
```

Right before `export function parseWorkItemRef(id) {` add:

```js
/** D1: Azure's state categories onto Worca's four (Resolved counts as in progress, so Any Done status is Completed; user,
 *  2026-10-29); a state without a known category is to do. */
const CATEGORY = { Proposed: 'todo', InProgress: 'in_progress', Resolved: 'in_progress', Completed: 'done', Removed: 'cancelled' };
export const categoryOf = (state) => CATEGORY[state?.category] || 'todo';

```

Inside `createTaskSource`, after `const one = async (ref) => …;` (just before `return {`) add:

```js
  // ---- Ticket updates ----
  const lc = (s) => String(s ?? '').trim().toLowerCase();
  /** A project name, never a path (as jira-source's projectKeyOf): ".." would turn /{project}/_apis into another endpoint. */
  function projectOf(project) {
    const name = String(project ?? '').trim();
    if (!name) throw Object.assign(new Error('a project is required'), { kind: 'plugin' });
    if (name.length > 100 || /^\.+$/.test(name) || /[/\\?#]/.test(name)) {
      throw Object.assign(new Error('a project name cannot be a path'), { kind: 'plugin' });
    }
    return name;
  }
  /** Azure's own words for a refusal, without a trailing full stop; "Azure Boards gave no reason" when it sends none. */
  const azureSaid = (e) => (String(e?.detail || '').trim() || 'Azure Boards gave no reason').replace(/\.+$/, '');
  /** A refusal as Azure's words ("Azure Boards refused the request: …"), never adoFetch's status and REST URL, which the host's
   *  reach sentence would show as they are; auth, network and rate limit pass unchanged. */
  const ownWords = (e) => (e && e.kind === 'plugin' && e.status
    ? Object.assign(new Error(`Azure Boards refused the request: ${azureSaid(e)}.`), { kind: 'plugin', status: e.status }) : e);
  /** Every state of the project's visible work item types once, by name, in Azure's order, with its category (D1). Disabled
   *  types and the hidden ones (Code Review Request, Test Plan, …: Microsoft.HiddenCategory) add nothing. */
  async function statesOfProject(project) {
    const p = enc(projectOf(project));
    const [types, cats] = await Promise.all([adoFetch(ado, `${base}/${p}/_apis/wit/workitemtypes`),
      adoFetch(ado, `${base}/${p}/_apis/wit/workitemtypecategories`)]);
    const hiddenCat = (cats?.value || []).find((c) => c?.referenceName === 'Microsoft.HiddenCategory');
    const hidden = new Set((hiddenCat?.workItemTypes || []).map((t) => t?.name));
    const seen = new Set();
    const out = [];
    for (const t of types?.value || []) {
      if (!t || t.isDisabled || hidden.has(t.name)) continue;
      for (const s of Array.isArray(t.states) ? t.states : []) {
        const name = String(s?.name || '');
        if (!name || seen.has(lc(name))) continue;
        seen.add(lc(name));
        out.push({ value: name, label: name, category: categoryOf(s) });
      }
    }
    return out;
  }
```

In `getTask`, replace the `meta` line

```js
        meta: { organization: ref.org, project: ref.project, id: ref.id, type: f['System.WorkItemType'] || null } };
```

with

```js
        // meta.project (Ticket updates, D6): the item's own project as listProjects names it, whatever case the id was typed in
        meta: { organization: ref.org, project: f['System.TeamProject'] || ref.project, id: ref.id, type: f['System.WorkItemType'] || null } };
```

Replace `capabilities() { return { writeBack: true, incrementalSync: false }; },` with:

```js
    capabilities() { return { writeBack: true, incrementalSync: false, ticketUpdates: true }; },
    // ---- Ticket updates (plans/ticket-updates-design.md §3) ----
    async listStatuses({ project } = {}) {
      projectOf(project);   // its own words pass unchanged
      try { return await statesOfProject(project); } catch (e) { throw ownWords(e); }
    },
    legacyMove() {
      return { field: 'closeOnComplete', target: toBool(ctx.config?.closeOnComplete) ? { category: 'done' } : null };
    },
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/azure-boards-ticket-updates.test.mjs test/azure-boards-connector.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/helpers/fake-azure-boards.mjs test/azure-boards-ticket-updates.test.mjs test/azure-boards-connector.test.mjs plugins/azure-boards-source/connector/index.mjs plugins/azure-boards-source/connector/ado-api.mjs plugins/azure-boards-source/worca-cc-plugin.json
git commit -m "Ticket updates: azure-boards-source 0.2.0 lists states, says its old setting and the item's project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: azure-boards-source's `reportResult` with a `move`

D1, D10's refusal rule as PR 1's Deviation 3, D11; decisions 3 and 9. The state changes first, then one comment ending with the line. Without a `move`, byte for byte as today.

**Files:**
- Modify: `plugins/azure-boards-source/connector/index.mjs` (`refusedMove`, `applyMove`, `reportResult`), `plugins/azure-boards-source/README.md`
- Test: `test/azure-boards-ticket-updates.test.mjs` (append)

**Interfaces:**
- Consumes (Task 2): `lc`, `azureSaid`, `statesOfProject`, `one`, `adoFetch`, `escapeHtml`, `markdownToHtml`.
- Produces: `reportResult(id, { status, summary, links, move })`: with `move` → `{ commented: true, moved: { from, to } | null, note: string }`; without → `undefined`, exactly as before.

- [ ] **Step 1: Write the failing tests**

Append to `test/azure-boards-ticket-updates.test.mjs`:

```js
// ---- reportResult with a move (Task 3) ----
const RESULT = { status: 'completed', summary: 'done', links: [{ title: 'PR', url: 'https://dev.azure.com/acme/Shop/_git/api/pullrequest/5' }] };
const HTML = '<p>done</p><ul><li><a href="https://dev.azure.com/acme/Shop/_git/api/pullrequest/5">PR</a></li></ul>';
/** One report against a fresh fake holding work item 12 (a `type` in `state`). */
async function report(move, { type = 'Bug', state = 'Active', ...more } = {}) {
  const s = site({ items: [{ id: 12, project: 'Shop', type, state }], ...more });
  const out = await s.src.reportResult('acme/Shop#12', { ...RESULT, move });
  const w = s.ado.items.get(12);
  return { out, comment: w.comments.at(-1), state: w.state, calls: s.ado.requests.map((r) => r.method),
    patches: s.ado.requests.filter((r) => r.method === 'PATCH').map((r) => r.body), ...s };
}

test("Any Done status: the type's Completed state, moved first, then one comment ending with the line", async () => {
  const r = await report({ category: 'done' });
  assert.deepEqual(r.patches, [[{ op: 'add', path: '/fields/System.State', value: 'Closed' }]]);
  assert.deepEqual(r.out, { commented: true, moved: { from: 'Active', to: 'Closed' }, note: 'Moved to Closed.' });
  assert.equal(r.comment, `${HTML}<p>Moved to Closed.</p>`);
  assert.deepEqual(r.calls, ['GET', 'GET', 'PATCH', 'POST'], 'read the item, its type\'s states, move, then comment');
  assert.equal((await report({ category: 'done' }, { state: 'Resolved' })).out.note, 'Moved to Closed.', 'D1: Resolved is not done yet');
  assert.equal((await report({ category: 'done' }, { type: 'Shipping Note', state: 'Draft' })).out.note, 'Moved to Shipped.');
});

test('Any Done status never picks Removed; a ticket already Completed or Removed stays; a type without a Done status says so', async () => {
  for (const [type, state] of [['Bug', 'Closed'], ['Task', 'Removed']]) {
    const r = await report({ category: 'done' }, { type, state });
    assert.deepEqual([r.out.note, r.patches.length, r.state], [`Already in ${state}.`, 0, state], state);
    assert.equal(r.comment, `${HTML}<p>Already in ${state}.</p>`);
  }
  const idea = await report({ category: 'done' }, { type: 'Idea', state: 'Proposed' });
  assert.deepEqual([idea.out.note, idea.patches.length], ["Not moved: Shop's Idea type has no Done status.", 0]);
});

test("a status move: by name; already there; this type lacks it; gone from the project; Removed may be picked by name", async () => {
  const byName = await report({ status: 'Resolved', name: 'Resolved' });
  assert.deepEqual([byName.out.note, byName.state], ['Moved to Resolved.', 'Resolved']);
  assert.equal((await report({ status: 'active', name: 'Active' })).out.note, 'Already in Active.');
  const lacks = await report({ status: 'Resolved', name: 'Resolved' }, { type: 'Task' });
  assert.deepEqual([lacks.out.note, lacks.patches.length], ["Not moved: Shop's Task type has no status named Resolved.", 0],
    'decision 3: no fallback to another state of the same category');
  const gone = await report({ status: 'Released', name: 'Released' });
  assert.equal(gone.out.note, 'Not moved: Shop has no status named Released any more.');
  assert.equal((await report({ status: 'Removed', name: 'Removed' }, { type: 'Task' })).out.note, 'Moved to Removed.');
});

test("a 4xx refusal of the move is a line with Azure's reason and the comment is posted; 401, 429 and 5xx throw", async () => {
  const r = await report({ category: 'done' }, { refusePatch: { status: 400, body: { message: 'TF401320: Rule Error for field Reason.' } } });
  assert.deepEqual([r.out.moved, r.out.note], [null, 'Not moved: Azure Boards refused the move to Closed: TF401320: Rule Error for field Reason.']);
  assert.equal(r.comment, `${HTML}<p>Not moved: Azure Boards refused the move to Closed: TF401320: Rule Error for field Reason.</p>`);
  const silent = await report({ category: 'done' }, { refusePatch: { status: 403, body: {} } });
  assert.equal(silent.out.note, 'Not moved: Azure Boards refused the move to Closed: Azure Boards gave no reason.');
  for (const [status, kind] of [[401, 'auth'], [429, 'rate-limit'], [500, 'plugin']]) {
    const s = site({ items: [{ id: 12, project: 'Shop', type: 'Bug', state: 'Active' }], refusePatch: { status, body: { message: 'no' } } });
    await assert.rejects(s.src.reportResult('acme/Shop#12', { ...RESULT, move: { category: 'done' } }), (e) => e.kind === kind, String(status));
    assert.deepEqual(s.ado.items.get(12).comments, [], `${status}: no comment, so the write-back fails and can be retried`);
  }
});

test("Don't move: no read, no move, no line; a run that did not finish passes none and only comments", async () => {
  const r = await report({ none: true });
  assert.deepEqual([r.calls, r.out, r.comment], [['POST'], { commented: true, moved: null, note: '' }, HTML]);
});

test('without a move: exactly the old behaviour (comment first, then closeOnComplete)', async () => {
  const s = site({ close: 'yes', items: [{ id: 12, project: 'Shop', type: 'Bug', state: 'Active' }] });
  assert.equal(await s.src.reportResult('acme/Shop#12', RESULT), undefined);
  assert.deepEqual(s.ado.requests.map((r) => r.method), ['POST', 'GET', 'GET', 'PATCH']);
  assert.deepEqual([s.ado.items.get(12).comments, s.ado.items.get(12).state], [[HTML], 'Closed']);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/azure-boards-ticket-updates.test.mjs`
Expected: FAIL — with a `move` the connector runs the legacy path: it comments first, never moves (`closeOnComplete` is `no`), and answers `undefined` instead of `{ commented, moved, note }`. The "without a move" test passes already.

- [ ] **Step 3: Implement**

In `plugins/azure-boards-source/connector/index.mjs`, inside `createTaskSource`, after `statesOfProject` (Task 2) add:

```js
  /** PR 1's rule for a refused move (its Deviation 3), in Azure's terms: a 4xx other than 401 (auth, as 203) and 429 (rate
   *  limit) is a line; a 5xx, network error, timeout, refused token or rate limit throws, so the write-back can be retried. */
  const refusedMove = (e) => !!e && e.kind === 'plugin' && e.status >= 400 && e.status < 500 && e.status !== 429;
  /** One move, before the comment (D11). Answers { note, moved }. Any Done status is the type's first Completed-category state,
   *  never a Removed one; a status move is that state of the work item's own type, with no fallback (decision 3). Reading the
   *  item or its states throws (decision 9). */
  async function applyMove(ref, move) {
    const none = { note: '', moved: null };
    const want = typeof move.status === 'string' ? move.status.trim() : '';
    if (move.none === true || (move.category !== 'done' && !want)) return none;
    const f = (await one(ref))?.fields || {};
    const type = String(f['System.WorkItemType'] || '');
    const project = String(f['System.TeamProject'] || ref.project);
    const from = String(f['System.State'] || '?');
    // Work Item Type States - List is a preview endpoint in 7.1: pin its version, as closeOnComplete does.
    const states = ((await adoFetch(ado, `${base}/${enc(ref.project)}/_apis/wit/workitemtypes/${enc(type)}/states?api-version=7.1-preview.1`))?.value || [])
      .filter((s) => s && s.name);
    let to;
    if (move.category === 'done') {
      const now = states.find((s) => lc(s.name) === lc(from));
      if (now && (now.category === 'Completed' || now.category === 'Removed')) return { ...none, note: `Already in ${from}.` };
      to = states.find((s) => s.category === 'Completed');
      if (!to) return { ...none, note: `Not moved: ${project}'s ${type} type has no Done status.` };
    } else {
      const named = typeof move.name === 'string' && move.name.trim() ? move.name.trim() : want;
      if (lc(from) === lc(want)) return { ...none, note: `Already in ${from}.` };
      to = states.find((s) => lc(s.name) === lc(want));
      if (!to) {
        let has = true;
        try { has = (await statesOfProject(ref.project)).some((s) => lc(s.value) === lc(want)); } catch { has = true; }   // unknown: the type line
        return { ...none, note: has ? `Not moved: ${project}'s ${type} type has no status named ${named}.`
          : `Not moved: ${project} has no status named ${named} any more.` };
      }
    }
    try {
      await adoFetch(ado, `${base}/${enc(ref.project)}/_apis/wit/workitems/${ref.id}`, {
        method: 'PATCH', contentType: 'application/json-patch+json', body: [{ op: 'add', path: '/fields/System.State', value: to.name }],
      });
    } catch (e) {
      if (refusedMove(e)) return { ...none, note: `Not moved: Azure Boards refused the move to ${to.name}: ${azureSaid(e)}.` };
      throw e;
    }
    return { note: `Moved to ${to.name}.`, moved: { from, to: to.name } };
  }
```

In `reportResult`, change the signature line to

```js
    async reportResult(id, { status, summary: text, links = [], move } = {}) {
```

and, right after the `const html = …;` line (before the comment `await adoFetch(…`), add:

```js
      if (move && typeof move === 'object') {
        // Ticket updates (D11): Worca decided the move; the state changes first, then one comment: the run summary, its links,
        // then the outcome line last. Without a move (nothing saved in Worca) the old path below runs unchanged (D4).
        const out = await applyMove(ref, move);
        await adoFetch(ado, `${base}/${enc(ref.project)}/_apis/wit/workItems/${ref.id}/comments?api-version=7.1-preview.4`,
          { method: 'POST', body: { text: `${html}${out.note ? `<p>${escapeHtml(out.note)}</p>` : ''}` } });
        return { commented: true, moved: out.moved, note: out.note };
      }
```

The rest of `reportResult` stays exactly as it is.

In `plugins/azure-boards-source/README.md`, **Setup**'s `closeOnComplete` row becomes:

```
| closeOnComplete | select yes/no | no | the old setting: once **Ticket updates** is saved for this connection (Labs flag `ticketUpdates`), Worca no longer uses it. Until then: move the work item to its type's Completed state when a run finishes successfully |
```

and right before `## Pull request link` add:

```markdown
## Ticket updates

With the Labs flag **Ticket updates** on, Worca decides what a finished run does to its work item (Marketplace › Installed ›
Azure Boards › Settings › **Ticket updates**: the projects you work on and, per project, Don't move, Any Done status or one
of that project's states). The plugin answers `capabilities()` with `ticketUpdates: true` and:

- **listStatuses** — every state of the project's work item types once (disabled and hidden types left out), with Worca's
  category: Proposed is to do, In Progress and Resolved in progress, Completed done, Removed cancelled.
- **legacyMove** — what **Close work item on completion** means (Yes: Any Done status), so the section starts from it.
- **reportResult with a move** — the state first, then one comment: the run summary, its links, and a last line saying what
  happened. **Any Done status** is the item type's first Completed state (Agile `Closed`, Scrum and Basic `Done`), never
  Removed; a Resolved item is not done yet. A picked state is that state of the item's own type, never another one. Last
  lines:
  - `Moved to Closed.` / `Already in Closed.` (an item already Completed or Removed stays where it is)
  - `Not moved: Shop's Idea type has no Done status.`
  - `Not moved: Shop's Task type has no status named Resolved.`
  - `Not moved: Shop has no status named Shipped any more.`
  - `Not moved: Azure Boards refused the move to Closed: <Azure's message>.` — a 4xx other than 401 and 429;
    `Azure Boards gave no reason` when Azure sends no message.

  In every case above the comment is still posted. A refused token, a rate limit (429), a server error (5xx), a network
  error or a timeout fails the write-back, so it can be tried again.

Until Ticket updates is saved for a connection, write-back works exactly as described under Write-back.

```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/azure-boards-ticket-updates.test.mjs test/azure-boards-connector.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/azure-boards-source/connector/index.mjs plugins/azure-boards-source/README.md test/azure-boards-ticket-updates.test.mjs
git commit -m "Ticket updates: azure-boards-source moves a work item by Worca's rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: github-source speaks the contract: repositories as projects, `ticketUpdates`, `listStatuses`, `legacyMove`, `meta.project`; version 0.3.0

D1 (GitHub's mapping), D4, D5, D6, D9; decisions 2, 4, 7, 8, 10. `reportResult` is Task 5.

**Files:**
- Create: `test/helpers/fake-github-issues.mjs`, `test/github-source-ticket-updates.test.mjs`
- Modify: `plugins/github-source/connector/index.mjs`, `plugins/github-source/worca-cc-plugin.json` (`"version": "0.3.0"`; the Repository input's `optionsFrom`), `test/github-source-connector.test.mjs` (the `getTask` `meta` `deepEqual`), `test/api-ticket-updates-trackers.test.mjs` (import; one test)

**Interfaces:**
- Produces (connector): exported `STATUSES` (frozen `[{ value: 'open', label: 'Open', category: 'todo' }, { value: 'completed', label: 'Closed', category: 'done' }, { value: 'not_planned', label: 'Closed as not planned', category: 'cancelled' }]`) and `statusOf(issue) → one of STATUSES or { value: 'duplicate', label: 'Closed as duplicate', category: 'cancelled' }`; `capabilities() → { writeBack: true, incrementalSync: false, ticketUpdates: true }`; `listProjects() → [{ value: 'Acme/API', label: 'Acme/API', name: 'API' }]`; `listRepos()` unchanged; `listStatuses({ project }) → STATUSES` copies (no request; `project` must be `owner/repo`); `legacyMove() → { field: 'closeOnComplete', target: { category: 'done' } | null }`; `getTask(id).meta.project` = the repository from `repository_url`, else the id's repo.
- Inside `createTaskSource` (Task 5 uses it): `repoList()`.
- `fakeGithubIssues({ token, repos, issues, refusePatch }) → { fetch, issues, requests, issue(repo, number) }`.

- [ ] **Step 1: Write the failing tests**

Create `test/helpers/fake-github-issues.mjs`:

```js
// test/helpers/fake-github-issues.mjs — a fake GitHub Issues REST API for github-source's Ticket updates
// (plans/ticket-updates-pr2-plan.md): in memory, every request recorded. The connector's host (https://api.github.com) is fixed
// and it takes an injected `fetch`, so the fake is that fetch: it answers real `Response` objects and opens no port. Not
// test/helpers/fake-github.mjs, which serves git data for the git-free transports. Never a real GitHub.

/**
 * @param {{token?:string, repos?:Array<{full_name:string, name?:string}>,
 *   issues?:Array<{repo:string, number:number, state:'open'|'closed', state_reason?:string|null}>,
 *   refusePatch?:{status:number, body:any, headers?:object}|null}} o
 */
export function fakeGithubIssues(o = {}) {
  const opt = { token: 'tok', repos: [{ full_name: 'Acme/API' }, { full_name: 'Acme/Web' }], issues: [], refusePatch: null, ...o };
  // GitHub reads owner/repo case-insensitively in a URL and answers its canonical name
  const keyOf = (repo, number) => `${String(repo).toLowerCase()}#${number}`;
  const issues = new Map(opt.issues.map((i) => [keyOf(i.repo, i.number), { state_reason: null, ...i, comments: [] }]));
  const requests = [];
  const answer = (status, body, headers = {}) => new Response(body == null ? null : JSON.stringify(body),
    { status, headers: { 'content-type': 'application/json', ...headers } });
  const view = (i) => ({ number: i.number, title: `Issue ${i.number}`, body: '', state: i.state, state_reason: i.state_reason,
    html_url: `https://github.com/${i.repo}/issues/${i.number}`, repository_url: `https://api.github.com/repos/${i.repo}`,
    labels: [], assignee: null, updated_at: '2026-10-01T00:00:00Z' });

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body });
    if (headers.authorization !== `Bearer ${opt.token}`) return answer(401, { message: 'Bad credentials' });
    if (method === 'GET' && u.pathname === '/user/repos') {
      return answer(200, opt.repos.map((r) => ({ full_name: r.full_name, name: r.name ?? r.full_name.split('/')[1] })));
    }
    const m = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)(\/comments)?$/.exec(u.pathname);
    const i = m && issues.get(keyOf(`${m[1]}/${m[2]}`, m[3]));
    if (!i) return answer(404, { message: 'Not Found' });
    if (m[4]) {
      if (method === 'POST') { i.comments.push(body.body); return answer(201, { id: i.comments.length, body: body.body }); }
      return answer(200, []);
    }
    if (method === 'PATCH') {
      if (opt.refusePatch) return answer(opt.refusePatch.status, opt.refusePatch.body, opt.refusePatch.headers);
      i.state = body.state || i.state;
      i.state_reason = i.state === 'open' ? 'reopened' : (body.state_reason ?? 'completed');
      return answer(200, view(i));
    }
    return answer(200, view(i));
  }
  return { fetch: fetchImpl, issues, requests, issue: (repo, number) => issues.get(keyOf(repo, number)) };
}
```

Create `test/github-source-ticket-updates.test.mjs`:

```js
// test/github-source-ticket-updates.test.mjs — github-source's Ticket updates (plans/ticket-updates-design.md D1, D4, D6, D9,
// D11, §3; plans/ticket-updates-pr2-plan.md decisions 1, 2 and 4) against a fake GitHub Issues API: the capability, the repos
// as projects, the old setting, the three statuses, the ticket's project, and (Task 5) reportResult with a move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createTaskSource, { STATUSES, statusOf } from '../plugins/github-source/connector/index.mjs';
import { fakeGithubIssues } from './helpers/fake-github-issues.mjs';

function site(o = {}) {
  const gh = fakeGithubIssues(o);
  const ctx = { apiVersion: 1, config: { token: 'tok', closeOnComplete: o.close ?? 'no' }, log: () => {},
    state: { get: async () => null, set: async () => {} } };
  return { gh, src: createTaskSource(ctx, { fetch: gh.fetch }) };
}

test('capabilities: ticketUpdates; write-back as before', () => {
  assert.deepEqual(site().src.capabilities(), { writeBack: true, incrementalSync: false, ticketUpdates: true });
});

test('listProjects: the repos, each with its name alone (D5); listRepos unchanged; the Repository input lists projects (D9)', async () => {
  const { src } = site({ repos: [{ full_name: 'Acme/API', name: 'API' }, { full_name: 'Acme/web-site', name: 'web-site' }] });
  assert.deepEqual(await src.listProjects(), [{ value: 'Acme/API', label: 'Acme/API', name: 'API' },
    { value: 'Acme/web-site', label: 'Acme/web-site', name: 'web-site' }]);
  assert.deepEqual(await src.listRepos(), [{ value: 'Acme/API', label: 'Acme/API' }, { value: 'Acme/web-site', label: 'Acme/web-site' }]);
  const manifest = JSON.parse(readFileSync(new URL('../plugins/github-source/worca-cc-plugin.json', import.meta.url), 'utf8'));
  assert.equal(manifest.taskSources[0].inputs.find((i) => i.key === 'repo').optionsFrom, 'listProjects');
});

test('legacyMove (D4): closeOnComplete yes is Any Done status, no or unset is nothing', () => {
  assert.deepEqual(site({ close: 'yes' }).src.legacyMove(), { field: 'closeOnComplete', target: { category: 'done' } });
  assert.deepEqual(site({ close: 'no' }).src.legacyMove(), { field: 'closeOnComplete', target: null });
});

test('listStatuses (D1): open is to do, closed as completed done, closed as not planned cancelled; no request; owner/repo only', async () => {
  const { src, gh } = site();
  assert.deepEqual(await src.listStatuses({ project: 'Acme/API' }), [{ value: 'open', label: 'Open', category: 'todo' },
    { value: 'completed', label: 'Closed', category: 'done' }, { value: 'not_planned', label: 'Closed as not planned', category: 'cancelled' }]);
  assert.deepEqual(STATUSES.map((s) => s.value), ['open', 'completed', 'not_planned']);
  await assert.rejects(src.listStatuses({}), (e) => e.kind === 'plugin' && e.message === 'a project is required');
  for (const project of ['acme', 'a/b/c', '/a', 'a/', '../x', 'a/..', 'a/.', '-a/b', 'a b/c', 'a/b?c', `${'o'.repeat(40)}/r`]) {
    await assert.rejects(src.listStatuses({ project }), (e) => e.kind === 'plugin' && e.message === 'a project is a repository: owner/repo', project);
  }
  assert.ok(await src.listStatuses({ project: `${'o'.repeat(39)}/${'r'.repeat(100)}` }), 'the longest names GitHub allows');
  assert.equal(gh.requests.length, 0, 'GitHub Issues has fixed statuses: nothing is asked');
});

test("statusOf: an issue's status; reopened is open, a close without a reason completed, a duplicate cancelled", () => {
  assert.deepEqual([{ state: 'open' }, { state: 'open', state_reason: 'reopened' }, { state: 'closed', state_reason: null },
    { state: 'closed', state_reason: 'completed' }, { state: 'closed', state_reason: 'not_planned' }, { state: 'closed', state_reason: 'duplicate' }]
    .map((i) => [statusOf(i).label, statusOf(i).category]), [['Open', 'todo'], ['Open', 'todo'], ['Closed', 'done'], ['Closed', 'done'],
    ['Closed as not planned', 'cancelled'], ['Closed as duplicate', 'cancelled']]);
});

test("getTask: meta.project is the issue's repository as GitHub names it, whatever case the id was typed in (D6)", async () => {
  const { src } = site({ issues: [{ repo: 'Acme/API', number: 7, state: 'open' }] });
  const t = await src.getTask('acme/api#7');
  assert.deepEqual(t.meta, { repo: 'acme/api', project: 'Acme/API', number: 7, labels: [], assignee: null });
});
```

In `test/github-source-connector.test.mjs`, the `getTask` test's last assertion becomes:

```js
  assert.deepEqual(t.meta, { repo: 'acme/api', project: 'acme/api', number: 7, labels: ['bug'], assignee: 'alice' });
```

In `test/api-ticket-updates-trackers.test.mjs`, the `plugin-config` import becomes

```js
import { readTicketUpdates, writeTicketUpdates } from '../src/core/plugin-config.mjs';
```

and append:

```js
test('D9: the Repository input lists projects, filtered by the projects you work on; listRepos is no longer a browser op', async () => {
  setMockSourceResponses({ listProjects: [{ value: 'Acme/API', label: 'Acme/API', name: 'API' }, { value: 'Acme/Web', label: 'Acme/Web', name: 'Web' }] });
  try {
    writeTicketUpdates('github-source', 'default', 'github', { projects: [{ value: 'Acme/API', label: 'API' }], rules: [NONE_ALL] });
    const r = await call('POST', '/api/sources/call', { plugin: 'github-source', sourceId: 'github', op: 'listProjects' });
    assert.deepEqual([r.status, r.json], [200, { ok: true, result: [{ value: 'Acme/API', label: 'Acme/API', name: 'API' }] }]);
    const old = await call('POST', '/api/sources/call', { plugin: 'github-source', sourceId: 'github', op: 'listRepos' });
    assert.deepEqual([old.status, old.json], [400, { error: 'op "listRepos" is not allowed for this source' }]);
  } finally { setMockSourceResponses(null); }
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/github-source-ticket-updates.test.mjs test/github-source-connector.test.mjs test/api-ticket-updates-trackers.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../plugins/github-source/connector/index.mjs' does not provide an export named 'STATUSES'`; the connector test's `meta` lacks `project`; `/api/sources/call` answers `400 { error: 'op "listProjects" is not allowed for this source' }`.

- [ ] **Step 3: Implement**

In `plugins/github-source/worca-cc-plugin.json`: `"version": "0.3.0",` and the Repository input becomes

```json
        { "key": "repo", "type": "remote-select", "label": "Repository", "optionsFrom": "listProjects" },
```

In `plugins/github-source/connector/index.mjs`, replace

```js
// zero dependencies. Task ids round-trip opaquely as "owner/repo#123".

import { ghFetch } from './github-api.mjs';
import { ghAuthToken } from './gh-cli.mjs';

const PER_PAGE = 30;
```

with

```js
// zero dependencies. Task ids round-trip opaquely as "owner/repo#123".
// Ticket updates (plans/ticket-updates-design.md §3, plans/ticket-updates-pr2-plan.md): a repository is a project ("owner/repo");
// Worca decides what happens to an issue when a run finishes and passes it as reportResult's `move`; this plugin maps an issue's
// state onto Worca's four categories (D1), says what its old closeOnComplete setting means (legacyMove, D4), and without a
// `move` behaves exactly as before. Projects (v2) status fields are not read (decision 2).

import { ghFetch } from './github-api.mjs';
import { ghAuthToken } from './gh-cli.mjs';

const PER_PAGE = 30;

/** D1: GitHub Issues' statuses: open is to do, closed as completed done, closed as not planned cancelled; nothing is in
 *  progress. The values are the API's own (`state`, `state_reason`). */
export const STATUSES = Object.freeze([
  Object.freeze({ value: 'open', label: 'Open', category: 'todo' }),
  Object.freeze({ value: 'completed', label: 'Closed', category: 'done' }),
  Object.freeze({ value: 'not_planned', label: 'Closed as not planned', category: 'cancelled' }),
]);
const DUPLICATE = Object.freeze({ value: 'duplicate', label: 'Closed as duplicate', category: 'cancelled' });
/** An issue's status: reopened is open, a close without a reason (older issues) completed, a duplicate cancelled. */
export function statusOf(issue) {
  if (issue?.state !== 'closed') return STATUSES[0];
  if (issue.state_reason === 'not_planned') return STATUSES[2];
  if (issue.state_reason === 'duplicate') return DUPLICATE;
  return STATUSES[1];
}
/** A repository as Worca keys it (decision 1): owner/repo in GitHub's own characters (an owner of 1 to 39 letters, digits or
 *  inner hyphens; a repo of 1 to 100 letters, digits, ".", "_" or "-", never "." or ".."), so it is never another path. */
const REPO_KEY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;
function repoKeyOf(project) {
  const key = String(project ?? '').trim();
  if (!key) throw Object.assign(new Error('a project is required'), { kind: 'plugin' });
  if (!REPO_KEY.test(key)) throw Object.assign(new Error('a project is a repository: owner/repo'), { kind: 'plugin' });
  return key;
}
```

Inside `createTaskSource`, after the `login()` function (just before `return {`) add:

```js
  /** The token's repositories, the 100 most recently updated (as the Repository input has always listed them). */
  const repoList = async () => (await ghFetch(gh, '/user/repos?per_page=100&sort=updated')).json;
```

Replace

```js
    /** inputs[].optionsFrom: "listRepos" */
    async listRepos() {
      const { json } = await ghFetch(gh, '/user/repos?per_page=100&sort=updated');
      return json.map((r) => ({ value: r.full_name, label: r.full_name }));
    },
```

with

```js
    /** The Repository input's options before Ticket updates; kept for any caller that still names it. */
    async listRepos() {
      return (await repoList()).map((r) => ({ value: r.full_name, label: r.full_name }));
    },

    /** inputs[].optionsFrom: "listProjects" (Ticket updates, D9: a repository is a project, so New run's list is filtered by
     *  the projects you work on); `name` is the repository's name alone, for the chips (D5). */
    async listProjects() {
      return (await repoList()).map((r) => ({ value: r.full_name, label: r.full_name, name: r.name }));
    },
```

In `getTask`'s `meta`, after `repo,` add:

```js
          // Ticket updates (D6): the issue's repository as listProjects names it (GitHub's case), whatever case the id was typed in
          project: /\/repos\/([^/]+\/[^/]+)$/.exec(String(issue.repository_url || ''))?.[1] || repo,
```

Replace

```js
    capabilities() {
      return { writeBack: true, incrementalSync: false };
    },
```

with

```js
    capabilities() {
      return { writeBack: true, incrementalSync: false, ticketUpdates: true };
    },

    // ---- Ticket updates (plans/ticket-updates-design.md §3) ----
    /** GitHub Issues has the same three statuses in every repository: nothing is asked. */
    async listStatuses({ project } = {}) {
      repoKeyOf(project);
      return STATUSES.map((s) => ({ ...s }));
    },
    legacyMove() {
      return { field: 'closeOnComplete', target: closeOnComplete ? { category: 'done' } : null };
    },
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/github-source-ticket-updates.test.mjs test/github-source-connector.test.mjs test/api-ticket-updates-trackers.test.mjs test/api-sources.test.mjs test/plugin-manifest.test.mjs`
Expected: PASS (the last two use their own fixture manifests that still name `listRepos`; they must not change).

- [ ] **Step 5: Commit**

```bash
git add test/helpers/fake-github-issues.mjs test/github-source-ticket-updates.test.mjs test/github-source-connector.test.mjs test/api-ticket-updates-trackers.test.mjs plugins/github-source/connector/index.mjs plugins/github-source/worca-cc-plugin.json
git commit -m "Ticket updates: github-source 0.3.0 lists repositories as projects, its statuses and its old setting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: github-source's `reportResult` with a `move`

D1, D11, PR 1's Deviation 3; decisions 2 and 9. The issue changes first, then one comment ending with the line. Without a `move`, byte for byte as today.

**Files:**
- Modify: `plugins/github-source/connector/index.mjs` (`githubSaid`, `refusedMove`, `applyMove`, `reportResult`), `plugins/github-source/connector/github-api.mjs` (`detail`), `plugins/github-source/README.md`
- Test: `test/github-source-ticket-updates.test.mjs` (append)

**Interfaces:**
- Consumes (Task 4): `STATUSES`, `statusOf`; `ghFetch` (existing).
- Produces: `reportResult(id, { status, summary, links, move })`: with `move` → `{ commented: true, moved: { from, to } | null, note: string }`; without → `undefined`, exactly as before. `ghFetch`'s `plugin` errors gain `detail` (GitHub's `message` alone, `''` without one).

- [ ] **Step 1: Write the failing tests**

Append to `test/github-source-ticket-updates.test.mjs`:

```js
// ---- reportResult with a move (Task 5) ----
const RESULT = { status: 'completed', summary: 'All done', links: [{ title: 'PR', url: 'https://github.com/Acme/API/pull/9' }] };
const BODY = 'All done\n\n- [PR](https://github.com/Acme/API/pull/9)\n';
/** One report against a fresh fake holding Acme/API#7 in `state` (closed with `reason`). */
async function report(move, { state = 'open', reason = null, ...more } = {}) {
  const s = site({ issues: [{ repo: 'Acme/API', number: 7, state, state_reason: reason }], ...more });
  const out = await s.src.reportResult('Acme/API#7', { ...RESULT, move });
  const i = s.gh.issue('Acme/API', 7);
  return { out, comment: i.comments.at(-1), issue: i, calls: s.gh.requests.map((r) => r.method),
    patches: s.gh.requests.filter((r) => r.method === 'PATCH').map((r) => r.body), ...s };
}

test('Any Done status: closed as completed, moved first, then one comment ending with the line', async () => {
  const r = await report({ category: 'done' });
  assert.deepEqual(r.patches, [{ state: 'closed', state_reason: 'completed' }]);
  assert.deepEqual(r.out, { commented: true, moved: { from: 'Open', to: 'Closed' }, note: 'Moved to Closed.' });
  assert.equal(r.comment, 'All done\n\n- [PR](https://github.com/Acme/API/pull/9)\n\nMoved to Closed.');
  assert.deepEqual(r.calls, ['GET', 'PATCH', 'POST']);
});

test('Any Done status leaves a closed issue as it is, never turning not planned into completed', async () => {
  for (const [reason, label] of [['completed', 'Closed'], [null, 'Closed'], ['not_planned', 'Closed as not planned'], ['duplicate', 'Closed as duplicate']]) {
    const r = await report({ category: 'done' }, { state: 'closed', reason });
    assert.deepEqual([r.out.note, r.patches.length, r.issue.state_reason], [`Already in ${label}.`, 0, reason], String(reason));
  }
});

test('a status move: closed as not planned, reopened, completed from not planned; already there; a value GitHub has not', async () => {
  const np = await report({ status: 'not_planned', name: 'Closed as not planned' });
  assert.deepEqual([np.patches, np.out.note], [[{ state: 'closed', state_reason: 'not_planned' }], 'Moved to Closed as not planned.']);
  const reopen = await report({ status: 'open', name: 'Open' }, { state: 'closed', reason: 'completed' });
  assert.deepEqual([reopen.patches, reopen.out.moved], [[{ state: 'open' }], { from: 'Closed', to: 'Open' }]);
  const fix = await report({ status: 'completed', name: 'Closed' }, { state: 'closed', reason: 'not_planned' });
  assert.deepEqual([fix.patches, fix.out.note], [[{ state: 'closed', state_reason: 'completed' }], 'Moved to Closed.']);
  assert.equal((await report({ status: 'open', name: 'Open' })).out.note, 'Already in Open.');
  const odd = await report({ status: 'wontfix', name: "Won't fix" });
  assert.deepEqual([odd.patches.length, odd.out.note], [0, "Not moved: Acme/API has no status named Won't fix any more."]);
});

test("a 4xx refusal of the move is a line with GitHub's reason and the comment is posted; 401, rate limits and 5xx throw", async () => {
  const r = await report({ category: 'done' }, { refusePatch: { status: 403, body: { message: 'Must have push access to close this issue.' } } });
  assert.deepEqual([r.out.moved, r.out.note], [null, 'Not moved: GitHub refused the move to Closed: Must have push access to close this issue.']);
  assert.equal(r.comment.split('\n').at(-1), r.out.note);
  assert.equal((await report({ category: 'done' }, { refusePatch: { status: 422, body: {} } })).out.note,
    'Not moved: GitHub refused the move to Closed: GitHub gave no reason.');
  for (const [refusal, kind] of [[{ status: 401, body: { message: 'Bad credentials' } }, 'auth'], [{ status: 429, body: {} }, 'plugin'],
    [{ status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0' } }, 'rate-limit'],
    [{ status: 403, body: { message: 'You have exceeded a secondary rate limit.' } }, 'plugin'], [{ status: 502, body: {} }, 'plugin']]) {
    const s = site({ issues: [{ repo: 'Acme/API', number: 7, state: 'open' }], refusePatch: refusal });
    await assert.rejects(s.src.reportResult('Acme/API#7', { ...RESULT, move: { category: 'done' } }), (e) => e.kind === kind, JSON.stringify(refusal));
    assert.deepEqual(s.gh.issue('Acme/API', 7).comments, [], `${refusal.status}: no comment, so the write-back fails and can be retried`);
  }
});

test("Don't move: no read, no move, no line; a run that did not finish passes none and only comments", async () => {
  const r = await report({ none: true });
  assert.deepEqual([r.calls, r.out, r.comment], [['POST'], { commented: true, moved: null, note: '' }, BODY]);
});

test('without a move: exactly the old behaviour (comment first, then closeOnComplete)', async () => {
  const s = site({ close: 'yes', issues: [{ repo: 'Acme/API', number: 7, state: 'open' }] });
  assert.equal(await s.src.reportResult('Acme/API#7', RESULT), undefined);
  assert.deepEqual(s.gh.requests.map((r) => r.method), ['POST', 'PATCH']);
  assert.deepEqual([s.gh.issue('Acme/API', 7).comments, s.gh.issue('Acme/API', 7).state], [[BODY], 'closed']);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/github-source-ticket-updates.test.mjs`
Expected: FAIL — with a `move` the connector runs the legacy path: it comments first without the line, never closes (`closeOnComplete` is `no`), and answers `undefined`. The "without a move" test passes already.

- [ ] **Step 3: Implement**

In `plugins/github-source/connector/github-api.mjs`, replace

```js
      { status: res.status },
```

with

```js
      // detail: GitHub's own message alone, for a Ticket updates line (index.mjs githubSaid)
      { status: res.status, detail },
```

In `plugins/github-source/connector/index.mjs`, inside `createTaskSource`, after `repoList` (Task 4) add:

```js

  // ---- Ticket updates: one move, before the comment (D11) ----
  /** GitHub's own words for a refusal, without a trailing full stop; "GitHub gave no reason" when it sends none. */
  const githubSaid = (e) => (String(e?.detail || '').trim() || 'GitHub gave no reason').replace(/\.+$/, '');
  /** PR 1's rule for a refused move (its Deviation 3), in GitHub's terms: a 4xx other than 401 (auth) and 429, and not a
   *  secondary rate limit (a 403 that says so), is a line; a 5xx, network error, timeout, refused token or rate limit throws,
   *  so the write-back fails and can be retried. */
  const refusedMove = (e) => !!e && e.kind === 'plugin' && e.status >= 400 && e.status < 500 && e.status !== 429
    && !/rate limit/i.test(e.detail || '');
  /** Answers { note, moved }. Any Done status closes as completed an issue that is open; a closed one (as not planned too)
   *  stays as it is. A status move sets that status: open reopens, completed and not_planned close with that reason. Reading
   *  the issue throws (decision 9). */
  async function applyMove(repo, number, move) {
    const none = { note: '', moved: null };
    const want = move.category === 'done' ? 'completed' : (typeof move.status === 'string' ? move.status.trim() : '');
    if (move.none === true || !want) return none;
    const now = statusOf((await ghFetch(gh, `/repos/${repo}/issues/${number}`)).json);
    if (move.category === 'done' ? now.value !== 'open' : now.value === want) return { ...none, note: `Already in ${now.label}.` };
    const to = STATUSES.find((s) => s.value === want);
    if (!to) return { ...none, note: `Not moved: ${repo} has no status named ${move.name || want} any more.` };
    try {
      await ghFetch(gh, `/repos/${repo}/issues/${number}`, { method: 'PATCH',
        body: to.value === 'open' ? { state: 'open' } : { state: 'closed', state_reason: to.value } });
    } catch (e) {
      if (refusedMove(e)) return { ...none, note: `Not moved: GitHub refused the move to ${to.label}: ${githubSaid(e)}.` };
      throw e;
    }
    return { note: `Moved to ${to.label}.`, moved: { from: now.label, to: to.label } };
  }
```

In `reportResult`, change the signature to

```js
    async reportResult(id, { status, summary, links = [], move } = {}) {
```

and, right after the links loop's closing `}` (before `await ghFetch(gh, \`/repos/${repo}/issues/${number}/comments\`, …)`), add:

```js
      if (move && typeof move === 'object') {
        // Ticket updates (D11): Worca decided the move; the issue changes first, then one comment: the run summary, its links,
        // then the outcome line last. Without a move (nothing saved in Worca) the old path below runs unchanged (D4).
        const out = await applyMove(repo, number, move);
        await ghFetch(gh, `/repos/${repo}/issues/${number}/comments`, { method: 'POST',
          body: { body: out.note ? `${body.replace(/\s+$/, '')}\n\n${out.note}` : body } });
        return { commented: true, moved: out.moved, note: out.note };
      }
```

The rest of `reportResult` stays exactly as it is.

In `plugins/github-source/README.md`, **Config**'s `closeOnComplete` row becomes:

```
| closeOnComplete | select yes/no | no | the old setting: once **Ticket updates** is saved (Labs flag `ticketUpdates`), Worca no longer uses it. Until then: close the issue (`state_reason: completed`) when a run finishes successfully |
```

and right before `## Filter micro-syntax` add:

```markdown
## Ticket updates

With the Labs flag **Ticket updates** on, Worca decides what a finished run does to its issue (Marketplace › Installed ›
GitHub Issues › Settings › **Ticket updates**). A repository is a project (`owner/repo`): **Projects you work on** picks
repositories, and New run's **Repository** list shows only those. The plugin answers `capabilities()` with
`ticketUpdates: true` and:

- **listProjects** — the Repository input's list (the 100 repositories updated last), each with its name for the chips.
  `listRepos`, its old name, still answers.
- **listStatuses** — the same three for every repository: Open (to do), Closed (done) and Closed as not planned
  (cancelled). An issue closed as a duplicate counts as cancelled. Projects (v2) status fields are not used.
- **legacyMove** — what **Close issue on completion** means (Yes: Any Done status), so the section starts from it.
- **reportResult with a move** — the issue changes first, then one comment: the run summary, its links, and a last line
  saying what happened. **Any Done status** closes an open issue as completed; a closed issue stays as it is (one closed as
  not planned is never turned into completed). A rule may also pick Closed as not planned, or Open to reopen. Last lines:
  - `Moved to Closed.` / `Moved to Closed as not planned.` / `Moved to Open.` / `Already in Closed as not planned.`
  - `Not moved: GitHub refused the move to Closed: <GitHub's message>.` — a 4xx other than 401, 429 and a rate limit;
    `GitHub gave no reason` when GitHub sends no message.

  In every case above the comment is still posted. A refused token, a rate limit, a server error (5xx), a network error or a
  timeout fails the write-back, so it can be tried again.

Until Ticket updates is saved, write-back works as before: a comment, and with `closeOnComplete: yes` the issue is closed.

```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/github-source-ticket-updates.test.mjs test/github-source-connector.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/github-source/connector/index.mjs plugins/github-source/connector/github-api.mjs plugins/github-source/README.md test/github-source-ticket-updates.test.mjs
git commit -m "Ticket updates: github-source moves an issue by Worca's rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: PR 1's section, unchanged, for Azure Boards and GitHub Issues (a guard test)

Decisions 4 and 5. No UI code changes: this task adds a jsdom test that proves PR 1's section already handles a single-profile source, `owner/repo` keys, a carried-over yes/no setting and a select-type old field. It is green from its first run; its job is to stop a later change from breaking these cases silently. **If any assertion fails, do not change the UI: stop and report it** (a UI change needs an approved mock first).

**Files:**
- Create: `test/marketplace-ticket-updates-trackers.test.mjs`

**Interfaces:**
- Consumes: `createTicketUpdates` (`ui/public/marketplace/ticket-updates-section.mjs`), `createManageSheet` (`ui/public/marketplace/manage-sheet.mjs`), `sheetHarness`, `ok`, `settle` (`test/helpers/marketplace-sheet-harness.mjs`), `ROW`, `DETAIL` (`test/helpers/marketplace-manage-fixtures.mjs`, github-source's Installed row and detail).

- [ ] **Step 1: Write the test**

Create `test/marketplace-ticket-updates-trackers.test.mjs`:

```js
// test/marketplace-ticket-updates-trackers.test.mjs — PR 1's Ticket updates section, unchanged, for azure-boards-source and
// github-source (plans/ticket-updates-pr2-plan.md decision 5): a single-profile source, owner/repo keys in the statuses URL, a
// carried-over yes/no setting, and a select-type old field that gives way to "Moved to Ticket updates.". No UI code changes in
// PR 2: a failure here means the section needs a change, which needs an approved mock first.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { sheetHarness, ok, settle } from './helpers/marketplace-sheet-harness.mjs';
import { createTicketUpdates } from '../ui/public/marketplace/ticket-updates-section.mjs';
import { createManageSheet } from '../ui/public/marketplace/manage-sheet.mjs';
import { ROW, DETAIL } from './helpers/marketplace-manage-fixtures.mjs';

const trackDom = useDomRelease(afterEach);
const GH = '/api/plugins/github-source/ticket-updates';
const GH_STATUSES = [{ value: 'open', label: 'Open', category: 'todo' }, { value: 'completed', label: 'Closed', category: 'done' },
  { value: 'not_planned', label: 'Closed as not planned', category: 'cancelled' }];
const NOT_PLANNED = { kind: 'status', value: 'not_planned', label: 'Closed as not planned', category: 'cancelled' };
const GH_SAVED = { available: true, connection: 'saved', profile: { id: 'default', label: 'GitHub Issues' }, saved: true,
  projects: [{ value: 'Acme/API', label: 'API' }],
  rules: [{ project: '', moment: 'finished', target: { kind: 'category', value: 'done' } },
    { project: 'Acme/API', label: 'API', moment: 'finished', target: NOT_PLANNED }],
  legacy: { field: 'closeOnComplete', label: 'Close issue on completion', target: null } };
const ghRoutes = (get = GH_SAVED) => ({ [`GET ${GH}?sourceId=github`]: ok(get),
  [`GET ${GH}/statuses?sourceId=github&project=Acme%2FAPI`]: ok({ statuses: GH_STATUSES }) });

test('github-source: one connection (no profile id), owner/repo as a chip and a rule, its statuses asked by the encoded key', async () => {
  const h = sheetHarness({ trackDom, routes: ghRoutes() });
  const tu = createTicketUpdates({ doc: h.doc, api: h.deps.api, plugin: 'github-source', sourceId: 'github', tracker: 'GitHub Issues' });
  h.doc.body.append(tu.el);
  assert.equal((await tu.load()).available, true);
  await settle();
  assert.equal(tu.el.querySelector('.mk-tu-head .mk-meta').textContent, 'GitHub Issues', 'a single-profile source: its name, no "(default)"');
  const chip = tu.el.querySelector('.mk-tu-chip');
  assert.deepEqual([chip.dataset.value, chip.querySelector('.mk-tu-key').textContent, chip.querySelector('.mk-tu-cname').textContent], ['Acme/API', 'Acme/API', 'API']);
  assert.deepEqual([...tu.el.querySelectorAll('.mk-tu-rule')].map((r) => r.dataset.project).filter(Boolean), ['Acme/API']);
  assert.ok(h.calls.some((c) => c[1] === `${GH}/statuses?sourceId=github&project=Acme%2FAPI`), 'the gone check asks with the key encoded');
  assert.equal(tu.el.querySelector('.mk-tu-gone'), null, 'Closed as not planned is still one of its statuses');
  assert.equal(tu.dirty(), false);
  assert.deepEqual(tu.body(), { sourceId: 'github', projects: GH_SAVED.projects, rules: GH_SAVED.rules }, 'no profile in the body');
});

test('azure-boards-source: closeOnComplete yes is carried over as Any Done status, with the note naming the old field; not dirty', async () => {
  const AZ = '/api/plugins/azure-boards-source/ticket-updates';
  const get = { available: true, connection: 'saved', profile: { id: 'work', label: 'Work' }, saved: false, projects: [], rules: [],
    legacy: { field: 'closeOnComplete', label: 'Close work item on completion', target: { category: 'done' } } };
  const h = sheetHarness({ trackDom, routes: { [`GET ${AZ}?sourceId=azure-boards&profile=work`]: ok(get) } });
  const tu = createTicketUpdates({ doc: h.doc, api: h.deps.api, plugin: 'azure-boards-source', sourceId: 'azure-boards', profile: 'work',
    tracker: 'Azure Boards' });
  h.doc.body.append(tu.el);
  await tu.load();
  await settle();
  assert.equal(tu.el.querySelector('.mk-tu-carried').textContent,
    'Filled in from the old Close work item on completion setting. Nothing changes until you save; after that, the old setting is no longer used.');
  assert.deepEqual(tu.body().rules, [{ project: '', moment: 'finished', target: { kind: 'category', value: 'done' } }]);
  assert.equal(tu.dirty(), false, '§10 B: carried over is not a change');
});

// ---- inside the manage sheet: the old select field ----
const GCONFIG = { sources: [{ id: 'github', multiProfile: false, profile: null, profiles: [],
  schema: [{ key: 'token', type: 'text', label: 'GitHub token', secret: true, required: false, default: null, help: null, options: [] },
    { key: 'closeOnComplete', type: 'select', label: 'Close issue on completion', secret: false, required: false, default: 'no',
      help: 'Yes closes the issue (state_reason: completed) when a pipeline finishes successfully', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }],
  values: { token: { set: true }, closeOnComplete: 'yes' } }], channels: [] };

test('D4 for a select: after the first save, Close issue on completion reads "Moved to Ticket updates." and Save never sends it', async () => {
  const h = sheetHarness({ trackDom, plugins: [{ ...ROW, latest: null }], routes: { 'GET /api/plugins/github-source': ok(DETAIL),
    'GET /api/plugins/github-source/config': ok(GCONFIG), ...ghRoutes() } });
  h.doc.documentElement.dataset.flags = 'ticketUpdates';
  const manage = createManageSheet({ doc: h.doc, win: h.window, page: h.page, deps: h.deps, wait: h.wait, now: h.now });
  await manage.open('github-source', { opener: h.doc.getElementById('opener') });
  await settle();
  assert.ok(h.doc.querySelector('#mk-sheet [data-group="source:github"] .mk-tu:not([hidden])'), 'the section is there for github-source');
  const row = [...h.doc.querySelectorAll('#mk-sheet .field[data-field]')].find((r) => r.dataset.field === 'closeOnComplete');
  assert.equal(row.querySelector('label').textContent, 'Close issue on completion');
  assert.deepEqual([row.querySelector('[data-key]'), row.querySelector('.select-wrap'), row.querySelector('small.hint')], [null, null, null]);
  assert.equal(row.querySelector('.mk-tu-moved').textContent, 'Moved to Ticket updates.');
  h.doc.querySelector('#mk-sheet [data-act="save"]').click();
  await settle();
  assert.deepEqual([manage.isOpen(), h.calls.filter((c) => c[0] === 'PUT')], [false, []], 'nothing changed: the sheet just closes');
});
```

- [ ] **Step 2: Run it and see it pass at once**

Run: `node tools/test.mjs test/marketplace-ticket-updates-trackers.test.mjs`
Expected: PASS, 3 of 3, with no file under `ui/` changed (`git status --short ui/` prints nothing). Checked while writing this plan against 052500f33: 3 of 3. If it fails, stop: report which assertion, and do not touch `ui/`.

- [ ] **Step 3: Run PR 1's UI tests beside it**

Run: `node tools/test.mjs test/marketplace-ticket-updates.test.mjs test/marketplace-manage-sheet.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/marketplace-ticket-updates-trackers.test.mjs
git commit -m "Ticket updates: the section for Azure Boards and GitHub Issues, unchanged (a guard test)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, the changelog and the plugin contract

Decision 6. Product docs in the boards' voice; no code.

**Files:**
- Modify: `docs/ticket-updates.md`, `docs/changelog/unreleased.md`, `.claude/skills/creating-worca-cc-plugins/SKILL.md`, `plans/ticket-updates-design.md` (§14, one sentence)

- [ ] **Step 1: `docs/ticket-updates.md`**

Replace

```
**Marketplace › Installed › Jira › Settings**, below **Test connection**, once the connection is saved. Advanced mode, with
the Marketplace page.
```

with

```
**Marketplace › Installed › Jira, Azure Boards or GitHub Issues › Settings**, below **Test connection**, once the connection
is saved. Advanced mode, with the Marketplace page. For GitHub Issues a project is a repository (`owner/repo`), and New run's
**Repository** list is the one that is shortened.
```

Replace

```
- A refused API token (401), a rate limit (429), a Jira server error (5xx), a network error or a timeout fails the
```

with

```
- A refused API token (401), a rate limit (429), a server error (5xx), a network error or a timeout fails the
```

Right before `## Categories`, add:

```markdown
## Azure Boards and GitHub Issues

**Azure Boards.** Any Done status is the first state of the work item's type in the Completed category (Agile's Closed,
Scrum's and Basic's Done); a Resolved item is not done yet, and Removed is never chosen. A rule that names a state moves the
item to that state of its own type; a type without that state leaves the item where it is and says so (`Not moved: Shop's
Task type has no status named Resolved.`). An item already Completed or Removed stays. A move Azure refuses reads `Not
moved: Azure Boards refused the move to Closed: <Azure's message>.`

**GitHub Issues.** Three statuses: Open, Closed (as completed) and Closed as not planned. Any Done status closes an open
issue as completed; a closed issue stays as it is, so one closed as not planned is never turned into a completed one. A rule
may also close as not planned, or reopen (Open). GitHub Projects' own Status fields are not used. A move GitHub refuses reads
`Not moved: GitHub refused the move to Closed: <GitHub's message>.`

```

Replace

```
Progress" in progress, "Done" done, except the cancelled names above. Azure Boards and GitHub follow in a later release.
```

with

```
Progress" in progress, "Done" done, except the cancelled names above. Azure Boards: Proposed is to do, In Progress and
Resolved in progress, Completed done, Removed cancelled. GitHub Issues: open is to do, closed as completed done, closed as
not planned (or as a duplicate) cancelled; nothing is in progress.
```

Replace

```
Until you save Ticket updates for a connection, the plugin's old setting works exactly as before (Jira: **Transition on
completion**).
```

with

```
Until you save Ticket updates for a connection, the plugin's old setting works exactly as before (Jira: **Transition on
completion**; Azure Boards: **Close work item on completion**; GitHub Issues: **Close issue on completion**, where Yes is
carried over as Any Done status).
```

Replace

```
The plugin contract (`listStatuses`, `legacyMove`, `reportResult`'s `move`) is in the creating-plugins skill and in
`plugin-api.mjs`. The plugin API stays 5: a plugin without these keeps its old behaviour.
```

with

```
The plugin contract (`listStatuses`, `legacyMove`, `reportResult`'s `move`) is in the creating-plugins skill and in
`plugin-api.mjs`. The plugin API stays 5: a plugin without these keeps its old behaviour. A project key may hold one `/`
(GitHub's `owner/repo`), never `.` or `..` as a part, `%`, `\`, `?` or `#`.
```

- [ ] **Step 2: `docs/changelog/unreleased.md`**

In the **Ticket updates (experimental)** entry, replace

```
In Marketplace › Installed › Jira › Settings, a saved connection gets **Ticket updates**:
```

with

```
In Marketplace › Installed › Jira, Azure Boards or GitHub Issues › Settings, a saved connection gets **Ticket updates**:
```

replace

```
A move Jira refuses becomes a "Not moved" line and the comment still posts; a refused token, a rate limit, a Jira error or a timeout fails the write-back so it can be retried. New run and the Requirements export list only the projects you work on. Until you save, the old **Transition on completion** setting works as before.
```

with

```
A move the tracker refuses becomes a "Not moved" line and the comment still posts; a refused token, a rate limit, a server error or a timeout fails the write-back so it can be retried. Azure Boards moves a work item to its type's Completed state (Resolved is not done yet) or to a state you pick; GitHub Issues closes an issue as completed or as not planned, or reopens it, and a repository is a project. New run and the Requirements export list only the projects you work on. Until you save, each plugin's old setting (**Transition on completion**, **Close work item on completion**, **Close issue on completion**) works as before.
```

replace

```
Chips: Ticket updates · Jira · projects you work on · Any Done status · experimental: turn it on in Settings › Labs
```

with

```
Chips: Ticket updates · Jira · Azure Boards · GitHub Issues · projects you work on · Any Done status · experimental: turn it on in Settings › Labs
```

and under its "Pull requests" list, after `- Ticket updates (#1072)`, add the line `- Ticket updates: Azure Boards and GitHub Issues` (the number is added when the pull request opens, as the list's heading says).

- [ ] **Step 3: The plugin contract**

In `.claude/skills/creating-worca-cc-plugins/SKILL.md`, the `listProjects` row becomes:

```
| `listProjects` | `({})` — the project input's `optionsFrom` | `[{value, label, name?}]`; `name` (optional) is the project's name alone, for Ticket updates' chips; `value` is the project's key: at most one `/` (GitHub's `owner/repo`), never `.` or `..` as a part, `%`, `\`, `?` or `#` |
```

- [ ] **Step 4: The design's §14 points here**

In `plans/ticket-updates-design.md`, replace

```
**PR 2:** azure-boards-source and github-source adopt the contract (`listStatuses`, `legacyMove`, `move`, `meta.project`,
github-source's `listProjects` over its repos).
```

with

```
**PR 2:** azure-boards-source and github-source adopt the contract (`listStatuses`, `legacyMove`, `move`, `meta.project`,
github-source's `listProjects` over its repos). Its decisions (the `owner/repo` key, GitHub's statuses, Azure's status moves,
GitHub's `optionsFrom`) are in `plans/ticket-updates-pr2-plan.md`.
```

- [ ] **Step 5: Check the changelog build and the edits**

Run: `node tools/test.mjs test/docs-site-changelog.test.mjs`
Expected: PASS (the changelog build still reads the repo's entries).
Run: `git diff --stat` — exactly the four files above changed; `grep -c "Azure Boards" docs/ticket-updates.md docs/changelog/unreleased.md` counts at least 1 in each.

- [ ] **Step 6: Commit**

```bash
git add docs/ticket-updates.md docs/changelog/unreleased.md .claude/skills/creating-worca-cc-plugins/SKILL.md plans/ticket-updates-design.md
git commit -m "Ticket updates: docs and changelog for Azure Boards and GitHub Issues

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Whole-branch verification

**Files:** whatever this task finds to fix (no new feature code; each fix in the module of the task that owns it, its test first, as its own commit).

- [ ] **Step 1: The touched files' tests**

Run: `node tools/test.mjs test/ticket-updates.test.mjs test/api-ticket-updates.test.mjs test/api-ticket-updates-trackers.test.mjs test/azure-boards-ticket-updates.test.mjs test/azure-boards-connector.test.mjs test/github-source-ticket-updates.test.mjs test/github-source-connector.test.mjs test/marketplace-ticket-updates-trackers.test.mjs test/marketplace-ticket-updates.test.mjs test/marketplace-manage-sheet.test.mjs test/api-sources.test.mjs test/plugin-manifest.test.mjs test/ask-sources.test.mjs test/writeback.test.mjs test/sources.test.mjs test/plugin-shim.test.mjs`
Expected: PASS.

- [ ] **Step 2: The full suite, compared with PR 1's head.** Run `npm test` on this branch and record the failing files. This Windows laptop has about 170 upstream failures that also fail on a clean base, so compare by test name: run each failing file alone at PR 1's head (052500f33) in a checkout you already have (never switch or stash this worktree): `node tools/test.mjs test/<file>.test.mjs`. A test that fails here and passes there is this branch's to fix; one that fails on both is not. Record both counts in the pull request.
- [ ] **Step 3: The browser proof.** `npm run verify:ticket-updates` → "all checks passed" (PR 1's section, unchanged, in mock mode).
- [ ] **Step 4: The plugin smoke.** `npm run smoke:plugin` → no "smoke:plugin FAILED" line, exit 0 (the mock write-back path still records `lastReport`).
- [ ] **Step 5: Static checks.** `git diff --name-only 052500f33...HEAD -- '*.mjs' | xargs -n1 node --check` prints nothing; `git diff 052500f33...HEAD | grep -nE '^\+.*(console\.log|debugger|TODO|FIXME)'` prints nothing; `git diff --stat 052500f33...HEAD -- ui/` prints nothing (decision 5); `plugins/azure-boards-source/worca-cc-plugin.json` says `0.2.0` and `plugins/github-source/worca-cc-plugin.json` `0.3.0`; `grep -n "WORCA_PLUGIN_API = 5" src/core/plugin-api.mjs` finds the line; no local path or real person's name in the new fixtures.
- [ ] **Step 6: Flag off.** With `WORCA_FLAGS=-ticketUpdates`, run `node tools/test.mjs test/azure-boards-connector.test.mjs test/github-source-connector.test.mjs test/writeback.test.mjs test/api-ticket-updates.test.mjs` (they pass: no `move` is ever passed, so both plugins run their old setting).
- [ ] **Step 7: Linux, if WSL is at hand.** The full suite and `npm run smoke:plugin` on Linux (Node 22) from a clean `git archive` of the committed tree; compare with PR 1's head the same way.
- [ ] **Step 8: Real trackers, by hand, before the flag leaves Labs** (not needed to open the pull request; no paid model call is involved): an Azure DevOps organization (Agile and Scrum projects): `listStatuses` lists the visible types' states and leaves out Code Review Request and the like (this plan's fake follows the REST reference for `workitemtypes`' `states` and `workitemtypecategories`; confirm both); Any Done status from Active and from Resolved; a state rule on a type that lacks it; a rule-protected transition refused with a 400. A GitHub repository: Any Done status on an open issue and on one closed as not planned; a not-planned rule; reopen; a token without push access (403 line). Findings go into the pull request.

---

## Appendix A: decisions and design points → tasks

| Point | Task(s) |
|---|---|
| Decision 1 (`owner/repo` key; needs approval) | 1 (host), 2 (Azure's own check), 4 (GitHub's own check), 7 (docs, skill) |
| Decision 2 (GitHub statuses; no Projects v2) | 4 (`STATUSES`, `statusOf`, `listStatuses`), 5 (moves), 7 |
| Decision 3 (Azure statuses and status moves) | 2 (`listStatuses`), 3 (`applyMove`), 7 |
| Decision 4 (`legacyMove`, carried-over display) | 2, 4 (`legacyMove`), 6 (the section shows it; the select gives way) |
| Decision 5 (no UI change) | 6 (guard test), 8 (no `ui/` diff) |
| Decision 6 (versions, changelog, docs) | 2, 4 (versions), 3, 5 (READMEs), 7 |
| Decision 7 (GitHub's `optionsFrom`) | 4 (manifest, `listProjects`, the `/api/sources/call` test) |
| Decision 8 (`meta.project` from the tracker's record) | 2, 4 |
| Decision 9 (reads throw; refusals are lines) | 3, 5 |
| Decision 10 (fakes are `fetch`) | 2, 4 |
| D1 (Azure: Resolved in progress; GitHub: no in progress) | 2, 4 |
| D4 (legacy until the first save, byte for byte) | 3, 5 ("without a move" tests; existing connector tests) |
| D5 (optional contract, API 5) | 2, 4 (no engine change), 8 |
| D6 (`meta.project`) | 2, 4 |
| D9 (GitHub's repositories join the filter) | 4 |
| D11 (move first; the line last; `{ moved, note }`) | 3, 5 |
| D18-style bump | 2 (0.2.0), 4 (0.3.0) |
| §14 PR 2 scope | 1–7 |

## Appendix B: copy this plan adds (not in the design)

- Azure Boards comment lines: `Moved to Closed.` · `Already in Closed.` · `Not moved: Shop's Idea type has no Done status.` · `Not moved: Shop's Task type has no status named Resolved.` · `Not moved: Shop has no status named Released any more.` (PR 1's line, reused) · `Not moved: Azure Boards refused the move to Closed: <Azure's message>.` · `Azure Boards gave no reason`.
- GitHub Issues comment lines: `Moved to Closed.` · `Moved to Closed as not planned.` · `Moved to Open.` · `Already in Closed as not planned.` · `Already in Closed as duplicate.` · `Not moved: Acme/API has no status named Won't fix any more.` · `Not moved: GitHub refused the move to Closed: <GitHub's message>.` · `GitHub gave no reason`.
- GitHub status labels: "Open", "Closed", "Closed as not planned", "Closed as duplicate" (GitHub's own words).
- Connector refusals (502 sentences through PR 1's reach sentence): "Azure Boards refused the request: <Azure's message>." · "a project name cannot be a path" (Azure) · "a project is a repository: owner/repo" (GitHub) · "a project is required" (both; PR 1's Jira wording).
- Docs: the **Azure Boards and GitHub Issues** section of `docs/ticket-updates.md`, the READMEs' **Ticket updates** sections, the changelog sentences.

## Self-review (done while writing)

- **Spec coverage:** §14's PR 2 list maps to tasks: `listStatuses` (2, 4), `legacyMove` (2, 4), `move` (3, 5), `meta.project` (2, 4), github-source's `listProjects` over its repos (4); D1's Azure and GitHub mappings (2, 4); D9's GitHub filter (4, decision 7). The user's six questions are decisions 1–6. Nothing in PR 1's host changes beyond decision 1.
- **Tested while writing (scratch, not committed):** Tasks 2–5's connector code and tests in a scratch mirror of both plugins: 44 of 44 (the new files and both existing connector files, with the two `deepEqual` updates); `node --check` on both connectors. Task 1 and Task 4's host test against the worktree with the planned `isProjectKey` and manifest change applied temporarily: the new file 2 of 2, PR 1's `api-ticket-updates` and `ticket-updates` tests green except exactly the two `A/B` rows Task 1 rewrites; red against the unchanged code for the planned reasons. Task 6: 3 of 3 against the unchanged UI. The worktree was restored byte for byte afterwards (`git status` clean).
- **Placeholders:** none. The changelog's pull-request number is added when the PR opens, as that file asks.
- **Names across tasks:** `isProjectKey` (1); `categoryOf`, `projectOf`, `azureSaid`, `ownWords`, `statesOfProject`, `lc` (2) → `refusedMove`, `applyMove` (3); `fakeAzureBoards`, `AGILE` (2) → 3; `STATUSES`, `statusOf`, `REPO_KEY`, `repoKeyOf`, `repoList` (4) → `githubSaid`, `refusedMove`, `applyMove` (5); `fakeGithubIssues` with `issue(repo, number)` (4) → 5; `detail` on `adoFetch` (2) and `ghFetch` (5) errors; `{ commented, moved, note }` (3, 5).
