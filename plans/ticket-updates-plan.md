# Ticket updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worca owns what happens to a ticket when a run finishes: in Marketplace › Installed › a tracker plugin › Settings, a saved connection gets **Ticket updates** (the projects you work on, and per project Don't move, Any Done status or one of that project's statuses); write-back moves the ticket by that rule and the one comment ends with what happened; Jira never closes a finished run's ticket as Won't Do or Duplicate and fills a required Resolution itself; New run and Requirements export (and import, with #1041) list only the projects you work on. With nothing saved every plugin behaves as today; with the flag off nothing changes.

**Architecture:** Worca keeps one record per plugin, profile and task source in `<plugins>/<name>/data/ticket-updates.json` (the `profiles/1` envelope of `plugin-config.mjs`, dropped by `deleteProfile`, kept by uninstall, removed by purge). A provider-neutral module `src/core/ticket-updates.mjs` turns a record into the `move` write-back passes (`moveFor`), validates a save, and filters project lists (`projectFilter`, `filterProjects`); `describeMove` gives Report back its words. Four host routes under `/api/plugins/:name/ticket-updates` (`src/core/ticket-updates-routes.mjs`) read and save through `callSource`, server-side only. The plugins translate: jira-source gains `capabilities().ticketUpdates`, `listStatuses`, `legacyMove`, `name` on `listProjects` and a `move` branch in `reportResult` (§7); the plugin API stays 5. The manage sheet mounts a host-drawn section (`ticket-updates-section.mjs`) built on two small new controls (`move-select.mjs`, `projects-popover.mjs`) and saves it with the sheet's Save, after the config `PUT`.

**Tech Stack:** Node ESM, `node:test`, jsdom, Express (`ui/server.mjs`), the plugin shim (`src/core/plugin-shim.mjs`, one child per op, `WORCA_MOCK=1` canned answers), vanilla DOM (`ui/public/marketplace/*.mjs`), `node:http` fake Jira (`test/helpers/fake-jira.mjs`), headless Chrome over CDP for the browser proof.

