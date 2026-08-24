# Guardrails

Guardrails are **named policy sets**, selected **per pipeline run**. The
**Guardrails** view in the web UI lists the built-ins — **Permissive**,
**Normal**, **Strict** — alongside your own sets ("Create guardrails" starts
from any of them, or blank), with an editor for the five policy fields:

1. honor project settings
2. environment scrub
3. environment allowlist
4. protected paths
5. deny rules

The New Pipeline form has a **Guardrails** picker next to the workflow picker:
the selected set is the run's entire policy, applied uniformly to every agent
the run spawns — and, for a workspace run, uniformly to every member project.

**Guardrails apply per run; runs without a selection run unguarded
(Permissive).** The picker defaults to Permissive — no restrictions,
byte-identical to runs before guardrails existed — so protection is an
explicit per-run choice, not a persistent project property. (This is a
deliberate tradeoff of the per-run model: there is no per-project default to
fall back on, and one set applies to all workspace members. If you want a
stricter habitual posture, pick Normal/Strict — or your org set — when you
start the run.)

## The built-in tiers

- **Permissive** (default) — no restrictions; byte-identical behavior to a
  run with no selection.
- **Normal** — protects credential files (`.env*`, `*.pem`, `*.key`, SSH keys,
  cert stores) from agent Read/Edit and blocks publication commands
  (`git push`, `npm/yarn/pnpm publish`). Never breaks a pipeline: commits,
  installs, tests, and `curl localhost` all still work.
- **Strict** (wire id `secure`) — Normal plus: environment scrub on agent
  spawn (the spawned `claude` gets a minimal env: base vars, the proxy/CA
  connectivity vars, every `ANTHROPIC_*`/`CLAUDE_*` var, and the set's
  allowlist — nothing else), network egress binaries denied (`curl`, `wget`,
  `nc`, `ssh`, `scp`, `rsync`, ...), `gh`/`docker push` and cloud CLIs
  (`aws`, `gcloud`, `az`) denied, `WebFetch`/`WebSearch` denied, and home-dir
  credential stores (`~/.ssh`, `~/.aws`, `~/.config/gh`,
  `~/.git-credentials`, ...) protected from the Read/Edit tools.

## Resolution and lifecycle

Built-ins resolve from Worca's code at read time (never snapshotted), so
preset improvements ship with upgrades; your named sets resolve by reference
at read time too — editing a set applies to every future run that picks it,
and to paused runs on resume. Built-ins are undeletable; editing one offers
"Save as new set". A set pinned by a paused run cannot be deleted (the API
answers 409 with the pinning runs); finished runs record the set id in
History and `run.json` (`guardrails.guardrailsId` beside the compact
envScrub/deny/protected counts — an id, not a content snapshot, since sets
stay editable). Resume re-reads the set by id and enforces its latest
definition; a set missing at resume is a LOUD warn in the run log and the
run proceeds Permissive (fail-open).

## Enforcement

Protected paths and deny rules become Claude Code `permissions.deny` rules in
a single `--settings` payload on every pipeline spawn (deny rules merge across
scopes and cannot be removed by lower scopes — repo settings can't undo Worca
policy, plugin-granted tools remain subject to it). Protected paths expand to
`Read(p)` + `Edit(p)` denies (Edit covers Write/NotebookEdit; a `Write(p)`
rule is never consulted and only produces CLI warnings, so it is not emitted).

A workspace run enforces the run's ONE selected set uniformly on every member
— nothing is unioned across member projects — and the workspace scanner is
not subject to guardrails at all (a scan takes no guardrails selection and
spawns permissive). Repo `.claude/settings.json` `permissions` are honored:
natively on single-project runs (cwd is the project worktree — the toggle can
only decide whether they're *lifted*, it cannot un-load what the worktree
loads itself); on **detached workspace runs (the default)** each member's own
`deny` rules are lifted per-member into the merged `--settings` when the
run's set honors project settings (that honor flag is uniform across members —
it comes from the selected set, not from each project; `allow`/`ask` rules
are never lifted — that would widen capability and bypass Claude Code's
workspace-trust gate; hooks and statusline still don't apply off-worktree and
stay warned). A paused run re-reads its selected set by id on resume, so it
enforces the set's latest definition.

