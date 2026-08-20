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