**Spec:** `plans/ticket-updates-design.md` (decisions D1–D18, §3–§14 and "Decided by the user (2026-10-29)"). It is normative: where this plan and the design differ, the design wins, except for the points marked **Deviation** below (each says why). Mock canvas: "Jira status picker", boards 1–7 (https://claude.ai/artifact/WqBFrAG6dPMQ66F8RDmUmB); the copy is design §9 verbatim.

## Global Constraints

- One commit per task (review fixes as their own commits); subjects start `Ticket updates:`; every message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never rebase or amend; a merge of `dev` is a merge commit. Do not push.
- **Flag (D16):** Labs flag `ticketUpdates`, stage `experimental`, `default: false`, owner `TomicaB`, `requires` nothing. Off: the section is hidden (`flagOn('ticketUpdates', doc)`), every `/api/plugins/:name/ticket-updates*` route answers the gate's 404 (`requireFlag('ticketUpdates')`), no project filter applies (`projectFilter` → `null`), and write-back ignores saved rules (`moveFor` → `undefined`). The file is kept, so turning the flag on restores the rules.
- **Plugin API stays 5 (D5):** every addition is optional (`capabilities().ticketUpdates`, `listStatuses`, `legacyMove`, `reportResult`'s `move` and its `{ moved, note }` answer, `listProjects`' `name`, `getTask`'s `meta.project`); `WORCA_PLUGIN_API` and `WORCA_PLUGIN_APIS` do not change; jira-source keeps `"worca-cc-api": ">=5 <6"`.
- **jira-source goes to `0.2.0` (D18)** in `plugins/jira-source/worca-cc-plugin.json`.
- **No new browser-callable op (D8):** `POST /api/sources/call`'s allowlist is unchanged; it never gains `listStatuses` or `legacyMove`. `listProjects`, `listStatuses` and `legacyMove` run in the server through `callSource` with the saved profile.
- **Legacy byte for byte (D4):** with no record for a profile and source, write-back passes no `move` and each plugin does exactly what it does today (Jira's comment order included); every existing `test/jira-source-connector.test.mjs` `reportResult` row passes unchanged. The host never parses a ticket id (D6).
- **Storage (D3, §4):** `<plugins>/<name>/data/ticket-updates.json`, `{ "$format": "profiles/1", "profiles": { "<profile>": { "<sourceId>": { projects, rules, savedAt, savedBy } } } }`; no secrets, no SQLite table, no schema migration.
- **Limits (§4):** at most 200 projects and 200 project rules; values and labels at most 200 characters; one rule per (project, moment); exactly one All projects rule (project `''`); All projects only `none`, `category` or `typed`; moments only `finished`.
- **Timeouts (§3):** `listProjects` 60 s; `listStatuses`, `legacyMove` and `capabilities` the `callSource` default (30 s). A tracker failure answers 502 `{ error, kind }` with A6-D11's sentence through `reachSentence` (moved to `src/core/source-reach.mjs`, re-exported from `requirements/export.mjs`, unchanged).
- **Copy:** every user-facing string is design §9 verbatim, with "Jira" being the source's `displayName`, "Acme" the profile label, "SHOP"/"CRM" the tracker project key. Strings the design does not name are listed in the report under "invented copy" and in Appendix B.
- **CSS:** every new rule is an `mk-tu-*` rule in a new block `/* ── marketplace ticket updates ── */` placed right before `/* ── marketplace P7 ── */` in `ui/public/style.css` (the Marketplace block), tokens only (no hex, no `rgba(`), font sizes `var(--fs-*)`, so board 2 (dark) needs nothing more. Phone (board 6) at `max-width: 600px`.
- **Accessibility (§11):** the section is a `section` labelled by its header; the rules a `role="list"`; the move select a `button` with `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls`, labelled "<KEY>: move to", focus kept on it while open with `aria-activedescendant`; options `role="option"` with `aria-selected`; group labels and the separator `role="presentation"`; dots `aria-hidden`; the projects popover a `role="dialog"` labelled "Projects you work on" with a multi-select listbox; loading and failure lines `aria-live="polite"`; the gone line tied by `aria-describedby`; 44 px targets on a phone.
- **Level:** Advanced, with the Marketplace page; no new level.
- **Platforms:** Windows and Linux. Files keep their line endings (the repo stores LF; a Windows checkout has CRLF in the working tree: edit with the Edit tool, never rewrite a whole file).
- **Tests are hermetic:** one file at a time with `node tools/test.mjs test/<file>.test.mjs` (it sets an isolated `WORCA_HOME`); no real Claude, no real Jira: every tracker call goes to the mock shim (`WORCA_MOCK=1`, `setMockSourceResponses`), an injected fake `fetch`, or `test/helpers/fake-jira.mjs` on `127.0.0.1`. A test that turns the flag on sets `process.env.WORCA_FLAGS` and restores it.
- No local machine paths and no real person's names in shipped files, tests, docs or plans (fixtures use "Ann Example"). No `console.log`, `debugger`, `TODO` or `FIXME`.

## Deviations from the design

1. **`GET …/ticket-updates` calls `legacyMove` whenever the connection is saved, not only while nothing is saved (§5).** After the first save the sheet must still replace the old field's control with "Moved to Ticket updates." (D4), and only `legacyMove` names that field. One extra child spawn per sheet opening; the answer's `target` is used only while `saved` is false.
2. **`GET …/ticket-updates` accepts no `profile` for a multi-profile source whose roster is empty (§5's guard).** That is the only time the manage sheet shows the profile id field (board 5 A, "a new profile (the id field)"); the route then answers `{ available, connection: 'new', profile: null, … }`, probing `capabilities` through the default bucket (`allowLegacyDefault`), with no other call. Every other request keeps the guard exactly.
3. **A non-400 `plugin` failure of the transition `POST` is also a "Not moved" line (D10 vs §7).** D10 says any failed move other than auth, network, rate limit or timeout still posts the comment; §7 says a 400 is a line and "any other failure throws". Reconciled: Jira's `plugin`-kind failures (400, 403, 409, 500…) give `Not moved: Jira refused the move to <status>: <Jira's message>.`; `auth`, `network` and `rate-limit` throw as today.
4. **Two existing `listProjects` assertions in `test/jira-source-connector.test.mjs` gain `name` (§12 says every existing connector test is unchanged).** §7 adds `name` to every `listProjects` item, so a `deepEqual` on the old shape must change; no `reportResult` row changes.
5. **The old field's help line goes with its control (D4).** D4 replaces the control by "Moved to Ticket updates." and keeps the label; the help under it ("Optional. A transition or status name … to move the issue to …") describes the control that left, so it is removed too.

## File structure

| File | Task | Responsibility |
|---|---|---|
| `src/core/plugin-config.mjs` | 1 | `readTicketUpdates`, `writeTicketUpdates`; `deleteProfile` drops the profile's bucket in `ticket-updates.json` |
| `src/shared/flags/registry.mjs` | 2, 19 | the `ticketUpdates` flag (its `docs` in Task 19) |
| `src/core/ticket-updates.mjs` (new) | 2 | pure rules: `toMove`, `moveFor`, `validateTicketUpdates`, `projectFilter`, `filterProjects`, `describeMove` |
| `src/core/source-reach.mjs` (new) | 3 | `reachReason`, `reachSentence` (moved from `requirements/export.mjs`, re-exported there) |
| `src/core/plugin-shim.mjs` | 4 | D17 mock answers: `capabilities`, `listProjects`, `listStatuses`, `legacyMove`, `reportResult` by `move` |
| `src/core/ticket-updates-routes.mjs` (new) | 5 | the four routes of §5 |
| `ui/server.mjs` | 5, 6 | registers the routes; filters `/api/sources/call`'s `listProjects` |
| `src/core/requirements/export.mjs` | 3, 6, 10 | re-exports the reach helpers; `exportOptions` filters `projects`; `exportView` gains `move` |
| `src/core/sources.mjs` | 7, 8 | `meta.project` pinned into `sourceMeta.project`; `move` in `reportResult`'s args; `{ note, moved }` returned |
| `src/core/requirements/start.mjs`, `src/core/run-harness.mjs` | 7, 8 | `reportTo.project` from the link's tracker project into `reportMeta`; the audit line's note |
| `ui/public/results-view.mjs` | 8 | Report result's "reported · <note>" |
| `plugins/jira-source/connector/index.mjs`, `worca-cc-plugin.json`, `README.md` | 9, 10 | the contract, §7, 0.2.0, the README section |
| `test/helpers/fake-jira.mjs` | 9, 10 | a project's statuses; seeded issues, transitions and a transition POST |
| `ui/public/requirements-view.mjs` | 11 | Report back's hint from `move` (D14) |
| `ui/public/marketplace/move-select.mjs` (new) | 12 | the move select (board 4) |
| `ui/public/marketplace/projects-popover.mjs` (new) | 13 | the projects popover (board 3) |
| `ui/public/marketplace/ticket-updates-section.mjs` (new) | 14, 15 | the section: states A–E, chips, rules, dirty, PUT body |
| `ui/public/marketplace/manage-sheet.mjs` | 16 | mounts the section; dirty; Save order; "Moved to Ticket updates." |
| `ui/public/style.css` | 17 | the `mk-tu-*` block, phone rules |
| `tools/verify-ticket-updates-cdp.mjs` (new), `package.json` | 18 | the browser proof, `npm run verify:ticket-updates` |
| `docs/ticket-updates.md` (new), `docs/feature-flags.md`, `docs/storage.md`, `docs/ui-levels.md`, `docs/requirements.md`, `docs/changelog/unreleased.md`, `.claude/skills/creating-worca-cc-plugins/SKILL.md`, `src/core/plugin-api.mjs` | 19 | docs and the contract table |
| `src/core/requirements/import.mjs`, jira-source `searchTickets` | 21 (conditional) | the import filter, only if #1041 is on `dev` |

Tests: `test/plugin-config.test.mjs` (1), `test/ticket-updates.test.mjs` (2), `test/flags-api.test.mjs`, `test/index-html.test.mjs` (2), `test/source-reach.test.mjs` (3), `test/plugin-shim.test.mjs` (4), `test/api-ticket-updates.test.mjs` (5, 6), `test/requirements-export.test.mjs` (6, 10), `test/sources.test.mjs`, `test/requirements-start.test.mjs`, `test/requirements-run-link.test.mjs` (7), `test/writeback.test.mjs`, `test/results-view-helpers.test.mjs` (8), `test/jira-source-ticket-updates.test.mjs`, `test/jira-source-export.test.mjs`, `test/jira-source-connector.test.mjs` (9, 10), `test/requirements-export.test.mjs`, `test/requirements-view-export.test.mjs` (11), `test/marketplace-move-select.test.mjs` (12), `test/marketplace-projects-popover.test.mjs` (13), `test/helpers/ticket-updates-fixtures.mjs`, `test/marketplace-ticket-updates.test.mjs` (14–16), `test/marketplace-ticket-updates-css.test.mjs` (17), `test/requirements-import-ticket-updates.test.mjs` (21, conditional).

## Review Focus

1. **Nothing changes without a save, or with the flag off.** No record → no `move`, the plugins' old settings; flag off → no section, 404s, no filter, no `move` (Tasks 2, 5, 6, 8).
2. **No tracker call from the browser.** Every op in the routes goes through `callSource`; `/api/sources/call`'s allowlist is untouched (Tasks 5, 6).
3. **The host never parses an id.** The project comes from `getTask`'s `meta.project` or the export link's tracker project (Task 7).
4. **Jira never closes a ticket as cancelled, fills a Resolution, and the line is last.** §7 against the fake Jira on Cloud and Data Center; legacy unchanged (Tasks 9, 10).
5. **The sheet's Save:** config `PUT` first, a refusal stops the ticket-updates `PUT`; the carried-over state is not dirty; the old field's control is gone after the first save (Task 16).
6. **Accessibility and phone** (Tasks 12, 13, 14, 17, 18).

---

### Task 1: Storage: `ticket-updates.json` in the plugin's data folder

D3 and §4: one record per profile and task source, in the `profiles/1` envelope; `deleteProfile` drops the profile's bucket; purge removes the file with `data/`.

**Files:**
- Modify: `src/core/plugin-config.mjs` (`files()`, `deleteProfile`, two new exports)
- Test: `test/plugin-config.test.mjs` (imports, three tests at the end)

**Interfaces:**
- Consumes: `readBucket`, `writeBucket`, `profileId`, `isBag`, `files()` (all already in `plugin-config.mjs`); `purgePluginData(name)` from `src/core/plugin-store.mjs` (test only).
- Produces: `readTicketUpdates(name: string, profile: string|undefined, sourceId: string) → object|null` (null = nothing saved: legacy, D4); `writeTicketUpdates(name, profile, sourceId, record: object) → { ok: true }` (atomic; other profiles and sources untouched; throws on an empty source id, a bad profile id or a non-object record); `deleteProfile(name, id)` also rewrites `ticket-updates.json` without that profile.

- [ ] **Step 1: Write the failing tests**

In `test/plugin-config.test.mjs`, replace the import from `../src/core/plugin-config.mjs` and add one import:

```js
import {
  readPluginConfig, writePluginConfig, redactedConfig, readPluginState, writePluginState,
  listProfiles, listProfileIds, createProfile, deleteProfile, isValidProfileId, DEFAULT_PROFILE,
  readTicketUpdates, writeTicketUpdates,
} from '../src/core/plugin-config.mjs';
import { purgePluginData } from '../src/core/plugin-store.mjs';
```

Append at the end of the file:

```js
// ── ticket updates (plans/ticket-updates-design.md §4, D3) ─────────────────────
const TU_REC = { projects: [{ value: 'SHOP', label: 'Shop' }],
  rules: [{ project: '', moment: 'finished', target: { kind: 'category', value: 'done' } }],
  savedAt: '2026-10-29T10:42:00.000Z', savedBy: 'local' };

test('ticket updates: null until saved; one record per profile and source, in the profiles/1 envelope', () => {
  const P = 'tu-plugin';
  assert.equal(readTicketUpdates(P, 'acme', 'jira'), null, 'nothing saved: legacy');
  writeTicketUpdates(P, 'acme', 'jira', TU_REC);
  writeTicketUpdates(P, 'acme', 'other', { ...TU_REC, projects: [] });
  writeTicketUpdates(P, 'beta', 'jira', { ...TU_REC, savedBy: 'ann' });
  assert.deepEqual(readTicketUpdates(P, 'acme', 'jira'), TU_REC);
  assert.deepEqual(readTicketUpdates(P, 'acme', 'other').projects, []);
  assert.equal(readTicketUpdates(P, 'beta', 'jira').savedBy, 'ann');
  assert.equal(readTicketUpdates(P, 'beta', 'other'), null);
  assert.equal(readTicketUpdates(P, undefined, 'jira'), null, 'no profile = the default bucket, empty here');
  const onDisk = JSON.parse(readFileSync(join(pluginDataDir(P), 'ticket-updates.json'), 'utf8'));
  assert.equal(onDisk.$format, 'profiles/1');
  assert.deepEqual(Object.keys(onDisk.profiles).sort(), ['acme', 'beta']);
  assert.deepEqual(Object.keys(onDisk.profiles.acme).sort(), ['jira', 'other']);
  assert.deepEqual(readdirSync(pluginDataDir(P)).filter((f) => f.endsWith('.tmp')), [], 'atomic: no temp litter');
  assert.throws(() => writeTicketUpdates(P, 'acme', '', TU_REC), /task source/);
  assert.throws(() => writeTicketUpdates(P, '../x', 'jira', TU_REC), /invalid profile id/);
  assert.throws(() => writeTicketUpdates(P, 'acme', 'jira', null), /must be an object/);
});

test("ticket updates: deleteProfile drops that profile's records and keeps the others", () => {
  const P = 'tu-del';
  createProfile(P, 'acme', 'Acme');
  createProfile(P, 'beta', 'Beta');
  writeTicketUpdates(P, 'acme', 'jira', TU_REC);
  writeTicketUpdates(P, 'beta', 'jira', TU_REC);
  deleteProfile(P, 'acme');
  assert.equal(readTicketUpdates(P, 'acme', 'jira'), null);
  assert.deepEqual(readTicketUpdates(P, 'beta', 'jira'), TU_REC);
  const onDisk = JSON.parse(readFileSync(join(pluginDataDir(P), 'ticket-updates.json'), 'utf8'));
  assert.deepEqual(Object.keys(onDisk.profiles), ['beta']);
});

test("ticket updates: purge removes the file with the plugin's data", () => {
  const P = 'tu-orphan';   // not in the lock: purgePluginData's orphan path
  writeTicketUpdates(P, 'acme', 'jira', TU_REC);
  assert.ok(existsSync(join(pluginDataDir(P), 'ticket-updates.json')));
  purgePluginData(P);
  assert.equal(existsSync(join(pluginDataDir(P), 'ticket-updates.json')), false);
  assert.equal(readTicketUpdates(P, 'acme', 'jira'), null);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/plugin-config.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../src/core/plugin-config.mjs' does not provide an export named 'readTicketUpdates'`.

- [ ] **Step 3: Implement**

In `src/core/plugin-config.mjs`, add the file to `files()`:

```js
function files(name) {
  const dir = pluginDataDir(name);
  return {
    config: join(dir, 'config.json'),
    secrets: join(dir, 'secrets.json'),
    state: join(dir, 'state.json'),
    profiles: join(dir, 'profiles.json'),
    // Ticket updates (plans/ticket-updates-design.md §4): Worca's own record per profile and task source, never a connector's.
    ticketUpdates: join(dir, 'ticket-updates.json'),
  };
}
```

In `deleteProfile`, change the loop's file list:

```js
  for (const [file, opts] of [[f.config, undefined], [f.secrets, { mode: 0o600 }], [f.state, undefined], [f.ticketUpdates, undefined]]) {
```

and the first line of its doc comment to `Delete a profile and everything stored under it (config, secrets, state, ticket updates).`

Append at the end of the file:

```js
// ── ticket updates ────────────────────────────────────────────────────────────
// plans/ticket-updates-design.md D3, §4: the projects you work on and the rules for a finished run, per profile and task
// source, in the same envelope as the files above: { "$format": "profiles/1", "profiles": { <profile>: { <sourceId>: record } } }.
// Not in config.json (PUT /api/plugins/:name/config writes any key it is given) and not in state.json (connectors write it).
// No secrets. deleteProfile drops a profile's bucket here too; uninstall keeps data/, purge removes it.

/** One profile's record for one task source, or null when nothing is saved (the plugin's old setting applies, D4). */
export function readTicketUpdates(name, profile, sourceId) {
  const rec = readBucket(files(name).ticketUpdates, profileId(profile))[String(sourceId ?? '')];
  return isBag(rec) ? rec : null;
}

/** Replace one profile's record for one task source; every other profile and source is left alone. Atomic. */
export function writeTicketUpdates(name, profile, sourceId, record) {
  const pid = profileId(profile);
  const sid = String(sourceId ?? '');
  if (!sid) throw new Error('a task source id is required');
  if (!isBag(record)) throw new Error('a ticket updates record must be an object');
  const file = files(name).ticketUpdates;
  writeBucket(file, pid, { ...readBucket(file, pid), [sid]: record });
  return { ok: true };
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/plugin-config.test.mjs`
Expected: PASS (every test, the three new ones included).

- [ ] **Step 5: Commit**

```bash
git add src/core/plugin-config.mjs test/plugin-config.test.mjs
git commit -m "Ticket updates: store the record per profile and source in the plugin's data folder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `ticketUpdates` flag and the provider-neutral rules

D16's flag; D2, D4, D7, D9, D14 and §4, §6 as pure functions over the record.

**Files:**
- Modify: `src/shared/flags/registry.mjs` (one entry after `runTelemetry`)
- Create: `src/core/ticket-updates.mjs`
- Test: create `test/ticket-updates.test.mjs`; modify `test/flags-api.test.mjs` (two `deepEqual`s), `test/index-html.test.mjs` (two rows)

**Interfaces:**
- Consumes: `readTicketUpdates`, `DEFAULT_PROFILE` (Task 1); `flagEnabled` from `src/core/flags.mjs`.
- Produces (all in `src/core/ticket-updates.mjs`):
  - `TU_CATEGORIES = ['todo', 'in_progress', 'done', 'cancelled']`, `TU_MOMENTS = ['finished']`, `TU_LIMITS = { projects: 200, rules: 200, text: 200 }`
  - `class TicketUpdatesError extends Error` with `code = 'BAD_REQUEST'`
  - `toMove(target) → { none: true } | { category: 'done' } | { status: string, name?: string }`
  - `moveFor({ plugin, sourceId, profile, project, status }) → move | undefined` (`undefined` = flag off or no record: legacy)
  - `validateTicketUpdates(body) → { projects: [{ value, label }], rules: [{ project, label?, moment, target }] }` (All projects first; throws `TicketUpdatesError`)
  - `projectFilter(plugin, sourceId, profile) → Set<string> | null`
  - `filterProjects(options, filter, keep = []) → options` (the same array when `filter` is null)
  - `describeMove(move, { project }) → { kind: 'none' | 'category' | 'status', label: string } | null`

- [ ] **Step 1: Write the failing tests**

Create `test/ticket-updates.test.mjs`:

```js
// test/ticket-updates.test.mjs — Ticket updates' provider-neutral rules (plans/ticket-updates-design.md D2, D4, D7, D9, D14,
// §4, §6): the move a finished run passes, the save's checks, the projects filter and Report back's words.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { writeTicketUpdates } from '../src/core/plugin-config.mjs';
import {
  toMove, moveFor, validateTicketUpdates, projectFilter, filterProjects, describeMove, TU_LIMITS, TicketUpdatesError,
} from '../src/core/ticket-updates.mjs';

useTempHome(after, 'worca-tu-rules-');
const prevFlags = process.env.WORCA_FLAGS;
after(() => { if (prevFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prevFlags; });
const flag = (on) => { process.env.WORCA_FLAGS = on ? 'ticketUpdates' : '-ticketUpdates'; };

const ALL = (target) => ({ project: '', moment: 'finished', target });
const RULE = (project, label, target) => ({ project, label, moment: 'finished', target });
const RESOLVED = { kind: 'status', value: '10012', label: 'Resolved', category: 'done' };
const SAVED = {
  projects: [{ value: 'SHOP', label: 'Shop' }, { value: 'CRM', label: 'Customer portal' }],
  rules: [ALL({ kind: 'category', value: 'done' }), RULE('SHOP', 'Shop', RESOLVED), RULE('CRM', 'Customer portal', { kind: 'none' })],
  savedAt: '2026-10-29T10:42:00.000Z', savedBy: 'local',
};
writeTicketUpdates('jira-source', 'acme', 'jira', SAVED);
writeTicketUpdates('jira-source', 'typed', 'jira', { projects: [], rules: [ALL({ kind: 'typed', value: 'Resolve' })] });
const AT = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };

test('toMove: each stored target as the move a plugin hears (§3)', () => {
  assert.deepEqual(toMove({ kind: 'none' }), { none: true });
  assert.deepEqual(toMove({ kind: 'category', value: 'done' }), { category: 'done' });
  assert.deepEqual(toMove(RESOLVED), { status: '10012', name: 'Resolved' });
  assert.deepEqual(toMove({ kind: 'typed', value: 'Resolve' }), { status: 'Resolve' }, 'typed: no name');
  assert.deepEqual(toMove(undefined), { none: true });
});

test('moveFor: project rule, All projects, no project, no record, a failed run, flag off, typed (D4, D7, §6)', async () => {
  flag(true);
  await checkRows([
    { name: "the ticket's project rule wins", run: () => assert.deepEqual(moveFor({ ...AT, project: 'SHOP', status: 'completed' }), { status: '10012', name: 'Resolved' }) },
    { name: "a project rule of Don't move", run: () => assert.deepEqual(moveFor({ ...AT, project: 'CRM', status: 'completed' }), { none: true }) },
    { name: 'a project without a rule: All projects', run: () => assert.deepEqual(moveFor({ ...AT, project: 'OPS', status: 'completed' }), { category: 'done' }) },
    { name: 'no project (a row from before this change): All projects', run: () => {
      assert.deepEqual(moveFor({ ...AT, project: '', status: 'completed' }), { category: 'done' });
      assert.deepEqual(moveFor({ ...AT, status: 'completed' }), { category: 'done' });
    } },
    { name: 'no record: undefined (legacy)', run: () => assert.equal(moveFor({ ...AT, profile: 'beta', project: 'SHOP', status: 'completed' }), undefined) },
    { name: 'a run that did not finish successfully: none, once rules exist', run: () => {
      assert.deepEqual(moveFor({ ...AT, project: 'SHOP', status: 'failed' }), { none: true });
      assert.deepEqual(moveFor({ ...AT, project: 'SHOP', status: 'needs-human' }), { none: true });
    } },
    { name: 'typed carried over: status without a name', run: () => assert.deepEqual(moveFor({ ...AT, profile: 'typed', status: 'completed' }), { status: 'Resolve' }) },
    { name: 'no profile reads the default bucket (empty here)', run: () => assert.equal(moveFor({ plugin: 'jira-source', sourceId: 'jira', status: 'completed' }), undefined) },
  ]);
  flag(false);
  assert.equal(moveFor({ ...AT, project: 'SHOP', status: 'completed' }), undefined, 'flag off: saved rules are ignored');
});

const refused = (body, re) => assert.throws(() => validateTicketUpdates(body),
  (e) => e instanceof TicketUpdatesError && e.code === 'BAD_REQUEST' && re.test(e.message));
const NONE_ALL = ALL({ kind: 'none' });

test('validateTicketUpdates: the limits and shapes of §4; the clean record, All projects first', async () => {
  await checkRows([
    { name: 'a valid body comes back clean, All projects first, labels defaulted, a repeated project dropped', run: () => {
      const v = validateTicketUpdates({ projects: [{ value: ' SHOP ', label: 'Shop' }, { value: 'SHOP', label: 'x' }, { value: 'CRM' }],
        rules: [RULE('SHOP', '', RESOLVED), ALL({ kind: 'typed', value: 'Resolve' })], extra: 1 });
      assert.deepEqual(v, { projects: [{ value: 'SHOP', label: 'Shop' }, { value: 'CRM', label: 'CRM' }],
        rules: [{ project: '', moment: 'finished', target: { kind: 'typed', value: 'Resolve' } },
          { project: 'SHOP', label: 'SHOP', moment: 'finished', target: RESOLVED }] });
    } },
    { name: 'projects and rules must be lists', run: () => { refused({ rules: [NONE_ALL] }, /projects/); refused({ projects: [] }, /rules/); } },
    { name: 'at most 200 projects', run: () => refused({ projects: Array.from({ length: TU_LIMITS.projects + 1 }, (_, i) => ({ value: `P${i}` })), rules: [NONE_ALL] }, /200 projects/) },
    { name: 'at most 200 project rules', run: () => refused({ projects: [],
      rules: [NONE_ALL, ...Array.from({ length: TU_LIMITS.rules + 1 }, (_, i) => RULE(`P${i}`, '', { kind: 'none' }))] }, /200 project rules/) },
    { name: 'values and labels at most 200 characters', run: () => {
      refused({ projects: [{ value: 'X'.repeat(201) }], rules: [NONE_ALL] }, /200 characters/);
      refused({ projects: [], rules: [NONE_ALL, RULE('SHOP', 'n'.repeat(201), { kind: 'none' })] }, /200 characters/);
    } },
    { name: 'one rule per project and moment', run: () => refused({ projects: [], rules: [NONE_ALL, RULE('SHOP', '', { kind: 'none' }), RULE('SHOP', '', { kind: 'none' })] }, /SHOP has more than one rule/) },
    { name: 'exactly one All projects rule', run: () => {
      refused({ projects: [], rules: [RULE('SHOP', '', { kind: 'none' })] }, /exactly one rule/);
      refused({ projects: [], rules: [NONE_ALL, NONE_ALL] }, /All projects has more than one rule/);
    } },
    { name: 'All projects only none, category or typed', run: () => refused({ projects: [], rules: [ALL(RESOLVED)] }, /All projects can only be/) },
    { name: 'typed only on All projects', run: () => refused({ projects: [], rules: [NONE_ALL, RULE('SHOP', '', { kind: 'typed', value: 'x' })] }, /old setting/) },
    { name: 'moments only finished', run: () => refused({ projects: [], rules: [{ ...NONE_ALL, moment: 'started' }] }, /finishes/) },
    { name: 'a status needs its id, name and one of the four categories', run: () => {
      refused({ projects: [], rules: [NONE_ALL, RULE('SHOP', '', { kind: 'status', value: '1', label: 'Done', category: 'closed' })] }, /category/);
      refused({ projects: [], rules: [NONE_ALL, RULE('SHOP', '', { kind: 'status', value: '', label: 'Done', category: 'done' })] }, /id and name/);
    } },
    { name: 'a category move is only Any Done status; an unknown kind is refused', run: () => {
      refused({ projects: [], rules: [ALL({ kind: 'category', value: 'todo' })] }, /Any Done status/);
      refused({ projects: [], rules: [ALL({ kind: 'close' })] }, /needs a move/);
    } },
  ]);
});

test('projectFilter and filterProjects (D9): only with the flag on and projects picked; a kept value stays', () => {
  flag(true);
  assert.deepEqual([...projectFilter('jira-source', 'jira', 'acme')], ['SHOP', 'CRM']);
  assert.equal(projectFilter('jira-source', 'jira', 'typed'), null, 'none picked = all projects');
  assert.equal(projectFilter('jira-source', 'jira', 'beta'), null, 'no record');
  const all = [{ value: 'SHOP', label: 'Shop (SHOP)' }, { value: 'OPS', label: 'Operations (OPS)' }, { value: 'CRM', label: 'Customer portal (CRM)' }];
  assert.deepEqual(filterProjects(all, projectFilter('jira-source', 'jira', 'acme')).map((o) => o.value), ['SHOP', 'CRM']);
  assert.deepEqual(filterProjects(all, new Set(['CRM']), ['OPS']).map((o) => o.value), ['OPS', 'CRM'], 'a saved choice outside the filter stays');
  assert.equal(filterProjects(all, null), all);
  flag(false);
  assert.equal(projectFilter('jira-source', 'jira', 'acme'), null, 'flag off: no filter');
});

test('describeMove (D14): the words Report back uses', () => {
  assert.equal(describeMove(undefined), null);
  assert.deepEqual(describeMove({ category: 'done' }, { project: 'SHOP' }), { kind: 'category', label: 'a Done status' });
  assert.deepEqual(describeMove({ status: '10012', name: 'Resolved' }, { project: 'SHOP' }), { kind: 'status', label: 'Resolved' });
  assert.deepEqual(describeMove({ status: 'Resolve' }, { project: 'SHOP' }), { kind: 'status', label: 'Resolve' });
  assert.deepEqual(describeMove({ none: true }, { project: 'SHOP' }), { kind: 'none', label: 'SHOP' });
});
```

In `test/flags-api.test.mjs`, both maps gain `ticketUpdates: false` at the end:

```js
        assert.deepEqual(msgs.find((m) => m.type === 'hello').flags, { flagsDemo: false, commandSummaries: true, runLabels: false, smartRunNaming: false, requirements: false, runTelemetry: false, ticketUpdates: false });
```

```js
        assert.deepEqual(msgs.filter((m) => m.type === 'flags').at(-1), { type: 'flags', flags: { flagsDemo: true, commandSummaries: true, runLabels: false, smartRunNaming: false, requirements: false, runTelemetry: false, ticketUpdates: false } });
```

In `test/index-html.test.mjs`, the "on" row:

```js
      const out = renderIndexHtml(mini, 'dark', 'simple', { flagsDemo: true, commandSummaries: true, runLabels: true, smartRunNaming: true, requirements: true, runTelemetry: true, ticketUpdates: true });
      assert.match(out, /<html lang="en" data-theme="dark" data-level="simple" data-flags="flagsDemo commandSummaries runLabels smartRunNaming requirements runTelemetry ticketUpdates">/);
```

and the "off" row:

```js
      const out = renderIndexHtml(mini, 'light', undefined, { flagsDemo: false, commandSummaries: false, runLabels: false, smartRunNaming: false, requirements: false, runTelemetry: false, ticketUpdates: false });
      assert.match(out, /<html lang="en" data-theme="light" data-flags="">/);
      assert.match(out, /<style id="flag-gates">\[data-flag~="flagsDemo"\]\{display:none!important\}\n\[data-flag~="commandSummaries"\]\{display:none!important\}\n\[data-flag~="runLabels"\]\{display:none!important\}\n\[data-flag~="smartRunNaming"\]\{display:none!important\}\n\[data-flag~="requirements"\]\{display:none!important\}\n\[data-flag~="runTelemetry"\]\{display:none!important\}\n\[data-flag~="ticketUpdates"\]\{display:none!important\}<\/style>/);
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/ticket-updates.test.mjs test/flags-api.test.mjs test/index-html.test.mjs`
Expected: FAIL — `ticket-updates.test.mjs`: `Cannot find module '…/src/core/ticket-updates.mjs'`; `flags-api`: the hello map has no `ticketUpdates`; `index-html`: the gates regex does not match.

- [ ] **Step 3: Implement**

In `src/shared/flags/registry.mjs`, after the `runTelemetry` entry (the `docs` field comes in Task 19, with the page):

```js
  entry({
    key: 'ticketUpdates',
    title: 'Ticket updates',
    description: 'Marketplace › Installed › a tracker plugin › Settings gets Ticket updates: the projects you work on, and per project what a finished run does to its tickets (Don\'t move, Any Done status, or one of that project\'s statuses). New run and Requirements list only those projects. Off: each plugin\'s old setting applies.',
    stage: 'experimental',
    default: false,
    owner: 'TomicaB',
    since: '1.16.0',
    added: '2026-10-29',
    reviewBy: '2027-01-27',
  }),
```

Create `src/core/ticket-updates.mjs`:

```js
// src/core/ticket-updates.mjs — what Worca does to a ticket when a run finishes (plans/ticket-updates-design.md §6).
// Pure but for the record read: the move write-back passes to a plugin (D7), the checks a save must pass (§4), the projects
// filter (D9) and the words Report back uses (D14). Provider-neutral: it knows no tracker's id format or status names; each
// plugin translates a move into its tracker's terms (D1, D5).
import { flagEnabled } from './flags.mjs';
import { readTicketUpdates, DEFAULT_PROFILE } from './plugin-config.mjs';

export const TU_CATEGORIES = Object.freeze(['todo', 'in_progress', 'done', 'cancelled']);
export const TU_MOMENTS = Object.freeze(['finished']);
export const TU_LIMITS = Object.freeze({ projects: 200, rules: 200, text: 200 });

/** A save §4 refuses; the route answers 400 with its message. */
export class TicketUpdatesError extends Error {
  constructor(message) { super(message); this.name = 'TicketUpdatesError'; this.code = 'BAD_REQUEST'; }
}

const isBag = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** The saved record, or null (nothing saved, or a file Worca cannot read). */
function recordOf(plugin, sourceId, profile) {
  try {
    const rec = readTicketUpdates(plugin, profile || DEFAULT_PROFILE, sourceId);
    return rec && Array.isArray(rec.rules) ? rec : null;
  } catch { return null; }
}

/** A stored target as the move a plugin hears (§3): none → { none }, category → Any Done status, status → its id and name,
 *  typed (a carried-over Jira setting) → its text without a name. */
export function toMove(target) {
  const t = isBag(target) ? target : { kind: 'none' };
  if (t.kind === 'category') return { category: 'done' };
  if (t.kind === 'status') return { status: String(t.value), ...(t.label ? { name: String(t.label) } : {}) };
  if (t.kind === 'typed') return { status: String(t.value) };
  return { none: true };
}

/**
 * The move for one write-back (D7, §6): undefined with the flag off or nothing saved (the plugin's old setting applies, D4);
 * { none: true } for a run that did not finish successfully once rules exist; else the ticket's project rule, else All projects.
 * @param {{plugin:string, sourceId:string, profile?:string|null, project?:string|null, status:string}} o
 */
export function moveFor({ plugin, sourceId, profile, project, status } = {}) {
  if (!flagEnabled('ticketUpdates')) return undefined;
  const rec = recordOf(plugin, sourceId, profile);
  if (!rec) return undefined;
  if (status !== 'completed') return { none: true };   // only `finished` exists (D2)
  const finished = rec.rules.filter((r) => isBag(r) && r.moment === 'finished');
  const rule = (project && finished.find((r) => r.project === project)) || finished.find((r) => r.project === '');
  return toMove(rule && rule.target);
}

function text(v, what) {
  const s = typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : '');
  if (s.length > TU_LIMITS.text) throw new TicketUpdatesError(`${what} is longer than ${TU_LIMITS.text} characters.`);
  return s;
}

function targetOf(t, allProjects) {
  if (!isBag(t)) throw new TicketUpdatesError('Each rule needs a move.');
  if (t.kind === 'none') return { kind: 'none' };
  if (t.kind === 'category') {
    if (t.value !== 'done') throw new TicketUpdatesError('A category move can only be Any Done status.');
    return { kind: 'category', value: 'done' };
  }
  if (t.kind === 'typed') {
    if (!allProjects) throw new TicketUpdatesError('Only All projects can keep the old setting.');
    const value = text(t.value, 'A status');
    if (!value) throw new TicketUpdatesError('A status needs a name.');
    return { kind: 'typed', value };
  }
  if (t.kind === 'status') {
    if (allProjects) throw new TicketUpdatesError("All projects can only be Don't move or Any Done status.");
    const value = text(t.value, 'A status id');
    const label = text(t.label, 'A status name');
    if (!value || !label) throw new TicketUpdatesError('A status needs its id and name.');
    if (!TU_CATEGORIES.includes(t.category)) throw new TicketUpdatesError('A status needs its category.');
    return { kind: 'status', value, label, category: t.category };
  }
  throw new TicketUpdatesError('Each rule needs a move.');
}

/**
 * §4's checks on a PUT body: at most 200 projects and 200 project rules, values and labels at most 200 characters, one rule
 * per (project, moment), exactly one All projects rule (project ''), All projects only none / category / typed, moments only
 * `finished`. Answers the clean record (All projects first; a missing label is the key); throws TicketUpdatesError.
 * @returns {{projects:Array<{value:string,label:string}>, rules:Array<{project:string,label?:string,moment:string,target:object}>}}
 */
export function validateTicketUpdates(body) {
  const b = isBag(body) ? body : {};
  if (!Array.isArray(b.projects)) throw new TicketUpdatesError('projects must be a list.');
  if (!Array.isArray(b.rules)) throw new TicketUpdatesError('rules must be a list.');
  if (b.projects.length > TU_LIMITS.projects) throw new TicketUpdatesError(`Pick at most ${TU_LIMITS.projects} projects.`);
  const projects = [];
  const seen = new Set();
  for (const p of b.projects) {
    const value = text(isBag(p) ? p.value : '', 'A project key');
    const label = text(isBag(p) ? p.label : '', 'A project name');
    if (!value) throw new TicketUpdatesError('Each project needs its key.');
    if (seen.has(value)) continue;
    seen.add(value);
    projects.push({ value, label: label || value });
  }
  const all = [];
  const own = [];
  const keys = new Set();
  for (const r of b.rules) {
    if (!isBag(r)) throw new TicketUpdatesError('Each rule needs a project and a move.');
    if (!TU_MOMENTS.includes(r.moment)) throw new TicketUpdatesError('A rule can only apply when a run finishes.');
    const project = text(r.project, 'A project key');
    const key = `${project}\u0000${r.moment}`;
    if (keys.has(key)) throw new TicketUpdatesError(`${project || 'All projects'} has more than one rule.`);
    keys.add(key);
    if (!project) { all.push({ project: '', moment: r.moment, target: targetOf(r.target, true) }); continue; }
    const label = text(r.label, 'A project name');
    own.push({ project, label: label || project, moment: r.moment, target: targetOf(r.target, false) });
  }
  if (all.length !== 1) throw new TicketUpdatesError('All projects needs exactly one rule.');
  if (own.length > TU_LIMITS.rules) throw new TicketUpdatesError(`Keep at most ${TU_LIMITS.rules} project rules.`);
  return { projects, rules: [...all, ...own] };
}

/** The projects a connection's lists keep (D9): a Set of project values, or null (flag off, nothing saved, none picked). */
export function projectFilter(plugin, sourceId, profile) {
  if (!flagEnabled('ticketUpdates')) return null;
  const rec = recordOf(plugin, sourceId, profile);
  const values = rec && Array.isArray(rec.projects) ? rec.projects.map((p) => (isBag(p) ? String(p.value ?? '') : '')).filter(Boolean) : [];
  return values.length ? new Set(values) : null;
}

/** A list of `{ value, … }` options shortened to the filter; `keep` (a saved choice) stays listed (D9). */
export function filterProjects(options, filter, keep = []) {
  if (!filter || !Array.isArray(options)) return options;
  const kept = new Set((keep || []).filter(Boolean).map(String));
  return options.filter((o) => isBag(o) && (filter.has(String(o.value)) || kept.has(String(o.value))));
}

/** Report back's words for a move (D14): { kind, label }, where label is what the hint names (the status, "a Done status",
 *  or for Don't move the project whose tickets stay); null for no move (the old two lines). */
export function describeMove(move, { project = '' } = {}) {
  if (!isBag(move)) return null;
  if (move.none === true) return { kind: 'none', label: String(project || '') };
  if (move.category === 'done') return { kind: 'category', label: 'a Done status' };
  if (typeof move.status === 'string' && move.status) return { kind: 'status', label: String(move.name || move.status) };
  return null;
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/ticket-updates.test.mjs test/flags-api.test.mjs test/index-html.test.mjs test/flags-registry.test.mjs test/flags-usage.test.mjs`
Expected: PASS (the usage scan finds `flagEnabled('ticketUpdates')` in `src/core/ticket-updates.mjs`).

- [ ] **Step 5: Commit**

```bash
git add src/shared/flags/registry.mjs src/core/ticket-updates.mjs test/ticket-updates.test.mjs test/flags-api.test.mjs test/index-html.test.mjs
git commit -m "Ticket updates: the Labs flag and the rules (move, checks, project filter)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `src/core/source-reach.mjs`: the reach sentence moves out of Requirements

§5: `reachReason` and `reachSentence` move to a shared module and are re-exported from `requirements/export.mjs`, unchanged.

**Files:**
- Create: `src/core/source-reach.mjs`
- Modify: `src/core/requirements/export.mjs` (remove `SENTENCE_KINDS`, `NOT_COPY`, `isSentence`, `reachReason`, `reachSentence`; import and re-export)
- Test: create `test/source-reach.test.mjs`

**Interfaces:**
- Produces: `reachReason(err: {kind?, message?}, name?: string) → string`, `reachSentence(name: string, err) → string` ("Worca could not reach Jira: the API token was refused."), byte-identical to A6's. `requirements/export.mjs` still exports both names (the same function objects).

- [ ] **Step 1: Write the failing test**

Create `test/source-reach.test.mjs`:

```js
// test/source-reach.test.mjs — A6-D11's reach sentence, shared by Requirements and Ticket updates (plans/ticket-updates-design.md §5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PluginOpError } from '../src/core/plugin-shim.mjs';
import { reachReason, reachSentence } from '../src/core/source-reach.mjs';
import * as exportMod from '../src/core/requirements/export.mjs';

test('the reach helpers live in source-reach.mjs; requirements/export.mjs re-exports the same functions', () => {
  assert.equal(exportMod.reachReason, reachReason);
  assert.equal(exportMod.reachSentence, reachSentence);
});

test("the sentences are A6's, unchanged", () => {
  assert.equal(reachSentence('Jira', new PluginOpError('auth', 'x')), 'Worca could not reach Jira: the API token was refused.');
  assert.equal(reachReason(new PluginOpError('timeout', 'plugin "jira-source" op "listStatuses" exceeded 30000ms (child killed)')), 'it did not answer within a minute');
  assert.equal(reachReason(new PluginOpError('network', 'Jira unreachable: fetch failed.')), 'Jira unreachable: fetch failed');
  assert.equal(reachReason(new PluginOpError('protocol', 'non-JSON'), 'Jira'), 'the Jira plugin gave an answer Worca could not read');
  assert.equal(reachReason(new PluginOpError('plugin', 'TypeError: x is not a function'), 'Jira'), 'the Jira plugin stopped unexpectedly');
  assert.equal(reachSentence('', { message: 'it did not name the ticket it made' }), 'Worca could not reach the tracker: it did not name the ticket it made.');
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node tools/test.mjs test/source-reach.test.mjs`
Expected: FAIL — `Cannot find module '…/src/core/source-reach.mjs'`.

- [ ] **Step 3: Implement**

Create `src/core/source-reach.mjs` (the five definitions moved verbatim from `requirements/export.mjs`):

```js
// src/core/source-reach.mjs — why a task source could not be reached, in product words (plans/requirements-a6-design.md D11).
// Shared by Requirements' export and the Ticket updates routes (plans/ticket-updates-design.md §5); requirements/export.mjs
// re-exports both functions unchanged.

/** Kinds whose message is the connector's own sentence ("Jira unreachable: fetch failed.", "Jira refused the request: …"). */
const SENTENCE_KINDS = new Set(['network', 'rate-limit', 'plugin']);
/** Not product copy: more than one line, a stack frame, a path or URL scheme of a file, the shim's own words, a JS error. */
const NOT_COPY = /[\r\n]|\bat\s+\S+\s+\(|\b(?:file|node):|[A-Za-z]:\\|(?:^|[\s'"(=])\/[\w.-]+\/|^plugin "|^\w*Error\b|^Cannot read propert|is not (?:a function|defined)/;
const isSentence = (m) => typeof m === 'string' && !!m.trim() && m.length <= 300 && !NOT_COPY.test(m);

/** D11: why a tracker could not be reached, in product words. A message that is not product copy (a connector that crashed,
 *  an answer the shim could not read, a kind the host does not know) becomes a fixed phrase; callers log the first line of the raw text. */
export function reachReason(err, name) {
  const kind = err && err.kind;
  const message = err && err.message;
  const plugin = name ? `the ${name} plugin` : "the tracker's plugin";
  if (kind === 'auth') return 'the API token was refused';
  if (kind === 'timeout') return 'it did not answer within a minute';
  if (kind === 'protocol') return `${plugin} gave an answer Worca could not read`;
  if (kind && !(SENTENCE_KINDS.has(kind) && isSentence(message))) return `${plugin} stopped unexpectedly`;
  return String(message || 'it did not answer').trim().replace(/\.+$/, '');
}
export const reachSentence = (name, err) => `Worca could not reach ${name || 'the tracker'}: ${reachReason(err, name)}.`;
```

In `src/core/requirements/export.mjs`, delete the block from `/** Kinds whose message is the connector's own sentence …` through `export const reachSentence = …;` (the lines now in `source-reach.mjs`). After the last existing import add:

```js
import { reachReason, reachSentence } from '../source-reach.mjs';
```

and after `export { isExporting };`:

```js
// D11's reach sentences live in src/core/source-reach.mjs (shared with Ticket updates); re-exported unchanged.
export { reachReason, reachSentence };
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/source-reach.test.mjs test/requirements-export-trackers.test.mjs test/requirements-export.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/source-reach.mjs src/core/requirements/export.mjs test/source-reach.test.mjs
git commit -m "Ticket updates: move the reach sentence to source-reach.mjs, re-exported unchanged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Mock mode answers the new ops (D17)

So every later test and the browser proof run offline: `capabilities` says `ticketUpdates`, the six board-3 projects, board 4's statuses, a `legacyMove` answer and a `reportResult` that answers by `move`.

**Files:**
- Modify: `src/core/plugin-shim.mjs` (`MOCK_DEFAULTS` and three small helpers above it)
- Test: `test/plugin-shim.test.mjs` (two existing assertions; one new test)

**Interfaces:**
- Produces (mock mode only, `WORCA_MOCK=1`): `capabilities` → `{ writeBack: true, export: true, ticketUpdates: true }`; `listProjects` → `[{ value: 'SHOP', label: 'Shop (SHOP)', name: 'Shop' }, …]` (SHOP Shop, CRM Customer portal, OPS Operations, SUP Support desk, MKT Marketing site, DATA Data platform); `listStatuses({ project })` → `[{ value, label, category }]` (Done 10001, Released 10002, In Progress 3, Waiting for customer 10003, Open 1, Won't Fix 10004; SHOP adds Resolved 10012 after Released); `legacyMove` → `{ field: 'transitionOnComplete', target: null }`; `reportResult(args)` → `{ moved: { from: 'In Progress', to }, note: 'Moved to <to>.' }` for a category or status move, else `{ moved: null, note: '' }`, still recorded in `lastReport`.
- `MOCK_PROJECTS`, `mockStatuses(project)`, `mockReport(move)` are module-private.

- [ ] **Step 1: Write the failing test**

In `test/plugin-shim.test.mjs`, in the test `'WORCA_MOCK=1 short-circuits without spawning (plugin need not exist)'`, change the two default assertions:

```js
    assert.deepEqual(await callSource({ plugin: 'x', sourceId: 'x', op: 'reportResult', args: { id: 'T-42', status: 'completed', summary: 's' } }), { moved: null, note: '' });
```

```js
    // A6: capabilities has a canned answer now: write-back stays on, and the mock source can export; Ticket updates (D17) too.
    assert.deepEqual(await callSource({ plugin: 'x', sourceId: 'x', op: 'capabilities', args: { inputs: {} } }), { writeBack: true, export: true, ticketUpdates: true });
```

Add after that test:

```js
test('WORCA_MOCK=1: the Ticket updates answers (plans/ticket-updates-design.md D17)', async () => {
  process.env.WORCA_MOCK = '1';
  const call = (op, args) => callSource({ plugin: 'not-installed', sourceId: 'x', op, args });
  try {
    setMockSourceResponses(null);
    assert.deepEqual((await call('listProjects', {})).map((p) => [p.value, p.label, p.name]), [
      ['SHOP', 'Shop (SHOP)', 'Shop'], ['CRM', 'Customer portal (CRM)', 'Customer portal'], ['OPS', 'Operations (OPS)', 'Operations'],
      ['SUP', 'Support desk (SUP)', 'Support desk'], ['MKT', 'Marketing site (MKT)', 'Marketing site'], ['DATA', 'Data platform (DATA)', 'Data platform']]);
    const crm = await call('listStatuses', { project: 'CRM' });
    assert.deepEqual(crm.map((s) => [s.label, s.category]), [['Done', 'done'], ['Released', 'done'], ['In Progress', 'in_progress'],
      ['Waiting for customer', 'in_progress'], ['Open', 'todo'], ["Won't Fix", 'cancelled']]);
    assert.deepEqual((await call('listStatuses', { project: 'SHOP' })).map((s) => s.label).slice(0, 3), ['Done', 'Released', 'Resolved']);
    assert.equal((await call('listStatuses', { project: 'SHOP' })).find((s) => s.label === 'Resolved').value, '10012');
    assert.deepEqual(await call('legacyMove', {}), { field: 'transitionOnComplete', target: null });
    assert.deepEqual(await call('reportResult', { id: 'SHOP-7', status: 'completed', move: { category: 'done' } }),
      { moved: { from: 'In Progress', to: 'Done' }, note: 'Moved to Done.' });
    assert.deepEqual(await call('reportResult', { id: 'SHOP-7', status: 'completed', move: { status: '10012', name: 'Resolved' } }),
      { moved: { from: 'In Progress', to: 'Resolved' }, note: 'Moved to Resolved.' });
    assert.deepEqual(await call('reportResult', { id: 'SHOP-7', status: 'completed', move: { status: 'Resolve' } }),
      { moved: { from: 'In Progress', to: 'Resolve' }, note: 'Moved to Resolve.' }, 'typed: its own text');
    assert.deepEqual(await call('reportResult', { id: 'SHOP-7', status: 'completed', move: { none: true } }), { moved: null, note: '' });
    assert.deepEqual(await call('reportResult', { id: 'SHOP-7', status: 'completed' }), { moved: null, note: '' });
    assert.deepEqual(JSON.parse(readPluginState('not-installed').lastReport).move, undefined, 'lastReport still records the args');
    await call('reportResult', { id: 'SHOP-8', status: 'completed', move: { category: 'done' } });
    assert.deepEqual(JSON.parse(readPluginState('not-installed').lastReport).move, { category: 'done' });
  } finally {
    delete process.env.WORCA_MOCK;
    setMockSourceResponses(null);
  }
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/plugin-shim.test.mjs`
Expected: FAIL — the default `reportResult` answers `{ ok: true }`, `capabilities` lacks `ticketUpdates`, and `listProjects` rejects with kind `unimplemented` ("mock: no canned response for op \"listProjects\"").

- [ ] **Step 3: Implement**

In `src/core/plugin-shim.mjs`, above `const MOCK_DEFAULTS = {`:

```js
// Ticket updates (plans/ticket-updates-design.md D17): board 3's projects, board 4's CRM workflow (SHOP adds Resolved), and a
// reportResult that answers by its move, so the Marketplace section and its browser proof run offline.
const MOCK_PROJECTS = [['SHOP', 'Shop'], ['CRM', 'Customer portal'], ['OPS', 'Operations'], ['SUP', 'Support desk'],
  ['MKT', 'Marketing site'], ['DATA', 'Data platform']].map(([value, name]) => ({ value, label: `${name} (${value})`, name }));
function mockStatuses(project) {
  const done = [{ value: '10001', label: 'Done', category: 'done' }, { value: '10002', label: 'Released', category: 'done' },
    ...(project === 'SHOP' ? [{ value: '10012', label: 'Resolved', category: 'done' }] : [])];
  return [...done, { value: '3', label: 'In Progress', category: 'in_progress' },
    { value: '10003', label: 'Waiting for customer', category: 'in_progress' }, { value: '1', label: 'Open', category: 'todo' },
    { value: '10004', label: "Won't Fix", category: 'cancelled' }];
}
function mockReport(move) {
  if (move && move.category === 'done') return { moved: { from: 'In Progress', to: 'Done' }, note: 'Moved to Done.' };
  if (move && typeof move.status === 'string' && move.status) {
    const to = move.name || move.status;
    return { moved: { from: 'In Progress', to }, note: `Moved to ${to}.` };
  }
  return { moved: null, note: '' };
}
```

In `MOCK_DEFAULTS`, replace the `reportResult` and `capabilities` entries and add three ops:

```js
  reportResult: (args = {}) => mockReport(args.move),
```

```js
  // Write-back stays on (what a missing capabilities op defaulted to before A6), the mock source can export, and it answers
  // Ticket updates' ops (D17).
  capabilities: () => ({ writeBack: true, export: true, ticketUpdates: true }),
  listProjects: () => MOCK_PROJECTS.map((p) => ({ ...p })),
  listStatuses: (args = {}) => mockStatuses(args.project),
  legacyMove: () => ({ field: 'transitionOnComplete', target: null }),
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/plugin-shim.test.mjs test/writeback.test.mjs test/api-sources.test.mjs test/requirements-run-link.test.mjs`
Expected: PASS (write-back still answers `{ ok: true }`: an empty note adds nothing, Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/core/plugin-shim.mjs test/plugin-shim.test.mjs
git commit -m "Ticket updates: mock answers for the new ops

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The four routes under `/api/plugins/:name/ticket-updates`

§5 and D8, behind `requireFlag('ticketUpdates')`; every tracker op through `callSource` with the saved profile.

**Files:**
- Create: `src/core/ticket-updates-routes.mjs`
- Modify: `ui/server.mjs` (one import beside the `plugin-config.mjs` import; one registration right after the `app.put('/api/plugins/:name/config', …)` handler)
- Test: create `test/api-ticket-updates.test.mjs`

**Interfaces:**
- Consumes: `validateTicketUpdates`, `TU_CATEGORIES`, `TU_LIMITS` (Task 2); `readTicketUpdates`, `writeTicketUpdates` (Task 1); `reachSentence` (Task 3); mock answers (Task 4); the server's `requirePlugin(req, res) → name|null`, `readInstalledManifest(name) → manifest|null`, `emitPluginsChanged(action)`.
- Produces: `registerTicketUpdatesRoutes(app, { requirePlugin, readManifest, onChanged, callSource })`; `LIST_PROJECTS_TIMEOUT_MS = 60_000`; `CANNOT_UPDATE = 'This plugin cannot update tickets.'`.
  - `GET /api/plugins/:name/ticket-updates?sourceId=&profile=` → `{ available, connection: 'saved'|'new', profile: { id, label }|null, saved, projects, rules, legacy: { field, label, target }|null }` (`target`: `{ category: 'done' }` | `{ typed }` | null)
  - `GET …/projects?sourceId=&profile=` → `{ projects: [{ value, label, name? }] }` (unfiltered)
  - `GET …/statuses?sourceId=&profile=&project=` → `{ statuses: [{ value, label, category }] }`
  - `PUT …` `{ sourceId, profile, projects, rules }` → `{ ok: true }`; 400 (§4, guards), 409 `CANNOT_UPDATE`, 502 `{ error, kind }`; emits `plugins-changed` (`config`).

- [ ] **Step 1: Write the failing test**

Create `test/api-ticket-updates.test.mjs`:

```js
// test/api-ticket-updates.test.mjs — Ticket updates' routes (plans/ticket-updates-design.md §5, D8, D16) on the real server in
// mock mode: jira-source linked with a saved connection (acme) and a profile without its values (beta), and a fixture plugin
// with no profile yet. Guards, 502 with A6's sentence, 409 without the capability, 404 with the flag off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { createProfile, writePluginConfig, readTicketUpdates } from '../src/core/plugin-config.mjs';
import { setMockSourceResponses, PluginOpError } from '../src/core/plugin-shim.mjs';

useTempHome(after, 'worca-tu-api-');
const prev = { flags: process.env.WORCA_FLAGS, mock: process.env.WORCA_MOCK };
process.env.WORCA_FLAGS = 'ticketUpdates';
process.env.WORCA_MOCK = '1';
const JIRA = fileURLToPath(new URL('../plugins/jira-source', import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(JIRA, 'worca-cc-plugin.json'), 'utf8')).taskSources[0].configSchema;
const FIXTURE = { name: 'tu-fixture', version: '0.1.0', taskSources: [{ id: 'main', displayName: 'Fixture', module: './connector/index.mjs',
  multiProfile: true, configSchema: [{ key: 'token', type: 'text', label: 'Token', secret: true, required: true }],
  inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }] };
let srv; let base; let fixtureDir;

before(async () => {
  await linkPlugin('jira-source', JIRA);
  createProfile('jira-source', 'acme', 'Acme');
  createProfile('jira-source', 'beta', 'Beta');
  writePluginConfig('jira-source', SCHEMA, { baseUrl: 'https://acme.atlassian.net', email: 'ann@example.test', token: 'tok-SECRET-1234' }, 'acme');
  fixtureDir = await mkdtemp(join(tmpdir(), 'worca-tu-fixture-'));
  await writeFile(join(fixtureDir, 'worca-cc-plugin.json'), JSON.stringify(FIXTURE, null, 2));
  await mkdir(join(fixtureDir, 'connector'), { recursive: true });
  await writeFile(join(fixtureDir, 'connector', 'index.mjs'),
    'export default () => ({ async validateConfig() { return { ok: true }; }, async listTasks() { return { tasks: [] }; }, async getTask(id) { return { id }; }, async reportResult() {} });\n');
  await linkPlugin('tu-fixture', fixtureDir);
  const { app } = await import('../ui/server.mjs');   // imported: no port bound
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await new Promise((r) => srv.close(r));
  for (const [k, v] of [['WORCA_FLAGS', prev.flags], ['WORCA_MOCK', prev.mock]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setMockSourceResponses(null);
  await rm(fixtureDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const raw = await r.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { json = null; }
  return { status: r.status, json, raw };
};
const TU = '/api/plugins/jira-source/ticket-updates';
const Q = (profile, extra = '') => `?sourceId=jira&profile=${profile}${extra}`;
const RESOLVED = { kind: 'status', value: '10012', label: 'Resolved', category: 'done' };
const VALID = { sourceId: 'jira', profile: 'acme', projects: [{ value: 'SHOP', label: 'Shop' }, { value: 'CRM', label: 'Customer portal' }],
  rules: [{ project: '', moment: 'finished', target: { kind: 'category', value: 'done' } },
    { project: 'SHOP', label: 'Shop', moment: 'finished', target: RESOLVED }] };

test('flag off: every Ticket updates route answers the gate\'s 404', async () => {
  process.env.WORCA_FLAGS = '-ticketUpdates';
  try {
    for (const [m, p, b] of [['GET', `${TU}${Q('acme')}`], ['GET', `${TU}/projects${Q('acme')}`], ['GET', `${TU}/statuses${Q('acme', '&project=SHOP')}`],
      ['PUT', TU, VALID]]) {
      const r = await call(m, p, b);
      assert.deepEqual([r.status, r.json], [404, { error: 'not found' }], `${m} ${p}`);
    }
  } finally { process.env.WORCA_FLAGS = 'ticketUpdates'; }
});

test('GET: a saved connection, nothing saved yet: the old setting\'s field and what it means; never a config value', async () => {
  setMockSourceResponses(null);
  let r = await call('GET', `${TU}${Q('acme')}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { available: true, connection: 'saved', profile: { id: 'acme', label: 'Acme' }, saved: false, projects: [], rules: [],
    legacy: { field: 'transitionOnComplete', label: 'Transition on completion', target: null } });
  assert.doesNotMatch(r.raw, /tok-SECRET|acme\.atlassian\.net/);
  setMockSourceResponses({ legacyMove: { field: 'transitionOnComplete', target: { typed: 'Resolve' } } });
  r = await call('GET', `${TU}${Q('acme')}`);
  assert.deepEqual(r.json.legacy, { field: 'transitionOnComplete', label: 'Transition on completion', target: { typed: 'Resolve' } });
  setMockSourceResponses({ legacyMove: { field: 'noSuchKey', target: { category: 'done' } } });
  assert.equal((await call('GET', `${TU}${Q('acme')}`)).json.legacy, null, 'a field the schema does not have is no legacy');
  setMockSourceResponses({ legacyMove: undefined });
  assert.equal((await call('GET', `${TU}${Q('acme')}`)).json.legacy, null, 'a plugin without legacyMove');
  setMockSourceResponses(null);
});

test('GET: a profile without its required values is a new connection; nothing but capabilities is asked (board 5 A)', async () => {
  let asked = 0;
  setMockSourceResponses({ legacyMove: () => { asked += 1; return { field: 'transitionOnComplete', target: null }; } });
  const r = await call('GET', `${TU}${Q('beta')}`);
  assert.deepEqual(r.json, { available: true, connection: 'new', profile: { id: 'beta', label: 'Beta' }, saved: false, projects: [], rules: [], legacy: null });
  assert.equal(asked, 0);
  setMockSourceResponses(null);
});

test('GET (Deviation 2): a multi-profile source with no profile yet answers a new connection without a profile', async () => {
  const r = await call('GET', '/api/plugins/tu-fixture/ticket-updates?sourceId=main');
  assert.deepEqual([r.status, r.json], [200, { available: true, connection: 'new', profile: null, saved: false, projects: [], rules: [], legacy: null }]);
  assert.equal((await call('GET', '/api/plugins/tu-fixture/ticket-updates?sourceId=main&profile=work')).status, 400, 'a profile not in the roster');
});

test('the guards of PUT /api/plugins/:name/config: plugin, source, profile', async () => {
  assert.equal((await call('GET', '/api/plugins/no-such-plugin/ticket-updates?sourceId=jira&profile=acme')).status, 404);
  assert.equal((await call('GET', `${TU}?sourceId=nope&profile=acme`)).status, 400);
  assert.equal((await call('GET', `${TU}?sourceId=jira`)).status, 400, 'a multi-profile source with a roster needs a profile');
  assert.equal((await call('GET', `${TU}${Q('ghost')}`)).status, 400, 'not in the roster');
  assert.equal((await call('GET', `${TU}${Q('Bad_Id')}`)).status, 400, 'not a profile id');
  assert.equal((await call('GET', `${TU}/projects?sourceId=jira`)).status, 400);
  assert.equal((await call('PUT', TU, { ...VALID, profile: 'ghost' })).status, 400);
});

test('GET: available is false when the plugin cannot update tickets (no capability, or no capabilities op)', async () => {
  setMockSourceResponses({ capabilities: { writeBack: true, export: true } });
  assert.deepEqual((await call('GET', `${TU}${Q('acme')}`)).json,
    { available: false, connection: 'saved', profile: { id: 'acme', label: 'Acme' }, saved: false, projects: [], rules: [], legacy: null });
  setMockSourceResponses({ capabilities: undefined });
  assert.equal((await call('GET', `${TU}${Q('acme')}`)).json.available, false);
  setMockSourceResponses(null);
});

test('projects and statuses: through the saved profile, unfiltered; a missing project is 400; a tracker failure is 502 with A6\'s sentence', async () => {
  setMockSourceResponses(null);
  const p = await call('GET', `${TU}/projects${Q('acme')}`);
  assert.deepEqual(p.json.projects.map((x) => [x.value, x.name]), [['SHOP', 'Shop'], ['CRM', 'Customer portal'], ['OPS', 'Operations'],
    ['SUP', 'Support desk'], ['MKT', 'Marketing site'], ['DATA', 'Data platform']]);
  const s = await call('GET', `${TU}/statuses${Q('acme', '&project=SHOP')}`);
  assert.deepEqual(s.json.statuses[2], { value: '10012', label: 'Resolved', category: 'done' });
  assert.equal((await call('GET', `${TU}/statuses${Q('acme')}`)).status, 400);
  setMockSourceResponses({ listStatuses: [{ value: '1', label: 'Odd', category: 'closed' }, { value: '2', label: 'Open', category: 'todo' }] });
  assert.deepEqual((await call('GET', `${TU}/statuses${Q('acme', '&project=SHOP')}`)).json.statuses, [{ value: '2', label: 'Open', category: 'todo' }],
    'a category outside the four is left out');
  setMockSourceResponses({ listStatuses: () => { throw new PluginOpError('auth', 'Jira token invalid or expired'); } });
  const f = await call('GET', `${TU}/statuses${Q('acme', '&project=SHOP')}`);
  assert.deepEqual([f.status, f.json], [502, { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' }]);
  setMockSourceResponses({ listProjects: () => { throw new PluginOpError('network', 'Jira unreachable: fetch failed.'); } });
  const g = await call('GET', `${TU}/projects${Q('acme')}`);
  assert.deepEqual([g.status, g.json], [502, { error: 'Worca could not reach Jira: Jira unreachable: fetch failed.', kind: 'network' }]);
  setMockSourceResponses({ listStatuses: undefined });
  assert.deepEqual((await call('GET', `${TU}/statuses${Q('acme', '&project=SHOP')}`)).json, { error: 'This plugin cannot update tickets.' });
  setMockSourceResponses(null);
});

test('PUT: §4\'s checks, the record on disk with who and when, then GET answers it; 409 without the capability', async () => {
  setMockSourceResponses(null);
  const bad = await call('PUT', TU, { ...VALID, rules: [VALID.rules[1]] });
  assert.deepEqual([bad.status, bad.json], [400, { error: 'All projects needs exactly one rule.' }]);
  const r = await call('PUT', TU, VALID);
  assert.deepEqual([r.status, r.json], [200, { ok: true }]);
  const rec = readTicketUpdates('jira-source', 'acme', 'jira');
  assert.deepEqual([rec.projects, rec.rules, rec.savedBy], [VALID.projects, VALID.rules, 'local']);
  assert.match(rec.savedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const g = await call('GET', `${TU}${Q('acme')}`);
  assert.deepEqual([g.json.saved, g.json.projects, g.json.rules], [true, VALID.projects, VALID.rules]);
  assert.equal(g.json.legacy.field, 'transitionOnComplete', 'Deviation 1: still named after the first save');
  setMockSourceResponses({ capabilities: { writeBack: true } });
  const no = await call('PUT', TU, VALID);
  assert.deepEqual([no.status, no.json], [409, { error: 'This plugin cannot update tickets.' }]);
  setMockSourceResponses(null);
});

test('POST /api/sources/call still refuses listStatuses and legacyMove (D8)', async () => {
  for (const op of ['listStatuses', 'legacyMove']) {
    const r = await call('POST', '/api/sources/call', { plugin: 'jira-source', sourceId: 'jira', op, profile: 'acme', args: { project: 'SHOP' } });
    assert.equal(r.status, 400, op);
  }
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node tools/test.mjs test/api-ticket-updates.test.mjs`
Expected: FAIL — every `/api/plugins/jira-source/ticket-updates*` request answers 404 (`no route`), so the GET, guard, projects and PUT tests fail; the flag-off and `/api/sources/call` tests pass.

- [ ] **Step 3: Implement**

Create `src/core/ticket-updates-routes.mjs`:

```js
// src/core/ticket-updates-routes.mjs — Ticket updates' host routes (plans/ticket-updates-design.md §5, D8), behind the
// `ticketUpdates` flag. The manage sheet reads and saves here; listProjects, listStatuses and legacyMove run in the server
// through callSource with the saved profile, never from the browser (POST /api/sources/call's allowlist is unchanged).
import { requireFlag } from './flags.mjs';
import { callSource as shimCallSource } from './plugin-shim.mjs';
import { listProfiles, isValidProfileId, redactedConfig, readTicketUpdates, writeTicketUpdates, DEFAULT_PROFILE } from './plugin-config.mjs';
import { actorOf } from './identity.mjs';
import { reachSentence } from './source-reach.mjs';
import { validateTicketUpdates, TU_CATEGORIES, TU_LIMITS } from './ticket-updates.mjs';

/** listProjects pages up to 2,000 Jira Cloud projects (§3, A6-D14). */
export const LIST_PROJECTS_TIMEOUT_MS = 60_000;
export const CANNOT_UPDATE = 'This plugin cannot update tickets.';

const isBag = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * The task source and profile a request names, guarded as PUT /api/plugins/:name/config guards them: an unknown source 400,
 * a bad profile id 400, a multi-profile source without a roster profile 400. `allowNew` (GET only, Deviation 2): a
 * multi-profile source whose roster is empty may name no profile. null after an answer was sent.
 */
function guard(req, res, manifest, name, { body = false, allowNew = false } = {}) {
  const src = body ? (isBag(req.body) ? req.body : {}) : (req.query || {});
  const sources = manifest.taskSources || [];
  const sourceId = typeof src.sourceId === 'string' && src.sourceId ? src.sourceId : (sources.length === 1 ? sources[0].id : '');
  const source = sources.find((s) => s.id === sourceId);
  if (!source) { res.status(400).json({ error: 'sourceId does not match a task source of this plugin' }); return null; }
  const profile = typeof src.profile === 'string' && src.profile ? src.profile : null;
  if (profile && !isValidProfileId(profile)) { res.status(400).json({ error: 'invalid profile id' }); return null; }
  const roster = listProfiles(name);
  if (source.multiProfile && !profile) {
    if (allowNew && !roster.length) return { source, profile: null, bucket: null, roster };
    res.status(400).json({ error: 'profile is required for this task source' });
    return null;
  }
  if (source.multiProfile && !roster.some((p) => p.id === profile)) {
    res.status(400).json({ error: `plugin "${name}" has no profile "${profile}". Create it first` });
    return null;
  }
  return { source, profile: source.multiProfile ? profile : null, bucket: source.multiProfile ? profile : DEFAULT_PROFILE, roster };
}

/** 'saved' when the profile is in the roster and every required config field has a stored value (D12), else 'new'. */
function connectionOf(ctx) {
  if (ctx.source.multiProfile && !ctx.profile) return 'new';
  const schema = list(ctx.source.configSchema);
  const values = redactedConfig(ctx.name, schema, ctx.profile || undefined);
  const missing = schema.filter((f) => f && f.required).some((f) => {
    const v = values[f.key];
    return f.secret ? !(isBag(v) && v.set === true) : (v == null || String(v).trim() === '');
  });
  return missing ? 'new' : 'saved';
}

/** The section header's "<label> (<id>)" parts; a single-profile source is its source's name. */
function profileOf(ctx) {
  if (ctx.profile) {
    const p = ctx.roster.find((x) => x.id === ctx.profile);
    return { id: ctx.profile, label: (p && p.label) || ctx.profile };
  }
  return ctx.source.multiProfile ? null : { id: DEFAULT_PROFILE, label: ctx.tracker };
}

/** legacyMove's answer (D4) checked against the source's config schema: the old field's key and label, and what it means. */
function legacyOf(answer, source) {
  if (!isBag(answer) || typeof answer.field !== 'string') return null;
  const field = list(source.configSchema).find((f) => f && f.key === answer.field);
  if (!field) return null;
  const t = answer.target;
  const target = isBag(t) && t.category === 'done' ? { category: 'done' }
    : isBag(t) && typeof t.typed === 'string' && t.typed.trim() ? { typed: t.typed.trim().slice(0, TU_LIMITS.text) } : null;
  return { field: field.key, label: field.label || field.key, target };
}

/**
 * Mount the four routes. Deps from ui/server.mjs: requirePlugin(req, res) → name | null (it answers the 404), readManifest(name)
 * → manifest | null, onChanged() after a save (the `plugins-changed` frame); callSource for tests.
 */
export function registerTicketUpdatesRoutes(app, { requirePlugin, readManifest, onChanged = () => {}, callSource = shimCallSource } = {}) {
  const gate = requireFlag('ticketUpdates');
  const P = '/api/plugins/:name/ticket-updates';

  function start(req, res, opts) {
    const name = requirePlugin(req, res);
    if (!name) return null;
    const manifest = readManifest(name);
    if (!manifest) { res.status(409).json({ error: 'plugin manifest unreadable. Run doctor' }); return null; }
    const ref = guard(req, res, manifest, name, opts);
    if (!ref) return null;
    return { name, ...ref, tracker: ref.source.displayName || name };
  }
  const run = (ctx, op, args, more = {}) => callSource({ plugin: ctx.name, sourceId: ctx.source.id, op, args,
    ...(ctx.profile ? { profile: ctx.profile } : {}), ...more });
  function failed(res, ctx, op, err) {
    const kind = (err && err.kind) || 'plugin';
    if (kind === 'unimplemented') return res.status(409).json({ error: CANNOT_UPDATE });
    const first = String((err && err.message) || err).split(/\r?\n/)[0].slice(0, 200);   // never a plugin's whole output
    console.error(`ticket updates: ${op} via ${ctx.name}/${ctx.source.id} failed (${kind}):`, first);
    return res.status(502).json({ error: reachSentence(ctx.tracker, { kind, message: err && err.message }), kind });
  }
  /** Does the connector say ticketUpdates? An absent capabilities op is "no"; any other failure throws. With no profile yet
   *  (Deviation 2) the probe runs against the default bucket: capabilities needs no connection. */
  async function capable(ctx) {
    const probe = !ctx.profile && ctx.source.multiProfile ? { profile: DEFAULT_PROFILE, allowLegacyDefault: true } : {};
    try {
      const caps = await run(ctx, 'capabilities', { inputs: {} }, probe);
      return !!(caps && caps.ticketUpdates === true);
    } catch (err) {
      if ((err && err.kind) === 'unimplemented') return false;
      throw err;
    }
  }

  // GET: what the sheet paints. No tracker call: capabilities, and legacyMove for a saved connection (Deviation 1).
  app.get(P, gate, async (req, res) => {
    const ctx = start(req, res, { allowNew: true });
    if (!ctx) return;
    let ok;
    try { ok = await capable(ctx); } catch (err) { return failed(res, ctx, 'capabilities', err); }
    const connection = connectionOf(ctx);
    const profile = profileOf(ctx);
    const empty = { saved: false, projects: [], rules: [], legacy: null };
    if (!ok) return res.json({ available: false, connection, profile, ...empty });
    if (connection !== 'saved') return res.json({ available: true, connection, profile, ...empty });
    const rec = readTicketUpdates(ctx.name, ctx.bucket, ctx.source.id);
    let legacy = null;
    try { legacy = legacyOf(await run(ctx, 'legacyMove', {}), ctx.source); } catch { legacy = null; }
    res.json({ available: true, connection, profile, saved: !!rec, projects: rec ? list(rec.projects) : [], rules: rec ? list(rec.rules) : [], legacy });
  });

  // GET projects: the tracker's projects, unfiltered (D9: the section's own picker sees them all).
  app.get(`${P}/projects`, gate, async (req, res) => {
    const ctx = start(req, res);
    if (!ctx) return;
    try {
      const r = await run(ctx, 'listProjects', {}, { timeoutMs: LIST_PROJECTS_TIMEOUT_MS });
      res.json({ projects: list(r).filter((o) => isBag(o) && o.value != null).map((o) => ({ value: String(o.value), label: String(o.label ?? o.value),
        ...(typeof o.name === 'string' && o.name.trim() ? { name: o.name.trim() } : {}) })) });
    } catch (err) { failed(res, ctx, 'listProjects', err); }
  });

  // GET statuses: one project's statuses with their category (D1); a category outside the four is left out.
  app.get(`${P}/statuses`, gate, async (req, res) => {
    const ctx = start(req, res);
    if (!ctx) return;
    const project = text(req.query.project, TU_LIMITS.text);
    if (!project) return res.status(400).json({ error: 'project is required' });
    try {
      const r = await run(ctx, 'listStatuses', { project });
      res.json({ statuses: list(r).filter((s) => isBag(s) && s.value != null && TU_CATEGORIES.includes(s.category))
        .map((s) => ({ value: String(s.value), label: String(s.label ?? s.value), category: s.category })) });
    } catch (err) { failed(res, ctx, 'listStatuses', err); }
  });

  // PUT: §4's checks, then the record with who saved it and when.
  app.put(P, gate, async (req, res) => {
    const ctx = start(req, res, { body: true });
    if (!ctx) return;
    let ok;
    try { ok = await capable(ctx); } catch (err) { return failed(res, ctx, 'capabilities', err); }
    if (!ok) return res.status(409).json({ error: CANNOT_UPDATE });
    let clean;
    try { clean = validateTicketUpdates(req.body); } catch (err) {
      return res.status(err && err.code === 'BAD_REQUEST' ? 400 : 500).json({ error: err && err.message ? err.message : String(err) });
    }
    try {
      writeTicketUpdates(ctx.name, ctx.bucket, ctx.source.id, { ...clean, savedAt: new Date().toISOString(), savedBy: actorOf(req) });
    } catch (err) {
      return res.status(500).json({ error: err && err.message ? err.message : String(err) });
    }
    onChanged();
    res.json({ ok: true });
  });
}
```

In `ui/server.mjs`, after the `import { … } from '../src/core/plugin-config.mjs';` block:

```js
import { registerTicketUpdatesRoutes } from '../src/core/ticket-updates-routes.mjs';
```

Right after the closing `});` of `app.put('/api/plugins/:name/config', …)`:

```js
// Ticket updates (plans/ticket-updates-design.md §5, D8): the projects you work on and the rules for a finished run, beside the
// config routes, behind the `ticketUpdates` flag. Tracker ops run here through callSource, never from the browser.
registerTicketUpdatesRoutes(app, { requirePlugin, readManifest: readInstalledManifest, onChanged: () => emitPluginsChanged('config') });
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/api-ticket-updates.test.mjs test/api-sources.test.mjs test/flags-usage.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/ticket-updates-routes.mjs ui/server.mjs test/api-ticket-updates.test.mjs
git commit -m "Ticket updates: the four host routes behind the flag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The projects filter: New run's `listProjects` and Requirements export's `exportOptions`

D9: the filter is applied server-side where each list is built; a saved choice outside it stays listed; the flag off or none picked lists all.

**Files:**
- Modify: `ui/server.mjs` (`POST /api/sources/call`: `const result` → `let result`, one filter line; one import)
- Modify: `src/core/requirements/export.mjs` (`exportOptions`; imports)
- Test: `test/api-ticket-updates.test.mjs` (import; one test), `test/requirements-export.test.mjs` (import; one test at the end)

**Interfaces:**
- Consumes: `projectFilter`, `filterProjects` (Task 2); `DEFAULT_PROFILE` from `plugin-config.mjs`; the export setup's `trackerProject` and `sameConn` (already in `export.mjs`).
- Produces: `POST /api/sources/call` with `op: 'listProjects'` answers `{ ok: true, result }` where `result` holds only the picked projects of the call's profile (`DEFAULT_PROFILE` for a single-profile source); `exportOptions(scope, body, d).projects` holds only the picked projects of `body.profile`, plus the scope's setup's `trackerProject` when the setup is on that connection.

- [ ] **Step 1: Write the failing tests**

In `test/api-ticket-updates.test.mjs`, change the `plugin-config.mjs` import to:

```js
import { createProfile, writePluginConfig, readTicketUpdates, writeTicketUpdates } from '../src/core/plugin-config.mjs';
```

and append:

```js
const SIX = ['SHOP', 'CRM', 'OPS', 'SUP', 'MKT', 'DATA'];
test("POST /api/sources/call filters listProjects by the call's profile, only with the flag on and projects picked (D9)", async () => {
  setMockSourceResponses(null);
  const NONE = [{ project: '', moment: 'finished', target: { kind: 'none' } }];
  writeTicketUpdates('jira-source', 'acme', 'jira', { projects: [{ value: 'SHOP', label: 'Shop' }, { value: 'CRM', label: 'Customer portal' }], rules: NONE });
  const values = async (profile) => (await call('POST', '/api/sources/call', { plugin: 'jira-source', sourceId: 'jira', op: 'listProjects', profile })).json.result.map((p) => p.value);
  assert.deepEqual(await values('acme'), ['SHOP', 'CRM']);
  assert.deepEqual(await values('beta'), SIX, "another profile: its own record (none saved)");
  writeTicketUpdates('jira-source', 'beta', 'jira', { projects: [], rules: NONE });
  assert.deepEqual(await values('beta'), SIX, 'none picked: all projects');
  process.env.WORCA_FLAGS = '-ticketUpdates';
  try { assert.deepEqual(await values('acme'), SIX, 'flag off: no filter'); } finally { process.env.WORCA_FLAGS = 'ticketUpdates'; }
});
```

In `test/requirements-export.test.mjs`, change the `plugin-config.mjs` import to:

```js
import { createProfile, writeTicketUpdates } from '../src/core/plugin-config.mjs';
```

and append at the end:

```js
// ---- Ticket updates (plans/ticket-updates-design.md D9): the export setup lists only the projects a connection works on ----
const TU_NONE = [{ project: '', moment: 'finished', target: { kind: 'none' } }];
async function withTicketUpdates(fn) {
  const was = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = 'ticketUpdates';
  try { return await fn(); } finally { if (was === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = was; }
}

test("Ticket updates (D9): exportOptions lists the connection's picked projects; the setup's project stays listed", async () => {
  reset();
  await saveSetup(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', project: 'SHOP', projectName: 'SHOP — Shop web',
    issueType: '10001', issueTypeName: 'Story', labels: ['worca'] }, { by: 'po' }, d);
  writeTicketUpdates('jira-source', 'acme', 'jira', { projects: [{ value: 'OPS', label: 'Operations' }], rules: TU_NONE });
  writeTicketUpdates('jira-source', 'beta', 'jira', { projects: [{ value: 'OPS', label: 'Operations' }], rules: TU_NONE });
  const values = async (profile) => (await exportOptions(SCOPE, { plugin: 'jira-source', sourceId: 'jira', profile }, d)).projects.map((p) => p.value);
  await withTicketUpdates(async () => {
    assert.deepEqual(await values('acme'), ['SHOP', 'OPS'], "the setup's SHOP stays; OPS is picked");
    assert.deepEqual(await values('beta'), ['OPS'], 'another connection: only its picks');
  });
  process.env.WORCA_FLAGS = '-ticketUpdates';
  try { assert.deepEqual(await values('beta'), ['SHOP', 'OPS'], 'flag off: all'); } finally { delete process.env.WORCA_FLAGS; }
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/api-ticket-updates.test.mjs test/requirements-export.test.mjs`
Expected: FAIL — `/api/sources/call` answers all six projects for acme; `exportOptions` answers `['SHOP', 'OPS']` for beta with the flag on.

- [ ] **Step 3: Implement**

In `ui/server.mjs`, add beside the Task 5 import:

```js
import { projectFilter, filterProjects } from '../src/core/ticket-updates.mjs';
```

In `app.post('/api/sources/call', …)`, replace `const result = await callSource({ plugin, sourceId, op, args, profile });` with:

```js
    let result = await callSource({ plugin, sourceId, op, args, profile });
    // Ticket updates (D9): New run's project select lists only the projects this connection works on (flag off or none picked: all)
    if (op === 'listProjects') result = filterProjects(result, projectFilter(plugin, sourceId, profile || DEFAULT_PROFILE));
```

In `src/core/requirements/export.mjs`, change `import { listProfiles } from '../plugin-config.mjs';` to:

```js
import { listProfiles, DEFAULT_PROFILE } from '../plugin-config.mjs';
import { projectFilter, filterProjects } from '../ticket-updates.mjs';
```

In `exportOptions`, right after `const setup = getExportSetup(scope.scopeType, scope.scopeKey);` add:

```js
  // Ticket updates (D9): only the projects this connection works on; the setup's own project stays listed when it is this connection's
  const keep = setup && sameConn(setup, conn) && setup.trackerProject ? [setup.trackerProject] : [];
  out.projects = filterProjects(out.projects, projectFilter(conn.plugin, conn.sourceId, conn.profile || DEFAULT_PROFILE), keep);
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/api-ticket-updates.test.mjs test/requirements-export.test.mjs test/requirements-export-api.test.mjs test/api-sources.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/server.mjs src/core/requirements/export.mjs test/api-ticket-updates.test.mjs test/requirements-export.test.mjs
git commit -m "Ticket updates: New run and the export setup list only the projects you work on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The ticket's project is pinned when the run starts

D6: `resolveTaskInput` copies `getTask`'s `meta.project` into `sourceMeta.project`; a Requirements start carries the link's tracker project as `reportTo.project`, which the harness copies into `reportMeta`. The host never parses an id.

**Files:**
- Modify: `src/core/sources.mjs` (`resolveTaskInput`'s `sourceMeta`), `src/core/requirements/start.mjs` (`reportTo`), `src/core/run-harness.mjs` (`reportMeta`)
- Test: `test/sources.test.mjs` (one test), `test/requirements-start.test.mjs` (the A6 D15 `deepEqual`), `test/requirements-run-link.test.mjs` (one assertion)

**Interfaces:**
- Produces: `sourceMeta.project: string` (only when `task.meta.project` is a non-empty string); `reportTo.project` (the link's `trackerProject`, only when set); the pipeline row's `source_ref.project`. Task 8 reads `ref.project`.

- [ ] **Step 1: Write the failing tests**

In `test/sources.test.mjs`, after the test `'plugin source: getTask -> …'`, add:

```js
test('Ticket updates (D6): getTask\'s meta.project is pinned as sourceMeta.project; anything else leaves no key', async () => {
  process.env.WORCA_MOCK = '1';
  const task = (meta) => ({ getTask: (args) => ({ id: args.id, title: 'T', url: 'https://tracker.test/SHOP-7', state: 'open', updatedAt: 'x', body: 'b', meta }) });
  try {
    setMockSourceResponses(task({ key: 'SHOP-7', project: 'SHOP' }));
    const pinned = await resolveTaskInput({ type: 'plugin', plugin: 'gh', sourceId: 'issues', taskId: 'SHOP-7', profile: 'acme' }, { projectDir: tmp() });
    assert.equal(pinned.sourceMeta.project, 'SHOP');
    for (const meta of [{ project: 42 }, { project: '  ' }, {}]) {
      setMockSourceResponses(task(meta));
      const bare = await resolveTaskInput({ type: 'plugin', plugin: 'gh', sourceId: 'issues', taskId: 'SHOP-7' }, { projectDir: tmp() });
      assert.equal('project' in bare.sourceMeta, false, JSON.stringify(meta));
    }
  } finally {
    delete process.env.WORCA_MOCK;
    setMockSourceResponses(null);
  }
});
```

In `test/requirements-start.test.mjs`, the A6 D15 assertion becomes:

```js
  assert.deepEqual(calls[0].opts.reportTo, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', taskId: 'SHOP-123',
    url: 'https://acme.test/browse/SHOP-123', title: 'Report me', inputs: { writeBack: 'yes' }, project: 'SHOP' });
```

In `test/requirements-run-link.test.mjs`, in the test `'server: Start with Report back makes a plugin pipeline row; …'`, after the `assert.deepEqual([ref.plugin, …` line add:

```js
    assert.equal(ref.project, 'SHOP', "Ticket updates (D6): the link's tracker project is pinned on the row");
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/sources.test.mjs test/requirements-start.test.mjs test/requirements-run-link.test.mjs`
Expected: FAIL — `sourceMeta.project` is `undefined`; `reportTo` lacks `project`; `ref.project` is `undefined`.

- [ ] **Step 3: Implement**

In `src/core/sources.mjs` `resolveTaskInput`, in the plugin branch's `sourceMeta`, after `title: task.title ?? null,` add:

```js
        // Ticket updates (D6): the ticket's project as the tracker names it (a listProjects value), pinned now so write-back
        // picks its rule; the host never parses an id. Left out when the connector does not say.
        ...(typeof task.meta?.project === 'string' && task.meta.project.trim() ? { project: task.meta.project.trim() } : {}),
```

In `src/core/requirements/start.mjs`, replace the `reportTo` assignment with:

```js
    const reportTo = link && link.key && reportBack !== false ? { plugin: link.plugin, sourceId: link.sourceId, profile: link.profile || null,
      taskId: link.key, url: link.url || null, title: f.title, inputs: { writeBack: 'yes' },   // writeBack: jira-source's reserved "on"
      ...(link.trackerProject ? { project: link.trackerProject } : {}) } : null;   // Ticket updates (D6): the ticket's project
```

In `src/core/run-harness.mjs`, replace the `reportMeta` assignment with:

```js
      const reportMeta = reportTo ? { plugin: reportTo.plugin, sourceId: reportTo.sourceId, taskId: reportTo.taskId, profile: reportTo.profile || null,
        inputs: reportTo.inputs && typeof reportTo.inputs === 'object' ? reportTo.inputs : null, url: reportTo.url ?? null, title: reportTo.title ?? null,
        // Ticket updates (D6): a Requirements start names the link's tracker project, so write-back picks that project's rule
        ...(typeof reportTo.project === 'string' && reportTo.project ? { project: reportTo.project } : {}) } : null;
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/sources.test.mjs test/requirements-start.test.mjs test/requirements-run-link.test.mjs`
Expected: PASS (the existing `sourceMeta` `deepEqual` with `meta: { priority: 'high' }` is unchanged: no `project` key).

- [ ] **Step 5: Commit**

```bash
git add src/core/sources.mjs src/core/requirements/start.mjs src/core/run-harness.mjs test/sources.test.mjs test/requirements-start.test.mjs test/requirements-run-link.test.mjs
git commit -m "Ticket updates: pin the ticket's project on the run, never parsed from its id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Write-back passes the move; the note reaches the audit line and the results view

D7 and D11: after the existing capabilities probe, `move` joins `reportResult`'s args when the flag is on, the connector says `ticketUpdates` and a record exists; the plugin's `{ moved, note }` comes back to the audit line and Report result.

**Files:**
- Modify: `src/core/sources.mjs` (`reportResultForPipeline`; one import), `src/core/run-harness.mjs` (`_reportToSource`'s audit line), `ui/public/results-view.mjs` (`reportResultControl`'s status)
- Test: `test/writeback.test.mjs` (import; two tests), `test/results-view-helpers.test.mjs` (imports; one test)

**Interfaces:**
- Consumes: `moveFor` (Task 2); `ref.project` (Task 7); the mock `reportResult` answer (Task 4).
- Produces: `reportResultForPipeline(row, bundle) → { ok: true, note?: string, moved?: { from, to } } | { ok: true, skipped: true } | { ok: false, error }` (`note` only when the plugin answered a non-empty one, so every existing `{ ok: true }` assertion holds); `retryWriteback` and `POST /api/pipelines/:id/report-result` pass it on; audit line `Result reported back to the task source. <note>`; results view `reported · <note>`.

- [ ] **Step 1: Write the failing tests**

In `test/writeback.test.mjs`, change the `plugin-config.mjs` import to:

```js
import { createProfile, readPluginState, writeTicketUpdates } from '../src/core/plugin-config.mjs';
```

and append:

```js
// ── Ticket updates (plans/ticket-updates-design.md D6, D7, D11) ─────────────────
const TU_RULES = { projects: [{ value: 'SHOP', label: 'Shop' }], rules: [
  { project: '', moment: 'finished', target: { kind: 'category', value: 'done' } },
  { project: 'SHOP', label: 'Shop', moment: 'finished', target: { kind: 'status', value: '10012', label: 'Resolved', category: 'done' } }] };
async function withFlag(on, fn) {
  const was = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = on ? 'ticketUpdates' : '-ticketUpdates';
  try { return await fn(); } finally { if (was === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = was; }
}
const tuMeta = (project, plugin = 'tu-gh') => ({ plugin, sourceId: 'issues', taskId: 'SHOP-7', url: 'https://tracker.test/SHOP-7', title: 'Fix',
  ...(project ? { project } : {}) });

test('Ticket updates: a move only with ticketUpdates and a record; project rule, All projects, a failed run; the note comes back', async () => {
  const calls = [];
  const answer = (args) => (args.move && args.move.status
    ? { moved: { from: 'In Progress', to: args.move.name }, note: `Moved to ${args.move.name}.` } : { moved: null, note: '' });
  setMockSourceResponses({ reportResult: (args) => { calls.push(args); return answer(args); } });   // capabilities: the mock's, ticketUpdates true
  writeTicketUpdates('tu-gh', 'default', 'issues', TU_RULES);
  await withFlag(true, async () => {
    let p = await seedDonePluginPipeline(tuMeta('SHOP'));
    assert.deepEqual(await retryWriteback(p.id), { ok: true, note: 'Moved to Resolved.', moved: { from: 'In Progress', to: 'Resolved' } });
    assert.deepEqual(calls.at(-1).move, { status: '10012', name: 'Resolved' });
    p = await seedDonePluginPipeline(tuMeta('OPS'));
    assert.deepEqual(await retryWriteback(p.id), { ok: true }, 'an empty note adds nothing');
    assert.deepEqual(calls.at(-1).move, { category: 'done' }, 'no rule for OPS: All projects');
    p = await seedDonePluginPipeline(tuMeta(null));
    await retryWriteback(p.id);
    assert.deepEqual(calls.at(-1).move, { category: 'done' }, 'a row without project (from before this change): All projects');
    p = await seedDonePluginPipeline(tuMeta('SHOP'));
    getDb().prepare("UPDATE pipelines SET status = 'error' WHERE id = ?").run(p.id);
    await retryWriteback(p.id);
    assert.deepEqual(calls.at(-1).move, { none: true }, 'a run that did not finish successfully');
    p = await seedDonePluginPipeline(tuMeta('SHOP', 'tu-none'));
    assert.deepEqual(await retryWriteback(p.id), { ok: true });
    assert.equal('move' in calls.at(-1), false, 'no record: no move (legacy)');
    setMockSourceResponses({ capabilities: { writeBack: true }, reportResult: (args) => { calls.push(args); return answer(args); } });
    p = await seedDonePluginPipeline(tuMeta('SHOP'));
    await retryWriteback(p.id);
    assert.equal('move' in calls.at(-1), false, 'a connector without ticketUpdates hears no move');
  });
  setMockSourceResponses({ reportResult: (args) => { calls.push(args); return answer(args); } });
  await withFlag(false, async () => {
    const p = await seedDonePluginPipeline(tuMeta('SHOP'));
    await retryWriteback(p.id);
    assert.equal('move' in calls.at(-1), false, 'flag off: no move');
  });
  setMockSourceResponses(null);
});

test("e2e (D6, D11): the task's meta.project picks the rule; the audit line ends with the plugin's note", async () => {
  setMockSourceResponses({ getTask: { id: 'SHOP-9', title: 'Demo', url: 'https://x.test/SHOP-9', state: 'open', updatedAt: '2026-07-12T00:00:00Z',
    body: 'demo body', meta: { key: 'SHOP-9', project: 'SHOP' } } });   // reportResult: the mock's (D17), it answers by the move
  writeTicketUpdates('tu-e2e', 'default', 'issues', TU_RULES);
  await withFlag(true, async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-wb-tu-'));
    const orch = createOrchestrator({ projectDir, auto: true, claude: { mock: true },
      source: { type: 'plugin', plugin: 'tu-e2e', sourceId: 'issues', taskId: 'SHOP-9' } });
    const res = await orch.run();
    assert.equal(res.status, 'done');
    const id = orch.getState().id;
    assert.equal(JSON.parse(getDb().prepare('SELECT source_ref FROM pipelines WHERE id = ?').get(id).source_ref).project, 'SHOP');
    assert.deepEqual(JSON.parse(readPluginState('tu-e2e').lastReport).move, { status: '10012', name: 'Resolved' });
    const lines = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(id).map((r) => r.text);
    assert.ok(lines.includes('Result reported back to the task source. Moved to Resolved.'), lines.join(' | '));
  });
  setMockSourceResponses(null);
});
```

In `test/results-view-helpers.test.mjs`, change the imports to:

```js
import { JSDOM } from 'jsdom';
import { summaryChips, mergeFindings, statusChip, diffBadges, memoryChangesRows, reportResultControl } from '../ui/public/results-view.mjs';
```

and append:

```js
test('Report result says what happened to the ticket (Ticket updates D11)', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const doc = window.document;
  const answers = [{ ok: true, note: 'Moved to Resolved.' }, { ok: true }, { ok: true, skipped: true }, { ok: false, error: 'tracker down' }];
  const ctl = reportResultControl('p1', { doc, post: async () => answers.shift() });
  doc.body.append(ctl);
  const press = async () => { ctl.querySelector('button').click(); await ctl._pending; return ctl.querySelector('.src-report-status').textContent; };
  assert.equal(await press(), 'reported · Moved to Resolved.');
  assert.equal(await press(), 'reported');
  assert.equal(await press(), 'nothing to report');
  assert.equal(await press(), 'failed: tracker down');
  window.close();
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/writeback.test.mjs test/results-view-helpers.test.mjs`
Expected: FAIL — `retryWriteback` answers `{ ok: true }` without `note`; `calls.at(-1).move` is `undefined`; the audit line has no note; the results view says `reported`.

- [ ] **Step 3: Implement**

In `src/core/sources.mjs`, add the import:

```js
import { moveFor } from './ticket-updates.mjs';
```

In `reportResultForPipeline`, replace from `let writeBack = true;` to the end of the `try` block (`return { ok: true };`) with:

```js
    let writeBack = true;
    let caps = null;
    try {
      caps = await callSource({ ...callRef, op: 'capabilities', args: { inputs } });
      if (caps && caps.writeBack === false) writeBack = false;
    } catch (err) {
      if ((err?.kind || 'plugin') !== 'unimplemented' && 'writeBack' in inputs) {
        return { ok: false, error: `write-back capability probe failed: ${err?.message || String(err)}` };
      }
      writeBack = true;
    }
    if (!writeBack) return { ok: true, skipped: true };

    // Ticket updates (D7): the move by the rule of the ticket's project (pinned at fetch, D6), else All projects. Only when the
    // connector can hear it (capabilities().ticketUpdates, the probe above: no extra spawn) and a record exists for the row's
    // profile and source; otherwise no `move` and the plugin's old setting applies (D4).
    const status = statusToResult(pipelineRow.status);
    const move = caps && caps.ticketUpdates === true
      ? moveFor({ plugin: ref.plugin, sourceId: ref.sourceId, profile: callRef.profile || DEFAULT_PROFILE,
        project: typeof ref.project === 'string' ? ref.project : '', status })
      : undefined;
    const answer = await callSource({
      ...callRef,
      op: 'reportResult',
      args: {
        id: ref.taskId,
        status,
        summary: buildResultSummary(pipelineRow, resultsBundle),
        links: buildResultLinks(resultsBundle),
        inputs,
        ...(move ? { move } : {}),
      },
    });
    // D11: what happened, for the audit line and the results view; nothing is added when the plugin says nothing.
    const out = { ok: true };
    if (answer && typeof answer.note === 'string' && answer.note.trim()) out.note = answer.note.trim();
    if (answer && answer.moved && typeof answer.moved === 'object') out.moved = { from: String(answer.moved.from ?? ''), to: String(answer.moved.to ?? '') };
    return out;
```

and update the JSDoc `@returns` to `{Promise<{ok:true, skipped?:true, note?:string, moved?:{from:string,to:string}} | {ok:false, error:string}>}`.

In `src/core/run-harness.mjs` `_reportToSource`, replace the audit call with:

```js
        // Ticket updates (D11): the plugin's outcome line ends the audit line ("… Moved to Resolved.")
        await appendAudit(this.pipeline.dir, `Result reported back to the task source.${outcome.note ? ` ${outcome.note}` : ''}`).catch(() => {});
```

In `ui/public/results-view.mjs` `reportResultControl`, replace the status line with:

```js
        status.textContent = out && out.ok
          ? (out.skipped ? 'nothing to report' : (out.note ? `reported · ${out.note}` : 'reported'))   // Ticket updates D11
          : `failed: ${out?.error || 'unknown'}`;
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/writeback.test.mjs test/results-view-helpers.test.mjs test/requirements-run-link.test.mjs test/api-sources.test.mjs`
Expected: PASS (every earlier `{ ok: true }` assertion holds: their connectors answer no note).

- [ ] **Step 5: Commit**

```bash
git add src/core/sources.mjs src/core/run-harness.mjs ui/public/results-view.mjs test/writeback.test.mjs test/results-view-helpers.test.mjs
git commit -m "Ticket updates: write-back passes the move; the outcome reaches the audit line and Report result

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: jira-source speaks the contract: `ticketUpdates`, `name`, `legacyMove`, `listStatuses`; version 0.2.0

D1 (Jira's mapping), D4, D5, D18 and §7's first four bullets; `reportResult` is Task 10.

**Files:**
- Modify: `plugins/jira-source/connector/index.mjs` (exports `CANCELLED_NAME`, `isCancelledName`, `categoryOf`; `listProjects`, `capabilities`; new ops `listStatuses`, `legacyMove`), `plugins/jira-source/worca-cc-plugin.json` (`"version": "0.2.0"`), `test/helpers/fake-jira.mjs` (a project's statuses)
- Test: create `test/jira-source-ticket-updates.test.mjs`; modify `test/jira-source-export.test.mjs` (the capabilities `deepEqual`s), `test/jira-source-connector.test.mjs` (two `listProjects` `deepEqual`s: **Deviation 4**)

**Interfaces:**
- Produces (connector): `capabilities({ inputs }) → { writeBack, incrementalSync: false, export: true, ticketUpdates: true }`; `listProjects() → [{ value: 'SHOP', label: 'Shop (SHOP)', name: 'Shop' }]`; `listStatuses({ project }) → [{ value, label, category }]` from `GET /rest/api/2/project/{key}/statuses`, each status once by id, in Jira's order; `legacyMove() → { field: 'transitionOnComplete', target: { typed: '<text>' } | null }`. Exports `isCancelledName(name) → boolean`, `categoryOf(status) → 'todo'|'in_progress'|'done'|'cancelled'`.
- Inside `createTaskSource`: `statusesOf(project)` (shared with Task 10).
- `startFakeJira({ projectStatuses: { SHOP: [[status, …], …] } })`: one array per issue type; `status = { id, name, statusCategory: { key } }`.

- [ ] **Step 1: Write the failing tests**

In `test/helpers/fake-jira.mjs`, add `projectStatuses: {},` to the `opt` defaults (after `noVersionNumbers: false,`), and right before the line `let m = /^\/rest\/api\/2\/issue\/createmeta\/([^/]+)\/issuetypes(?:\/([^/]+))?$/.exec(p);`:

```js
    // Ticket updates: a project's statuses per issue type (GET /rest/api/2/project/{key}/statuses), the same on Cloud and Data Center
    const ps = /^\/rest\/api\/2\/project\/([^/]+)\/statuses$/.exec(p);
    if (ps) {
      const types = opt.projectStatuses[decodeURIComponent(ps[1])];
      if (!types) return send(res, 404, { errorMessages: [`No project could be found with key '${ps[1]}'.`], errors: {} });
      return send(res, 200, types.map((statuses, i) => ({ id: String(10001 + i), name: `Type ${i + 1}`, subtask: false, statuses })));
    }
```

Create `test/jira-source-ticket-updates.test.mjs`:

```js
// test/jira-source-ticket-updates.test.mjs — jira-source's Ticket updates (plans/ticket-updates-design.md D1, D4, D10, D11, §7)
// against a fake Jira over real HTTP, Cloud and Data Center: the capability, project names, the old setting, a project's
// statuses with their categories, and (Task 10) reportResult with a move.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import createTaskSource, { isCancelledName, categoryOf } from '../plugins/jira-source/connector/index.mjs';
import { startFakeJira } from './helpers/fake-jira.mjs';

const open = [];
after(async () => { for (const j of open) await j.close(); });
const BOTH = ['cloud', 'datacenter'];
async function site(o = {}) {
  const jira = await startFakeJira(o);
  open.push(jira);
  const cloud = (o.deployment || 'cloud') === 'cloud';
  const map = new Map();
  const logs = [];
  const ctx = { apiVersion: 5, profile: 'acme', log: (level, msg) => { logs.push(`${level} ${msg}`); },
    config: { baseUrl: jira.base, email: cloud ? 'ann@acme.test' : '', token: 'tok', transitionOnComplete: o.done ?? '' },
    state: { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } } };
  return { jira, logs, src: createTaskSource(ctx) };
}
const st = (id, name, key) => ({ id, name, statusCategory: { key } });
const S = { open: st('1', 'Open', 'new'), prog: st('3', 'In Progress', 'indeterminate'), review: st('4', 'In Review', 'indeterminate'),
  done: st('10001', 'Done', 'done'), closed: st('6', 'Closed', 'done'), resolved: st('10012', 'Resolved', 'done'),
  wontdo: st('10010', "Won't Do", 'done'), wontfix: st('10011', 'Won’t Fix', 'done'), dup: st('10013', 'Duplicate', 'done'),
  notplanned: st('10014', 'Not planned', 'done') };
const STATUSES = { SHOP: [[S.open, S.prog, S.done, S.wontdo], [S.open, S.resolved, S.wontfix, S.dup, S.notplanned]] };

test('capabilities: ticketUpdates beside export; write-back still follows the run\'s input', async () => {
  const { src } = await site();
  assert.deepEqual(src.capabilities({ inputs: { writeBack: 'yes' } }), { writeBack: true, incrementalSync: false, export: true, ticketUpdates: true });
  assert.equal(src.capabilities({}).writeBack, false);
});

test('listProjects: each item gains name, the project name alone (Cloud and Data Center)', async () => {
  for (const deployment of BOTH) {
    const { src } = await site({ deployment });
    assert.deepEqual(await src.listProjects(), [{ value: 'SHOP', label: 'Shop web (SHOP)', name: 'Shop web' }, { value: 'OPS', label: 'Operations (OPS)', name: 'Operations' }], deployment);
  }
});

test('legacyMove (D4): the old setting\'s key and what it means', async () => {
  assert.deepEqual((await site({ done: ' Resolve ' })).src.legacyMove(), { field: 'transitionOnComplete', target: { typed: 'Resolve' } });
  assert.deepEqual((await site({ done: '' })).src.legacyMove(), { field: 'transitionOnComplete', target: null });
});

test('listStatuses: every status of the project once, in Jira\'s order, its category by D1 (Cloud and Data Center)', async () => {
  for (const deployment of BOTH) {
    const { src, jira } = await site({ deployment, projectStatuses: STATUSES });
    assert.deepEqual(await src.listStatuses({ project: 'SHOP' }), [
      { value: '1', label: 'Open', category: 'todo' }, { value: '3', label: 'In Progress', category: 'in_progress' },
      { value: '10001', label: 'Done', category: 'done' }, { value: '10010', label: "Won't Do", category: 'cancelled' },
      { value: '10012', label: 'Resolved', category: 'done' }, { value: '10011', label: 'Won’t Fix', category: 'cancelled' },
      { value: '10013', label: 'Duplicate', category: 'cancelled' }, { value: '10014', label: 'Not planned', category: 'cancelled' }], deployment);
    assert.ok(jira.requests.some((r) => r.path === '/rest/api/2/project/SHOP/statuses'));
    await assert.rejects(src.listStatuses({ project: 'NOPE' }), (e) => e.kind === 'plugin');
    await assert.rejects(src.listStatuses({}), (e) => e.kind === 'plugin' && /project is required/.test(e.message));
  }
});

test('D1: the negative endings, case-insensitive, either apostrophe; Jira\'s three categories', () => {
  for (const n of ["Won't Do", 'won’t do', "WON'T FIX", 'Rejected', 'Duplicate', 'Cancelled', 'Canceled', 'Declined', 'Invalid', 'Obsolete', 'Abandoned', 'Not planned', ' not planned ']) {
    assert.equal(isCancelledName(n), true, n);
  }
  for (const n of ['Done', 'Closed', 'Resolved', 'Won it', 'Duplicated work', 'Cancel']) assert.equal(isCancelledName(n), false, n);
  assert.equal(categoryOf(S.open), 'todo');
  assert.equal(categoryOf(S.prog), 'in_progress');
  assert.equal(categoryOf(S.done), 'done');
  assert.equal(categoryOf(S.wontdo), 'cancelled');
  assert.equal(categoryOf(st('9', 'Odd', 'undefined')), 'todo', 'no category: to do');
});
```

In `test/jira-source-export.test.mjs`, the capabilities test becomes:

```js
test('capabilities: export is on; write-back still follows the run\'s input', async () => {
  const { src } = await site();
  assert.deepEqual(src.capabilities({ inputs: { writeBack: 'yes' } }), { writeBack: true, incrementalSync: false, export: true, ticketUpdates: true });
  assert.deepEqual(src.capabilities({}), { writeBack: false, incrementalSync: false, export: true, ticketUpdates: true });
});
```

In `test/jira-source-connector.test.mjs` (**Deviation 4**), the two `listProjects` expectations gain `name`:

```js
      assert.deepEqual(await createTaskSource(makeCtx(), { fetch }).listProjects(),
        [{ value: 'SHOP', label: 'Shop (SHOP)', name: 'Shop' }, { value: 'OPS', label: 'Ops (OPS)', name: 'Ops' }]);
```

```js
      assert.deepEqual(await createTaskSource(makeCtx(DC), { fetch }).listProjects(), [{ value: 'SHOP', label: 'Shop (SHOP)', name: 'Shop' }]);
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/jira-source-ticket-updates.test.mjs test/jira-source-export.test.mjs test/jira-source-connector.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../plugins/jira-source/connector/index.mjs' does not provide an export named 'isCancelledName'`; the capabilities and `listProjects` `deepEqual`s differ.

- [ ] **Step 3: Implement**

In `plugins/jira-source/worca-cc-plugin.json`: `"version": "0.2.0",`.

In `plugins/jira-source/connector/index.mjs`, extend the header comment with:

```js
// Ticket updates (plans/ticket-updates-design.md §7): Worca decides what happens to a ticket when a run finishes and passes it
// as reportResult's `move`; this plugin maps Jira onto Worca's four categories (D1), lists a project's statuses, says what its
// old transitionOnComplete setting means (legacyMove, D4), and without a `move` behaves exactly as before.
```

Below `export const AFTER_KEY_TIMEOUT_MS = 15_000;`:

```js
/** D1: a done status whose name means a negative ending is cancelled (case-insensitive; ' or ’). */
export const CANCELLED_NAME = /^(?:won['’]t (?:do|fix)|rejected|duplicate|cancell?ed|declined|invalid|obsolete|abandoned|not planned)$/i;
export const isCancelledName = (name) => CANCELLED_NAME.test(String(name ?? '').trim());
/** D1: Jira's statusCategory onto Worca's four: new → todo, indeterminate → in_progress, done → done (cancelled-named:
 *  cancelled); a status without a category is to do. */
export function categoryOf(status) {
  const key = status?.statusCategory?.key;
  if (key === 'done') return isCancelledName(status?.name) ? 'cancelled' : 'done';
  if (key === 'indeterminate') return 'in_progress';
  return 'todo';
}
```

Inside `createTaskSource`, after `const lastLine = …;` (just before `return {`):

```js
  // Ticket updates: every status of a project once by id, in Jira's order (one list per issue type), with its category (D1)
  async function statusesOf(project) {
    const key = String(project ?? '').trim();
    if (!key) throw Object.assign(new Error('a project is required'), { kind: 'plugin' });
    const types = await jiraFetch(jira, `/rest/api/2/project/${enc(key)}/statuses`);
    const seen = new Set();
    const out = [];
    for (const t of Array.isArray(types) ? types : []) {
      for (const s of Array.isArray(t?.statuses) ? t.statuses : []) {
        const id = String(s?.id ?? '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ value: id, label: String(s.name || id), category: categoryOf(s) });
      }
    }
    return out;
  }
```

Replace `listProjects`:

```js
    async listProjects() {
      // `name` (Ticket updates, D5): the project's name alone, for the chips
      return (await projectList()).map((p) => ({ value: p.key, label: `${p.name} (${p.key})`, name: p.name }));
    },
```

Replace `capabilities`:

```js
    capabilities({ inputs } = {}) { return { writeBack: yes(inputs?.writeBack), incrementalSync: false, export: true, ticketUpdates: true }; },
    // ---- Ticket updates (plans/ticket-updates-design.md §3, §7) ----
    async listStatuses({ project } = {}) { return statusesOf(project); },
    legacyMove() {
      const text = String(ctx.config?.transitionOnComplete || '').trim();
      return { field: 'transitionOnComplete', target: text ? { typed: text } : null };
    },
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/jira-source-ticket-updates.test.mjs test/jira-source-export.test.mjs test/jira-source-connector.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/jira-source/connector/index.mjs plugins/jira-source/worca-cc-plugin.json test/helpers/fake-jira.mjs test/jira-source-ticket-updates.test.mjs test/jira-source-export.test.mjs test/jira-source-connector.test.mjs
git commit -m "Ticket updates: jira-source 0.2.0 lists statuses, names projects and its old setting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: jira-source's `reportResult` with a `move` (§7, D10, D11)

The transition goes first, then one comment: summary, links, the outcome line last. Without a `move`, byte for byte as today.

**Files:**
- Modify: `plugins/jira-source/connector/index.mjs` (`applyMove` and helpers; `reportResult`), `plugins/jira-source/README.md` (a **Ticket updates** section after **Write-back**; `transitionOnComplete` marked as the old setting), `test/helpers/fake-jira.mjs` (seeded issues with a status, transitions, the transition POST)
- Test: `test/jira-source-ticket-updates.test.mjs` (append)

**Interfaces:**
- Consumes: `statusesOf`, `isCancelledName` (Task 9); `issue`, `jiraFetch`, `markdownToWiki`, `wikiLink`, `log` (existing).
- Produces: `reportResult(id, { status, summary, links, inputs, move })`: with `move` → `{ commented: true, transitioned: boolean, moved: { from, to } | null, note: string }`; without → `{ commented: true, transitioned }` exactly as before.
- `startFakeJira({ seed: [{ key, project, status, transitions }], refuseTransition: { status, body } | null })`: a transition is `{ id, name, to: status, fields? }`; the issue read answers `status` and `project`; `GET …/transitions` answers `{ transitions }`; `POST …/transitions` moves the issue (or answers `refuseTransition`).

- [ ] **Step 1: Write the failing tests**

In `test/helpers/fake-jira.mjs`, add `seed: [], refuseTransition: null,` to the `opt` defaults; after `let next = 101;` add:

```js
  // Ticket updates: issues that exist from the start, each with a status and the transitions it offers
  for (const s of opt.seed) {
    issues.set(s.key, { key: s.key, project: s.project, fields: { summary: s.summary || s.key, description: '', labels: [], status: s.status },
      properties: {}, comments: [], transitions: s.transitions || [] });
  }
```

Right before `m = /^\/rest\/api\/2\/issue\/([^/]+)\/comment$/.exec(p);` add:

```js
    m = /^\/rest\/api\/2\/issue\/([^/]+)\/transitions$/.exec(p);
    if (m) {
      const i = issues.get(m[1]);
      if (!i) return gone(res);
      if (req.method === 'GET') return send(res, 200, { transitions: i.transitions || [] });
      if (opt.refuseTransition) return send(res, opt.refuseTransition.status, opt.refuseTransition.body);
      const t = (i.transitions || []).find((x) => x.id === body?.transition?.id);
      if (!t) return send(res, 400, { errorMessages: ['Transition id is not valid for this issue.'], errors: {} });
      i.fields.status = t.to;
      if (body.fields?.resolution) i.fields.resolution = body.fields.resolution;
      return send(res, 204);
    }
```

and in the issue read's answer (the last `send(res, 200, { key: i.key, fields: { … } })` of the `^/rest/api/2/issue/([^/]+)$` branch) add `status` and `project`:

```js
      return send(res, 200, { key: i.key, fields: { description: i.fields.description, labels: i.fields.labels, summary: i.fields.summary,
        issuetype: i.fields.issuetype, status: i.fields.status, project: { key: i.project } } });
```

Append to `test/jira-source-ticket-updates.test.mjs`:

```js
// ---- reportResult with a move (§7, D10, D11) ----
const tr = (id, name, to, fields) => ({ id, name, to, ...(fields ? { fields } : {}) });
const RES = (...names) => ({ resolution: { required: true, name: 'Resolution', allowedValues: names.map((n, i) => ({ id: String(i + 1), name: n })) } });
const RESULT = { status: 'completed', summary: 'done', links: [{ title: 'Pull request', url: 'https://github.com/acme/shop/pull/5' }], inputs: { writeBack: 'yes' } };
const LINK = '* [Pull request|https://github.com/acme/shop/pull/5]';
/** One report against a fresh fake Jira holding SHOP-12 in `from` with `transitions`. */
async function report(move, { from = S.prog, transitions = [], deployment = 'cloud', ...more } = {}) {
  const { jira, src, logs } = await site({ deployment, projectStatuses: STATUSES, seed: [{ key: 'SHOP-12', project: 'SHOP', status: from, transitions }], ...more });
  const out = await src.reportResult('SHOP-12', { ...RESULT, move });
  const i = jira.issues.get('SHOP-12');
  return { out, comment: i.comments.at(-1), posts: jira.requests.filter((r) => r.method === 'POST' && /\/transitions$/.test(r.path)),
    reads: jira.requests.filter((r) => r.method === 'GET' && /\/transitions$/.test(r.path)), status: i.fields.status, jira, logs };
}

test('Any Done status: prefers Done, then Closed, Resolved, Complete, Completed, then the rest in Jira\'s order; the line is last', async () => {
  for (const deployment of BOTH) {
    const r = await report({ category: 'done' }, { deployment,
      transitions: [tr('51', 'Resolve', S.resolved), tr('61', 'Close', S.closed), tr('71', 'Finish', S.done), tr('81', "Won't do", S.wontdo)] });
    assert.deepEqual(r.posts.map((p) => p.body), [{ transition: { id: '71' } }], deployment);
    assert.deepEqual(r.out, { commented: true, transitioned: true, moved: { from: 'In Progress', to: 'Done' }, note: 'Moved to Done.' }, deployment);
    assert.equal(r.comment, `done\n\n${LINK}\n\nMoved to Done.`, `${deployment}: summary, links, then the outcome line`);
    assert.equal(r.reads[0].query.expand, 'transitions.fields');
  }
  const closed = await report({ category: 'done' }, { transitions: [tr('51', 'Resolve', S.resolved), tr('61', 'Close', S.closed)] });
  assert.equal(closed.out.note, 'Moved to Closed.');
  const other = await report({ category: 'done' }, { transitions: [tr('91', 'Ship', st('20', 'Shipped', 'done')), tr('92', 'Archive', st('21', 'Archived', 'done'))] });
  assert.equal(other.out.note, 'Moved to Shipped.', "no preferred name: Jira's order");
});

test('Any Done status never takes a cancelled one; with none it does not move and says so; already done is said', async () => {
  const only = await report({ category: 'done' }, { from: S.review, transitions: [tr('81', "Won't do", S.wontdo), tr('82', 'Duplicate', S.dup), tr('83', 'Dup again', S.dup)] });
  assert.deepEqual([only.posts.length, only.out.moved, only.out.transitioned], [0, null, false]);
  assert.equal(only.out.note, 'Not moved: from "In Review" only Won\'t Do and Duplicate lead to a Done status.');
  assert.equal(only.comment, `done\n\n${LINK}\n\nNot moved: from "In Review" only Won't Do and Duplicate lead to a Done status.`);
  const none = await report({ category: 'done' }, { from: S.review, transitions: [tr('11', 'Start', S.prog)] });
  assert.equal(none.out.note, 'Not moved: from "In Review" no transition leads to a Done status.');
  const already = await report({ category: 'done' }, { from: S.closed, transitions: [tr('71', 'Finish', S.done)] });
  assert.deepEqual([already.out.note, already.reads.length, already.posts.length], ['Already in Closed.', 0, 0]);
  const wontdo = await report({ category: 'done' }, { from: S.wontdo });
  assert.equal(wontdo.out.note, "Already in Won't Do.", 'a ticket already in a done-category status is not moved again');
});

test('a required Resolution: filled with Done, Fixed, Complete or Completed; else the next candidate; else not moved', async () => {
  const filled = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done, RES("Won't Do", 'Done'))] });
  assert.deepEqual(filled.posts[0].body, { transition: { id: '71' }, fields: { resolution: { id: '2' } } });
  assert.equal(filled.out.note, 'Moved to Done, Resolution: Done.');
  const fallback = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done, RES("Won't Do")), tr('61', 'Close', S.closed)] });
  assert.deepEqual([fallback.posts.map((p) => p.body.transition.id), fallback.out.note], [['61'], 'Moved to Closed.']);
  const no = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done, RES('Rejected'))] });
  assert.deepEqual([no.posts.length, no.out.note], [0, 'Not moved: the move to Done needs a Resolution, and none is named Done, Fixed or Complete.']);
  const status = await report({ status: '10001', name: 'Done' }, { transitions: [tr('71', 'Finish', S.done, RES('Fixed'))] });
  assert.equal(status.out.note, 'Moved to Done, Resolution: Fixed.', 'the same rule for a status move');
});

test('other required fields without a default: Worca fills none, so it does not move and names them', async () => {
  const r = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done, { customfield_10020: { required: true, name: 'Fix versions', hasDefaultValue: false },
    customfield_10021: { required: true, name: 'Team', hasDefaultValue: true } })] });
  assert.deepEqual([r.posts.length, r.out.note], [0, 'Not moved: the move to Done asks for fields Worca does not fill (Fix versions).']);
});

test('a status move: by id, a typed name, already there, gone from the project, not reachable', async () => {
  for (const deployment of BOTH) {
    const byId = await report({ status: '10012', name: 'Resolved' }, { deployment, transitions: [tr('11', 'Start', S.prog), tr('51', 'Resolve', S.resolved)] });
    assert.deepEqual([byId.posts[0].body, byId.out.note, byId.status.name], [{ transition: { id: '51' } }, 'Moved to Resolved.', 'Resolved'], deployment);
  }
  const typed = await report({ status: 'resolve' }, { transitions: [tr('51', 'Resolve', S.resolved)] });
  assert.equal(typed.out.note, 'Moved to Resolved.', 'typed: by transition name, case-insensitive');
  const toName = await report({ status: 'resolved' }, { transitions: [tr('51', 'Wrap up', S.resolved)] });
  assert.equal(toName.out.note, 'Moved to Resolved.', "typed: by the target status's name");
  const already = await report({ status: '3', name: 'In Progress' }, { transitions: [tr('51', 'Resolve', S.resolved)] });
  assert.deepEqual([already.out.note, already.reads.length], ['Already in In Progress.', 0]);
  const gone = await report({ status: '10099', name: 'Shipped' }, { transitions: [tr('11', 'Start', S.prog)] });
  assert.equal(gone.out.note, 'Not moved: SHOP has no status named Shipped any more.');
  const away = await report({ status: '10012', name: 'Resolved' }, { transitions: [tr('11', 'Start', S.prog), tr('12', 'Review', S.review)] });
  assert.equal(away.out.note, 'Could not move to "Resolved" from "In Progress" (available: Start, Review).');
  const legacyTyped = await report({ status: 'Shipped' }, { transitions: [tr('11', 'Start', S.prog), tr('12', 'Review', S.review)] });
  assert.equal(legacyTyped.out.note, 'Could not move to "Shipped" from "In Progress" (available: Start, Review).');
  assert.ok(legacyTyped.logs.some((l) => /^warn SHOP-12: Could not move/.test(l)));
});

test("a refused transition still comments with Jira's reason (D10, Deviation 3); a refused token still throws", async () => {
  const r = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done)],
    refuseTransition: { status: 400, body: { errorMessages: ['Field Assignee is required.'], errors: {} } } });
  assert.deepEqual([r.out.transitioned, r.out.moved], [false, null]);
  assert.equal(r.out.note, 'Not moved: Jira refused the move to Done: Field Assignee is required.');
  assert.equal(r.comment.split('\n').at(-1), r.out.note);
  const forbidden = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done)],
    refuseTransition: { status: 403, body: { errorMessages: [], errors: { status: 'You may not move this issue.' } } } });
  assert.equal(forbidden.out.note, 'Not moved: Jira refused the move to Done: You may not move this issue.');
  const { jira, src } = await site({ projectStatuses: STATUSES, seed: [{ key: 'SHOP-12', project: 'SHOP', status: S.prog, transitions: [] }], refuseToken: true });
  await assert.rejects(src.reportResult('SHOP-12', { ...RESULT, move: { category: 'done' } }), (e) => e.kind === 'auth');
  assert.deepEqual(jira.issues.get('SHOP-12').comments, [], 'no comment after a refused token');
});