## Honest limitations

- `Read` denial is the load-bearing secret guard; Claude Code does not consult
  `Write(path)` rules (so Worca emits `Read`+`Edit` only), and Bash denies are
  prefix matches — `sh -c "curl …"`, `/usr/bin/curl`, and `git -c k=v push`
  evade them (a leading `VAR=val` or a `timeout`/`nice` wrapper does *not*).
  Env scrub is the real exfil control, but it is **not containment**: with
  `HOME` retained, credential *files* stay readable to any subprocess an agent
  spawns (`node -e` + `fetch`), so deny rules alone don't stop indirect reads —
  for OS-level enforcement use Claude Code's sandbox (out of scope here).
- Env scrub failing a pipeline that needed an unlisted var fails visibly
  (tool errors in the transcript) — add the var to the allowlist; there is no
  silent fallback. Common cases: a corporate TLS-intercepting proxy already
  survives (proxy/CA vars are kept), but **Bedrock/Vertex/Foundry auth needs
  you to allowlist the cloud credential vars** (`AWS_*`,
  `GOOGLE_APPLICATION_CREDENTIALS`, `AZURE_*`), and a run that needs
  git-over-SSH or takes its git identity from the environment must allowlist
  `SSH_AUTH_SOCK` / the relevant `GIT_*` names — neither is in the base
  keep-list. Worca deliberately does **not** set the CLI's own
  `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` marker: on current CLIs setting it forces
  the child's permission mode back to `default`, overriding Worca's
  `--permission-mode acceptEdits` and breaking scrubbed pipeline runs.
- Not setting that marker is not the same as blocking it: if **your own shell**
  exports `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, it survives the scrub (the
  `CLAUDE_*` keep-rule passes it through) and inflicts exactly the breakage
  above on every spawned `claude` — unset it before launching Worca, or expect
  degraded runs.
- Strict denies `curl`, which the manual web-UI-testing agent uses to poll a
  dev server — it falls back to the `browser_*` MCP tools (not denied), so that
  flow degrades rather than breaks. `.env*` also matches `.env.example` /
  `.env.sample`, which agents may legitimately edit; a deny list can't carve
  per-file exceptions, so those become read-only under Normal/Strict too.
- Exempt from scrub/deny: UI-triggered utility agents outside pipeline runs
  (overview generation, agent generation), the `graphify` graph-build
  subprocess, **workspace scans**, and the `claude --help`/`--version`
  capability probe. In-run title generation IS scrubbed.
- **Ask Worca sandbox.** The in-app assistant (`Ask Worca`) is a headless
  `claude` spawned by Worca itself, never inside a project folder: its cwd is
  `<worcaHome>/tmp/ask`, its built-in tools are reduced to `Task` (`--tools
  Task` — no Bash/Read/Write/Edit exist in the process), only Worca's own MCP
  server is loaded (`--strict-mcp-config`, `--allowedTools Task,mcp__worca`
  under `--permission-mode dontAsk`), user hooks/plugins/skills are dropped
  (`--setting-sources project`, `--disable-slash-commands`), the env is
  scrubbed like a Strict run, and Task sub-agents run in the foreground of the
  same process with the same pool (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`).
  Belt-and-braces deny rules cover `Bash`/`Edit`/`Write`/`WebFetch`/… and the
  worca home (`Read(//**/.worca-cc/**)`, `Read(//**/secrets.json)`,
  `Read(//**/.env*)`, `~/.ssh`, `~/.aws`). **Anchoring matters:** a permission
  path that starts with `//` is absolute from the filesystem root; a bare
  `**/x` pattern is relative to the *current directory* and, from
  `<worcaHome>/tmp/ask`, protects nothing — verified both ways on claude
  2.1.239 (an absolute rule denied `<worcaHome>/settings.json`; the relative
  form read it). The MCP tools themselves are read-only by contract (a test
  scans the module for write statements) and the assistant can only *propose*
  a run — the user starts it from the card.
  **What `get_run_diff` can and cannot filter.** It drops a diff section when
  EITHER side names a protected path, and `diffPatch` pins every git setting
  that decides the shape it reads — `-M -l0`, `--no-ext-diff`,
  `--submodule=short`, `--no-color`, the `a/`…`b/` prefixes and
  `core.quotePath=false` — so the header shape is Worca's, not the user's
  `~/.gitconfig`'s. The filter is still path-based: a file git cannot PAIR with
  its source has no protected side to check, so a rename below git's 50%
  similarity threshold, a plain copy, or credential lines an agent pasted into
  a harmless file arrive as an ordinary add under a name no pattern matches.
  Redaction (`src/core/ask/redact.mjs`) is the second line for those. Per-turn `--max-turns` and
  `--max-budget-usd` caps are configurable in Settings → Ask Worca.
  **Chat worktrees.** The assistant can open read-only **detached** git checkouts of
  any registered project ref (or a run's feature branch) under
  `<worcaHome>/ask/<threadId>/wt/<worktreeId>` — `open_worktree` /
  `list_worktrees` / `remove_worktree`, capped at 5 per chat and 15 machine-wide,
  registered in `ask_worktrees`, removed with the thread and reconciled by the boot
  and `worca doctor` sweeps. No branch is ever created, locked or deleted, so a
  chat checkout can never block a pipeline run. They are the assistant's only view
  into a repository, and it reaches them through exactly one tool: `git`.
  **Why the `git` tool is the whole file surface.** The built-ins stay `--tools
  Task` and the blanket `Read(//**/.worca-cc/**)` deny stays, because granting
  native `Read`/`Grep`/`Glob` scoped to the worktree subtree was probed and
  rejected (gate E1, claude 2.1.241): a path matched by NO rule is *read* —
  `unmatched ⇒ allow`, verified outside the process cwd — so a scoped grant would
  also expose the rest of the disk; and `Grep` returned the CONTENTS of a file
  under a denied path, ignoring both a `Read(<path>)` and a `Grep(<path>)` deny
  (the CLI reports that only `Read(path)` rules are matched by file permission
  checks; Grep escaped even those). Symlink and `..` escapes out of the allowed
  subtree WERE blocked correctly — the two findings above are what disqualified
  the grant. `askWorktreeAllowRules()` therefore returns `[]` and is the single
  seam that flips if the engine ever gains `unmatched ⇒ deny`.
  **How the `git` tool defends itself** (it is the one file-access surface that
  permission rules do not govern): (1) `src/core/ask/git-allowlist.mjs` allows a
  fixed read set (`diff`, `log`, `show`, `status`, `blame`, `rev-parse`,
  `merge-base`, `grep`, `shortlog`, `describe`, `ls-files`, `ls-tree`), list-only
  `branch`/`tag`, always-`--detach` `checkout`/`switch`, and `fetch` against a
  configured remote NAME only — `push`/`pull`/`commit`/`config`/`cat-file` and
  every unknown subcommand are refused, as are the arbitrary-read/exec options
  (`-c`, `--git-dir`, `--work-tree`, `-C`, `--exec-path`, `--ext-diff`,
  `--textconv`, `--output`/`-o`, `--upload-pack`/`--receive-pack`, `--no-index`,
  `--contents`, `-f`/`--file`, `--filters`, `--color`, and any `-O…`). (2) git is
  spawned with `GIT_PAGER=cat`, `GIT_TERMINAL_PROMPT=0` and empty
  `GIT_ASKPASS`/`SSH_ASKPASS` so an uncredentialed fetch fails fast instead of
  hanging the turn, and the handler PREPENDS trusted `-c diff.external= -c
  color.ui=never …` (plus `--no-ext-diff --no-color` on patch-producing
  subcommands) so a hostile repo's `.git/config` cannot run an external-diff
  program. (3) Output is filtered by what git actually emitted: patch output
  passes the same protected-path SECTION filter as `get_run_diff`, path lists
  (`grep`/`ls-files`/`ls-tree`) pass a LINE filter, a command that NAMES a
  protected file (`blame .env`, `show HEAD:.env`, `log -p -- .env`) is refused at
  input, and a `show` that produced no patch (a raw blob or tree) is refused —
  which also closes `ls-tree → blob-sha → show <sha>`. Everything that survives is
  redacted. `SSH_AUTH_SOCK` is the one env var allowlisted into the child, for
  ssh-remote `fetch`.