test("Don't move: no read, no transition, no line; a failed run passes none and only comments", async () => {
  const r = await report({ none: true }, { transitions: [tr('71', 'Finish', S.done)] });
  assert.deepEqual([r.reads.length, r.posts.length, r.out], [0, 0, { commented: true, transitioned: false, moved: null, note: '' }]);
  assert.equal(r.comment, `done\n\n${LINK}`);
  assert.equal(r.jira.requests.filter((q) => /\/issue\/SHOP-12$/.test(q.path)).length, 0, 'the status is not even read');
});

test('without a move: exactly the old behaviour (transitionOnComplete, its line before the links)', async () => {
  const { jira, src } = await site({ done: 'Done', projectStatuses: STATUSES,
    seed: [{ key: 'SHOP-12', project: 'SHOP', status: S.prog, transitions: [tr('71', 'Finish', S.done)] }] });
  const out = await src.reportResult('SHOP-12', RESULT);
  assert.deepEqual(out, { commented: true, transitioned: true });
  assert.equal(jira.issues.get('SHOP-12').comments.at(-1), `done\n\nMoved to Done.\n\n${LINK}`);
  const reads = jira.requests.filter((q) => q.method === 'GET' && /\/transitions$/.test(q.path));
  assert.equal(reads[0].query.expand, undefined, 'the legacy read asks for no fields');
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/jira-source-ticket-updates.test.mjs`
Expected: FAIL — with a `move` the connector still runs the legacy path: no transition is posted (`transitionOnComplete` is blank), the answer has no `note`, and the comment has no outcome line.

- [ ] **Step 3: Implement**

In `plugins/jira-source/connector/index.mjs`, inside `createTaskSource`, after `statusesOf` (Task 9):

```js
  // ---- Ticket updates: one move (§7, D10) ----
  const PREFERRED = ['done', 'closed', 'resolved', 'complete', 'completed'];
  const RESOLUTIONS = ['done', 'fixed', 'complete', 'completed'];
  const lc = (s) => String(s ?? '').trim().toLowerCase();
  /** "A", "A and B", "A, B and C". */
  const andList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
  /** Jira's own words for a refusal, without a trailing full stop. */
  const jiraSaid = (e) => ([...(e?.body?.errorMessages || []), ...Object.values(e?.body?.errors || {})]
    .map((m) => String(m).trim()).filter(Boolean).join('; ') || 'no reason given').replace(/\.+$/, '');
  /** What a transition still needs: its Resolution (undefined when not required; the first allowed value named Done, Fixed,
   *  Complete or Completed; null when none fits), and its other required fields without a default (Worca fills none). */
  function needs(t) {
    const fields = t?.fields && typeof t.fields === 'object' ? t.fields : {};
    const r = fields.resolution;
    const resolution = r && r.required === true ? (r.allowedValues || []).find((v) => RESOLUTIONS.includes(lc(v?.name))) || null : undefined;
    const other = Object.entries(fields).filter(([k, f]) => k !== 'resolution' && f && f.required === true && !f.hasDefaultValue).map(([k, f]) => f.name || k);
    return { resolution, other };
  }
  const nameOf = (t) => t?.to?.name || t?.name || '?';
  const needLine = (t, n) => (n.other.length ? `Not moved: the move to ${nameOf(t)} asks for fields Worca does not fill (${n.other.join(', ')}).`
    : `Not moved: the move to ${nameOf(t)} needs a Resolution, and none is named Done, Fixed or Complete.`);
  const transitionsOf = async (key) => ((await jiraFetch(jira, `/rest/api/2/issue/${enc(key)}/transitions?expand=transitions.fields`)) || {}).transitions || [];
  /** §7: one move, before the comment. Answers { note, moved, transitioned }. A refused transition (any `plugin` failure:
   *  Deviation 3) is a "Not moved" line; auth, network and rate limit throw, so the write-back fails and Report result retries
   *  (a retry after a failed comment finds the ticket moved: "Already in …"). */
  async function applyMove(key, move) {
    const none = { note: '', moved: null, transitioned: false };
    if (!move || move.none === true) return none;
    const fields = (await issue(key, ['status', 'project']))?.fields || {};
    const now = fields.status || {};
    const from = now.name || '?';
    const go = async (t, resolution) => {
      try {
        await jiraFetch(jira, `/rest/api/2/issue/${enc(key)}/transitions`, { method: 'POST',
          body: { transition: { id: t.id }, ...(resolution ? { fields: { resolution: { id: resolution.id } } } : {}) } });
      } catch (e) {
        if (e && e.kind === 'plugin') return { ...none, note: `Not moved: Jira refused the move to ${nameOf(t)}: ${jiraSaid(e)}.` };
        throw e;
      }
      return { note: resolution ? `Moved to ${nameOf(t)}, Resolution: ${resolution.name}.` : `Moved to ${nameOf(t)}.`,
        moved: { from, to: nameOf(t) }, transitioned: true };
    };
    if (move.category === 'done') {
      if (now.statusCategory?.key === 'done') return { ...none, note: `Already in ${from}.` };
      const done = (await transitionsOf(key)).filter((t) => t?.to?.statusCategory?.key === 'done');
      const usable = done.filter((t) => !isCancelledName(t.to?.name));
      if (!usable.length) {
        const names = [...new Set(done.map((t) => t.to?.name).filter(Boolean))];
        return { ...none, note: names.length ? `Not moved: from "${from}" only ${andList(names)} lead to a Done status.`
          : `Not moved: from "${from}" no transition leads to a Done status.` };
      }
      const rank = (t) => { const i = PREFERRED.indexOf(lc(t.to?.name)); return i < 0 ? PREFERRED.length : i; };
      const ordered = usable.map((t, i) => [t, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([t]) => t);
      for (const t of ordered) {
        const n = needs(t);
        if (!n.other.length && n.resolution !== null) return go(t, n.resolution);
      }
      return { ...none, note: needLine(ordered[0], needs(ordered[0])) };
    }
    const want = String(move.status ?? '').trim();
    const named = typeof move.name === 'string' && move.name.trim() ? move.name.trim() : null;
    if (String(now.id ?? '') === want || lc(from) === lc(want) || (named && lc(from) === lc(named))) return { ...none, note: `Already in ${from}.` };
    const transitions = await transitionsOf(key);
    const t = transitions.find((x) => String(x?.to?.id ?? '') === want)
      || transitions.find((x) => lc(x?.name) === lc(want) || lc(x?.to?.name) === lc(want));
    if (!t) {
      const project = fields.project?.key;
      if (named && project) {
        let has = true;
        try { has = (await statusesOf(project)).some((s) => s.value === want); } catch { has = true; }   // unknown: the general line
        if (!has) return { ...none, note: `Not moved: ${project} has no status named ${named} any more.` };
      }
      const note = `Could not move to "${named || want}" from "${from}" (available: ${transitions.map((x) => x.name).join(', ') || 'none'}).`;
      log('warn', `${key}: ${note}`);
      return { ...none, note };
    }
    const n = needs(t);
    if (n.other.length || n.resolution === null) return { ...none, note: needLine(t, n) };
    return go(t, n.resolution);
  }
```

In `reportResult`, change the signature and add the `move` branch right after the write-back gate (`if (!yes(inputs?.writeBack)) return { skipped: true };`); the rest of the function stays exactly as it is:

```js
    async reportResult(id, { status, summary: text, links = [], inputs = {}, move } = {}) {
      // A bad id throws: sources.mjs records a throw as a failed write-back, a return as ok:true.
      const key = requireKey(id);
      if (!yes(inputs?.writeBack)) return { skipped: true };
      if (move && typeof move === 'object') {
        // Ticket updates (§7, D11): Worca decided the move; Jira transitions first, then one comment: the run summary, its links,
        // then the outcome line last. Without a move (nothing saved in Worca) the old path below runs unchanged (D4).
        const out = await applyMove(key, move);
        const lines = links.map((l) => `* ${wikiLink(l.title, l.url)}`);
        const body = [markdownToWiki(text || `worca pipeline ${status}`), ...(lines.length ? ['', ...lines] : []),
          ...(out.note ? ['', markdownToWiki(out.note)] : [])].join('\n');
        await jiraFetch(jira, `/rest/api/2/issue/${enc(key)}/comment`, { method: 'POST', body: { body } });
        return { commented: true, transitioned: out.transitioned, moved: out.moved, note: out.note };
      }
```

In `plugins/jira-source/README.md`, in **Setup**'s table change the `transitionOnComplete` row to:

```
| transitionOnComplete | text | — | the old setting: once **Ticket updates** is saved for this connection (Labs flag `ticketUpdates`), Worca no longer uses it. Until then, optional: a transition or status name (e.g. `Done`) to move the issue to when a run that writes back finishes successfully |
```

and add after the **Write-back** section:

```markdown
## Ticket updates

With the Labs flag **Ticket updates** on, Worca decides what a finished run does to its ticket (Marketplace › Installed ›
Jira › Settings › **Ticket updates**: the projects you work on and, per project, Don't move, Any Done status or one of that
project's statuses). The plugin answers `capabilities()` with `ticketUpdates: true` and:

- **listStatuses** — a project's statuses (`/rest/api/2/project/<key>/statuses`), each once, with Worca's category: Jira's
  `new` is to do, `indeterminate` in progress, `done` done, except a done status named Won't Do, Won't Fix, Rejected,
  Duplicate, Cancelled, Canceled, Declined, Invalid, Obsolete, Abandoned or Not planned, which is cancelled.
- **legacyMove** — what **Transition on completion** means, so the section starts from it.
- **reportResult with a move** — the transition first, then one comment: the run summary, its links, and a last line saying
  what happened. **Any Done status** takes a transition to a done status, preferring Done, then Closed, Resolved, Complete,
  Completed, and never a cancelled one. A required Resolution is filled with the first allowed value named Done, Fixed,
  Complete or Completed. Last lines:
  - `Moved to Resolved.` / `Moved to Done, Resolution: Done.` / `Already in Closed.`
  - `Not moved: from "In Review" only Won't Do and Duplicate lead to a Done status.`
  - `Not moved: the move to Done needs a Resolution, and none is named Done, Fixed or Complete.`
  - `Not moved: the move to Done asks for fields Worca does not fill (Fix versions).`
  - `Not moved: CRM has no status named Shipped any more.`
  - `Not moved: Jira refused the move to Done: <Jira's message>.` — the comment is still posted.

Until Ticket updates is saved for a connection, write-back works exactly as described above.
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/jira-source-ticket-updates.test.mjs test/jira-source-connector.test.mjs test/jira-source-export.test.mjs`
Expected: PASS (every legacy `reportResult` row in `jira-source-connector.test.mjs` unchanged).

- [ ] **Step 5: Commit**

```bash
git add plugins/jira-source/connector/index.mjs plugins/jira-source/README.md test/helpers/fake-jira.mjs test/jira-source-ticket-updates.test.mjs
git commit -m "Ticket updates: jira-source moves by Worca's rule, never to a cancelled status, the outcome last

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Report back says the rule's move (D14)

`exportView` gains `move`, resolved from the link's connection and tracker project with the same `moveFor` as write-back; the Report back hint uses it when it is not null.

**Files:**
- Modify: `src/core/requirements/export.mjs` (`exportView`, its fallback; the `ticket-updates.mjs` import), `ui/public/requirements-view.mjs` (`reportRow`'s hint)
- Test: `test/requirements-export.test.mjs` (one test at the end), `test/requirements-view-export.test.mjs` (one test at the end)

**Interfaces:**
- Consumes: `moveFor`, `describeMove` (Task 2); the link's `plugin`, `sourceId`, `profile`, `trackerProject`.
- Produces: `exportView(f, turns, d).move: { kind: 'category'|'status'|'none', label: string } | null` (null without a link, with the flag off or with nothing saved; `label` is "a Done status", the status's name, or for `none` the tracker project).

- [ ] **Step 1: Write the failing tests**

Append to `test/requirements-export.test.mjs` (after Task 6's test, which re-saved the acme setup on SHOP and defined `TU_NONE` and `withTicketUpdates`):

```js
test("Ticket updates (D14): exportView's move is the rule of the link's connection and project", async () => {
  reset();
  const f = readyFeature('Report move');
  await exportNow(f.seq);   // a link on acme, project SHOP
  const move = async () => (await exportView(getFeature(f.seq), listTurns(f.seq), d)).move;
  const ALL_DONE = { project: '', moment: 'finished', target: { kind: 'category', value: 'done' } };
  await withTicketUpdates(async () => {
    writeTicketUpdates('jira-source', 'acme', 'jira', { projects: [], rules: [ALL_DONE,
      { project: 'SHOP', label: 'Shop web', moment: 'finished', target: { kind: 'status', value: '10012', label: 'Resolved', category: 'done' } }] });
    assert.deepEqual(await move(), { kind: 'status', label: 'Resolved' });
    writeTicketUpdates('jira-source', 'acme', 'jira', { projects: [], rules: [ALL_DONE] });
    assert.deepEqual(await move(), { kind: 'category', label: 'a Done status' });
    writeTicketUpdates('jira-source', 'acme', 'jira', { projects: [], rules: TU_NONE });
    assert.deepEqual(await move(), { kind: 'none', label: 'SHOP' });
    assert.equal((await exportView(readyFeature('No link'), [], d)).move, null, 'no link');
  });
  process.env.WORCA_FLAGS = '-ticketUpdates';
  try { assert.equal(await move(), null, 'flag off: the old lines'); } finally { delete process.env.WORCA_FLAGS; }
});
```

Append to `test/requirements-view-export.test.mjs`:

```js
test("Ticket updates (D14): Report back's hint says the rule's move; without one, the two lines stay", async () => {
  const hint = async (move) => {
    const m = await openFeature(feature({ export: XV({ link: LINK, doneStatus: 'Done', move }) }));
    return text(document.getElementById(q('report-card', m.host).getAttribute('aria-describedby')));
  };
  assert.equal(await hint({ kind: 'category', label: 'a Done status' }), 'When the run ends, Worca comments with the result and the pull request link, '
    + 'and moves the ticket to a Done status (Ticket updates in the Jira connection).');
  assert.equal(await hint({ kind: 'status', label: 'Resolved' }), 'When the run ends, Worca comments with the result and the pull request link, '
    + 'and moves the ticket to Resolved (Ticket updates in the Jira connection).');
  assert.equal(await hint({ kind: 'none', label: 'SHOP' }), 'When the run ends, Worca comments with the result and the pull request link. '
    + 'Ticket updates in the Jira connection leave SHOP tickets where they are.');
  assert.equal(await hint(null), 'When the run ends, Worca comments with the result and the pull request link, '
    + 'and moves the ticket to Done (the status named in the Jira connection; without one, it only comments).');
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/requirements-export.test.mjs test/requirements-view-export.test.mjs`
Expected: FAIL — `exportView(…).move` is `undefined`; the hint still names "Done (the status named in the Jira connection; …)".

- [ ] **Step 3: Implement**

In `src/core/requirements/export.mjs`, extend the Task 6 import:

```js
import { projectFilter, filterProjects, moveFor, describeMove } from '../ticket-updates.mjs';
```

In `exportView`, after the `doneStatus: …,` line add:

```js
      // Ticket updates (D14): what Report back will do, by the rule of the link's connection and tracker project (write-back's
      // own moveFor); null with the flag off or nothing saved, and the hint keeps its two lines
      move: link ? describeMove(moveFor({ plugin: link.plugin, sourceId: link.sourceId, profile: link.profile || DEFAULT_PROFILE,
        project: link.trackerProject || '', status: 'completed' }), { project: link.trackerProject || '' }) : null,
```

and in its `catch` fallback add `move: null`:

```js
    return { tracker: null, canExport: false, hasSetup: false, link: null, exporting: false, doneStatus: null, move: null, history: [] };
```

In `ui/public/requirements-view.mjs` `reportRow`, replace the `h('p', { class: 'hint req-report-hint', id: hintId, text: … })` argument's `text` with a value computed before the `return`:

```js
    // Ticket updates (D14): the rule's move when the link's connection has one; else the two lines A6 wrote
    const mv = xOf(f).move;
    const lead = 'When the run ends, Worca comments with the result and the pull request link';
    const hintText = mv && mv.kind === 'none'
      ? `${lead}. Ticket updates in the ${name} connection leave ${mv.label} tickets where they are.`
      : mv && (mv.kind === 'category' || mv.kind === 'status')
        ? `${lead}, and moves the ticket to ${mv.label} (Ticket updates in the ${name} connection).`
        : done
          ? `${lead}, and moves the ticket to ${done} (the status named in the ${name} connection; without one, it only comments).`
          : `${lead}. The ${name} connection names no status to move the ticket to, so it only comments.`;
    return h('div', { class: 'req-report' }, row,
      h('p', { class: 'hint req-report-hint', id: hintId, text: hintText }));
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/requirements-export.test.mjs test/requirements-view-export.test.mjs test/requirements-export-api.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/requirements/export.mjs ui/public/requirements-view.mjs test/requirements-export.test.mjs test/requirements-view-export.test.mjs
git commit -m "Ticket updates: Report back names the move the connection's rule makes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The move select (board 4)

D13 and §8, §10 C/D, §11: a select-only combobox. No generic combobox exists upstream; this module is not made generic.

**Files:**
- Create: `ui/public/marketplace/move-select.mjs`
- Test: create `test/marketplace-move-select.test.mjs`

**Interfaces:**
- Consumes: `placeFlyout` (`ui/public/side-flyout.mjs`), `icon` (`ui/public/icons.mjs`).
- Produces:
  - `targetText(target) → string` ("Don't move", "Any Done status", the status's name, "<text> (as typed)")
  - `sameTarget(a, b) → boolean`
  - `CATEGORY_GROUPS` (the four groups, in §9's order), `FALLBACK_ERROR = 'Worca could not finish that. Try again.'`
  - `createMoveSelect({ doc, project, value, general, label, loadStatuses, onChange, host, now }) → { el, button, get(), set(target), describe(id|null), open(), close(), isOpen(), destroy() }`. `general: true` = the All projects row (and a new row before its project is chosen): only Don't move and Any Done status (plus a carried-over typed value while it is selected), no load. `loadStatuses()` → array of `{ value, label, category }` or a rejection whose `message` is the sentence to show. `host` is where the listbox is appended (the sheet panel; default `doc.body`).
  - Class hooks: `mk-tu-movewrap`, `mk-tu-move`, `mk-tu-move-t`, `mk-tu-move-ic`, `mk-tu-pop`, `mk-tu-movepop`, `mk-tu-list`, `mk-tu-opt` (`is-active`), `mk-tu-opt-b`, `mk-tu-opt-t`, `mk-tu-opt-s`, `mk-tu-opt-check`, `mk-tu-dot`, `mk-tu-dot-{none|category|typed|done|in_progress|todo|cancelled}`, `mk-tu-sep`, `mk-tu-group`, `mk-tu-live`, `mk-tu-retry`.

- [ ] **Step 1: Write the failing test**

Create `test/marketplace-move-select.test.mjs`:

```js
// test/marketplace-move-select.test.mjs — Ticket updates' move select (plans/ticket-updates-design.md board 4, §10 C/D, §11):
// the combobox and its listbox, the groups and dots, the keyboard, loading and failure.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { settle } from './helpers/marketplace-sheet-harness.mjs';
import { createMoveSelect, targetText } from '../ui/public/marketplace/move-select.mjs';

const trackDom = useDomRelease(afterEach);
const CRM = [{ value: '10001', label: 'Done', category: 'done' }, { value: '10002', label: 'Released', category: 'done' },
  { value: '3', label: 'In Progress', category: 'in_progress' }, { value: '10003', label: 'Waiting for customer', category: 'in_progress' },
  { value: '1', label: 'Open', category: 'todo' }, { value: '10004', label: "Won't Fix", category: 'cancelled' }];
const RELEASED = { kind: 'status', value: '10002', label: 'Released', category: 'done' };

function mount(opts = {}) {
  const { window } = trackDom(new JSDOM('<!doctype html><body><button id="away" type="button">away</button></body>', { url: 'http://localhost/' }));
  const doc = window.document;
  const changes = [];
  let clock = 1000;
  const ms = createMoveSelect({ doc, project: 'CRM', loadStatuses: async () => CRM, onChange: (t) => changes.push(t), now: () => clock, ...opts });
  doc.body.append(ms.el);
  const key = (k) => ms.button.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const list = () => doc.querySelector('[role="listbox"]');
  const options = () => [...doc.querySelectorAll('[role="listbox"] [role="option"]')];
  const titles = () => options().map((o) => o.querySelector('.mk-tu-opt-t').textContent);
  const active = () => doc.getElementById(ms.button.getAttribute('aria-activedescendant'))?.querySelector('.mk-tu-opt-t').textContent ?? null;
  return { window, doc, ms, changes, key, list, options, titles, active, tick: (ms2) => { clock += ms2; } };
}

test('targetText: the words each target shows', () => {
  assert.equal(targetText({ kind: 'none' }), "Don't move");
  assert.equal(targetText({ kind: 'category', value: 'done' }), 'Any Done status');
  assert.equal(targetText(RELEASED), 'Released');
  assert.equal(targetText({ kind: 'typed', value: 'Resolve' }), 'Resolve (as typed)');
  assert.equal(targetText(null), "Don't move");
});

test('board 4: the combobox and the listbox "CRM statuses": the two options, a separator, the groups with their dots; the selected one checked', async () => {
  const m = mount({ value: RELEASED });
  const b = m.ms.button;
  assert.deepEqual([b.tagName, b.type, b.getAttribute('role'), b.getAttribute('aria-haspopup'), b.getAttribute('aria-expanded'), b.textContent],
    ['BUTTON', 'button', 'combobox', 'listbox', 'false', 'Released']);
  assert.equal(m.doc.getElementById(b.getAttribute('aria-labelledby')).textContent, 'CRM: move to');
  b.click();
  await settle();
  assert.equal(b.getAttribute('aria-expanded'), 'true');
  assert.equal(b.getAttribute('aria-controls'), m.list().id);
  assert.equal(m.list().getAttribute('aria-label'), 'CRM statuses');
  assert.deepEqual(m.titles(), ["Don't move", 'Any Done status', 'Done', 'Released', 'In Progress', 'Waiting for customer', 'Open', "Won't Fix"]);
  assert.equal(m.options()[1].querySelector('.mk-tu-opt-s').textContent, 'One this ticket can reach');
  assert.deepEqual([...m.list().querySelectorAll('[role="presentation"]')].map((n) => n.textContent),
    ['', "Done · CRM's workflow", 'In progress', 'To do', 'Cancelled']);
  assert.deepEqual(m.options().map((o) => o.querySelector('.mk-tu-dot').className.split(' ')[1]),
    ['mk-tu-dot-none', 'mk-tu-dot-category', 'mk-tu-dot-done', 'mk-tu-dot-done', 'mk-tu-dot-in_progress', 'mk-tu-dot-in_progress', 'mk-tu-dot-todo', 'mk-tu-dot-cancelled']);
  assert.ok(m.options().every((o) => o.querySelector('.mk-tu-dot').getAttribute('aria-hidden') === 'true'));
  const sel = m.options().filter((o) => o.getAttribute('aria-selected') === 'true');
  assert.deepEqual(sel.map((o) => o.querySelector('.mk-tu-opt-t').textContent), ['Released']);
  assert.ok(sel[0].querySelector('.mk-tu-opt-check'), 'the selected option has a check');
  assert.equal(m.active(), 'Released', 'the list opens on the selected option');
  assert.equal(m.doc.activeElement === b || m.doc.activeElement === m.doc.body, true, 'the focus never moves into the list');
});

test('All projects: only the two general options, labelled "All projects: move to"; a carried-over typed value while selected; no load', async () => {
  let loads = 0;
  const m = mount({ general: true, value: { kind: 'typed', value: 'Resolve' }, loadStatuses: async () => { loads += 1; return CRM; } });
  assert.equal(m.ms.button.textContent, 'Resolve (as typed)');
  assert.equal(m.doc.getElementById(m.ms.button.getAttribute('aria-labelledby')).textContent, 'All projects: move to');
  m.ms.button.click();
  await settle();
  assert.equal(m.list().getAttribute('aria-label'), 'All projects: move to');
  assert.deepEqual(m.titles(), ["Don't move", 'Any Done status', 'Resolve (as typed)']);
  assert.equal(m.list().querySelector('[role="presentation"]'), null);
  m.options()[1].click();
  assert.deepEqual(m.changes, [{ kind: 'category', value: 'done' }]);
  m.ms.button.click();
  await settle();
  assert.deepEqual(m.titles(), ["Don't move", 'Any Done status'], 'once another option is picked the typed one is gone');
  assert.equal(loads, 0);
});

test('keyboard (§11): ↓ opens; ↑ ↓ Home End move; type-ahead; Enter picks and keeps focus; Esc closes without change; Space picks', async () => {
  const m = mount();
  m.ms.button.focus();
  m.key('ArrowDown');
  await settle();
  assert.equal(m.active(), "Don't move");
  m.key('ArrowDown');
  assert.equal(m.active(), 'Any Done status');
  m.key('End');
  assert.equal(m.active(), "Won't Fix");
  m.key('Home');
  assert.equal(m.active(), "Don't move");
  m.key('ArrowUp');
  assert.equal(m.active(), "Don't move", 'the top stays the top');
  m.key('w');
  assert.equal(m.active(), 'Waiting for customer', 'type-ahead: the next option starting with the letters');
  m.tick(1000);
  m.key('w');
  assert.equal(m.active(), "Won't Fix", 'the same letter again goes to the next one');
  m.tick(1000);
  m.key('r');
  m.key('e');
  assert.equal(m.active(), 'Released');
  assert.equal(m.key('Enter'), false, 'Enter is used');
  assert.deepEqual([m.ms.isOpen(), m.doc.activeElement, m.changes], [false, m.ms.button, [RELEASED]]);
  assert.equal(m.ms.button.textContent, 'Released');
  m.key('Enter');
  await settle();
  m.key('Home');
  assert.equal(m.key('Escape'), false, 'Esc is used: the sheet underneath does not close');
  assert.deepEqual([m.ms.isOpen(), m.changes.length, m.doc.activeElement], [false, 1, m.ms.button]);
  m.key(' ');
  await settle();
  m.key('Home');
  m.key(' ');
  assert.deepEqual(m.changes.at(-1), { kind: 'none' });
  assert.equal(m.key('Escape'), true, 'closed: Esc is left to the sheet');
});

test("C: the list opens at once with \"Getting CRM's statuses…\"; D: A6's sentence and Try again; a failed load is asked again on the next open", async () => {
  let n = 0;
  let reject;
  const m = mount({ loadStatuses: () => { n += 1; if (n === 1) return new Promise((_, r) => { reject = r; });
    if (n === 2) return Promise.reject(new Error('Worca could not reach Jira: the API token was refused.')); return CRM; } });
  m.ms.button.click();
  const live = () => m.doc.querySelector('.mk-tu-live');
  const retry = () => m.doc.querySelector('.mk-tu-retry');
  assert.deepEqual(m.titles(), ["Don't move", 'Any Done status'], "the two general options at once");
  assert.deepEqual([live().textContent, live().getAttribute('aria-live'), retry().hidden], ["Getting CRM's statuses…", 'polite', true]);
  reject(new Error('Worca could not reach Jira: the API token was refused.'));
  await settle();
  assert.deepEqual([live().textContent, retry().hidden], ['Worca could not reach Jira: the API token was refused.', false]);
  m.options()[1].click();
  assert.deepEqual(m.changes, [{ kind: 'category', value: 'done' }], 'Any Done status still works');
  m.ms.button.click();
  await settle();
  assert.equal(live().textContent, 'Worca could not reach Jira: the API token was refused.', 'the second load failed too');
  retry().click();
  await settle();
  assert.equal(n, 3);
  assert.equal(live().textContent, '');
  assert.equal(m.titles().length, 8, 'Try again loaded the statuses');
});

test('a press outside closes; describe() ties a line to the select; set() repaints; destroy() closes', async () => {
  const m = mount({ value: RELEASED });
  m.ms.button.click();
  await settle();
  m.doc.getElementById('away').dispatchEvent(new m.window.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(m.ms.isOpen(), false);
  m.ms.describe('gone-1');
  assert.equal(m.ms.button.getAttribute('aria-describedby'), 'gone-1');
  m.ms.describe(null);
  assert.equal(m.ms.button.hasAttribute('aria-describedby'), false);
  m.ms.set({ kind: 'category', value: 'done' });
  assert.deepEqual([m.ms.button.textContent, m.ms.get()], ['Any Done status', { kind: 'category', value: 'done' }]);
  m.ms.open();
  m.ms.destroy();
  assert.deepEqual([m.ms.isOpen(), m.doc.querySelector('.mk-tu-pop')], [false, null]);
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node tools/test.mjs test/marketplace-move-select.test.mjs`
Expected: FAIL — `Cannot find module '…/ui/public/marketplace/move-select.mjs'`.

- [ ] **Step 3: Implement**

Create `ui/public/marketplace/move-select.mjs`:

```js
// ui/public/marketplace/move-select.mjs — Ticket updates' move select (plans/ticket-updates-design.md §8 board 4, §10 C/D, §11).
// A button with role="combobox" opening a listbox placed by placeFlyout (side-flyout.mjs). Focus stays on the button while the
// list is open and aria-activedescendant names the active option (group-picker.mjs's openGroupPicker, topnav-search.mjs);
// group labels and sub-lines as cost-dimension-picker.mjs. A project's statuses load on first open through `loadStatuses` (the
// section caches them); a failed load is asked again on the next open or by Try again. Pure DOM; `doc` is injected.
import { icon } from '../icons.mjs';
import { placeFlyout } from '../side-flyout.mjs';

export const FALLBACK_ERROR = 'Worca could not finish that. Try again.';
/** Letters typed within this long make one type-ahead word. */
export const TYPE_AHEAD_MS = 700;
/** The status groups in §9's order, each with its label. */
export const CATEGORY_GROUPS = Object.freeze([
  ['done', (key) => `Done · ${key}'s workflow`], ['in_progress', () => 'In progress'], ['todo', () => 'To do'], ['cancelled', () => 'Cancelled'],
]);
let seq = 0;

/** The words a target shows as. */
export function targetText(target) {
  const t = target || { kind: 'none' };
  if (t.kind === 'category') return 'Any Done status';
  if (t.kind === 'status') return String(t.label || t.value);
  if (t.kind === 'typed') return `${t.value} (as typed)`;
  return "Don't move";
}

/** Two targets are the same choice (a status by its id). */
export function sameTarget(a, b) {
  const ka = (a && a.kind) || 'none';
  const kb = (b && b.kind) || 'none';
  if (ka !== kb) return false;
  return ka === 'status' || ka === 'typed' ? String(a.value) === String(b.value) : true;
}

const keyOf = (t) => `${t.kind}:${t.value ?? ''}`;

/**
 * @param {{doc:Document, project?:string, value?:object|null, general?:boolean, label?:string|null,
 *   loadStatuses?:()=>Array|Promise<Array>, onChange?:(t:object)=>void, host?:Element|null, now?:()=>number}} o
 */
export function createMoveSelect({ doc, project = '', value = null, general = false, label = null, loadStatuses = () => [],
  onChange = () => {}, host = null, now = () => Date.now() }) {
  const uid = `mk-tu-ms${++seq}`;
  const mk = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const name = label || (general ? 'All projects: move to' : `${project}: move to`);
  let current = value || { kind: 'none' };
  let loaded = null;
  let loading = false;
  let failure = null;
  let pop = null;
  let listEl = null;
  let liveEl = null;
  let retry = null;
  let active = null;
  const targets = new Map();   // option element → its target
  let typed = '';
  let typedAt = -Infinity;

  const wrap = mk('div', 'mk-tu-movewrap');
  const lab = mk('span', 'sr-only', name);
  lab.id = `${uid}-label`;
  const btn = mk('button', 'mk-tu-move');
  btn.type = 'button';
  btn.id = uid;
  btn.setAttribute('role', 'combobox');
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', `${uid}-list`);
  btn.setAttribute('aria-labelledby', lab.id);
  const txt = mk('span', 'mk-tu-move-t', targetText(current));
  btn.append(txt, icon(doc, 'chevron', 14, 'ic mk-tu-move-ic'));
  wrap.append(lab, btn);

  const options = () => (listEl ? [...listEl.querySelectorAll('[role="option"]')] : []);
  const titleOf = (o) => (o.querySelector('.mk-tu-opt-t')?.textContent || '').toLowerCase();

  function optionEl(o, i) {
    const n = mk('div', 'mk-tu-opt');
    n.id = `${uid}-o${i}`;
    n.setAttribute('role', 'option');
    const t = o.kind === 'status' ? { kind: 'status', value: o.value, label: o.label, category: o.category }
      : o.kind === 'category' ? { kind: 'category', value: 'done' }
        : o.kind === 'typed' ? { kind: 'typed', value: o.value } : { kind: 'none' };
    targets.set(n, t);
    const selected = sameTarget(t, current);
    n.setAttribute('aria-selected', String(selected));
    const dot = mk('span', `mk-tu-dot mk-tu-dot-${o.kind === 'status' ? o.category : o.kind}`);
    dot.setAttribute('aria-hidden', 'true');
    const body = mk('span', 'mk-tu-opt-b');
    body.append(mk('span', 'mk-tu-opt-t', o.label));
    if (o.sub) body.append(mk('span', 'mk-tu-opt-s', o.sub));
    n.append(dot, body);
    if (selected) n.append(icon(doc, 'check', 14, 'ic mk-tu-opt-check'));
    return n;
  }

  function setActive(o) {
    if (active) active.classList.remove('is-active');
    active = o || null;
    if (active) {
      active.classList.add('is-active');
      btn.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView?.({ block: 'nearest' });
    } else btn.removeAttribute('aria-activedescendant');
  }

  function paintList() {
    const keep = active && targets.has(active) ? keyOf(targets.get(active)) : null;
    targets.clear();
    let i = 0;
    const general2 = [{ kind: 'none', label: "Don't move" }, { kind: 'category', value: 'done', label: 'Any Done status', sub: 'One this ticket can reach' }];
    if (current.kind === 'typed') general2.push({ kind: 'typed', value: String(current.value), label: targetText(current) });
    const nodes = general2.map((o) => optionEl(o, i++));
    if (!general) {
      const sep = mk('div', 'mk-tu-sep');
      sep.setAttribute('role', 'presentation');
      nodes.push(sep);
      for (const [cat, title] of CATEGORY_GROUPS) {
        const items = (loaded || []).filter((s) => s && s.category === cat);
        if (!items.length) continue;
        const g = mk('div', 'mk-tu-group', title(project));
        g.setAttribute('role', 'presentation');
        nodes.push(g, ...items.map((s) => optionEl({ kind: 'status', value: String(s.value), label: String(s.label ?? s.value), category: cat }, i++)));
      }
    }
    listEl.replaceChildren(...nodes);
    const opts = options();
    setActive((keep && opts.find((o) => keyOf(targets.get(o)) === keep))
      || opts.find((o) => o.getAttribute('aria-selected') === 'true') || opts[0] || null);
  }

  function paintState() {
    if (!liveEl) return;
    liveEl.textContent = general ? '' : (failure || (loading ? `Getting ${project}'s statuses…` : ''));
    retry.hidden = general || !failure;
  }

  async function load() {
    loading = true;
    failure = null;
    paintState();
    try {
      const r = await loadStatuses();
      loaded = Array.isArray(r) ? r : [];
    } catch (e) {
      failure = String((e && e.message) || FALLBACK_ERROR);
    }
    loading = false;
    if (pop) { paintList(); paintState(); }
  }

  const onDown = (e) => { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); };

  function open() {
    if (pop) return;
    pop = mk('div', 'mk-tu-pop mk-tu-movepop');
    listEl = mk('div', 'mk-tu-list');
    listEl.id = `${uid}-list`;
    listEl.setAttribute('role', 'listbox');
    listEl.setAttribute('aria-label', general ? name : `${project} statuses`);
    liveEl = mk('p', 'mk-tu-live');
    liveEl.setAttribute('aria-live', 'polite');
    retry = mk('button', 'btn btn-sm mk-tu-retry', 'Try again');
    retry.type = 'button';
    retry.hidden = true;
    retry.addEventListener('click', () => { void load(); btn.focus(); });
    pop.append(listEl, liveEl, retry);
    pop.addEventListener('mousedown', (e) => e.preventDefault());   // a press keeps the focus on the select
    pop.addEventListener('click', (e) => { const o = e.target.closest?.('[role="option"]'); if (o && targets.has(o)) pick(o); });
    (host || doc.body).append(pop);
    btn.setAttribute('aria-expanded', 'true');
    paintList();
    paintState();
    pop.style.minWidth = `${btn.offsetWidth}px`;
    placeFlyout(pop, btn, { mode: 'down', gap: 4, margin: 8, win: doc.defaultView });
    doc.addEventListener('pointerdown', onDown, true);
    if (!general && !loaded && !loading) void load();
  }

  function close() {
    if (!pop) return;
    doc.removeEventListener('pointerdown', onDown, true);
    pop.remove();
    pop = null; listEl = null; liveEl = null; retry = null; active = null;
    targets.clear();
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-activedescendant');
  }

  function pick(o) {
    const t = targets.get(o);
    close();
    btn.focus();
    if (t && !sameTarget(t, current)) {
      current = t;
      txt.textContent = targetText(current);
      onChange(current);
    }
  }

  function typeAhead(ch) {
    const t = now();
    typed = t - typedAt > TYPE_AHEAD_MS ? ch.toLowerCase() : typed + ch.toLowerCase();
    typedAt = t;
    const opts = options();
    if (typed.length > 1 && active && titleOf(active).startsWith(typed)) return;   // a longer word stays while it still matches
    const i = opts.indexOf(active);
    const hit = [...opts.slice(i + 1), ...opts.slice(0, i + 1)].find((o) => titleOf(o).startsWith(typed));
    if (hit) setActive(hit);
  }

  btn.addEventListener('click', () => (pop ? close() : open()));
  btn.addEventListener('keyup', (e) => { if (e.key === ' ') e.preventDefault(); });   // Space never clicks the button too
  btn.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (!pop) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
      return;
    }
    const opts = options();
    const i = opts.indexOf(active);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(opts[Math.min(opts.length - 1, i + 1)] || opts[0]); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(opts[Math.max(0, i - 1)] || opts[0]); return; }
    if (e.key === 'Home') { e.preventDefault(); setActive(opts[0]); return; }
    if (e.key === 'End') { e.preventDefault(); setActive(opts[opts.length - 1]); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (active) pick(active); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); typeAhead(e.key); }
  });

  return {
    el: wrap,
    button: btn,
    get: () => current,
    set(t) { current = t || { kind: 'none' }; txt.textContent = targetText(current); if (pop) paintList(); },
    describe(id) { if (id) btn.setAttribute('aria-describedby', id); else btn.removeAttribute('aria-describedby'); },
    open,
    close,
    isOpen: () => !!pop,
    destroy: close,
  };
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `node tools/test.mjs test/marketplace-move-select.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/public/marketplace/move-select.mjs test/marketplace-move-select.test.mjs
git commit -m "Ticket updates: the move select (board 4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The projects popover (board 3)

D13 and §8, §10 C/D, §11: `label-picker.mjs`'s `openLabelPicker` pattern; not made generic.

**Files:**
- Create: `ui/public/marketplace/projects-popover.mjs`
- Test: create `test/marketplace-projects-popover.test.mjs`

**Interfaces:**
- Consumes: `placeFlyout`.
- Produces: `openProjectsPopover({ doc, anchor, host, profileLabel, tracker, isPicked(value) → boolean, pickedCount() → number, loadProjects() → Promise<[{ value, label, name? }]>, onToggle(project, on), onClose() }) → { el, close }`. Class hooks: `mk-tu-pop`, `mk-tu-projpop`, `mk-tu-search`, `mk-tu-plist`, `mk-tu-prow` (`is-active`), `mk-tu-pcheck`, `mk-tu-key`, `mk-tu-pname`, `mk-tu-live`, `mk-tu-retry`, `mk-tu-pfoot`, `mk-tu-pcount`, `mk-tu-done`.

- [ ] **Step 1: Write the failing test**

Create `test/marketplace-projects-popover.test.mjs`:

```js
// test/marketplace-projects-popover.test.mjs — "Projects you work on" (plans/ticket-updates-design.md board 3, §10 C/D, §11).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { settle, deferred } from './helpers/marketplace-sheet-harness.mjs';
import { openProjectsPopover } from '../ui/public/marketplace/projects-popover.mjs';

const trackDom = useDomRelease(afterEach);
const SIX = [['SHOP', 'Shop'], ['CRM', 'Customer portal'], ['OPS', 'Operations'], ['SUP', 'Support desk'], ['MKT', 'Marketing site'],
  ['DATA', 'Data platform']].map(([value, name]) => ({ value, label: `${name} (${value})`, name }));

function mount({ picked = ['SHOP'], loader = async () => SIX } = {}) {
  const { window } = trackDom(new JSDOM('<!doctype html><body><button id="add" type="button">Add projects…</button><p id="away">x</p></body>',
    { url: 'http://localhost/' }));
  const doc = window.document;
  const set = new Set(picked);
  const toggles = [];
  let closed = 0;
  const anchor = doc.getElementById('add');
  const pop = openProjectsPopover({ doc, anchor, profileLabel: 'Acme', tracker: 'Jira', isPicked: (v) => set.has(v), pickedCount: () => set.size,
    loadProjects: loader, onToggle: (p, on) => { toggles.push([p.value, on]); if (on) set.add(p.value); else set.delete(p.value); },
    onClose: () => { closed += 1; } });
  const $ = (s) => doc.querySelector(s);
  const rows = () => [...doc.querySelectorAll('.mk-tu-prow')];
  const row = (v) => rows().find((r) => r.dataset.value === v);
  const q = () => $('.mk-tu-search');
  const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const type = (text) => { q().value = text; q().dispatchEvent(new window.Event('input', { bubbles: true })); };
  return { window, doc, pop, anchor, toggles, closed: () => closed, $, rows, row, q, key, type };
}

test('board 3: a dialog with the search, the multi-select listbox "Jira projects" of checkbox rows, the footer and Done', async () => {
  const m = mount();
  await settle();
  const dlg = m.$('.mk-tu-projpop');
  assert.deepEqual([dlg.getAttribute('role'), dlg.getAttribute('aria-label')], ['dialog', 'Projects you work on']);
  assert.equal(m.doc.activeElement, m.q(), 'the focus is in the search box');
  assert.equal(m.q().placeholder, 'Find a project by key or name');
  assert.equal(m.doc.querySelector(`label[for="${m.q().id}"]`).textContent, 'Find a project');
  const list = m.$('.mk-tu-plist');
  assert.deepEqual([list.getAttribute('role'), list.getAttribute('aria-multiselectable'), list.getAttribute('aria-label')], ['listbox', 'true', 'Jira projects']);
  assert.deepEqual(m.rows().map((r) => [r.getAttribute('role'), r.querySelector('.mk-tu-key').textContent, r.querySelector('.mk-tu-pname').textContent]),
    SIX.map((p) => ['option', p.value, p.name]));
  assert.deepEqual(m.rows().map((r) => [r.getAttribute('aria-selected'), r.querySelector('input[type="checkbox"]').checked]),
    [['true', true], ...Array(5).fill(['false', false])]);
  assert.equal(m.$('.mk-tu-pcount').textContent, '1 picked · 6 projects on Acme');
  assert.equal(m.$('.mk-tu-done').textContent, 'Done');
});

test('toggles apply at once and the popover stays open; None picked; the search finds by key or name', async () => {
  const m = mount();
  await settle();
  m.row('CRM').querySelector('input').click();
  assert.deepEqual(m.toggles, [['CRM', true]]);
  assert.equal(m.row('CRM').getAttribute('aria-selected'), 'true');
  assert.equal(m.$('.mk-tu-pcount').textContent, '2 picked · 6 projects on Acme');
  m.row('SHOP').querySelector('input').click();
  m.row('CRM').querySelector('input').click();
  assert.equal(m.$('.mk-tu-pcount').textContent, 'None picked · 6 projects on Acme');
  assert.ok(m.$('.mk-tu-projpop'), 'still open');
  m.type('cust');
  assert.deepEqual(m.rows().map((r) => r.dataset.value), ['CRM']);
  m.type('ops');
  assert.deepEqual(m.rows().map((r) => r.dataset.value), ['OPS']);
  m.type('zzz');
  assert.deepEqual([m.rows().length, m.$('.mk-tu-live').textContent], [0, 'No project matches.']);
});

test('keyboard (§11): ↑ ↓ move the active row; Enter on the search toggles it; Esc closes and focuses Add projects…', async () => {
  const m = mount();
  await settle();
  m.key(m.q(), 'ArrowDown');
  assert.equal(m.doc.getElementById(m.q().getAttribute('aria-activedescendant')).dataset.value, 'SHOP');
  m.key(m.q(), 'ArrowDown');
  assert.equal(m.doc.getElementById(m.q().getAttribute('aria-activedescendant')).dataset.value, 'CRM');
  assert.equal(m.key(m.q(), 'Enter'), false);
  assert.deepEqual(m.toggles, [['CRM', true]]);
  m.row('OPS').querySelector('input').focus();
  m.key(m.row('OPS').querySelector('input'), 'ArrowDown');
  assert.equal(m.doc.activeElement, m.row('SUP').querySelector('input'), '↓ on a row moves to the next row');
  assert.equal(m.key(m.doc.activeElement, 'Escape'), false);
  assert.deepEqual([m.$('.mk-tu-projpop'), m.doc.activeElement, m.closed()], [null, m.anchor, 1]);
});

test("C: \"Getting Acme's projects…\" while they load; D: A6's sentence and Try again", async () => {
  const slow = deferred();
  let n = 0;
  const m = mount({ loader: () => { n += 1; if (n === 1) return slow.p; if (n === 2) return Promise.reject(new Error('Worca could not reach Jira: the API token was refused.')); return Promise.resolve(SIX); } });
  assert.deepEqual([m.$('.mk-tu-live').textContent, m.$('.mk-tu-live').getAttribute('aria-live'), m.$('.mk-tu-pcount').textContent],
    ["Getting Acme's projects…", 'polite', '']);
  slow.resolve(Promise.reject(new Error('Worca could not reach Jira: the API token was refused.')));
  await settle();
  assert.deepEqual([m.$('.mk-tu-live').textContent, m.$('.mk-tu-retry').hidden], ['Worca could not reach Jira: the API token was refused.', false]);
  m.$('.mk-tu-retry').click();
  await settle();
  assert.equal(m.$('.mk-tu-live').textContent, 'Worca could not reach Jira: the API token was refused.');
  m.$('.mk-tu-retry').click();
  await settle();
  assert.deepEqual([m.rows().length, m.$('.mk-tu-live').textContent, m.$('.mk-tu-retry').hidden], [6, '', true]);
});

test('Done and a press outside close it and focus Add projects…', async () => {
  let m = mount();
  await settle();
  m.$('.mk-tu-done').click();
  assert.deepEqual([m.$('.mk-tu-projpop'), m.doc.activeElement, m.closed()], [null, m.anchor, 1]);
  m = mount();
  await settle();
  m.doc.getElementById('away').dispatchEvent(new m.window.MouseEvent('pointerdown', { bubbles: true }));
  assert.deepEqual([m.$('.mk-tu-projpop'), m.doc.activeElement, m.closed()], [null, m.anchor, 1]);
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node tools/test.mjs test/marketplace-projects-popover.test.mjs`
Expected: FAIL — `Cannot find module '…/ui/public/marketplace/projects-popover.mjs'`.

- [ ] **Step 3: Implement**

Create `ui/public/marketplace/projects-popover.mjs`:

```js
// ui/public/marketplace/projects-popover.mjs — "Projects you work on" (plans/ticket-updates-design.md §8 board 3, §10 C/D, §11).
// label-picker.mjs's openLabelPicker pattern: a search box over a multi-select listbox of checkbox rows that stays open across
// toggles. Toggles apply at once (onToggle); Done, Esc or a press outside closes it and focuses the anchor (Add projects…).
// The focus starts in the search box; ↑ ↓ there move the active row and Enter toggles it; on a row ↑ ↓ move between rows and
// Space toggles it (a checkbox). Pure DOM; `doc` is injected.
import { placeFlyout } from '../side-flyout.mjs';

export const FALLBACK_ERROR = 'Worca could not finish that. Try again.';
let seq = 0;
const nameOf = (p) => String(p.name || p.label || p.value);

/**
 * @param {{doc:Document, anchor:HTMLElement, host?:Element|null, profileLabel:string, tracker:string, isPicked:(v:string)=>boolean,
 *   pickedCount:()=>number, loadProjects:()=>Promise<Array<{value:string,label:string,name?:string}>>, onToggle:(p:object, on:boolean)=>void,
 *   onClose?:()=>void}} o
 * @returns {{el:HTMLElement, close:()=>void}}
 */
export function openProjectsPopover({ doc, anchor, host = null, profileLabel, tracker, isPicked, pickedCount, loadProjects, onToggle, onClose = () => {} }) {
  const uid = `mk-tu-pp${++seq}`;
  const mk = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let all = null;
  let failure = null;
  let active = null;
  let open = true;

  const el = mk('div', 'mk-tu-pop mk-tu-projpop');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Projects you work on');
  const lab = mk('label', 'sr-only', 'Find a project');
  lab.htmlFor = `${uid}-q`;
  const q = mk('input', 'input mk-tu-search');
  q.type = 'search';
  q.id = `${uid}-q`;
  q.placeholder = 'Find a project by key or name';
  q.autocomplete = 'off';
  q.setAttribute('aria-controls', `${uid}-list`);
  const listEl = mk('div', 'mk-tu-plist');
  listEl.id = `${uid}-list`;
  listEl.setAttribute('role', 'listbox');
  listEl.setAttribute('aria-multiselectable', 'true');
  listEl.setAttribute('aria-label', `${tracker} projects`);
  const live = mk('p', 'mk-tu-live');
  live.setAttribute('aria-live', 'polite');
  const retry = mk('button', 'btn btn-sm mk-tu-retry', 'Try again');
  retry.type = 'button';
  retry.hidden = true;
  const foot = mk('div', 'mk-tu-pfoot');
  const count = mk('span', 'mk-tu-pcount');
  const done = mk('button', 'btn btn-sm btn-primary mk-tu-done', 'Done');
  done.type = 'button';
  foot.append(count, done);
  el.append(lab, q, listEl, live, retry, foot);

  const rows = () => [...listEl.querySelectorAll('.mk-tu-prow')];
  function paintFoot() {
    const n = pickedCount();
    count.textContent = all ? `${n ? `${n} picked` : 'None picked'} · ${all.length} projects on ${profileLabel}` : '';
  }
  function setActive(r) {
    if (active) active.classList.remove('is-active');
    active = r || null;
    if (active) { active.classList.add('is-active'); q.setAttribute('aria-activedescendant', active.id); active.scrollIntoView?.({ block: 'nearest' }); }
    else q.removeAttribute('aria-activedescendant');
  }
  function rowFor(p, i) {
    const r = mk('label', 'mk-tu-prow');
    r.id = `${uid}-r${i}`;
    r.setAttribute('role', 'option');
    r.dataset.value = String(p.value);
    const on = isPicked(String(p.value));
    r.setAttribute('aria-selected', String(on));
    const box = mk('input', 'mk-tu-pcheck');
    box.type = 'checkbox';
    box.checked = on;
    box.addEventListener('change', () => {
      r.setAttribute('aria-selected', String(box.checked));
      onToggle(p, box.checked);
      paintFoot();
    });
    r.append(box, mk('span', 'mk-mono mk-tu-key', String(p.value)), mk('span', 'mk-tu-pname', nameOf(p)));
    return r;
  }
  function paint() {
    const keep = active ? active.dataset.value : null;
    const s = q.value.trim().toLowerCase();
    const shown = (all || []).filter((p) => !s || String(p.value).toLowerCase().includes(s) || nameOf(p).toLowerCase().includes(s));
    listEl.replaceChildren(...shown.map(rowFor));
    active = null;
    setActive(keep ? rows().find((r) => r.dataset.value === keep) : null);
    live.textContent = failure || (!all ? `Getting ${profileLabel}'s projects…` : (!shown.length ? 'No project matches.' : ''));
    retry.hidden = !failure;
    paintFoot();
  }
  async function load() {
    failure = null;
    paint();
    try { const r = await loadProjects(); all = Array.isArray(r) ? r : []; }
    catch (e) { failure = String((e && e.message) || FALLBACK_ERROR); }
    if (open) paint();
  }

  function close() {
    if (!open) return;
    open = false;
    doc.removeEventListener('pointerdown', onDown, true);
    el.remove();
    onClose();
    if (anchor && anchor.isConnected) anchor.focus();
  }
  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };

  q.addEventListener('input', paint);
  q.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const list = rows();
    const i = list.indexOf(active);
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(list[Math.min(list.length - 1, i + 1)] || null); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(list[Math.max(0, i - 1)] || null); }
    else if (e.key === 'Enter') { e.preventDefault(); active?.querySelector('.mk-tu-pcheck')?.click(); }
  });
  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const boxes = rows().map((r) => r.querySelector('.mk-tu-pcheck'));
    const i = boxes.indexOf(doc.activeElement);
    if (i < 0) return;
    e.preventDefault();
    boxes[e.key === 'ArrowDown' ? Math.min(boxes.length - 1, i + 1) : Math.max(0, i - 1)].focus();
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  retry.addEventListener('click', () => { void load(); q.focus(); });
  done.addEventListener('click', () => close());

  (host || doc.body).append(el);
  placeFlyout(el, anchor, { mode: 'down', gap: 4, margin: 8, win: doc.defaultView });
  doc.addEventListener('pointerdown', onDown, true);
  q.focus();
  void load();
  return { el, close };
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `node tools/test.mjs test/marketplace-projects-popover.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/public/marketplace/projects-popover.mjs test/marketplace-projects-popover.test.mjs
git commit -m "Ticket updates: the projects popover (board 3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The section: header, states A and B, the projects you work on, the rules

Boards 1, 3, 4 and 5 A/B; D2 (a removed project keeps its rule), D4 (carried over, not dirty), D12 (the sheet's Save takes `body()`).

**Files:**
- Create: `ui/public/marketplace/ticket-updates-section.mjs`, `test/helpers/ticket-updates-fixtures.mjs`
- Test: create `test/marketplace-ticket-updates.test.mjs`

**Interfaces:**
- Consumes: `createMoveSelect`, `FALLBACK_ERROR` (Task 12); `openProjectsPopover` (Task 13); the GET, projects and statuses routes (Task 5).
- Produces:
  - `createTicketUpdates({ doc, api, plugin, sourceId, profile, tracker, popHost }) → { el, load(), dirty(), body(), markSaved(sent), legacyField(), destroy() }`
  - `load() → Promise<{ available: false } | { available: true, saved: boolean, connection: 'saved'|'new', legacyField: string|null }>`
  - `body() → { sourceId, profile?, projects: [{ value, label }], rules: [{ project, label?, moment: 'finished', target }] }` (a new row without a project is left out)
  - `markSaved(sent)`: `sent` is what `body()` gave; the section is clean and the carried-over note goes.
  - `TU_COPY`, `notSavedLine(tracker)`, `STATUS_LOADS = 4` (used in Task 15), `goneLine(key, name)` (Task 15).
  - Class hooks: `mk-tu`, `mk-tu-head`, `mk-tu-new`, `mk-tu-sub`, `mk-tu-block`, `mk-tu-projects`, `mk-tu-h`, `mk-tu-chiprow`, `mk-tu-chips`, `mk-tu-chip`, `mk-tu-key`, `mk-tu-cname`, `mk-tu-x`, `mk-tu-add-projects`, `mk-tu-carried`, `mk-tu-rulesblock`, `mk-tu-rules`, `mk-tu-rule`, `mk-tu-all`, `mk-tu-newrow`, `mk-tu-name`, `mk-tu-rname`, `mk-tu-rsub`, `mk-tu-pwrap`, `mk-tu-project`, `mk-tu-remove`, `mk-tu-add-rule`, `mk-tu-add-hint`, `mk-tu-newrow-hint`, `mk-tu-hint`.
  - Invented copy (not on the boards): the new row's move select label "New rule: move to"; the new row's project select placeholder is its label, "Project".

- [ ] **Step 1: Write the failing test**

Create `test/helpers/ticket-updates-fixtures.mjs`:

```js
// test/helpers/ticket-updates-fixtures.mjs — Ticket updates' screen data (plans/ticket-updates-design.md boards 1–5) as the routes
// answer it: the GET answers, board 3's projects, board 4's statuses; for the jsdom section and manage-sheet tests.
import { ok } from './marketplace-sheet-harness.mjs';

export const TU = '/api/plugins/jira-source/ticket-updates';
export const TU_Q = '?sourceId=jira&profile=acme';
export const PROJECTS = [['SHOP', 'Shop'], ['CRM', 'Customer portal'], ['OPS', 'Operations'], ['SUP', 'Support desk'], ['MKT', 'Marketing site'],
  ['DATA', 'Data platform']].map(([value, name]) => ({ value, label: `${name} (${value})`, name }));
export const CRM_STATUSES = [{ value: '10001', label: 'Done', category: 'done' }, { value: '10002', label: 'Released', category: 'done' },
  { value: '3', label: 'In Progress', category: 'in_progress' }, { value: '10003', label: 'Waiting for customer', category: 'in_progress' },
  { value: '1', label: 'Open', category: 'todo' }, { value: '10004', label: "Won't Fix", category: 'cancelled' }];
export const SHOP_STATUSES = [...CRM_STATUSES.slice(0, 2), { value: '10012', label: 'Resolved', category: 'done' }, ...CRM_STATUSES.slice(2)];
export const RESOLVED = { kind: 'status', value: '10012', label: 'Resolved', category: 'done' };
export const LEGACY = { field: 'transitionOnComplete', label: 'Transition on completion', target: null };
export const ALL_DONE = { project: '', moment: 'finished', target: { kind: 'category', value: 'done' } };
export const SHOP_RULE = { project: 'SHOP', label: 'Shop', moment: 'finished', target: RESOLVED };
export const tuGet = (over = {}) => ({ available: true, connection: 'saved', profile: { id: 'acme', label: 'Acme' }, saved: false, projects: [], rules: [],
  legacy: LEGACY, ...over });
export const SAVED = tuGet({ saved: true, projects: [{ value: 'SHOP', label: 'Shop' }, { value: 'CRM', label: 'Customer portal' }],
  rules: [ALL_DONE, SHOP_RULE, { project: 'CRM', label: 'Customer portal', moment: 'finished', target: { kind: 'none' } }] });
/** The harness routes for one profile (acme): the GET answer, the projects, each project's statuses; `more` overrides. */
export function tuRoutes(get = SAVED, more = {}) {
  const r = { [`GET ${TU}${TU_Q}`]: ok(get), [`GET ${TU}/projects${TU_Q}`]: ok({ projects: PROJECTS }) };
  for (const p of PROJECTS) r[`GET ${TU}/statuses${TU_Q}&project=${p.value}`] = ok({ statuses: p.value === 'SHOP' ? SHOP_STATUSES : CRM_STATUSES });
  return { ...r, ...more };
}
```

Create `test/marketplace-ticket-updates.test.mjs`:

```js
// test/marketplace-ticket-updates.test.mjs — Ticket updates in the manage sheet (plans/ticket-updates-design.md boards 1, 3, 4,
// 5 A–E; D2, D4, D12; §10, §11): the section on its own, then (Task 16) inside the manage sheet.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { sheetHarness, ok, fail, settle, deferred } from './helpers/marketplace-sheet-harness.mjs';
import { createTicketUpdates } from '../ui/public/marketplace/ticket-updates-section.mjs';
import { TU, TU_Q, RESOLVED, LEGACY, ALL_DONE, SHOP_RULE, tuGet, SAVED, tuRoutes } from './helpers/ticket-updates-fixtures.mjs';

const trackDom = useDomRelease(afterEach);
async function section(routes = tuRoutes()) {
  const h = sheetHarness({ trackDom, routes });
  const tu = createTicketUpdates({ doc: h.doc, api: h.deps.api, plugin: 'jira-source', sourceId: 'jira', profile: 'acme', tracker: 'Jira' });
  h.doc.body.append(tu.el);
  const info = await tu.load();
  await settle();
  const $ = (s) => tu.el.querySelector(s);
  const $$ = (s) => [...tu.el.querySelectorAll(s)];
  const rows = () => $$('.mk-tu-rule');
  const rowFor = (key) => rows().find((r) => r.dataset.project === key);
  const pick = (value) => h.doc.querySelector(`.mk-tu-prow[data-value="${value}"] input`).click();
  return { ...h, tu, info, $, $$, rows, rowFor, pick };
}
const statusCalls = (m, key) => m.calls.filter((c) => c[1] === `${TU}/statuses${TU_Q}&project=${key}`).length;

test('board 1: a saved connection: header and meta, the projects as chips, the rules list; not dirty', async () => {
  const m = await section();
  assert.deepEqual(m.info, { available: true, saved: true, connection: 'saved', legacyField: 'transitionOnComplete' });
  const head = m.doc.getElementById(m.tu.el.getAttribute('aria-labelledby'));
  assert.deepEqual([m.tu.el.tagName, head.textContent, m.$('.mk-tu-head .mk-meta').textContent], ['SECTION', 'Ticket updates', 'Acme (acme)']);
  assert.equal(m.$('.mk-tu-sub').textContent, "What Worca does to a ticket when a run that writes back finishes. A project's own rule wins over All projects.");
  assert.deepEqual(m.$$('.mk-tu-h').map((n) => n.textContent), ['Projects you work on', 'When a run finishes successfully']);
  assert.deepEqual(m.$$('.mk-tu-chip').map((c) => [c.getAttribute('role'), c.querySelector('.mk-tu-key').textContent, c.querySelector('.mk-tu-cname').textContent,
    c.querySelector('.mk-tu-x').getAttribute('aria-label')]), [['listitem', 'SHOP', 'Shop', 'Remove SHOP'], ['listitem', 'CRM', 'Customer portal', 'Remove CRM']]);
  assert.equal(m.$('.mk-tu-add-projects').textContent, 'Add projects…');
  assert.ok(m.$$('.mk-tu-projects .hint').some((n) => n.textContent === 'New run, Requirements export and import list only these. None picked = all projects.'));
  assert.equal(m.$('.mk-tu-rules').getAttribute('role'), 'list');
  assert.deepEqual(m.rows().map((r) => [r.getAttribute('role'), r.querySelector('.mk-tu-key, .mk-tu-rname').textContent,
    r.querySelector('.mk-tu-move').textContent, r.querySelector('.mk-tu-remove')?.getAttribute('aria-label') ?? null]),
  [['listitem', 'All projects', 'Any Done status', null], ['listitem', 'SHOP', 'Resolved', 'Remove the SHOP rule'], ['listitem', 'CRM', "Don't move", 'Remove the CRM rule']]);
  assert.equal(m.rows()[0].querySelector('.mk-tu-rsub').textContent, 'Unless a project below says otherwise');
  assert.equal(m.doc.getElementById(m.rowFor('SHOP').querySelector('.mk-tu-move').getAttribute('aria-labelledby')).textContent, 'SHOP: move to');
  assert.equal(m.$('.mk-tu-add-rule').textContent, 'Add a project rule');
  assert.equal(m.$('.mk-tu-hint').textContent, "Any Done status: one the ticket can reach, never Won't Do, Rejected or Duplicate. When a move asks for a Resolution, Worca fills in Done, Fixed or Complete. Every update is the last line of Worca's comment on the ticket.");
  assert.equal(m.$('.mk-tu-carried'), null);
  assert.equal(m.tu.dirty(), false);
});

test('board 5 A: a connection not saved yet shows only the line; nothing else is asked', async () => {
  const m = await section(tuRoutes(tuGet({ connection: 'new', legacy: null })));
  assert.equal(m.info.connection, 'new');
  assert.deepEqual([...m.tu.el.children].map((n) => n.className), ['mk-sec-head mk-tu-head', 'hint mk-tu-new']);
  assert.equal(m.$('.mk-tu-new').textContent, "Save this connection first. Ticket updates read Jira's projects and statuses through it.");
  assert.deepEqual(m.calls.map((c) => `${c[0]} ${c[1]}`), [`GET ${TU}${TU_Q}`]);
  assert.equal(m.tu.dirty(), false);
});

test('not available (no capability, or the GET failed): the section stays hidden', async () => {
  let m = await section(tuRoutes(tuGet({ available: false })));
  assert.deepEqual([m.info, m.tu.el.hidden], [{ available: false }, true]);
  m = await section(tuRoutes(SAVED, { [`GET ${TU}${TU_Q}`]: fail(502, { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' }) }));
  assert.deepEqual([m.info, m.tu.el.hidden], [{ available: false }, true]);
});

test('board 5 B: carried over: filled in, the note above the rules, not dirty until a change; Save sends it as shown', async () => {
  let m = await section(tuRoutes(tuGet({ legacy: { ...LEGACY, target: { typed: 'Resolve' } } })));
  assert.equal(m.rows()[0].querySelector('.mk-tu-move').textContent, 'Resolve (as typed)');
  const note = m.$('.mk-tu-carried');
  assert.equal(note.textContent, 'Filled in from the old Transition on completion setting. Nothing changes until you save; after that, the old setting is no longer used.');
  assert.equal(note.querySelector('strong').textContent, 'Transition on completion');
  assert.ok(note.compareDocumentPosition(m.$('.mk-tu-rules')) & 4, 'the note sits above the rules');
  assert.equal(m.tu.dirty(), false, 'closing the sheet asks nothing');
  m.$('.mk-tu-add-projects').click();
  await settle();
  m.pick('SHOP');
  assert.equal(m.tu.dirty(), true);
  const body = m.tu.body();
  assert.deepEqual(body, { sourceId: 'jira', profile: 'acme', projects: [{ value: 'SHOP', label: 'Shop' }],
    rules: [{ project: '', moment: 'finished', target: { kind: 'typed', value: 'Resolve' } }] }, 'the All projects row as shown, typed value included');
  m.tu.markSaved(body);
  assert.deepEqual([m.tu.dirty(), m.$('.mk-tu-carried')], [false, null]);
  m = await section(tuRoutes(tuGet({ legacy: { ...LEGACY, target: { category: 'done' } } })));
  assert.equal(m.rows()[0].querySelector('.mk-tu-move').textContent, 'Any Done status');
  m = await section(tuRoutes(tuGet()));
  assert.deepEqual([m.rows()[0].querySelector('.mk-tu-move').textContent, m.$('.mk-tu-carried')], ["Don't move", null]);
});

test('D2: removing a project keeps its rule; focus goes to Add projects…', async () => {
  const m = await section();
  m.$('.mk-tu-chip[data-value="SHOP"] .mk-tu-x').click();
  assert.deepEqual(m.$$('.mk-tu-chip').map((c) => c.dataset.value), ['CRM']);
  assert.equal(m.doc.activeElement, m.$('.mk-tu-add-projects'));
  assert.equal(m.tu.dirty(), true);
  const body = m.tu.body();
  assert.deepEqual(body.projects, [{ value: 'CRM', label: 'Customer portal' }]);
  assert.deepEqual(body.rules.map((r) => r.project), ['', 'SHOP', 'CRM'], 'a choice is never dropped silently');
});

test('board 3 from the section: a toggle adds a chip at once; the footer counts the picks', async () => {
  const m = await section();
  m.$('.mk-tu-add-projects').click();
  await settle();
  assert.equal(m.doc.querySelector('.mk-tu-pcount').textContent, '2 picked · 6 projects on Acme');
  m.pick('OPS');
  assert.deepEqual(m.$$('.mk-tu-chip').map((c) => [c.dataset.value, c.querySelector('.mk-tu-cname').textContent]),
    [['SHOP', 'Shop'], ['CRM', 'Customer portal'], ['OPS', 'Operations']]);
  assert.equal(m.doc.querySelector('.mk-tu-pcount').textContent, '3 picked · 6 projects on Acme');
  m.$('.mk-tu-add-projects').click();
  assert.equal(m.doc.querySelector('.mk-tu-projpop'), null, 'a second press closes it');
});

test('board 4: Add a project rule: a Project select of the projects you work on without a rule; the move starts at Any Done status', async () => {
  const m = await section();
  assert.deepEqual([m.$('.mk-tu-add-rule').disabled, m.$('.mk-tu-add-hint').hidden, m.$('.mk-tu-add-hint').textContent],
    [true, false, 'Every project you work on has a rule.'], 'SHOP and CRM have rules');
  assert.equal(m.$('.mk-tu-add-rule').getAttribute('aria-describedby'), m.$('.mk-tu-add-hint').id);
  m.$('.mk-tu-add-projects').click();
  await settle();
  m.pick('OPS');
  m.doc.querySelector('.mk-tu-done').click();
  assert.deepEqual([m.$('.mk-tu-add-rule').disabled, m.$('.mk-tu-add-hint').hidden], [false, true]);
  m.$('.mk-tu-add-rule').click();
  await settle();
  const row = m.rows().at(-1);
  const sel = row.querySelector('select.mk-tu-project');
  assert.equal(m.doc.activeElement, sel);
  assert.equal(sel.getAttribute('aria-label'), 'Project');
  assert.deepEqual([...sel.options].map((o) => [o.value, o.textContent, o.disabled]), [['', 'Project', true], ['OPS', 'OPS — Operations', false]]);
  assert.equal(row.querySelector('.mk-tu-move').textContent, 'Any Done status');
  assert.equal(m.doc.getElementById(row.querySelector('.mk-tu-move').getAttribute('aria-labelledby')).textContent, 'New rule: move to');
  assert.equal(row.querySelector('.mk-tu-remove').getAttribute('aria-label'), 'Remove the new rule');
  assert.equal(m.$('.mk-tu-newrow-hint').hidden, false);
  assert.equal(m.$('.mk-tu-newrow-hint').textContent, 'A project rule lists that project\'s own statuses. The project list is the projects you work on (all projects when none are picked).');
  assert.deepEqual(m.tu.body().rules.length, 3, 'a row without a project is not sent');
  sel.value = 'OPS';
  sel.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  const ops = m.rowFor('OPS');
  assert.deepEqual([ops.querySelector('.mk-tu-key').textContent, ops.querySelector('.mk-tu-rname').textContent, ops.querySelector('.mk-tu-move').textContent],
    ['OPS', 'Operations', 'Any Done status']);
  assert.equal(m.doc.activeElement, ops.querySelector('.mk-tu-move'));
  assert.deepEqual(m.tu.body().rules.at(-1), { project: 'OPS', label: 'Operations', moment: 'finished', target: { kind: 'category', value: 'done' } });
  assert.equal(m.$('.mk-tu-newrow-hint').hidden, true);
});

test('none picked: the new row lists all projects (loaded once), minus those with a rule', async () => {
  const m = await section(tuRoutes(tuGet({ saved: true, rules: [ALL_DONE, SHOP_RULE] })));
  m.$('.mk-tu-add-rule').click();
  const sel = m.rows().at(-1).querySelector('select.mk-tu-project');
  assert.deepEqual([...sel.options].map((o) => o.textContent), ["Getting Acme's projects…"]);
  await settle();
  assert.deepEqual([...sel.options].map((o) => o.value), ['', 'CRM', 'OPS', 'SUP', 'MKT', 'DATA']);
  assert.equal(m.calls.filter((c) => c[1] === `${TU}/projects${TU_Q}`).length, 1);
});

test('removing a rule: the row goes, focus to Add a project rule', async () => {
  const m = await section();
  m.rowFor('CRM').querySelector('.mk-tu-remove').click();
  assert.equal(m.rowFor('CRM'), undefined);
  assert.equal(m.doc.activeElement, m.$('.mk-tu-add-rule'));
  assert.deepEqual(m.tu.body().rules.map((r) => r.project), ['', 'SHOP']);
});

test("picking a status: the project's statuses load once per opening; the body takes its id, name and category; markSaved cleans", async () => {
  const m = await section();
  const btn = m.rowFor('SHOP').querySelector('.mk-tu-move');
  btn.click();
  await settle();
  [...m.doc.querySelectorAll('.mk-tu-movepop [role="option"]')].find((o) => o.textContent === 'Done').click();
  assert.equal(btn.textContent, 'Done');
  btn.click();
  await settle();
  btn.click();
  assert.equal(statusCalls(m, 'SHOP'), 1);
  const body = m.tu.body();
  assert.deepEqual(body.rules[1].target, { kind: 'status', value: '10001', label: 'Done', category: 'done' });
  assert.equal(m.tu.dirty(), true);
  m.tu.markSaved(body);
  assert.equal(m.tu.dirty(), false);
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node tools/test.mjs test/marketplace-ticket-updates.test.mjs`
Expected: FAIL — `Cannot find module '…/ui/public/marketplace/ticket-updates-section.mjs'`.

- [ ] **Step 3: Implement**

Create `ui/public/marketplace/ticket-updates-section.mjs`:

```js
// ui/public/marketplace/ticket-updates-section.mjs — Ticket updates in the manage sheet (plans/ticket-updates-design.md §8 boards
// 1–6, §10, §11; D2, D4, D12). Host-drawn: every tracker read goes through the server's /api/plugins/:name/ticket-updates
// routes (D8). The sheet owns Save: this module says when it is dirty, hands over the PUT body and takes the saved state
// back. Removing a project from Projects you work on keeps its rule (D2). Pure DOM; `doc` and `api` are injected.
import { icon } from '../icons.mjs';
import { createMoveSelect, FALLBACK_ERROR } from './move-select.mjs';
import { openProjectsPopover } from './projects-popover.mjs';

/** How many projects' statuses load at once when the section opens, to find a status that is gone (§8, board 5 E). */
export const STATUS_LOADS = 4;
export const TU_COPY = Object.freeze({
  title: 'Ticket updates',
  sub: "What Worca does to a ticket when a run that writes back finishes. A project's own rule wins over All projects.",
  projects: 'Projects you work on',
  addProjects: 'Add projects…',
  projectsHint: 'New run, Requirements export and import list only these. None picked = all projects.',
  rules: 'When a run finishes successfully',
  all: 'All projects',
  allSub: 'Unless a project below says otherwise',
  addRule: 'Add a project rule',
  allHaveRules: 'Every project you work on has a rule.',
  newRowHint: "A project rule lists that project's own statuses. The project list is the projects you work on (all projects when none are picked).",
  hint: "Any Done status: one the ticket can reach, never Won't Do, Rejected or Duplicate. When a move asks for a Resolution, Worca fills in Done, Fixed or Complete. Every update is the last line of Worca's comment on the ticket.",
  newRuleLabel: 'New rule: move to',
  project: 'Project',
});
export const notSavedLine = (tracker) => `Save this connection first. Ticket updates read ${tracker}'s projects and statuses through it.`;
export const goneLine = (key, name) => `${key} has no status named ${name} any more. Pick another; until then a run leaves ${key} tickets where they are and says so in its comment.`;

const list = (v) => (Array.isArray(v) ? v : []);
const fromLegacy = (t) => (t && t.category === 'done' ? { kind: 'category', value: 'done' }
  : t && typeof t.typed === 'string' && t.typed ? { kind: 'typed', value: t.typed } : null);

/**
 * @param {{doc:Document, api:(m:string,u:string,b?:object)=>Promise<{ok:boolean,status:number,data:any}>, plugin:string, sourceId:string,
 *   profile?:string|null, tracker?:string, popHost?:Element|null}} o
 */
export function createTicketUpdates({ doc, api, plugin, sourceId, profile = null, tracker = 'the tracker', popHost = null }) {
  const mk = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const enc = encodeURIComponent;
  const base = `/api/plugins/${enc(plugin)}/ticket-updates`;
  const query = `sourceId=${enc(sourceId)}${profile ? `&profile=${enc(profile)}` : ''}`;
  const sid = String(sourceId).replace(/[^A-Za-z0-9_-]/g, '-');
  const el = mk('section', 'mk-tu');
  el.hidden = true;
  el.dataset.sourceId = sourceId;
  let info = null;           // the GET answer
  let projects = [];         // [{ value, label }] picked, in pick order
  let rules = [];            // [{ uid, project, label, target }]: All projects (project '') first; project null = a new row
  let baseline = '';
  let destroyed = false;
  let popover = null;
  let seq = 0;
  const selects = new Map(); // rule uid → its move select
  const statusCache = new Map();
  let projectsPromise = null;
  const refs = {};
  const uid = () => `mk-tu-${sid}-r${++seq}`;
  const profileLabel = () => (info && info.profile ? info.profile.label : tracker);
  const legacyField = () => (info && info.legacy && info.legacy.field) || null;

  // ---- reads, once per sheet opening; a failed one is asked again next time (§10 D) ----
  function statuses(key) {
    if (!key) return Promise.resolve([]);
    if (!statusCache.has(key)) {
      const p = api('GET', `${base}/statuses?${query}&project=${enc(key)}`).then((r) => {
        if (r?.ok) return list(r.data?.statuses);
        throw new Error(r?.data?.error || FALLBACK_ERROR);
      });
      p.catch(() => { if (statusCache.get(key) === p) statusCache.delete(key); });
      statusCache.set(key, p);
    }
    return statusCache.get(key);
  }
  function projectList() {
    if (!projectsPromise) {
      const p = api('GET', `${base}/projects?${query}`).then((r) => {
        if (r?.ok) return list(r.data?.projects);
        throw new Error(r?.data?.error || FALLBACK_ERROR);
      });
      p.catch(() => { if (projectsPromise === p) projectsPromise = null; });
      projectsPromise = p;
    }
    return projectsPromise;
  }

  // ---- what Save sends (D12) ----
  function collect() {
    return {
      projects: projects.map(({ value, label }) => ({ value, label })),
      rules: rules.filter((r) => r.project !== null).map((r) => (r.project
        ? { project: r.project, label: r.label, moment: 'finished', target: r.target }
        : { project: '', moment: 'finished', target: r.target })),
    };
  }

  // ---- projects you work on ----
  function renderChips() {
    refs.chips.replaceChildren(...projects.map((p) => {
      const c = mk('span', 'chip mk-tu-chip');
      c.setAttribute('role', 'listitem');
      c.dataset.value = p.value;
      c.append(mk('span', 'mk-mono mk-tu-key', p.value));
      if (p.label && p.label !== p.value) c.append(mk('span', 'mk-tu-cname', p.label));
      const x = mk('button', 'mk-tu-x');
      x.type = 'button';
      x.setAttribute('aria-label', `Remove ${p.value}`);
      x.append(icon(doc, 'x', 12));
      x.addEventListener('click', () => {
        projects = projects.filter((y) => y.value !== p.value);   // its rule stays (D2)
        renderChips();
        refreshRules();
        refs.addProjects.focus();
      });
      c.append(x);
      return c;
    }));
  }
  function openPopover() {
    popover = openProjectsPopover({ doc, anchor: refs.addProjects, host: popHost || doc.body, profileLabel: profileLabel(), tracker,
      isPicked: (v) => projects.some((p) => p.value === v), pickedCount: () => projects.length, loadProjects: projectList,
      onToggle: (p, on) => {
        const v = String(p.value);
        if (on && !projects.some((x) => x.value === v)) projects.push({ value: v, label: String(p.name || p.label || v) });
        if (!on) projects = projects.filter((x) => x.value !== v);
        renderChips();
        refreshRules();
      },
      onClose: () => { popover = null; } });
  }
  function projectsBlock() {
    const b = mk('div', 'mk-tu-block mk-tu-projects');
    const hid = `mk-tu-ph-${sid}`;
    const h = mk('h5', 'mk-tu-h', TU_COPY.projects);
    h.id = hid;
    refs.chips = mk('div', 'mk-tu-chips');
    refs.chips.setAttribute('role', 'list');
    refs.chips.setAttribute('aria-labelledby', hid);
    refs.addProjects = mk('button', 'btn btn-sm mk-tu-add-projects', TU_COPY.addProjects);
    refs.addProjects.type = 'button';
    refs.addProjects.setAttribute('aria-haspopup', 'dialog');
    refs.addProjects.addEventListener('click', () => (popover ? popover.close() : openPopover()));
    const row = mk('div', 'mk-tu-chiprow');
    row.append(refs.chips, refs.addProjects);
    b.append(h, row, mk('p', 'hint', TU_COPY.projectsHint));
    renderChips();
    return b;
  }

  // ---- the rules ----
  const rowOf = (r) => (refs.listEl ? refs.listEl.querySelector(`[data-uid="${r.uid}"]`) : null);
  const option = (value, text, { name = '', placeholder = false } = {}) => {
    const o = mk('option', '', text);
    o.value = value;
    if (name) o.dataset.name = name;
    if (placeholder) { o.disabled = true; o.selected = true; }
    return o;
  };
  async function fillPicker(sel) {
    const taken = new Set(rules.map((x) => x.project).filter(Boolean));
    const choices = (src) => src.filter((p) => !taken.has(p.value))
      .map((p) => option(p.value, p.label && p.label !== p.value ? `${p.value} — ${p.label}` : p.value, { name: p.label }));
    delete sel.dataset.failed;
    if (projects.length) { sel.replaceChildren(option('', TU_COPY.project, { placeholder: true }), ...choices(projects)); return; }
    sel.replaceChildren(option('', `Getting ${profileLabel()}'s projects…`, { placeholder: true }));
    try {
      const all = (await projectList()).map((p) => ({ value: String(p.value), label: String(p.name || p.label || p.value) }));
      if (destroyed || !refs.listEl || !refs.listEl.contains(sel)) return;
      sel.replaceChildren(option('', TU_COPY.project, { placeholder: true }), ...choices(all));
    } catch (e) {
      if (destroyed || !refs.listEl || !refs.listEl.contains(sel)) return;
      sel.replaceChildren(option('', (e && e.message) || FALLBACK_ERROR, { placeholder: true }));
      sel.dataset.failed = '1';   // asked again when the select takes focus
    }
  }
  function projectPicker(r) {
    const wrap = mk('div', 'select-wrap mk-tu-pwrap');
    const sel = mk('select', 'select mk-tu-project');
    sel.setAttribute('aria-label', TU_COPY.project);
    sel.addEventListener('change', () => {
      const o = sel.selectedOptions[0];
      if (!o || !o.value) return;
      r.project = o.value;
      r.label = o.dataset.name || o.value;
      replaceRow(r, true);
      refreshRules();
    });
    sel.addEventListener('focus', () => { if (sel.dataset.failed === '1') void fillPicker(sel); });
    wrap.append(sel);
    void fillPicker(sel);
    return wrap;
  }
  function ruleRow(r) {
    const row = mk('div', 'mk-tu-rule');
    row.setAttribute('role', 'listitem');
    row.dataset.uid = r.uid;
    const name = mk('div', 'mk-tu-name');
    if (r.project === '') {
      row.classList.add('mk-tu-all');
      name.append(mk('span', 'mk-tu-rname', TU_COPY.all), mk('span', 'hint mk-tu-rsub', TU_COPY.allSub));
    } else if (r.project) {
      row.dataset.project = r.project;
      name.append(mk('span', 'mk-mono mk-tu-key', r.project));
      if (r.label && r.label !== r.project) name.append(mk('span', 'mk-tu-rname', r.label));
    } else {
      row.classList.add('mk-tu-newrow');
      name.append(projectPicker(r));
    }
    const ms = createMoveSelect({ doc, project: r.project || '', value: r.target, general: !r.project,
      label: r.project === null ? TU_COPY.newRuleLabel : null, host: popHost || doc.body,
      loadStatuses: () => statuses(r.project),
      onChange: (t) => { r.target = t; } });
    selects.set(r.uid, ms);
    row.append(name, ms.el);
    if (r.project !== '') {
      const rm = mk('button', 'btn btn-quiet btn-icon mk-tu-remove');
      rm.type = 'button';
      rm.setAttribute('aria-label', r.project ? `Remove the ${r.project} rule` : 'Remove the new rule');
      rm.append(icon(doc, 'x', 16));
      rm.addEventListener('click', () => removeRule(r));
      row.append(rm);
    }
    return row;
  }
  function replaceRow(r, focusMove) {
    const old = rowOf(r);
    selects.get(r.uid)?.destroy();
    const fresh = ruleRow(r);
    old.replaceWith(fresh);
    if (focusMove) fresh.querySelector('.mk-tu-move').focus();
  }
  function removeRule(r) {
    rules = rules.filter((x) => x !== r);
    selects.get(r.uid)?.destroy();
    selects.delete(r.uid);
    rowOf(r)?.remove();
    refreshRules();
    refs.addRule.focus();
  }
  function addRule() {
    const pending = rules.find((x) => x.project === null);
    if (pending) { rowOf(pending)?.querySelector('.mk-tu-project')?.focus(); return; }
    const r = { uid: uid(), project: null, label: '', target: { kind: 'category', value: 'done' } };   // board 4: starts at Any Done status
    rules.push(r);
    refs.listEl.append(ruleRow(r));
    refreshRules();
    rowOf(r).querySelector('.mk-tu-project').focus();
  }
  function refreshRules() {
    if (!refs.addRule) return;
    const taken = new Set(rules.map((x) => x.project).filter(Boolean));
    const hasNew = rules.some((x) => x.project === null);
    const full = !hasNew && projects.length > 0 && projects.every((p) => taken.has(p.value));
    refs.addRule.disabled = full;
    refs.addHint.hidden = !full;
    if (full) refs.addRule.setAttribute('aria-describedby', refs.addHint.id); else refs.addRule.removeAttribute('aria-describedby');
    refs.newHint.hidden = !hasNew;
    const sel = refs.listEl.querySelector('.mk-tu-project');
    if (sel) void fillPicker(sel);
  }
  function rulesBlock() {
    const b = mk('div', 'mk-tu-block mk-tu-rulesblock');
    const hid = `mk-tu-rh-${sid}`;
    const h = mk('h5', 'mk-tu-h', TU_COPY.rules);
    h.id = hid;
    refs.listEl = mk('div', 'mk-tu-rules');
    refs.listEl.setAttribute('role', 'list');
    refs.listEl.setAttribute('aria-labelledby', hid);
    for (const r of rules) refs.listEl.append(ruleRow(r));
    refs.addRule = mk('button', 'btn btn-sm mk-tu-add-rule', TU_COPY.addRule);
    refs.addRule.type = 'button';
    refs.addRule.addEventListener('click', addRule);
    refs.addHint = mk('p', 'hint mk-tu-add-hint', TU_COPY.allHaveRules);
    refs.addHint.id = `mk-tu-ah-${sid}`;
    refs.newHint = mk('p', 'hint mk-tu-newrow-hint', TU_COPY.newRowHint);
    b.append(h, refs.listEl, refs.addRule, refs.addHint, refs.newHint, mk('p', 'hint mk-tu-hint', TU_COPY.hint));
    refreshRules();
    return b;
  }

  // ---- the section ----
  function carriedNote() {
    const t = info.legacy && info.legacy.target;
    if (info.saved || !t) return [];
    const p = mk('p', 'hint mk-tu-carried');
    p.append(doc.createTextNode('Filled in from the old '), mk('strong', '', info.legacy.label),
      doc.createTextNode(' setting. Nothing changes until you save; after that, the old setting is no longer used.'));
    return [p];
  }
  function paint() {
    for (const s of selects.values()) s.destroy();
    selects.clear();
    popover?.close();
    const headId = `mk-tu-h-${sid}`;
    el.setAttribute('aria-labelledby', headId);
    const head = mk('div', 'mk-sec-head mk-tu-head');
    const h = mk('h4', 'subsection-title', TU_COPY.title);
    h.id = headId;
    head.append(h);
    if (info.profile) head.append(mk('span', 'mk-meta', info.profile.id === 'default' ? info.profile.label : `${info.profile.label} (${info.profile.id})`));
    if (info.connection !== 'saved') { el.replaceChildren(head, mk('p', 'hint mk-tu-new', notSavedLine(tracker))); return; }
    el.replaceChildren(head, mk('p', 'hint mk-tu-sub', TU_COPY.sub), projectsBlock(), ...carriedNote(), rulesBlock());
  }

  async function load() {
    const r = await api('GET', `${base}?${query}`);
    if (destroyed) return { available: false };
    if (!r?.ok || !r.data?.available) { el.hidden = true; return { available: false }; }
    info = r.data;
    projects = list(info.projects).filter((p) => p && p.value).map((p) => ({ value: String(p.value), label: String(p.label || p.value) }));
    const all = list(info.rules).find((x) => x && x.project === '');
    const carried = info.saved ? null : fromLegacy(info.legacy && info.legacy.target);
    rules = [{ uid: uid(), project: '', label: '', target: all ? all.target : (carried || { kind: 'none' }) },
      ...list(info.rules).filter((x) => x && x.project).map((x) => ({ uid: uid(), project: String(x.project), label: String(x.label || x.project), target: x.target }))];
    baseline = JSON.stringify(collect());   // a carried-over All projects row is not a change (§10 B)
    el.hidden = false;
    paint();
    return { available: true, saved: !!info.saved, connection: info.connection, legacyField: legacyField() };
  }

  return {
    el,
    load,
    dirty: () => !!info && info.connection === 'saved' && JSON.stringify(collect()) !== baseline,
    body: () => ({ sourceId, ...(profile ? { profile } : {}), ...collect() }),
    markSaved(sent) {
      baseline = JSON.stringify({ projects: sent.projects, rules: sent.rules });
      if (info) info = { ...info, saved: true };
      el.querySelector('.mk-tu-carried')?.remove();
    },
    legacyField,
    destroy() {
      destroyed = true;
      popover?.close();
      for (const s of selects.values()) s.destroy();
      selects.clear();
    },
  };
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `node tools/test.mjs test/marketplace-ticket-updates.test.mjs test/marketplace-move-select.test.mjs test/marketplace-projects-popover.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/public/marketplace/ticket-updates-section.mjs test/helpers/ticket-updates-fixtures.mjs test/marketplace-ticket-updates.test.mjs
git commit -m "Ticket updates: the section (projects you work on, the rules, carried over, not saved)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The section finds a status that is gone (board 5 E)

§8: on open the section loads, four at a time, the statuses of each project whose rule names a status; a stored status the project no longer has keeps its name on the select, and the line sits under the row, tied by `aria-describedby`.

**Files:**
- Modify: `ui/public/marketplace/ticket-updates-section.mjs` (`checkGone`, `markGone`, `clearGone`; `load` starts the check; a rule's `onChange` clears the line)
- Test: `test/marketplace-ticket-updates.test.mjs` (two tests)

**Interfaces:**
- Consumes: `statuses(key)` (Task 14's cache, so an open select does not ask again), `STATUS_LOADS`, `goneLine`, the move select's `describe(id)`.
- Produces: `.mk-tu-gone` (`id` = `<rule uid>-gone`) under a rule row whose status is gone.

- [ ] **Step 1: Write the failing tests**

Append to `test/marketplace-ticket-updates.test.mjs`:

```js
const SHIPPED = { kind: 'status', value: '10099', label: 'Shipped', category: 'done' };
test('board 5 E: a stored status the project no longer has keeps its name; the line under the row; picking another clears it', async () => {
  const m = await section(tuRoutes(tuGet({ saved: true, projects: [], rules: [ALL_DONE, { project: 'CRM', label: 'Customer portal', moment: 'finished', target: SHIPPED },
    { project: 'OPS', label: 'Operations', moment: 'finished', target: { kind: 'none' } }] })));
  await settle();
  const row = m.rowFor('CRM');
  const btn = row.querySelector('.mk-tu-move');
  const line = row.querySelector('.mk-tu-gone');
  assert.equal(btn.textContent, 'Shipped', 'the select shows the stored name');
  assert.equal(line.textContent, 'CRM has no status named Shipped any more. Pick another; until then a run leaves CRM tickets where they are and says so in its comment.');
  assert.equal(btn.getAttribute('aria-describedby'), line.id);
  assert.deepEqual([statusCalls(m, 'CRM'), statusCalls(m, 'OPS')], [1, 0], "only a rule that names a status is checked");
  assert.equal(m.tu.dirty(), false, 'Save still works; nothing changed');
  btn.click();
  await settle();
  assert.equal(statusCalls(m, 'CRM'), 1, 'the check filled the cache');
  [...m.doc.querySelectorAll('.mk-tu-movepop [role="option"]')].find((o) => o.textContent === 'Released').click();
  assert.deepEqual([row.querySelector('.mk-tu-gone'), btn.hasAttribute('aria-describedby')], [null, false]);
});

test('board 5 E: four projects at a time; a project that cannot be read marks nothing', async () => {
  const gate = deferred();
  let running = 0;
  let most = 0;
  const slow = () => async () => { running += 1; most = Math.max(most, running); await gate.p; running -= 1; return ok({ statuses: [] }); };
  const keys = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
  const more = Object.fromEntries(keys.map((k) => [`GET ${TU}/statuses${TU_Q}&project=${k}`, slow()]));
  more[`GET ${TU}/statuses${TU_Q}&project=P6`] = async () => { running += 1; most = Math.max(most, running); await gate.p; running -= 1;
    return fail(502, { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' }); };
  const m = await section(tuRoutes(tuGet({ saved: true, rules: [ALL_DONE, ...keys.map((k) => ({ project: k, label: k, moment: 'finished',
    target: { kind: 'status', value: '7', label: 'Gone', category: 'done' } }))] }), more));
  assert.equal(running, 4);
  gate.resolve();
  await settle(30);
  assert.equal(most, 4);
  assert.deepEqual(keys.map((k) => !!m.rowFor(k).querySelector('.mk-tu-gone')), [true, true, true, true, true, false]);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/marketplace-ticket-updates.test.mjs`
Expected: FAIL — no `.mk-tu-gone` line (`line` is null); no statuses are loaded on open (`running` is 0).

- [ ] **Step 3: Implement**

In `ui/public/marketplace/ticket-updates-section.mjs`, add above `// ---- the section ----`:

```js
  // ---- a status that is gone (board 5 E) ----
  function markGone(r) {
    const row = rowOf(r);
    if (!row || row.querySelector('.mk-tu-gone')) return;
    const p = mk('p', 'mk-tu-gone', goneLine(r.project, r.target.label || r.target.value));
    p.id = `${r.uid}-gone`;
    row.append(p);
    selects.get(r.uid)?.describe(p.id);
  }
  function clearGone(r) {
    rowOf(r)?.querySelector('.mk-tu-gone')?.remove();
    selects.get(r.uid)?.describe(null);
  }
  /** STATUS_LOADS projects at a time; a project that cannot be read marks nothing (its listbox says why when opened, §10 D). */
  async function checkGone() {
    const todo = rules.filter((r) => r.project && r.target && r.target.kind === 'status');
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const r = todo[next++];
        let found;
        try { found = await statuses(r.project); } catch { continue; }
        if (destroyed || !rules.includes(r) || !r.target || r.target.kind !== 'status') continue;
        if (!found.some((s) => String(s.value) === String(r.target.value))) markGone(r);
      }
    };
    await Promise.all(Array.from({ length: Math.min(STATUS_LOADS, todo.length) }, worker));
  }
```

In `ruleRow`, the move select's `onChange` becomes:

```js
      onChange: (t) => { r.target = t; clearGone(r); } });
```

In `load`, after `paint();`:

```js
    if (info.connection === 'saved') void checkGone();
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/marketplace-ticket-updates.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/public/marketplace/ticket-updates-section.mjs test/marketplace-ticket-updates.test.mjs
git commit -m "Ticket updates: show a picked status the project no longer has

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The section in the manage sheet: mount, dirty, Save order, the old field

D12 and D4: mounted in a task-source group after the Test connection row when the flag is on and the GET says `available`; it joins the group's dirty check and the sheet's Save (the config `PUT` first, then the ticket-updates `PUT`; a refused config save sends nothing more); it repaints with the group on a profile switch, Add profile and Remove profile; after the first save the old field's control is replaced by "Moved to Ticket updates.".

**Files:**
- Modify: `ui/public/marketplace/manage-sheet.mjs` (imports; `isDirty`; the sheet's `onClose`; `fillGroup`; new `mountTicketUpdates`, `movedField`; `switchProfile`'s check; `save`)
- Test: `test/marketplace-ticket-updates.test.mjs` (imports; five tests)

**Interfaces:**
- Consumes: `createTicketUpdates` (Tasks 14–15); `flagOn(key, doc)` from `ui/public/flags.mjs`; the routes (Task 5).
- Produces: each source group `g` gains `g.tu` (the section, or null); `PUT /api/plugins/:name/ticket-updates` with `g.tu.body()` after the group's config `PUT`; `.mk-tu-moved` ("Moved to Ticket updates.") in place of the old field's control.

- [ ] **Step 1: Write the failing tests**

In `test/marketplace-ticket-updates.test.mjs`, add to the imports:

```js
import { createManageSheet } from '../ui/public/marketplace/manage-sheet.mjs';
import { ROW, DETAIL, INVENTORY } from './helpers/marketplace-manage-fixtures.mjs';
```

Append:

```js
// ---- inside the manage sheet (D12) ----
const JROW = { ...ROW, name: 'jira-source', subdir: 'plugins/jira-source', latest: null };
const JDETAIL = { ...DETAIL, plugin: JROW, inventory: { ...INVENTORY, taskSources: [{ id: 'jira', displayName: 'Jira', secrets: ['token'] }] } };
const JSCHEMA = [
  { key: 'baseUrl', type: 'text', label: 'Jira URL', secret: false, required: true, default: null, help: null, options: [] },
  { key: 'email', type: 'text', label: 'Account email', secret: false, required: false, default: null, help: null, options: [] },
  { key: 'token', type: 'text', label: 'API token', secret: true, required: true, default: null, help: null, options: [] },
  { key: 'transitionOnComplete', type: 'text', label: 'Transition on completion', secret: false, required: false, default: null,
    help: 'Optional. A transition or status name (e.g. Done) to move the issue to.', options: [] }];
const jconfig = (profile = 'acme') => ok({ sources: [{ id: 'jira', multiProfile: true, profile, profiles: [{ id: 'acme', label: 'Acme' }, { id: 'beta', label: 'Beta' }],
  schema: JSCHEMA, values: { baseUrl: 'https://acme.atlassian.net', email: 'ann@example.test', token: { set: true }, transitionOnComplete: 'Resolve' } }], channels: [] });
async function sheet(routes = {}, { flags = 'ticketUpdates', get = SAVED } = {}) {
  const h = sheetHarness({ trackDom, plugins: [JROW], routes: { 'GET /api/plugins/jira-source': ok(JDETAIL), 'GET /api/plugins/jira-source/config': jconfig(),
    ...tuRoutes(get), ...routes } });
  h.doc.documentElement.dataset.flags = flags;
  const manage = createManageSheet({ doc: h.doc, win: h.window, page: h.page, deps: h.deps, wait: h.wait, now: h.now });
  await manage.open('jira-source', { opener: h.doc.getElementById('opener') });
  await settle();
  const $ = (s) => h.doc.querySelector(`#mk-sheet ${s}`);
  const field = (key) => [...h.doc.querySelectorAll('#mk-sheet .field[data-field]')].find((r) => r.dataset.field === key);
  const type = (key, value) => { const c = $(`[data-key="${key}"]`); c.value = value; c.dispatchEvent(new h.window.Event('input', { bubbles: true })); };
  const puts = () => h.calls.filter((c) => c[0] === 'PUT').map((c) => c[1]);
  return { ...h, manage, $, field, type, puts };
}

test('D12: the section sits after Test connection when the flag is on; off, nothing and no call', async () => {
  let m = await sheet();
  const tu = m.$('[data-group="source:jira"] .mk-tu');
  assert.ok(tu && !tu.hidden);
  assert.ok(tu.previousElementSibling.classList.contains('mk-test-row'));
  assert.equal(m.$('.mk-tu-head .mk-meta').textContent, 'Acme (acme)');
  m = await sheet({}, { flags: '' });
  assert.equal(m.$('.mk-tu'), null);
  assert.equal(m.calls.some((c) => String(c[1]).includes('/ticket-updates')), false);
});

test('D4: after the first save the old field reads "Moved to Ticket updates.", its label stays, and Save never sends it', async () => {
  let m = await sheet();
  const row = m.field('transitionOnComplete');
  assert.equal(row.querySelector('label').textContent, 'Transition on completion');
  assert.equal(row.querySelector('[data-key]'), null);
  assert.equal(row.querySelector('.mk-tu-moved').textContent, 'Moved to Ticket updates.');
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual([m.manage.isOpen(), m.puts()], [false, []], 'nothing changed: the sheet just closes');
  m = await sheet();
  m.type('baseUrl', 'https://acme2.atlassian.net');
  m.$('[data-act="save"]').click();
  await settle();
  const put = m.calls.find((c) => c[0] === 'PUT');
  assert.equal(put[1], '/api/plugins/jira-source/config');
  assert.equal('transitionOnComplete' in put[2].values, false);
  m = await sheet({}, { get: tuGet() });
  assert.ok(m.field('transitionOnComplete').querySelector('[data-key="transitionOnComplete"]'), 'nothing saved yet: the old field stays');
});

test('D12: Save sends the config PUT first, then the ticket-updates PUT; a refused config save sends nothing more', async () => {
  let m = await sheet({ 'PUT /api/plugins/jira-source/config': ok({ ok: true }), [`PUT ${TU}`]: ok({ ok: true }) });
  m.type('baseUrl', 'https://acme2.atlassian.net');
  m.$('.mk-tu-chip[data-value="CRM"] .mk-tu-x').click();
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual(m.puts(), ['/api/plugins/jira-source/config', TU]);
  const body = m.calls.find((c) => c[1] === TU)[2];
  assert.deepEqual([body.sourceId, body.profile, body.projects], ['jira', 'acme', [{ value: 'SHOP', label: 'Shop' }]]);
  assert.deepEqual([m.manage.isOpen(), m.notified.map((n) => n.title)], [false, ['Settings saved.']]);
  m = await sheet({ 'PUT /api/plugins/jira-source/config': fail(400, { error: 'the Jira URL must start with https://' }) });
  m.type('baseUrl', 'ftp://x');
  m.$('.mk-tu-chip[data-value="CRM"] .mk-tu-x').click();
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual(m.puts(), ['/api/plugins/jira-source/config'], 'no ticket-updates PUT after a refused config save');
  assert.equal(m.$('.mk-save-err .mk-wash-text').textContent, 'the Jira URL must start with https://');
  assert.equal(m.manage.isOpen(), true);
});

test('D12: only the section changed: one PUT; a refused one shows the error wash under Settings and the sheet stays', async () => {
  let m = await sheet({ [`PUT ${TU}`]: fail(400, { error: 'All projects needs exactly one rule.' }) });
  m.$('.mk-tu-chip[data-value="CRM"] .mk-tu-x').click();
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual(m.puts(), [TU]);
  assert.equal(m.$('[data-sec="settings"] .mk-save-err .mk-wash-text').textContent, 'All projects needs exactly one rule.');
  assert.equal(m.manage.isOpen(), true);
  m = await sheet({ [`PUT ${TU}`]: ok({ ok: true }) }, { get: tuGet({ legacy: { ...LEGACY, target: { typed: 'Resolve' } } }) });
  m.doc.getElementById('mk-sheet').dispatchEvent(new m.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  assert.deepEqual([m.manage.isOpen(), m.doc.querySelector('dialog.discard-modal')], [false, null], 'carried over is not a change: closing asks nothing');
});

test('D12: a profile switch repaints the section for that profile; a section change asks before switching', async () => {
  const BETA_Q = '?sourceId=jira&profile=beta';
  const m = await sheet({ 'GET /api/plugins/jira-source/config?profile=beta': jconfig('beta'),
    [`GET ${TU}${BETA_Q}`]: ok(tuGet({ connection: 'new', profile: { id: 'beta', label: 'Beta' }, legacy: null })) });
  m.$('.mk-tu-chip[data-value="CRM"] .mk-tu-x').click();
  const sel = m.$('.mk-profile-sel');
  sel.value = 'beta';
  sel.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await settle();
  assert.ok(m.calls.some((c) => c[0] === 'confirm' && c[1] === 'Discard unsaved changes?'), 'the section was dirty');
  assert.equal(m.$('.mk-tu-head .mk-meta').textContent, 'Beta (beta)');
  assert.equal(m.$('.mk-tu-new').textContent, "Save this connection first. Ticket updates read Jira's projects and statuses through it.");
  assert.equal(m.doc.querySelectorAll('.mk-tu').length, 1, 'the old section is gone');
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node tools/test.mjs test/marketplace-ticket-updates.test.mjs`
Expected: FAIL — the sheet mounts no `.mk-tu` (`tu` is null), the old field keeps its control, and Save sends no ticket-updates `PUT`.

- [ ] **Step 3: Implement**

In `ui/public/marketplace/manage-sheet.mjs`, add to the imports:

```js
import { flagOn } from '../flags.mjs';
import { createTicketUpdates } from './ticket-updates-section.mjs';
```

Replace `const isDirty = () => !!view && view.groups.some(changed);` with:

```js
  const isDirty = () => !!view && view.groups.some((g) => changed(g) || !!g.tu?.dirty());
```

In the `createSheet({ doc, win, onClose: () => { … } })` callback, make its first line:

```js
    for (const g of view?.groups || []) g.tu?.destroy();   // Ticket updates: its open lists and popover go with the sheet
```

In `fillGroup`, after the last line `g.baseline = g.setup ? baselineOf(g) : '';` add:

```js
    if (section.kind === 'source' && !section.broker) mountTicketUpdates(g);
```

Add after `fillGroup`:

```js
  // Ticket updates (plans/ticket-updates-design.md D12): a task source's group gets the section after Test connection when the
  // flag is on and the plugin can update tickets; it repaints with the group (a profile switch, Add or Remove profile reread it).
  function mountTicketUpdates(g) {
    g.tu?.destroy();
    g.tu = null;
    if (!flagOn('ticketUpdates', doc)) return;
    const t = token;
    const tu = createTicketUpdates({ doc, api: deps.api, plugin: name, sourceId: g.section.id, profile: g.setup?.dataset.profile || null,
      tracker: g.title, popHost: sheet.panel });
    g.tu = tu;
    g.el.append(tu.el);
    void tu.load().then((info) => {
      if (!live(t) || g.tu !== tu || !info.available) return;
      if (info.saved && info.legacyField) movedField(g, info.legacyField);
    });
  }

  // D4: once Ticket updates is saved, the old setting's control gives way to "Moved to Ticket updates." Its label stays, so a
  // person who looks for it finds where it went; with the control gone a Save never sends it, and its absence is no change.
  function movedField(g, key) {
    const row = g.setup ? [...g.setup.querySelectorAll('.field[data-field]')].find((r) => r.dataset.field === key) : null;
    if (!row || row.querySelector('.mk-tu-moved')) return;
    for (const c of [...row.querySelectorAll('[data-key]')]) (c.closest('.select-wrap, .mk-secret, .mk-secret-set') || c).remove();
    row.querySelector(':scope > small.hint')?.remove();   // the help described the control that left
    row.append(make(doc, 'p', 'hint mk-tu-moved', 'Moved to Ticket updates.'));
    try {
      const b = JSON.parse(g.baseline);
      delete b.values[key];
      g.baseline = JSON.stringify(b);   // typed edits elsewhere in the group stay changes
    } catch { g.baseline = baselineOf(g); }
  }
```

In `switchProfile`, change the first `if` condition to:

```js
    if ((changed(g) || g.tu?.dirty()) && !(await deps.confirmModal({ title: 'Discard unsaved changes?',
```

Replace `save` with:

```js
  // Save: per changed group, its config PUT, then its Ticket updates PUT (D12); a refusal stops there, so a refused config save
  // sends nothing more. An untouched stored secret is never sent; a channel PUT restarts its worker.
  async function save(t, btn) {
    if (!live(t) || btn.dataset.fbState === 'busy') return;
    const todo = view.groups.filter((g) => changed(g) || g.tu?.dirty());
    if (!todo.length) { close(); return; }
    const cancel = sheet.foot.querySelector('[data-act="cancel"]');
    const settings = view.settings;
    sheet.setBusy(true);
    if (cancel) cancel.disabled = true;
    saving = t;
    const refused = (text) => {
      const wash = hooked(text, 'mk-save-err');
      settings.querySelector('.mk-sec-head').after(wash);
      wash.scrollIntoView?.({ block: 'nearest' });
    };
    const pending = withButton(btn, async () => {
      settings.querySelector('.mk-save-err')?.remove();
      clearFieldErrors(view.body);
      if (todo.reduce((n, g) => n + (changed(g) ? flagMissing(g.setup) : 0), 0)) return { ok: false };
      let sent = false;
      for (const g of todo) {
        if (changed(g)) {
          const c = collectSetupFields(g.setup);
          if (c.newProfile) {
            const p = await deps.api('POST', url('/profiles'), { sourceId: c.sourceId, id: c.profile, label: '' });
            if (!live(t)) return { ok: false };
            if (!p?.ok) { fieldError(g.setup.querySelector('.mk-profile-id'), p?.data?.error || 'could not create the profile'); return { ok: false }; }
          }
          const { newProfile, ...req } = c;
          const put = await deps.api('PUT', url('/config'), req);
          if (!live(t)) return { ok: false };
          if (!put?.ok) { refused(put?.data?.error || 'save failed'); return { ok: false, sent }; }
          sent = true;
          g.baseline = JSON.stringify(c);   // what was sent, never what was typed meanwhile
        }
        if (g.tu?.dirty()) {
          const body = g.tu.body();
          const put = await deps.api('PUT', url('/ticket-updates'), body);
          if (!live(t)) return { ok: false };
          if (!put?.ok) { refused(put?.data?.error || 'save failed'); return { ok: false, sent }; }
          sent = true;
          g.tu.markSaved(body);
          if (g.tu.legacyField()) movedField(g, g.tu.legacyField());
        }
      }
      return { ok: true, sent };
    }, { busy: 'Saving…', done: 'Saved' });
    // "Saving…" is disabled, and a browser then drops its focus to <body>, from where Tab reaches the page behind the
    // sheet: the panel holds focus while the PUTs are out, and a refusal gives it back to Save.
    if (doc.activeElement === btn || !sheet.panel.contains(doc.activeElement)) sheet.panel.focus();
    const r = await pending;
    if (saving === t) saving = 0;
    if (t !== token) { if (r.sent) void page.load(); return; }
    sheet.setBusy(false);
    if (cancel) cancel.disabled = false;
    const back = () => { if (doc.activeElement === sheet.panel && btn.isConnected) btn.focus(); };
    if (!r.ok) { back(); return; }
    const typed = isDirty();   // typed while Save ran (each baseline is what was sent): still a change, the sheet stays
    if (typed) back(); else close();
    if (r.sent) {
      deps.notify({ tone: 'ok', title: 'Settings saved.' });
      // The reload can take the opener away (a "Set up" whose setup is now complete): the Installed tab, never <body>.
      void page.load().then(() => { const a = doc.activeElement; if (!typed && (!a || a === doc.body)) doc.querySelector('.mk-tab[data-tab="installed"]')?.focus(); });
    }
  }
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/marketplace-ticket-updates.test.mjs test/marketplace-manage-sheet.test.mjs test/marketplace-setup-fields.test.mjs`
Expected: PASS (the existing manage-sheet tests run with the flag off: no section, no extra call).

- [ ] **Step 5: Commit**

```bash
git add ui/public/marketplace/manage-sheet.mjs test/marketplace-ticket-updates.test.mjs
git commit -m "Ticket updates: the section in the manage sheet, saved with its Save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: The `mk-tu-*` styles, light, dark and phone (boards 1, 2, 6)

§8: CSS as `mk-tu-*` rules in the Marketplace block, tokens only (board 2 needs nothing more); board 6 at 600 px and narrower.

**Files:**
- Modify: `ui/public/style.css` (a new block right before `/* ── marketplace P7 ── */`)
- Test: create `test/marketplace-ticket-updates-css.test.mjs`

**Interfaces:**
- Consumes: every class hook listed in Tasks 12–16.
- Produces: the block `/* ── marketplace ticket updates ── */` (it also ends P6's block for `test/marketplace-sheets-css.test.mjs`, which reads to the next `/* ── marketplace ` marker).

- [ ] **Step 1: Write the failing test**

Create `test/marketplace-ticket-updates-css.test.mjs`:

```js
// test/marketplace-ticket-updates-css.test.mjs — Ticket updates' style block (plans/ticket-updates-design.md §8, boards 1, 2, 6):
// every mk-tu- class the section, the move select and the popover emit has a rule; the block sits in the Marketplace block
// (after P6, before P7); tokens only; board 6's phone rules.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { sheetHarness, settle } from './helpers/marketplace-sheet-harness.mjs';
import { createTicketUpdates } from '../ui/public/marketplace/ticket-updates-section.mjs';
import { tuGet, tuRoutes, ALL_DONE, LEGACY } from './helpers/ticket-updates-fixtures.mjs';

const trackDom = useDomRelease(afterEach);
const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
const at = css.indexOf('/* ── marketplace ticket updates ── */');
const block = css.slice(at, css.indexOf('/* ── marketplace P7 ── */'));
// JS and test hooks with no rule of their own.
const HOOKS = new Set(['mk-tu-add-projects', 'mk-tu-add-rule', 'mk-tu-projects', 'mk-tu-rulesblock', 'mk-tu-movepop', 'mk-tu-done', 'mk-tu-pcheck', 'mk-tu-newrow']);

test('every mk-tu- class the three modules and the sheet emit has a rule in the Ticket updates block', async () => {
  const h = sheetHarness({ trackDom, routes: tuRoutes(tuGet({ saved: false, legacy: { ...LEGACY, target: { typed: 'Resolve' } }, projects: [{ value: 'SHOP', label: 'Shop' }],
    rules: [ALL_DONE, { project: 'CRM', label: 'Customer portal', moment: 'finished', target: { kind: 'status', value: '10099', label: 'Shipped', category: 'done' } }] })) });
  const tu = createTicketUpdates({ doc: h.doc, api: h.deps.api, plugin: 'jira-source', sourceId: 'jira', profile: 'acme', tracker: 'Jira' });
  h.doc.body.append(tu.el);
  await tu.load();
  await settle();
  tu.el.querySelector('.mk-tu-add-rule').click();
  tu.el.querySelector('[data-project="CRM"] .mk-tu-move').click();
  await settle();
  const used = new Set([...h.doc.querySelectorAll('*')].flatMap((n) => [...n.classList]).filter((c) => c === 'mk-tu' || c.startsWith('mk-tu-')));
  h.doc.querySelector('[data-project="CRM"] .mk-tu-move').click();   // closes the list
  tu.el.querySelector('.mk-tu-add-projects').click();
  await settle();
  for (const c of [...h.doc.querySelectorAll('*')].flatMap((n) => [...n.classList])) if (c.startsWith('mk-tu-')) used.add(c);
  for (const c of ['mk-tu-moved', 'mk-tu-new', 'mk-tu-dot-in_progress', 'mk-tu-dot-todo', 'mk-tu-dot-cancelled', 'mk-tu-dot-none', 'mk-tu-dot-typed']) used.add(c);
  const missing = [...used].filter((c) => !HOOKS.has(c) && !new RegExp(`\\.${c}(?![\\w-])`).test(block));
  assert.deepEqual(missing, []);
});

test('the block sits after P6 and before P7 (the Marketplace block); tokens only; scale font sizes', () => {
  assert.ok(at > css.indexOf('/* ── marketplace P6 ── */') && css.indexOf('/* ── marketplace P7 ── */') > at);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}(?![\w-])|rgba?\(/);
  assert.deepEqual([...block.matchAll(/font-size:([^;}]+)/g)].map((m) => m[1]).filter((v) => !v.startsWith('var(--fs-')), []);
  assert.match(block, /\.mk-tu-rule\{display:grid;grid-template-columns:minmax\(0,1fr\) 220px 32px;/, 'board 1: name, a 220 px select, remove');
  assert.match(block, /\.mk-tu-dot-done\{background:var\(--green\);\}/);
  assert.match(block, /\.mk-tu-dot-in_progress\{background:var\(--peach\);\}/);
  assert.match(block, /\.mk-tu-dot-cancelled\{background:var\(--red\);\}/);
});

test('board 6: at 600 px and narrower each rule stacks, chips 36 px with 32 px ×, every button and select 44 px', () => {
  const phone = block.slice(block.indexOf('@media (max-width: 600px)'));
  assert.ok(block.includes('@media (max-width: 600px)'));
  assert.match(phone, /\.mk-tu-rule\{grid-template-columns:minmax\(0,1fr\) 44px;\}/);
  assert.match(phone, /\.mk-tu-rule>\.mk-tu-movewrap\{grid-column:1 \/ -1;grid-row:2;\}/);
  assert.match(phone, /\.mk-tu-chip\{min-height:36px;\}/);
  assert.match(phone, /\.mk-tu-x\{width:32px;height:32px;\}/);
  assert.match(phone, /\.mk-tu \.btn,\.mk-tu-move,\.mk-tu-project,\.mk-tu-remove,\.mk-tu-pop \.btn\{min-height:44px;\}/);
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node tools/test.mjs test/marketplace-ticket-updates-css.test.mjs`
Expected: FAIL — the block marker is missing (`at` is -1), so every class is missing and the position check fails.

- [ ] **Step 3: Implement**

In `ui/public/style.css`, insert right before the line `/* ── marketplace P7 ── */`:

```css
/* ── marketplace ticket updates ── */
/* Ticket updates in the installed plugin sheet (plans/ticket-updates-design.md §8, boards 1–6): the section, the move select
   (board 4) and the projects popover (board 3). Tokens and scale sizes only, so the dark theme (board 2) needs nothing more. */
.mk-tu{display:flex;flex-direction:column;gap:12px;padding-top:12px;border-top:1px solid var(--line);}
.mk-tu[hidden]{display:none;}
.mk-tu-head{align-items:baseline;gap:8px;margin:0;}
.mk-tu-sub,.mk-tu-new,.mk-tu-hint,.mk-tu-add-hint,.mk-tu-newrow-hint,.mk-tu-moved{margin:0;}
.mk-tu-add-hint[hidden],.mk-tu-newrow-hint[hidden]{display:none;}
.mk-tu-block{display:flex;flex-direction:column;gap:8px;}
.mk-tu-h{margin:0;font:600 var(--fs-meta)/var(--lh-body) var(--sans);color:var(--ink-2);}
.mk-tu-chiprow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
.mk-tu-chips{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
.mk-tu-chip{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:2px 4px 2px 10px;font-weight:500;color:var(--ink);}
.mk-tu-key{font-family:var(--mono);font-size:var(--fs-meta);color:var(--ink);}
.mk-tu-cname,.mk-tu-rname{min-width:0;overflow-wrap:anywhere;}
.mk-tu-x{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:var(--r-xs);background:none;color:var(--ink-2);cursor:pointer;}
.mk-tu-x:hover{background:var(--hover);color:var(--ink);}
.mk-tu-x:focus-visible,.mk-tu-move:focus-visible,.mk-tu-remove:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}
.mk-tu-carried{margin:0;padding:8px 12px;border-radius:var(--r-sm);background:var(--field);color:var(--ink);}
.mk-tu-rules{display:flex;flex-direction:column;border:1px solid var(--line-2);border-radius:var(--r-md);}
.mk-tu-rule{display:grid;grid-template-columns:minmax(0,1fr) 220px 32px;align-items:center;gap:4px 8px;padding:8px 12px;}
.mk-tu-rule+.mk-tu-rule{border-top:1px solid var(--line);}
.mk-tu-name{display:flex;flex-direction:column;min-width:0;}
.mk-tu-rule:not(.mk-tu-all)>.mk-tu-name{flex-direction:row;align-items:baseline;gap:8px;}
.mk-tu-all .mk-tu-rname{font-weight:500;}
.mk-tu-rsub{font-size:var(--fs-meta);}
.mk-tu-pwrap,.mk-tu-project{width:100%;}
.mk-tu-remove{grid-column:3;}
.mk-tu-gone{grid-column:1 / -1;margin:0;font-size:var(--fs-meta);color:var(--red-ink-strong);}
.mk-tu-movewrap{min-width:0;}
.mk-tu-move{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:0 8px 0 12px;border:1px solid var(--line-2);border-radius:var(--r-sm);background:var(--field);color:var(--ink);font:inherit;text-align:left;cursor:pointer;}
.mk-tu-move:hover{border-color:var(--hover-outline);}
.mk-tu-move-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mk-tu-move-ic{flex:none;transform:rotate(90deg);color:var(--ink-2);}
.mk-tu-pop{position:fixed;z-index:60;max-width:calc(100vw - 16px);max-height:60vh;overflow:auto;padding:4px;border:1px solid var(--line-2);border-radius:var(--r-sm);background:var(--panel);box-shadow:var(--shadow-menu);}
.mk-tu-projpop{width:320px;padding:8px;display:flex;flex-direction:column;gap:6px;}
.mk-tu-list,.mk-tu-plist{display:flex;flex-direction:column;}
.mk-tu-opt{display:flex;align-items:center;gap:8px;min-height:32px;padding:4px 8px;border-radius:var(--r-xs);cursor:pointer;}
.mk-tu-opt:hover,.mk-tu-opt.is-active,.mk-tu-prow:hover,.mk-tu-prow.is-active{background:var(--hover);}
.mk-tu-opt-b{display:flex;flex-direction:column;flex:1;min-width:0;}
.mk-tu-opt-t{overflow-wrap:anywhere;}
.mk-tu-opt-s{font-size:var(--fs-meta);color:var(--ink-2);}
.mk-tu-opt-check{flex:none;color:var(--ink);}
.mk-tu-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--slate);}
.mk-tu-dot-none{background:none;border:1.5px solid var(--ink-2);}
.mk-tu-dot-category{background:var(--green);}
.mk-tu-dot-done{background:var(--green);}
.mk-tu-dot-in_progress{background:var(--peach);}
.mk-tu-dot-todo{background:var(--slate);}
.mk-tu-dot-typed{background:var(--slate);}
.mk-tu-dot-cancelled{background:var(--red);}
.mk-tu-sep{height:1px;margin:4px 0;background:var(--line);}
.mk-tu-group{padding:8px 8px 2px;font-size:var(--fs-caption);font-weight:600;color:var(--ink-2);}
.mk-tu-live{margin:0;padding:4px 8px;font-size:var(--fs-meta);color:var(--ink-2);}
.mk-tu-live:empty{display:none;}
.mk-tu-retry{align-self:flex-start;margin:0 8px 4px;}
.mk-tu-retry[hidden]{display:none;}
.mk-tu-search{width:100%;}
.mk-tu-prow{display:grid;grid-template-columns:16px auto minmax(0,1fr);align-items:center;gap:8px;min-height:32px;padding:4px;border-radius:var(--r-xs);cursor:pointer;}
.mk-tu-pname{min-width:0;overflow-wrap:anywhere;}
.mk-tu-pfoot{display:flex;align-items:center;gap:8px;padding-top:6px;border-top:1px solid var(--line);font-size:var(--fs-meta);color:var(--ink-2);}
.mk-tu-pcount{flex:1;min-width:0;}
/* Board 6: a rule stacks (its name and remove button on one line, the select below at full width), chips are 36 px with 32 px
   × buttons, and every button and select is 44 px tall. */
@media (max-width: 600px){
.mk-tu-rule{grid-template-columns:minmax(0,1fr) 44px;}
.mk-tu-rule>.mk-tu-movewrap{grid-column:1 / -1;grid-row:2;}
.mk-tu-remove{grid-column:2;grid-row:1;width:44px;}
.mk-tu-chip{min-height:36px;}
.mk-tu-x{width:32px;height:32px;}
.mk-tu .btn,.mk-tu-move,.mk-tu-project,.mk-tu-remove,.mk-tu-pop .btn{min-height:44px;}
.mk-tu-projpop{width:calc(100vw - 16px);}
}

```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/marketplace-ticket-updates-css.test.mjs test/marketplace-sheets-css.test.mjs test/marketplace-marketplaces-view.test.mjs test/marketplace-add-dialog.test.mjs test/marketplace-installed-view.test.mjs test/marketplace-install-view.test.mjs`
Expected: PASS (the P6 block now ends at the new marker and keeps its own checks; P7's checks are untouched).

- [ ] **Step 5: Commit**

```bash
git add ui/public/style.css test/marketplace-ticket-updates-css.test.mjs
git commit -m "Ticket updates: styles for the section, the move select and the popover, phone included

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: The browser proof and `npm run verify:ticket-updates`

§12 Browser: mock mode, jira-source linked with `linkPlugin` and one profile, as `verify-requirements-cdp.mjs`: pick projects, add a project rule, pick a status, Save, reopen; New run's project list holds only the picked ones; a mock run's `lastReport` carries the move; light, dark and 390 px. Not part of `npm test`.

**Files:**
- Create: `tools/verify-ticket-updates-cdp.mjs`
- Modify: `package.json` (`scripts`: `"verify:ticket-updates"` after `"verify:requirements"`)

**Interfaces:**
- Consumes: everything above; `linkPlugin`, `createProfile`, `writePluginConfig`, `readTicketUpdates`, `readPluginState`, `setUiLevel`, `createPipeline`, `retryWriteback`, `getDb`.
- Produces: exit code 0 and "all checks passed" on stderr, or 1 with each failing check named.

- [ ] **Step 1: Write the proof (it is the test)**

Create `tools/verify-ticket-updates-cdp.mjs`:

```js
#!/usr/bin/env node
// tools/verify-ticket-updates-cdp.mjs — headless-Chrome proof of Ticket updates (plans/ticket-updates-design.md §12 Browser):
// mock mode (WORCA_MOCK=1), the ticketUpdates flag on, jira-source linked with one profile. Pick projects, add a project rule,
// pick a status, Save, reopen; the New run project list (POST /api/sources/call listProjects) holds only the picked ones; a mock
// write-back carries the move; the section in light, dark and at 390 px. NOT part of `npm test`.
// Run: node tools/verify-ticket-updates-cdp.mjs   (or: npm run verify:ticket-updates)
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const CHROME = process.env.CHROME_BIN || CHROME_PATHS.find((p) => existsSync(p)) || CHROME_PATHS[0];
const SANDBOX = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
if (!existsSync(CHROME)) { console.error(`no Chrome at ${CHROME} - set CHROME_BIN`); process.exit(1); }
const PORT = Number(process.env.CDP_PORT || 9351);
const T0 = Date.now();
const log = (m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`);

let chrome = null; let srv = null; let home = null; let profile = null; let failed = 0;
const sockets = [];
async function shutdown(code) {
  for (const s of sockets) { try { s.close(); } catch {} }
  try { if (chrome) chrome.kill('SIGKILL'); } catch {}
  try { if (srv) { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); } } catch {}
  for (const dir of [home, profile]) { try { if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3 }); } catch {} }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
  process.on(sig, (e) => { if (e && e.stack) console.error(e.stack); shutdown(1); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail = '') => {
  if (ok) log(`ok   ${name}`);
  else { failed += 1; log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
};

// ---- an isolated home + the app server (env BEFORE the import, the house pattern) ----
home = await mkdtemp(path.join(tmpdir(), 'worca-tu-home-'));
const REAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.WORCA_HOME = home;
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.WORCA_MOCK = '1';
process.env.WORCA_FLAGS = 'ticketUpdates';
const mod = (p) => import(new URL(p, import.meta.url).href);
const { linkPlugin } = await mod('../src/core/plugin-store.mjs');
const { createProfile, writePluginConfig, readTicketUpdates, readPluginState } = await mod('../src/core/plugin-config.mjs');
const { setUiLevel } = await mod('../src/core/settings.mjs');
const { createPipeline } = await mod('../src/core/artifacts.mjs');
const { retryWriteback } = await mod('../src/core/sources.mjs');
const { getDb } = await mod('../src/core/db.mjs');
await setUiLevel('advanced');   // the Marketplace page is Advanced
await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
createProfile('jira-source', 'acme', 'Acme');
writePluginConfig('jira-source', [{ key: 'baseUrl', type: 'text' }, { key: 'token', type: 'text', secret: true }],
  { baseUrl: 'https://acme.atlassian.net', token: 'tok-proof' }, 'acme');
const { server } = await mod('../ui/server.mjs');
srv = server;
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
log(`server on ${base}`);

// ---- Chrome, with the REAL home back for its caches ----
profile = await mkdtemp(path.join(tmpdir(), 'worca-tu-profile-'));
chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--use-mock-keychain', '--window-size=1400,1000', ...SANDBOX, 'about:blank'],
{ env: { ...process.env, ...REAL_ENV }, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 120 && !up; i += 1) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { /* not listening yet */ }
  if (!up) await sleep(250);
}
if (!up) { log('no CDP endpoint'); await shutdown(1); }
const { WebSocket } = await import('ws');

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  sockets.push(ws);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let msgId = 0;
  const pending = new Map();
  const pageErrors = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description || 'exception');
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = (msgId += 1);
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  for (let t0 = Date.now(); Date.now() - t0 < 15000;) {
    if (await evalJs(`document.readyState === 'complete' && location.href !== 'about:blank'`).catch(() => false)) break;
    await sleep(100);
  }
  return { send, evalJs, pageErrors };
}
async function openPage(url) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error(`could not open a tab: HTTP ${r.status}`);
  return connect((await r.json()).webSocketDebuggerUrl);
}

const A = await openPage(`${base}/#marketplace/installed`);
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(60); } return false; };
const js = (body) => A.evalJs(`(() => { ${body} })()`);
const has = (sel) => js(`return !!document.querySelector(${JSON.stringify(sel)});`);
const click = (sel) => js(`const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return false; n.click(); return true;`);
const textOf = (sel) => js(`return document.querySelector(${JSON.stringify(sel)})?.textContent ?? null;`);
const openSheet = async () => {
  check('the jira-source row is listed', await until(() => has('button.mk-name[data-name="jira-source"]'), 15000));
  await click('button.mk-name[data-name="jira-source"]');
  return until(() => js(`const s = document.querySelector('#mk-sheet .mk-tu'); return !!s && !s.hidden && !!s.querySelector('.mk-tu-rules');`), 10000);
};
/** WCAG contrast of every visible text node under `sel`, against the first opaque background up the tree: the lowest ratio. */
const lowestContrast = (sel) => js(`
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const ground = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] >= 1) return c; } return [255, 255, 255, 1]; };
  const lum = (c) => { const v = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  let low = 99;
  for (const root of document.querySelectorAll(${JSON.stringify(sel)})) for (const el of [root, ...root.querySelectorAll('*')]) {
    if (![...el.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim()) || !el.getClientRects().length) continue;
    const a = lum(rgba(getComputedStyle(el).color)); const b = lum(ground(el));
    low = Math.min(low, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
  }
  return low;`);

// ---- pick projects (board 3) ----
check('the manage sheet shows Ticket updates', await openSheet());
check('its header names the connection', (await textOf('#mk-sheet .mk-tu-head .mk-meta')) === 'Acme (acme)');
await click('#mk-sheet .mk-tu-add-projects');
check('the projects popover lists the six projects', await until(() => js(`return document.querySelectorAll('.mk-tu-projpop .mk-tu-prow').length === 6;`)));
await click('.mk-tu-prow[data-value="SHOP"] input');
await click('.mk-tu-prow[data-value="CRM"] input');
check('the footer counts the picks', (await textOf('.mk-tu-pcount')) === '2 picked · 6 projects on Acme');
await click('.mk-tu-done');
check('two chips, SHOP and CRM', await js(`return [...document.querySelectorAll('#mk-sheet .mk-tu-chip')].map((c) => c.dataset.value).join() === 'SHOP,CRM';`));

// ---- a project rule with one of its statuses (board 4) ----
await click('#mk-sheet .mk-tu-add-rule');
check('the new row has a Project select', await until(() => has('#mk-sheet .mk-tu-project')));
await js(`const s = document.querySelector('#mk-sheet .mk-tu-project'); s.value = 'SHOP'; s.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
check('the row became the SHOP rule', await until(() => has('#mk-sheet .mk-tu-rule[data-project="SHOP"]')));
await click('#mk-sheet .mk-tu-rule[data-project="SHOP"] .mk-tu-move');
check("SHOP's statuses load into the listbox", await until(() => js(`return [...document.querySelectorAll('.mk-tu-movepop [role="option"]')].some((o) => o.textContent === 'Resolved');`)));
await js(`[...document.querySelectorAll('.mk-tu-movepop [role="option"]')].find((o) => o.textContent === 'Resolved').click(); return true;`);
check('the select shows Resolved', (await textOf('#mk-sheet .mk-tu-rule[data-project="SHOP"] .mk-tu-move')) === 'Resolved');

// ---- light, dark, 390 px ----
const setTheme = async (t) => { await js(`document.documentElement.dataset.theme = ${JSON.stringify(t)}; return true;`); await sleep(200); };
await setTheme('light');
const light = await lowestContrast('#mk-sheet .mk-tu');
check(`light: the section's text is AA (${light.toFixed(2)}:1)`, light >= 4.5);
await setTheme('dark');
const dark = await lowestContrast('#mk-sheet .mk-tu');
check(`dark: the section's text is AA (${dark.toFixed(2)}:1)`, dark >= 4.5);
await setTheme('light');
await A.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(300);
const phone = await js(`const row = document.querySelector('#mk-sheet .mk-tu-rule[data-project="SHOP"]'); const sel = row.querySelector('.mk-tu-movewrap');
  const r = row.getBoundingClientRect(); const s = sel.getBoundingClientRect(); const name = row.querySelector('.mk-tu-name').getBoundingClientRect();
  const x = document.querySelector('#mk-sheet .mk-tu-x').getBoundingClientRect();
  const buttons = [...document.querySelectorAll('#mk-sheet .mk-tu .btn, #mk-sheet .mk-tu-move')].filter((b) => b.getClientRects().length);
  return { below: s.top >= name.bottom - 1, wide: s.width >= r.width - 40, tall: buttons.every((b) => b.getBoundingClientRect().height >= 44),
    x: Math.round(x.width), scroll: document.documentElement.scrollWidth <= window.innerWidth };`);
check('390 px: the select sits below the name at full width', phone.below && phone.wide, JSON.stringify(phone));
check('390 px: every button and select is 44 px tall; the chip × is 32 px', phone.tall && phone.x === 32, JSON.stringify(phone));
check('390 px: no sideways scroll', phone.scroll);
await A.send('Emulation.clearDeviceMetricsOverride');
await sleep(200);

// ---- Save, then reopen ----
await click('#mk-sheet [data-act="save"]');
check('Save closes the sheet', await until(() => js(`return !document.querySelector('#mk-sheet .mk-tu');`) .then((gone) => gone || js(`return document.getElementById('mk-sheet-host')?.classList.contains('hidden') === true;`))));
const rec = readTicketUpdates('jira-source', 'acme', 'jira');
check('the record holds SHOP and CRM and the SHOP rule', !!rec && rec.projects.map((p) => p.value).join() === 'SHOP,CRM'
  && rec.rules.some((r) => r.project === 'SHOP' && r.target.kind === 'status' && r.target.value === '10012'), JSON.stringify(rec));
check('reopened: the sheet shows the saved rule', await openSheet()
  && (await until(async () => (await textOf('#mk-sheet .mk-tu-rule[data-project="SHOP"] .mk-tu-move')) === 'Resolved')));
check('the old setting reads "Moved to Ticket updates."', await until(() => has('#mk-sheet .field[data-field="transitionOnComplete"] .mk-tu-moved')));

// ---- New run's project list; a mock write-back ----
const listed = await js(`return fetch('/api/sources/call', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ plugin: 'jira-source', sourceId: 'jira', op: 'listProjects', profile: 'acme' }) }).then((r) => r.json()).then((j) => j.result.map((p) => p.value).join());`);
check('New run lists only SHOP and CRM', listed === 'SHOP,CRM', listed);
const projectDir = path.join(home, 'shop');
await mkdir(projectDir, { recursive: true });
const p = await createPipeline(projectDir, { promptText: '# Ship it', sourceType: 'plugin', title: 'Ship it',
  sourceMeta: { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', taskId: 'SHOP-7', project: 'SHOP', inputs: { writeBack: 'yes' }, url: null, title: 'Ship it' } });
getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run(p.id);
const out = await retryWriteback(p.id);
const last = JSON.parse(readPluginState('jira-source', 'acme').lastReport || '{}');
check('a finished run reports with the SHOP rule\'s move', JSON.stringify(last.move) === JSON.stringify({ status: '10012', name: 'Resolved' }), JSON.stringify(last.move));
check('and hears what happened', out.note === 'Moved to Resolved.', JSON.stringify(out));

check('no page errors', A.pageErrors.length === 0, A.pageErrors.join(' | '));
log(failed ? `${failed} check(s) failed` : 'all checks passed');
await shutdown(failed ? 1 : 0);
```

In `package.json` `scripts`, after `"verify:requirements": …,`:

```json
    "verify:ticket-updates": "node --disable-warning=ExperimentalWarning tools/verify-ticket-updates-cdp.mjs",
```

- [ ] **Step 2: Run the proof**

The proof exercises Tasks 1–17 end to end in a real browser (it is the red/green step for this task: a check that fails names the behaviour).

Run: `npm run verify:ticket-updates`
Expected: every check `ok`, ending `all checks passed` (exit 0). A failing check is fixed in the task that owns the behaviour, its test first, and the proof run again.

- [ ] **Step 3: Check it syntax-only on a machine without Chrome**

Run: `node --check tools/verify-ticket-updates-cdp.mjs`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add tools/verify-ticket-updates-cdp.mjs package.json
git commit -m "Ticket updates: the browser proof (npm run verify:ticket-updates)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Docs, the changelog, levels, flags, storage and the plugin contract

§13. No code changes; the flag gets its `docs` page.

**Files:**
- Create: `docs/ticket-updates.md`
- Modify: `src/shared/flags/registry.mjs` (`docs: 'docs/ticket-updates.md'` on `ticketUpdates`), `docs/feature-flags.md` (the table row), `docs/storage.md` (the file), `docs/ui-levels.md` (rows under the Marketplace table), `docs/requirements.md` (the Report back line; the filter), `docs/changelog/unreleased.md` (a Ticket updates entry), `.claude/skills/creating-worca-cc-plugins/SKILL.md` (the contract table rows and a paragraph on `move`), `src/core/plugin-api.mjs` (the comment above `WORCA_PLUGIN_API`)
- Test: `test/flags-registry.test.mjs` (the docs page exists), `test/ui-levels.test.mjs`, `test/docs-site-changelog.test.mjs` (unchanged; they must pass)

**Interfaces:** none (docs).

- [ ] **Step 1: Write the docs**

Create `docs/ticket-updates.md`:

```markdown
# Ticket updates

> Labs: turn on **Ticket updates** in Settings › Labs (`ticketUpdates`). Off, nothing changes: each tracker plugin uses its own
> "on completion" setting, as before.

Worca decides what happens to a ticket when a run that writes back finishes; the tracker plugin only translates it into its
tracker's terms.

## Where

**Marketplace › Installed › Jira › Settings**, below **Test connection**, once the connection is saved. Advanced mode, with
the Marketplace page.

- **Projects you work on.** Pick the tracker's projects you work on (**Add projects…**). New run, Requirements export and
  import list only these. None picked = all projects. A project the tracker no longer lists stays as a chip.
- **When a run finishes successfully.** **All projects** says what happens unless a project says otherwise: **Don't move**
  or **Any Done status**. **Add a project rule** for a project's own choice: Don't move, Any Done status, or one of that
  project's statuses. Removing a project from the list keeps its rule.
- **Save** saves it with the connection's other settings.

## What a run does

The run's ticket moves by the rule of its project, else All projects, and Worca's one comment on the ticket ends with what
happened: `Moved to Resolved.`, `Already in Closed.`, `Moved to Done, Resolution: Done.`, or a `Not moved: …` line saying
why. A run that did not finish successfully does not move its ticket.

**Any Done status** is one the ticket can reach, never a cancelled one (Won't Do, Won't Fix, Rejected, Duplicate, Cancelled,
Declined, Invalid, Obsolete, Abandoned, Not planned). When a move asks for a Resolution, Worca fills in Done, Fixed or
Complete.

## Categories

Every tracker's statuses map onto four: to do, in progress, done and cancelled. Jira: its "To Do" category is to do, "In
Progress" in progress, "Done" done, except the cancelled names above. Azure Boards and GitHub follow in a later release.

## The old setting

Until you save Ticket updates for a connection, the plugin's old setting works exactly as before (Jira: **Transition on
completion**). The first time you open the section, All projects is filled in from it, with a note; nothing changes until you
save. After that, the old setting reads "Moved to Ticket updates." and is no longer used.

## Where it is stored

`<Worca home>/plugins/<plugin>/data/ticket-updates.json`, per connection (profile). Removing a profile removes its Ticket
updates; uninstalling a plugin keeps them, purging removes them. With the flag off the file is kept, so turning the flag on
again restores the rules.
```

In `src/shared/flags/registry.mjs`, add to the `ticketUpdates` entry, after `reviewBy`:

```js
    docs: 'docs/ticket-updates.md',
```

In `docs/feature-flags.md`, add a row after the `runTelemetry` row of the table:

```markdown
| `ticketUpdates` | experimental, default off | [Ticket updates](ticket-updates.md): Marketplace › Installed › a tracker plugin › Settings gets **Ticket updates** for a saved connection: the projects you work on, and per project what a finished run does to its tickets (Don't move, Any Done status, or one of that project's statuses). Write-back moves the ticket by that rule and its comment ends with what happened; New run and the Requirements export (and import) list only those projects. Stored per connection in the plugin's `data/ticket-updates.json`. Off, nothing changes: the section is hidden, `/api/plugins/:name/ticket-updates*` answers 404, no list is filtered and each plugin's old setting applies; the file is kept. |
```

In `docs/storage.md`, after the `plugins/ … installed plugin checkouts` line and its `.cache` lines:

```
    <name>/data/ticket-updates.json      Ticket updates (Labs): per profile and task source, the projects you work on
                                         and the rules for a finished run; dropped with its profile, kept by uninstall,
                                         removed by purge
```

In `docs/ui-levels.md`, in the **Marketplace, Connectors, Models, Providers** table, after the Marketplace page row:

```markdown
| Marketplace page, behind the `ticketUpdates` flag: the installed plugin sheet's **Ticket updates** section (Projects you work on and its popover, the rules and their move select, Add a project rule, the states), and "Moved to Ticket updates." on the old setting | A — with the Marketplace page |
```

In `docs/requirements.md`, replace the **Report back** bullet with:

```markdown
- **Report back.** Once a feature has a ticket, **Start in Worca** has **Report back to SHOP-123**, on by default: when the
  run ends, Worca comments on the ticket with the result and the pull request link, and moves it to the status named in
  the Jira connection (**Transition on completion**), if any. With [Ticket updates](ticket-updates.md) (Labs) saved for that
  connection, the hint says what its rule for the ticket's project does instead: "moves the ticket to a Done status", "moves
  the ticket to Resolved", or "leave SHOP tickets where they are".
```

and after the **Setup** bullet add:

```markdown
- With [Ticket updates](ticket-updates.md) (Labs), the setup's project list holds only the projects you work on in that
  connection; a project the setup already names stays listed.
```

In `docs/changelog/unreleased.md`, after the Requirements entry:

```markdown
## Ticket updates (experimental)

**Say what a finished run does to its ticket, per project.**

In Marketplace › Installed › Jira › Settings, a saved connection gets **Ticket updates**: the projects you work on and, per project, Don't move, Any Done status or one of that project's own statuses. A run that writes back moves its ticket by that rule, and Worca's comment ends with a line saying what happened. Any Done status never closes a ticket as Won't Do or Duplicate, and Worca fills in a required Resolution. New run and the Requirements export list only the projects you work on. Until you save, the old **Transition on completion** setting works as before.

Chips: Ticket updates · Jira · projects you work on · Any Done status · experimental: turn it on in Settings › Labs

Read it: [Ticket updates](../ticket-updates.md)

Pull requests (add each number when it opens):

- Ticket updates
```

In `.claude/skills/creating-worca-cc-plugins/SKILL.md`, change the `reportResult` and `capabilities` rows and add three rows after `findTicket`:

```markdown
| `reportResult` | `(id, {status, summary, links, inputs, move?})` — **positional** | anything; with `move` (Ticket updates): `{moved: {from, to} \| null, note}` |
| `capabilities` | `({inputs})` — optional | `{writeBack, incrementalSync, export?, ticketUpdates?}`; missing → `writeBack: true`; `export: true` turns on the export ops below; `ticketUpdates: true` the Ticket updates ops |
```

```markdown
| `listProjects` | `({})` — the project input's `optionsFrom` | `[{value, label, name?}]`; `name` (optional) is the project's name alone, for Ticket updates' chips |
| `listStatuses` | `({project})` — optional, Ticket updates | `[{value, label, category}]`, every status of the project once; `category` one of `todo`, `in_progress`, `done`, `cancelled` |
| `legacyMove` | `({})` — optional, Ticket updates | `{field, target}`: your old "on completion" config key and what it means: `{category: 'done'}`, `{typed: '<text>'}` or `null` |
```

and after the table:

```markdown
**Ticket updates (`move`).** With `capabilities().ticketUpdates`, Worca decides what a finished run does to its ticket and
passes it as `reportResult`'s `move`: `{category: 'done'}` (any status of the done category the ticket can reach, never a
cancelled one), `{status: '<listStatuses value>', name?}` (one status; without `name` it is the typed text of your old
setting, matched as before) or `{none: true}`. Without `move`, keep doing exactly what your old setting does. Move first,
then post one comment ending with `note`, the line saying what happened (`''` when nothing was to be done), and answer
`{moved, note}`. `getTask`'s `meta.project` names the ticket's project as a `listProjects` value, so Worca can pick the
project's rule without parsing your ids.
```

In `src/core/plugin-api.mjs`, after the A6 comment lines:

```js
// Ticket updates adds optional ones too (capabilities().ticketUpdates, listStatuses, legacyMove, reportResult's `move` and its
// { moved, note } answer, listProjects' `name`, getTask's meta.project): a connector without them keeps its old behaviour.
```

- [ ] **Step 2: Run the doc checks**

Run: `node tools/test.mjs test/flags-registry.test.mjs test/flags-usage.test.mjs test/ui-levels.test.mjs test/docs-site-changelog.test.mjs`
Expected: PASS (`flags-registry` finds `docs/ticket-updates.md`).

- [ ] **Step 3: Commit**

```bash
git add docs/ticket-updates.md src/shared/flags/registry.mjs docs/feature-flags.md docs/storage.md docs/ui-levels.md docs/requirements.md docs/changelog/unreleased.md .claude/skills/creating-worca-cc-plugins/SKILL.md src/core/plugin-api.mjs
git commit -m "Ticket updates: docs, changelog, levels, flags, storage and the plugin contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Whole-branch check

**Files:** whatever this task finds to fix (no new feature code; each fix in the module of the task that owns it, its test first, as its own commit).

- [ ] **Step 1: Merge `dev`** (a merge commit, never a rebase) if it moved. Where Ticket updates meets newer code (`export.mjs`'s imports, `/api/sources/call`, `manage-sheet.mjs`'s `save`, the flag registry and the two flag-map tests, the Marketplace CSS markers), keep both sides; if #1041 merged meanwhile, Task 21 applies.
- [ ] **Step 2: The full suite, file by file, against `dev`.** Run `npm test` on the branch and record the failing files. Run each failing file alone on `dev` (a clean worktree at the merge base): `node tools/test.mjs test/<file>.test.mjs`. A test that fails here and passes there, compared by test name, is this branch's to fix; one that fails on both is not (the Windows baseline has upstream failures on `dev`). Record both counts in the pull request.
- [ ] **Step 3: Linux.** The full suite and `npm run smoke`, `npm run smoke:plugin` (the mock write-back path) on Linux (WSL, Node 22) from a clean `git archive` of the committed tree, so the POSIX-only tests run; compare with `dev` the same way.
- [ ] **Step 4: The proof.** `npm run verify:ticket-updates` → all checks passed; `npm run verify:requirements` → all checks passed (Report back, the export setup's list).
- [ ] **Step 5: Static checks.** The repo has no lint script: run `node --check` on every `.mjs` the branch touched (`git diff --name-only dev...HEAD -- '*.mjs' | xargs -n1 node --check`); no new `console.log`, `debugger`, `TODO` or `FIXME` (`git diff dev...HEAD | grep -nE '^\+.*(console\.log|debugger|TODO|FIXME)'` prints nothing); no local path, no real person's name in a fixture; `plugins/jira-source/worca-cc-plugin.json` says `0.2.0`; `WORCA_PLUGIN_API` is still 5.
- [ ] **Step 6: Flag off.** With `WORCA_FLAGS=-ticketUpdates`, run `node tools/test.mjs test/api-ticket-updates.test.mjs test/writeback.test.mjs test/jira-source-connector.test.mjs test/requirements-export.test.mjs` (they pass) and open the Marketplace sheet by hand (no section).
- [ ] **Step 7: A real Jira, by hand,** before the flag leaves Labs (§12): Cloud and Data Center; Any Done status on a workflow with Won't Do; a required Resolution; a project status rule; a legacy carry-over. Its findings go into the pull request.

---

### Task 21 (conditional): The import's project filter and its All projects word search (D9, with #1041)

**Only if PR #1041 (`origin/feat/requirements-import`) has merged into `dev` when you reach this task.** Check: `git fetch origin && git merge-base --is-ancestor origin/feat/requirements-import origin/dev && echo merged`. If it prints nothing, skip this task and write in the pull request: "The `importOptions` filter and the `searchTickets` `projects` list land in #1041's follow-up (design D9, §14)." If it merged, merge `dev` first (Task 20 step 1); the code below is written against #1041 as it stands (`src/core/requirements/import.mjs` `importOptions`, `searchTickets`; jira-source `searchTickets`), so read those two functions before editing and keep their other lines as they are.

D9 and "Decided by the user (2026-10-29)": `importOptions` lists the connection's picked projects (a saved choice stays); A6.1's **All projects** word search looks only in the picked projects: `searchTickets` gains an optional `projects` list and jira-source adds `project in (…)`; a pasted key or link is unaffected.

**Files:**
- Modify: `src/core/requirements/import.mjs` (`importOptions`, `searchTickets`; imports), `plugins/jira-source/connector/index.mjs` (`searchTickets`), `src/core/plugin-shim.mjs` (the mock `searchTickets` honours `projects`)
- Test: create `test/requirements-import-ticket-updates.test.mjs`

**Interfaces:**
- Consumes: `projectFilter`, `filterProjects` (Task 2); `getExportSetup`, `sameConn` (#1041's imports); `DEFAULT_PROFILE`.
- Produces: `importOptions(scope, body, d).projects` filtered (the export setup's tracker project kept on the same connection); `searchTickets` passes `projects: string[]` to the connector only with no `project` picked and a filter in force; the connector op `searchTickets({ project?, projects?, search?, cursor? })`.

- [ ] **Step 1: Write the failing test**

Create `test/requirements-import-ticket-updates.test.mjs`:

```js
// test/requirements-import-ticket-updates.test.mjs — Ticket updates' filter in the import (plans/ticket-updates-design.md D9,
// "Decided by the user (2026-10-29)"): importOptions lists the picked projects; All projects searches only them; a pasted key
// searches nothing. Mock mode with jira-source linked, and jira-source's own query against a fake fetch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { createProfile, writeTicketUpdates } from '../src/core/plugin-config.mjs';
import { callSource, setMockSourceResponses } from '../src/core/plugin-shim.mjs';
import { importOptions, searchTickets } from '../src/core/requirements/import.mjs';
import { _resetExportCaches } from '../src/core/requirements/export.mjs';
import createTaskSource from '../plugins/jira-source/connector/index.mjs';

useTempHome(after, 'worca-tu-import-');
const prev = { flags: process.env.WORCA_FLAGS, mock: process.env.WORCA_MOCK };
process.env.WORCA_MOCK = '1';
process.env.WORCA_FLAGS = 'requirements,ticketUpdates';
after(() => { for (const [k, v] of [['WORCA_FLAGS', prev.flags], ['WORCA_MOCK', prev.mock]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } setMockSourceResponses(null); });
const SCOPE = { scopeType: 'project', scopeKey: 'shop-1' };
const CONN = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const seen = [];
const d = { callSource: (o) => { seen.push(o); return callSource(o); } };
const NONE = [{ project: '', moment: 'finished', target: { kind: 'none' } }];

before(async () => {
  await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
  createProfile('jira-source', 'acme', 'Acme');
  _resetExportCaches();
  writeTicketUpdates('jira-source', 'acme', 'jira', { projects: [{ value: 'OPS', label: 'Operations' }], rules: NONE });
});

test('importOptions lists only the picked projects; the flag off lists all', async () => {
  assert.deepEqual((await importOptions(SCOPE, CONN, d)).projects.map((p) => p.value), ['OPS']);
  process.env.WORCA_FLAGS = 'requirements,-ticketUpdates';
  try { assert.deepEqual((await importOptions(SCOPE, CONN, d)).projects.map((p) => p.value), ['SHOP', 'OPS']); }
  finally { process.env.WORCA_FLAGS = 'requirements,ticketUpdates'; }
});

test('All projects searches only the picked projects; a picked project or the flag off sends no list', async () => {
  seen.length = 0;
  await searchTickets(SCOPE, { ...CONN, search: 'cancel' }, d);
  assert.deepEqual(seen.find((c) => c.op === 'searchTickets').args.projects, ['OPS']);
  seen.length = 0;
  await searchTickets(SCOPE, { ...CONN, project: 'SHOP', search: 'cancel' }, d);
  assert.equal('projects' in seen.find((c) => c.op === 'searchTickets').args, false);
  process.env.WORCA_FLAGS = 'requirements,-ticketUpdates';
  try {
    seen.length = 0;
    await searchTickets(SCOPE, { ...CONN, search: 'cancel' }, d);
    assert.equal('projects' in seen.find((c) => c.op === 'searchTickets').args, false);
  } finally { process.env.WORCA_FLAGS = 'requirements,ticketUpdates'; }
});

test("jira-source: project in (…) for All projects; a pasted key reads that issue, whatever the list", async () => {
  const urls = [];
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body });
  const fetch = async (url) => {
    urls.push(String(url));
    if (/\/issue\/SHOP-9\?/.test(String(url))) return res({ key: 'SHOP-9', fields: { summary: 'S', status: { name: 'Open' }, updated: null } });
    return res({ issues: [], isLast: true });
  };
  const map = new Map([['deployment:https://acme.atlassian.net', 'cloud']]);
  const src = createTaskSource({ apiVersion: 5, profile: 'acme', log: () => {}, config: { baseUrl: 'https://acme.atlassian.net', email: 'a@example.test', token: 't' },
    state: { get: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } } }, { fetch });
  await src.searchTickets({ projects: ['SHOP', 'OPS'], search: 'cancel' });
  const jql = new URL(urls.at(-1)).searchParams.get('jql');
  assert.match(jql, /project in \("SHOP", "OPS"\)/);
  assert.match(jql, /text ~ "cancel"/);
  urls.length = 0;
  await src.searchTickets({ project: 'SHOP', projects: ['OPS'], search: 'x' });
  assert.doesNotMatch(new URL(urls.at(-1)).searchParams.get('jql'), /project in/, 'a picked project wins');
  urls.length = 0;
  const hit = await src.searchTickets({ projects: ['OPS'], search: 'SHOP-9' });
  assert.deepEqual([hit.tickets.map((t) => t.key), urls.some((u) => /\/search/.test(u))], [['SHOP-9'], false]);
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node tools/test.mjs test/requirements-import-ticket-updates.test.mjs`
Expected: FAIL — `importOptions` answers `['SHOP', 'OPS']`; `searchTickets`' args have no `projects`; the JQL has no `project in`.

- [ ] **Step 3: Implement**

In `src/core/requirements/import.mjs`, add to the imports:

```js
import { DEFAULT_PROFILE } from '../plugin-config.mjs';
import { projectFilter, filterProjects } from '../ticket-updates.mjs';
```

Replace `importOptions`:

```js
export async function importOptions(scope, body = {}, d = {}) {
  const { conn, t } = await sourceFor(body, d);
  const r = (await trackerCall(d, t.name, conn, 'importOptions', {})) || {};
  // Ticket updates (D9): only the projects this connection works on; the export setup's project stays listed on its connection
  const setup = getExportSetup(scope.scopeType, scope.scopeKey);
  const keep = setup && sameConn(setup, conn) && setup.trackerProject ? [setup.trackerProject] : [];
  return { projects: filterProjects(options(r.projects), projectFilter(conn.plugin, conn.sourceId, conn.profile || DEFAULT_PROFILE), keep) };
}
```

In `searchTickets`, replace the `trackerCall(… 'searchTickets', …)` line with:

```js
  // Ticket updates (D9, user 2026-10-29): All projects searches only the picked projects; a pasted key or link is unaffected
  const picked = project ? null : projectFilter(conn.plugin, conn.sourceId, conn.profile || DEFAULT_PROFILE);
  const r = (await trackerCall(d, t.name, conn, 'searchTickets', { ...(project ? { project } : {}), ...(search ? { search } : {}),
    ...(cursor ? { cursor } : {}), ...(picked ? { projects: [...picked] } : {}) })) || {};
```

In `plugins/jira-source/connector/index.mjs` `searchTickets`, take `projects` and add it to the query (the pasted-key branch above stays first):

```js
    searchTickets: exportOp(async ({ project, projects, search, cursor } = {}) => {
      const key = pastedKey(search);
      if (key) {
        try { return { tickets: [ticketOf(await issue(key, IMPORT_SEARCH_FIELDS))] }; }
        catch (e) { if (await notVisible(e)) return { tickets: [] }; throw e; }
      }
      const cloud = (await deployment()) === 'cloud';
      // Ticket updates (D9): with no project picked, Worca may name the projects you work on
      const within = !String(project || '').trim() && Array.isArray(projects) && projects.length
        ? `project in (${projects.map((p) => jqlString(p)).join(', ')})` : '';
      const bounded = Boolean(String(project || '').trim() || String(search || '').trim() || within);
      // never the user's saved filter: the import searches the whole project; on Cloud an otherwise unbounded search gets a window
      const jql = buildJql({ project, jql: within || (cloud && !bounded ? CLOUD_RECENT : ''), search });
```

(the rest of `searchTickets`, from `const q = …` on, unchanged).

In `src/core/plugin-shim.mjs`, the mock `searchTickets` keeps only tickets of `args.projects` when it is given and no `args.project` is (a pasted key is answered whatever the list, as the real connector does):

```js
  searchTickets: (args = {}) => {
    const pasted = mockPasted(args.search);
    const words = pasted ? [] : String(args.search || '').toLowerCase().split(/\s+/).filter(Boolean);
    // Ticket updates (D9): All projects searches only the projects you work on
    const within = !args.project && Array.isArray(args.projects) && args.projects.length ? new Set(args.projects.map(String)) : null;
    const hits = MOCK_SEARCH.filter((t) => (pasted ? t.key === pasted
      : (!args.project || t.key.startsWith(`${args.project}-`)) && (!within || within.has(t.key.split('-')[0]))
        && words.every((w) => t.title.toLowerCase().includes(w))))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { tickets: hits.map((t) => ({ ...t, url: mockUrl(t.key) })) };
  },
```

In `docs/requirements.md`'s **Start from a ticket** section add: "With [Ticket updates](ticket-updates.md) (Labs), From a ticket… lists only the projects you work on, and All projects searches only them; a pasted key or link finds a ticket in any project."

- [ ] **Step 4: Run the tests and see them pass**

Run: `node tools/test.mjs test/requirements-import-ticket-updates.test.mjs test/requirements-import.test.mjs test/jira-source-import.test.mjs test/plugin-shim.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/requirements/import.mjs plugins/jira-source/connector/index.mjs src/core/plugin-shim.mjs docs/requirements.md test/requirements-import-ticket-updates.test.mjs
git commit -m "Ticket updates: the import lists and searches only the projects you work on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Appendix A: design decisions and §9 copy → tasks

| Spec point | Task(s) |
|---|---|
| D1 four categories; Jira's mapping and the cancelled names (Azure Boards, GitHub, Linear: PR 2 and later) | 2 (`TU_CATEGORIES`), 9 (`categoryOf`, `isCancelledName`), 12 (groups and dots) |
| D2 per connection, stored by Worca; projects, rules by (project, moment); All projects once, Don't move / Any Done status / typed; a removed project keeps its rule | 1, 2, 5, 14 |
| D3 the file in `data/`, `profiles/1`, `deleteProfile`, uninstall keeps / purge removes; no migration | 1 |
| D4 legacy until the first save; `legacyMove`; filled in with the note; "Moved to Ticket updates."; typed passed as `{status}` | 2, 4, 5 (Deviation 1), 9, 14, 16 |
| D5 optional contract, API 5; the comment in `plugin-api.mjs` | 4, 9, 10, 19 |
| D6 `meta.project` pinned; `reportTo.project`; a row without project uses All projects | 7, 8 |
| D7 the move after the probe; none for a run that did not finish; no extra spawn | 2, 8 |
| D8 four host routes, flag-gated, server-side only; allowlist unchanged | 5 (Deviation 2) |
| D9 the filter at New run, export setup, import; a saved choice stays; a pasted key unaffected; All projects word search | 2, 6, 21 (conditional) |
| D10 Jira's choice, preference, never cancelled, Resolution, a failed move still comments | 10 (Deviation 3) |
| D11 the line last; `{ moved, note }`; the audit line; "reported · <note>" | 8, 10 |
| D12 the section in the manage sheet, dirty, Save order, profile switch, "connection saved", Advanced | 5, 14, 16, 19 |
| D13 the move select and the projects popover as small modules | 12, 13 |
| D14 Report back's `move` and hint | 2, 11 |
| D15 New run gets no new line | nothing built |
| D16 the Labs flag; off = hidden, 404, no filter, no move; the file kept | 2, 5, 6, 8, 16, 19 |
| D17 the mock answers | 4 |
| D18 jira-source 0.2.0 | 9 |
| §3 the contract table, timeouts | 4, 5, 9, 10 |
| §4 storage and limits | 1, 2 |
| §5 the routes, guards, 502, 409 | 3, 5 |
| §6 host resolution | 2, 8 |
| §7 the Jira connector | 9, 10 |
| §8 screens, CSS tokens only, phone | 12–17 |
| §10 states A–E, Save refused, a project no longer listed stays a chip | 14 (A, B), 12–13 (C, D), 15 (E), 16 (Save refused), 14 (chips keep their stored label) |
| §11 accessibility | 12, 13, 14 |
| §12 tests | every task; 18 (browser); 20 (whole branch, real Jira) |
| §13 docs | 10 (README), 19 |
| §14 PR 1 scope; #1041's piece | 1–20; 21 |

§9 strings → tasks: header, meta, sub, "Projects you work on", "Add projects…", "Remove SHOP", the projects hint (14); popover placeholder, label, "Jira projects", footer, "Done" (13); "When a run finishes successfully", "All projects", "Unless a project below says otherwise", "Add a project rule", "Remove the SHOP rule", "Remove the new rule", "Project" (14); move select label, "Don't move", "Any Done status", "One this ticket can reach", the four group labels, "CRM statuses", "All projects: move to" (12); the hint, the new-row hint, "Save this connection first…", the carried-over note, "Resolve (as typed)" (12, 14); "Getting CRM's statuses…", the unreachable sentence and **Try again** (5, 12, 13); the gone line (15); the comment lines (10); "Getting Acme's projects…", "No project matches.", "None picked · 6 projects on Acme" (13); "Every project you work on has a rule." (14); "Moved to Ticket updates." (16); the four extra Jira lines (10); "reported · Moved to Resolved.", the audit line (8); the three Report back hints (11).

## Appendix B: copy this plan adds (not in the design)

- The new row's move select label (before a project is chosen): "New rule: move to".
- §4's refusals (400 bodies the sheet shows in its error wash): "projects must be a list." · "rules must be a list." · "Pick at most 200 projects." · "Keep at most 200 project rules." · "<What> is longer than 200 characters." · "Each project needs its key." · "Each rule needs a project and a move." · "Each rule needs a move." · "A rule can only apply when a run finishes." · "<KEY> has more than one rule." / "All projects has more than one rule." · "All projects needs exactly one rule." · "All projects can only be Don't move or Any Done status." · "Only All projects can keep the old setting." · "A status needs a name." · "A status needs its id and name." · "A status needs its category." · "A category move can only be Any Done status."
- A list that failed without the server's sentence: A6's existing "Worca could not finish that. Try again."
- `docs/ticket-updates.md`, the changelog entry, the `docs/feature-flags.md` row and the flag's description (product docs, in the boards' voice).

## Self-review (done while writing)

- **Spec coverage:** every decision D1–D18 and every §9 string maps to a task (Appendix A); D15 builds nothing by design; PR 2's plugins (Azure Boards, GitHub) and the out-of-scope list are not built. Gaps found and fixed: the GET's need of `legacyMove` after the first save (Deviation 1), the empty-roster new profile (Deviation 2), D10 against §7 (Deviation 3).
- **Placeholders:** none; Task 21 is conditional on #1041 and written against that branch as it stands, with a skip note when #1041 has not merged.
- **Names across tasks:** `readTicketUpdates` / `writeTicketUpdates` (1) → 2, 5, 6, 8, 11, 18, 21; `moveFor`, `toMove`, `validateTicketUpdates`, `projectFilter`, `filterProjects`, `describeMove`, `TU_CATEGORIES`, `TU_LIMITS` (2) → 5, 6, 8, 11, 21; `reachSentence` (3) → 5; `registerTicketUpdatesRoutes`, `CANNOT_UPDATE`, `LIST_PROJECTS_TIMEOUT_MS` (5); `sourceMeta.project` / `reportTo.project` / `ref.project` (7) → 8; `{ note, moved }` (8, 10); `statusesOf`, `isCancelledName`, `categoryOf` (9) → 10; `exportView().move` (11); `createMoveSelect`, `targetText`, `sameTarget`, `FALLBACK_ERROR` (12) → 14; `openProjectsPopover` (13) → 14; `createTicketUpdates` with `load`, `dirty`, `body`, `markSaved`, `legacyField`, `destroy` (14) → 15, 16, 17; `checkGone`, `markGone`, `clearGone`, `STATUS_LOADS`, `goneLine` (15); `g.tu`, `mountTicketUpdates`, `movedField` (16); the `mk-tu-*` classes (12–16) → 17.
