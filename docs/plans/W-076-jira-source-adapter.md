# W-076: Jira Source Adapter via `jtr` CLI

**Status:** Draft
**Priority:** P2
**Area:** cc
**Date:** 2026-06-15 (re-anchored 2026-06-19 against current master `ed1ade2d`)
**Depends on:** None

## Problem

worca currently accepts work requests from four source kinds (`src/worca/orchestrator/work_request.py:109` — the `WorkRequest` dataclass): GitHub issues (`gh:issue:N`, `normalize_github_issue` at line 220), Beads tasks (`bd:ID`, `normalize_beads_task` at line 250), GitHub PRs (`gh:pr:N`, `normalize_github_pr` at line 406), and local files (`plan`, `spec`, `prompt`). Teams that track work in Jira have no first-class entry point — they must hand-copy a ticket description into `--prompt` or save it as a spec file, losing the link back to the originating ticket.

There is also no write-back: even with the existing sources, a pipeline run cannot acknowledge itself in the work-tracking system. A Jira ticket has no idea a pipeline started against it, opened a PR, or finished — the work is invisible to non-worca participants on the ticket.

This is acute for Bosch-internal users with the `jtr` CLI (Bosch Track and Release), which already handles auth, network, and per-instance routing for Jira tickets like `EXPFAM-13727`. The CLI is the right boundary — worca just needs to shell into it.

## Proposal

Add a Jira source adapter in two phases, each independently shippable:

- **Phase 1 — Read-only Jira source under the existing `--source` flag.** Follows the GitHub precedent (`work_request.py:523` in the `normalize()` `source` branch already sniffs `<github-url>` and rewrites to `gh:issue:N` before dispatch; PR URLs are detected one step earlier via `_ANY_URL_RE` at line 511 and `parse_pr_url()`). `--source` learns to recognise Jira ticket URLs and the canonical `jtr:KEY-N` form. Accepted shapes: `--source https://rb-tracker.bosch.com/tracker01/browse/BIRM-594` (URL — triggers auto-init of a per-repo `./.jtr/` config if missing) or `--source jtr:BIRM-594` (canonical ref — requires `./.jtr/` to already exist). Under the hood: sniff → ensure config → pre-flight auth check → shell `jtr view KEY --json` → map JSON to a `WorkRequest` with `source_type="jira"` and `source_ref="jtr:KEY-N"`. Planner runs as usual (no plan-link auto-detection in v1). No new top-level CLI flag — `--source` is the canonical entry for all external work-tracker references.

- **Phase 2 — Append-only write-back via existing event bus.** Add a small hook script (`worca.sources.jira.hook`) that subscribes to `pipeline.run.started`, `pipeline.git.pr_created`, and the four terminal events `pipeline.run.completed` / `pipeline.run.failed` / `pipeline.run.interrupted` / `pipeline.run.cancelled` (the last two were added since this plan was first drafted; both are still terminal and must be wired so a stopped or cancelled run still leaves a Jira trail). It reads the event JSON from stdin, derives the ticket key from `source_ref`, and calls `jtr comment <KEY> -y "<body>"` (the `-y` is mandatory — every `jtr` write is preview → confirm → POST/PUT by default, and a hook script has no TTY). The runner is untouched — the wiring lives in `worca.hooks` config. A `worca.sources.jira.write_back` flag (default `true`) gates posting per-repo.

Auth and per-instance config stay inside `jtr` — the same boundary as `gh`. Each worca repo carries its own `./.jtr/` (gitignored), pointing at whichever Jira project/instance that repo tracks against. No tokens or Jira URLs in worca settings. The only cross-cutting invariant the worca side enforces is that every `jtr` subprocess runs with `cwd = worca project root` so the right config dir is found — relevant when the pipeline runs inside a worktree (see §8).

## Design

### 1. Source Adapter — `normalize_jira_ticket`

- **Current state:** `src/worca/orchestrator/work_request.py:220-282` defines `normalize_github_issue` (L220) and `normalize_beads_task` (L250), both subprocess wrappers returning a `WorkRequest` dataclass (L109-125; the dataclass now also carries PR-revision fields `pr_number`, `pr_head_branch`, `pr_base_branch`, `pr_is_cross_repo`, `review_comments` for the `github_pr` source type). A fourth normalizer `normalize_github_pr` lives at L406.
- **Obstacle:** No equivalent for Jira; users must copy ticket bodies by hand into `--prompt`.
- **Resolution:** Add a third sibling function that shells `jtr view KEY --json`, maps the documented JSON envelope to `WorkRequest`, and is dispatched by a new `jtr:` prefix in `normalize()`.

**JSON envelope (from `jtr view EXPFAM-13727 --json`):**

```json
{
  "ticket": {
    "key": "EXPFAM-13727",
    "summary": "[BEA] Java Backend Developer (Sf) - from 09/26",
    "status": "On Hold",
    "priority": "Medium",
    "issue_type": "Task",
    "description": "Jira-wiki-markup body…",
    "labels": ["AvailableResources", "Bulgaria", "be"],
    "assignee": {"display_name": "Stefanova Diana (BD/SWD-BEA2)", "email": "…"},
    "reporter": {"display_name": "Dimitrov Nikolay (BD/SWD-BEA1)", "email": "…"},
    "created": "2026-06-09T10:38:15.578+0200",
    "updated": "2026-06-11T14:53:31.880+0200"
  },
  "comments": [
    {"id": "3293468", "author": {"display_name": "…"}, "body": "…", "created": "…"}
  ]
}
```

**Field mapping:**

| WorkRequest field | Jira source |
|---|---|
| `source_type` | literal `"jira"` |
| `title` | `ticket.summary` |
| `description` | `ticket.description` + appended `## Comments` section built from `comments[]` |
| `source_ref` | `f"jtr:{ticket.key}"` (e.g. `jtr:EXPFAM-13727`) |
| `priority` | default 2 (no Jira→worca priority mapping in v1) |
| `plan_path` | `None` (no plan-link convention in Jira; planner runs) |

**Implementation:**

```python
# src/worca/orchestrator/work_request.py — new function alongside normalize_beads_task
def normalize_jira_ticket(ref: str, *, project_root: str | None = None) -> WorkRequest:
    """Create a WorkRequest from a Jira ticket reference like 'jtr:EXPFAM-13727'.

    Shells out to the `jtr` CLI (Bosch Track and Release) for fetch. Auth,
    Jira instance routing, and project access live in jtr — worca trusts the
    CLI to be authenticated. The subprocess is always invoked with
    `cwd=project_root` so jtr picks up the repo-local `./.jtr/` config rather
    than the user's global `~/.jtr/`. Subprocess failures surface verbatim.
    """
    ticket_key = ref.split(":", 1)[-1]
    if not ticket_key or "-" not in ticket_key:
        raise ValueError(f"Invalid Jira ref {ref!r}: expected 'jtr:PROJECT-NUMBER'")
    result = subprocess.run(
        ["jtr", "view", ticket_key, "--json"],
        capture_output=True, text=True, env=get_env(),
        cwd=project_root or os.getcwd(),
    )
    if result.returncode != 0:
        # `jtr view --json` emits structured errors on stdout with stable
        # codes (`not_authenticated`, `not_found`, `jira_error`) and a `fix`
        # hint. Surface those when present; fall back to stderr otherwise.
        msg = result.stderr.strip() or result.stdout.strip()
        hint = ""
        try:
            err = json.loads(result.stdout)
            if isinstance(err, dict) and "error" in err:
                msg = err.get("message") or err["error"]
                if err.get("fix"):
                    hint = f"\nHint: {err['fix']}"
        except (json.JSONDecodeError, ValueError):
            hint = "\nHint: verify 'jtr' is installed and authenticated (try `jtr auth status`)."
        raise RuntimeError(f"Failed to fetch Jira ticket {ticket_key}: {msg}{hint}")
    data = json.loads(result.stdout)
    ticket = data["ticket"]
    body = (ticket.get("description") or "").strip()
    comments = data.get("comments") or []
    if comments:
        body += "\n\n## Comments\n"
        for c in comments:
            author = c.get("author", {}).get("display_name", "unknown")
            created = (c.get("created") or "")[:10]
            body += f"\n---\n\n**{author} ({created}):**\n\n{c.get('body', '').strip()}\n"
    return WorkRequest(
        source_type="jira",
        title=ticket["summary"],
        description=body,
        source_ref=f"jtr:{ticket_key}",
    )
```

### 2. Dispatcher Wiring (URL sniffing inside `--source`)

- **Current state:** `src/worca/orchestrator/work_request.py:509-535` already sniffs URLs inside `--source` for GitHub — first `_ANY_URL_RE` (L17) intercepts any HTTP URL and routes it through `parse_pr_url()` for the PR case (L511-521), then `_GH_ISSUE_URL_RE.match(source_value)` at L523 rewrites a `<github-issue-url>` to the canonical `gh:issue:N` form before prefix dispatch. The CLI entrypoints (`src/worca/cli/main.py`, `src/worca/scripts/run_pipeline.py`, `run_worktree.py`, `run_fleet.py`) already accept `--source`; nothing changes at the CLI surface.
- **Obstacle:** No Jira URL sniffing; no `jtr:` prefix branch; no URL → key parsing; no auto-init for `./.jtr/`.
- **Resolution:** Add a Jira URL regex, an auto-init helper, a pre-flight auth check, and a `jtr:` branch — all inside the existing `--source` dispatcher. Follows GitHub's pattern exactly.

**URL regex:**

```python
# work_request.py
_JIRA_URL_RE = re.compile(
    r"^(https?://[^/]+/[^/]+)/browse/([A-Z][A-Z0-9_]*-\d+)/?$"
)
# group(1) → base_url (e.g. "https://rb-tracker.bosch.com/tracker01")
# group(2) → ticket key (e.g. "BIRM-594")
```

**Auto-init helper:**

```python
# work_request.py
def _ensure_jtr_config(url: str, project_root: str) -> None:
    """If `./.jtr/` doesn't exist under project_root, run `jtr init <url>`.

    `jtr init` parses base_url + project key out of the URL and writes them
    into `./.jtr/.env` (mode 0700) plus appends `.jtr/` to .gitignore. Safe to
    skip if `./.jtr/` already exists — we treat that as "user has set this up".
    """
    jtr_dir = os.path.join(project_root, ".jtr")
    if os.path.isdir(jtr_dir):
        return
    result = subprocess.run(
        ["jtr", "init", url],
        capture_output=True, text=True, env=get_env(),
        cwd=project_root,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"`jtr init {url}` failed: {result.stderr.strip()}\n"
            f"Hint: install jtr with `uv tool install git+https://github.com/BD-AI-SDLC/jtr.git`."
        )
    print(f"[worca] Initialised Jira config at {jtr_dir} from {url}", file=sys.stderr)
```

**Pre-flight auth check (called once before the first fetch):**

```python
def _check_jtr_auth(project_root: str) -> None:
    result = subprocess.run(
        ["jtr", "auth", "status", "--json"],
        capture_output=True, text=True, env=get_env(),
        cwd=project_root,
    )
    if result.returncode != 0:
        # Structured JSON error envelope, e.g. {"error": "not_authenticated", "fix": "jtr auth pat"}
        try:
            err = json.loads(result.stdout)
            fix = err.get("fix") or "jtr auth pat"
        except (json.JSONDecodeError, ValueError):
            fix = "jtr auth pat"
        raise RuntimeError(
            f"Jira authentication missing or expired in {project_root}/.jtr/\n"
            f"Run `{fix}` from this directory and retry."
        )
```

**Extended `--source` dispatcher (one new branch + one new URL sniff):**

```python
def normalize(source_type, source_value, *, project_root=None, **kwargs):
    ...
    elif source_type == "source" or source_value.startswith(("gh:", "bd:", "jtr:")):
        # Existing GitHub URL sniff
        gh_url_match = _GH_ISSUE_URL_RE.match(source_value)
        if gh_url_match:
            source_value = f"gh:issue:{gh_url_match.group(1)}"

        # New: Jira URL sniff with side effect (auto-init ./.jtr/ from the URL)
        jira_url_match = _JIRA_URL_RE.match(source_value)
        if jira_url_match:
            _ensure_jtr_config(source_value, project_root or os.getcwd())
            source_value = f"jtr:{jira_url_match.group(2)}"

        if source_value.startswith("gh:issue:"):
            return normalize_github_issue(source_value, plan_path_template=plan_path_template)
        elif source_value.startswith("bd:"):
            return normalize_beads_task(source_value)
        elif source_value.startswith("jtr:"):
            _check_jtr_auth(project_root or os.getcwd())
            return normalize_jira_ticket(source_value, project_root=project_root)
        else:
            raise ValueError(f"Unknown source reference format: {source_value}")
```

Asymmetry vs. GitHub worth noting: the Jira URL sniff has a **side effect** (potentially running `jtr init`) before rewriting to the canonical form. GitHub's sniff is pure (regex match → rewrite). Justification: `gh` is globally configured once at the user level, so no per-repo bootstrap is needed; `jtr` is per-repo by design, so the URL is the natural trigger for bootstrap. The side effect is gated by `if not os.path.isdir(jtr_dir)` so it runs at most once per repo lifetime.

The internal canonical ref stored on `WorkRequest.source_ref` is always `jtr:<KEY>` — that's what the write-back hook (§4) reads off the event envelope. Users typing `--source <full-url>` get the same ref as users typing `--source jtr:KEY` directly. No CLI flag changes; no entrypoint code changes.

### 3. PATH Discovery for `jtr`

- **Current state:** `src/worca/utils/env.py:16` lists `_TOOLS = ("bd", "claude", "uv", "python3", "node", "git")`. These directories are pre-pended to `PATH` for spawned subprocesses so they're reachable from `claude -p`. (Note: env.py was restructured by W-051 — the reserved-key denylist now loads from `src/worca/schemas/reserved_env_keys.json` at L32-38; `WORCA_PROJECT_ROOT` is defaulted to `os.getcwd()` inside `get_env()` at L69-70 rather than hard-coded in a reserved set.)
- **Obstacle:** `jtr` won't be on the inherited `PATH` for agent subprocesses if it's installed in a user-local pyenv/pipx/cargo dir.
- **Resolution:** Add `"jtr"` to `_TOOLS`. One-line change. Behaviour matches existing tools — present? add its dir to extra_dirs; absent? silently skip (Phase 1 fetch will then surface the absence with a clear hint).

### 4. Write-Back via Existing Event Bus (Phase 2)

- **Current state:** worca already has a fully-formed event system at `src/worca/events/emitter.py` (plus sibling emitters `fleet_emitter.py`, `workspace_emitter.py`, `hook_emitter.py`, `dispatch_external.py`, `webhook.py`) and shell-hook dispatcher at `src/worca/orchestrator/events.py:26`. Event names are constants in `src/worca/events/types.py` (`RUN_STARTED` L15, `RUN_COMPLETED` L16, `RUN_FAILED` L17, `RUN_INTERRUPTED` L18, `RUN_CANCELLED` L19, `RUN_RESUMED` L20, `GIT_PR_CREATED` L60, `GIT_PR_DEFERRED` L61, `GIT_PR_MERGED` L62). The runner imports them at `runner.py:90-115, 146-147` and emits via `emit_event(ctx, NAME, payload(...))`:
  - `pipeline.run.started` — `runner.py:2978`
  - `pipeline.git.pr_created` — emitted via `git_pr_created_payload()` builder; for the deferrable-PR flow (W-065) `pipeline.git.pr_deferred` is the parallel
  - `pipeline.run.completed` — `runner.py:4006`
  - `pipeline.run.failed` — `runner.py:4044, 4062, 4078` (three sites: stage-failure, halt, terminal-on-disk guards)
  - `pipeline.run.interrupted` / `pipeline.run.cancelled` — added since this plan was first drafted; the hook must subscribe to both to cover the full terminal-event surface
- **Obstacle:** None — the wiring exists. The missing piece is a Jira-aware consumer.
- **Resolution:** Ship a hook module `worca.sources.jira.hook` that:
  1. Reads the event JSON from stdin (`json.load(sys.stdin)`).
  2. Pulls `source_ref` from the event envelope; bails silently if it doesn't start with `jtr:`.
  3. Reads `worca.sources.jira.write_back` from settings; bails silently if `False`.
  4. Resolves the worca project root from `WORCA_PROJECT_ROOT` (defaulted by `get_env()` at `src/worca/utils/env.py:69-70` and overridden by the runner with the original repo root before worktree creation). Critical for worktree mode — without it, `cwd` is the worktree dir which has no `./.jtr/`, and `jtr` falls back to global config (wrong project) or errors out.
  5. Formats a comment per event type (templates in §5 below).
  6. Shells `jtr comment <KEY> -y "<body>"` with `cwd=WORCA_PROJECT_ROOT`. The `-y` skips the interactive preview/confirm prompt that `jtr` enforces on every write — without it the hook hangs forever waiting on a stdin that's already been consumed for the event JSON. Stderr on failure goes to stderr; never raises (fire-and-forget contract of `dispatch_shell_hooks`). Posted comments (and any failures) are also captured in `jtr`'s `.jtr_audit.jsonl` for independent debugging.

Users opt in by adding to `.claude/settings.json`:

```jsonc
"worca": {
  "hooks": {
    "pipeline.run.started":     ["python -m worca.sources.jira.hook"],
    "pipeline.git.pr_created":  ["python -m worca.sources.jira.hook"],
    "pipeline.run.completed":   ["python -m worca.sources.jira.hook"],
    "pipeline.run.failed":      ["python -m worca.sources.jira.hook"],
    "pipeline.run.interrupted": ["python -m worca.sources.jira.hook"],
    "pipeline.run.cancelled":   ["python -m worca.sources.jira.hook"]
  }
}
```

Or, if we want auto-wire-on-jira-source, the `worca init` command can inject these hooks (with an `--with-jira` flag) — see Phase 2 tasks.

### 5. Comment Templates

Templates rendered by `worca.sources.jira.hook`. Append-only — no edit-in-place in v1.

**`pipeline.run.started`:**
```
[worca] Pipeline started · run {run_id}
  Branch: {target_branch}
  Source: {source_ref}
  Plan:   {plan_path or '(generated by planner)'}
```

**`pipeline.git.pr_created`:**
```
[worca] PR opened · {pr_url}
  Branch: {head} → {base}
  Commit: {commit_sha}
```

**`pipeline.run.completed`:**
```
[worca] Pipeline completed · run {run_id}
  Duration: {duration_human}
  Stages:   {stage_summary}
  Tokens:   in={tokens_in} out={tokens_out} cache_read={cache_read}
  Cost:     ${cost_usd}
  PR:       {pr_url or '(none)'}
```

**`pipeline.run.failed`:**
```
[worca] Pipeline FAILED · run {run_id}
  Stage:    {failed_stage}
  Reason:   {reason}
  Duration: {duration_human}
  Cost:     ${cost_usd}
```

**`pipeline.run.interrupted`:**
```
[worca] Pipeline interrupted · run {run_id}
  Stage:    {current_stage}
  Reason:   {reason or 'signal'}
  Duration: {duration_human}
  Cost:     ${cost_usd}
  Resume:   worca resume {run_id}
```

**`pipeline.run.cancelled`:**
```
[worca] Pipeline cancelled · run {run_id}
  Stage:    {current_stage}
  By:       {actor or 'user'}
  Duration: {duration_human}
  Cost:     ${cost_usd}
```

Cost/token data comes from `src/worca/state/status.py:225 get_run_token_usage()` (per-stage rollups via `get_stage_token_usage` at L199) which the runner already aggregates into the `run.completed`/`run.failed` payload (verify in implementation; if absent, the hook reads the status JSON directly from `run_dir`).

### 6. Auth & Multi-Project Boundary

The recommended deployment model is **one `./.jtr/` per worca repo**, not one global `~/.jtr/` shared across all repos. Each worca repo typically tracks a different Jira project (and possibly a different Jira instance), so a per-repo config naturally maps to the workflow.

- **Per-worca-project config (primary model).** Running `worca run --jtr <url>` on a fresh repo auto-runs `jtr init <url>` (see §2's `_ensure_jtr_config`), which creates `./.jtr/` (mode 0700) with its own `.env`, audit log, and SSO cookies, and appends `.jtr/` to `.gitignore`. The PAT is then a one-time `jtr auth pat` step in that directory. Every subsequent `worca run --jtr ...` from that repo uses the repo-local config — completely isolated from other worca repos or the user's global state.
- **Global `~/.jtr/` (fallback only).** Used when the user has never run `jtr init` inside a worca repo. Workable for someone who only ever touches one Jira project from one repo, but worca's auto-init flow makes the per-repo path the path of least resistance.
- **Auth:** `jtr` stores a Bosch PAT plus optional SSO cookies inside its config dir (`./.jtr/.env` and `./.jtr/.jtr_session.json`, both mode 0600). worca never reads or writes these — the subprocess inherits credentials transparently. Pre-flight check (§2's `_check_jtr_auth`) surfaces `not_authenticated` with the `fix:` hint from jtr's structured error envelope. Same boundary model as `gh`.
- **`cwd` invariant.** Every `jtr` subprocess — fetch (§1), auto-init (§2), pre-flight (§2), comment (§4) — must run with `cwd = worca project root` so it resolves the right `./.jtr/`. See §8 for how this is enforced under worktree mode.
- **Multi-project (Jira projects, not worca projects):** The Jira project key is part of the ticket key (`BIRM-594`, `EXPFAM-13727`). No worca-side default-project setting in v1 — `--jtr` always wants a full URL or a bare key with the project prefix. (`jtr` itself auto-AND's a `JTR_PROJECT` env var into JQL queries inside `list mine` / `search`, but those are jtr-internal concerns; worca only uses `jtr view`.)
- **Multi-instance:** Out of scope from worca's side; covered transparently by per-repo `./.jtr/` — different repo → different `.env` → different `JTR_BASE_URL`.

### 7. Configuration Surface

New keys under `worca.sources.jira` in `.claude/settings.json`:

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `worca.sources.jira.write_back` | `bool` | `true` | Master switch for posting comments. Read-only fetch is unaffected. |

Notably *not* added in v1:
- `worca.sources.jira.default_project` — defer until requested.
- `worca.sources.jira.transition_on_complete` — transitions are out of scope (v1 = comments only).
- `worca.sources.jira.url` / `auth_token` — never; auth is `jtr`'s problem.

### 8. Worktree Mode + `cwd` Invariant

- **Current state:** `run_worktree.py` creates `.worktrees/pipeline-<run-id>/` (note: path changed from `.claude/worktrees/` in earlier revisions) and runs the entire pipeline inside it. Hook scripts spawned by `dispatch_shell_hooks` (`src/worca/orchestrator/events.py:26`) inherit the runner's cwd → the worktree, not the original repo. The env var `WORCA_PROJECT_ROOT` is defaulted to `os.getcwd()` by `get_env()` at `src/worca/utils/env.py:69-70` and overridden by the runner with the original project root before worktree creation.
- **Obstacle:** The worktree dir doesn't contain `./.jtr/` (that lives in the parent repo). A naive `subprocess.run(["jtr", "comment", ...])` from inside the hook would either fall back to global `~/.jtr/` (wrong project) or fail with "Not configured." Same applies to the fetch path if anyone ever calls `normalize_jira_ticket` from inside a worktree-spawned subprocess.
- **Resolution:** Two complementary rules, both already implied above:
  1. **Phase 1 fetch:** `normalize_jira_ticket(..., project_root=...)` always sets `cwd=project_root`. The CLI entrypoint resolves project root before worktree creation (the fetch happens during work-request extraction, ahead of pipeline launch) — naturally correct, no worktree-specific code needed.
  2. **Phase 2 hook:** the hook script reads `os.environ["WORCA_PROJECT_ROOT"]` and passes it as `cwd=` to every `jtr` subprocess. This is the **only** worktree-mode-aware line in the whole feature; everything else is cwd-agnostic.
- **No file copying.** Unlike `settings.local.json` (which the runner materialises into the worktree per CLAUDE.md's "Worktree materialization" note), `./.jtr/` is **not** copied. The PAT stays in the parent repo's `./.jtr/.env`; the worktree never sees it. Matches the "jtr owns credentials" boundary.
- **Tested explicitly:** a worktree-mode hook test sets `WORCA_PROJECT_ROOT=/tmp/fake-repo` and verifies `subprocess.run` was called with `cwd="/tmp/fake-repo"`.

## Implementation Plan

### Phase 1: Read-only Jira source via `--source`

**Files:**
- `src/worca/orchestrator/work_request.py` — add `_JIRA_URL_RE`, `_ensure_jtr_config`, `_check_jtr_auth`, `normalize_jira_ticket`; extend `--source` dispatcher with Jira URL sniff + `jtr:` branch
- `src/worca/utils/env.py` — add `"jtr"` to `_TOOLS`
- `tests/test_work_request.py` — unit tests for URL parser, auto-init, pre-flight, normalizer, dispatcher
- `CLAUDE.md` — document Jira-URL / `jtr:` accepted forms under `--source`, plus per-repo `./.jtr/` setup
- `README.md` (if it documents source types) — same

**No CLI entrypoint changes.** `--source` already exists in every entrypoint; the new URL form flows through transparently. The dispatcher does need a `project_root` kwarg, so the entrypoints that call `normalize()` will pass it through — that's already done for `gh:issue:` URL sniffing, so the wiring exists (verify in implementation; add if missing).

**Tasks:**
1. Write failing tests in `tests/test_work_request.py` for:
   - URL parser: valid URL, malformed URL, URL without `/browse/` segment, URL with non-standard project key (`PROJ-X-1`).
   - `_ensure_jtr_config`: existing `./.jtr/` → no-op; missing → `jtr init` invoked with correct `cwd`; `jtr init` failure → raises with install hint.
   - `_check_jtr_auth`: `auth status --json` returns 0 → no-op; non-zero with structured error → raises with `fix:` hint.
   - `normalize_jira_ticket`: happy path, missing description, comments-present, comments-absent, malformed ref, subprocess non-zero with structured-error passthrough, `cwd=project_root` passed through.
   - `normalize("source", "<jira-url>", project_root=...)`: triggers `_ensure_jtr_config` + `_check_jtr_auth` + fetch.
   - `normalize("source", "jtr:KEY-1", project_root=...)`: skips auto-init, runs pre-flight + fetch.
   - `normalize("source", "jtr:KEY-1", project_root=...)` with no `./.jtr/`: pre-flight surfaces `not_authenticated` error pointing the user at `jtr init <url>` or `jtr auth pat`.
2. Implement the four helpers per §1–2.
3. Extend `normalize()`'s `--source` branch with the Jira URL sniff + `jtr:` dispatch (§2).
4. Add `"jtr"` to `_TOOLS` (§3).
5. Run `pytest tests/test_work_request.py` and `ruff check .`.
6. Update CLAUDE.md (source-flag accepted-values table + per-repo `./.jtr/` setup section).
7. Manual smoke test against a live `jtr`:
   - Fresh repo, no `./.jtr/`: `worca run --source <full-ticket-url> --dry-run` → auto-inits, surfaces pre-flight auth error pointing at `jtr auth pat`, exits.
   - After `jtr auth pat`: same command → fetches ticket, prints WorkRequest, exits.
   - Canonical ref after init: `worca run --source jtr:KEY-N --dry-run` → fetches, prints WorkRequest, exits.

**Done criteria:**
- `pytest tests/test_work_request.py` passes including new tests.
- `ruff check .` clean.
- All three smoke-test scenarios above behave as described against a live `jtr` install.

### Phase 2: Write-back hook

**Files:**
- `src/worca/sources/__init__.py` — new package
- `src/worca/sources/jira/__init__.py` — new package
- `src/worca/sources/jira/hook.py` — the hook script (stdin event → `jtr add-comment`)
- `tests/test_sources_jira_hook.py` — unit tests for templates + dispatch
- `CLAUDE.md` — document write-back hook + `worca.sources.jira.write_back`
- (Optional) `src/worca/cli/init.py` or wherever `worca init` lives — `--with-jira-hooks` flag that injects the four hook entries into `settings.json`

**Tasks:**
1. Create `src/worca/sources/jira/hook.py` with: stdin JSON parse, source-ref check (`startswith("jtr:")`), settings lookup (`worca.sources.jira.write_back`), `WORCA_PROJECT_ROOT` lookup, template rendering, `subprocess.run(["jtr", "comment", key, "-y", body], cwd=project_root)`. Never raises.
2. Write tests covering: each of the six wired event types (`run.started`, `git.pr_created`, `run.completed`, `run.failed`, `run.interrupted`, `run.cancelled`) renders the right template, non-Jira source is no-op, `write_back: false` is no-op, missing `jtr` binary fails silently with stderr log, malformed event JSON is no-op, `-y` is always present, `cwd=WORCA_PROJECT_ROOT` is always passed (worktree-mode regression guard), missing `WORCA_PROJECT_ROOT` falls back to `os.getcwd()` with a warning.
3. Document the hook config in `CLAUDE.md`.
4. (Optional) Wire `worca init --with-jira-hooks` to inject the four hook entries.
5. Manual smoke test: run a tiny pipeline with `--source <test-ticket-url>` (both in-place and `run_worktree.py`) and verify three comments appear on the ticket in both modes.

**Done criteria:**
- `pytest tests/test_sources_jira_hook.py` passes.
- A live pipeline against a sandbox ticket posts the three expected comments — both in-place AND in worktree mode.
- Setting `worca.sources.jira.write_back: false` suppresses all of them.

### Files Changed Summary

| File | Phase | Change |
|------|-------|--------|
| `src/worca/orchestrator/work_request.py` | 1 | Add `_JIRA_URL_RE`, `_ensure_jtr_config`, `_check_jtr_auth`, `normalize_jira_ticket`; extend `--source` dispatcher with Jira URL sniff + `jtr:` branch |
| `src/worca/utils/env.py` | 1 | Add `"jtr"` to `_TOOLS` tuple |
| `tests/test_work_request.py` | 1 | New tests for URL parser, auto-init, pre-flight, normalizer, dispatcher |
| `CLAUDE.md` | 1 + 2 | Document Jira-URL / `jtr:` under `--source`, per-repo `./.jtr/` setup, write-back hook |
| `src/worca/sources/__init__.py` | 2 | New empty package init |
| `src/worca/sources/jira/__init__.py` | 2 | New empty package init |
| `src/worca/sources/jira/hook.py` | 2 | New: event-bus consumer that posts Jira comments; reads `WORCA_PROJECT_ROOT` for cwd |
| `tests/test_sources_jira_hook.py` | 2 | New: hook-script tests including worktree-mode cwd regression |
| `src/worca/cli/init.py` (or equivalent) | 2 (optional) | `--with-jira-hooks` flag |

**No CLI entrypoint files modified.** The `--source` flag already exists everywhere; the new URL form flows through transparently.

## Considerations

- **`jtr` availability is a hard runtime dependency for Jira sources.** Without it, Phase 1 fetch fails with a clear hint; Phase 2 hook logs to stderr and is a no-op. Worca does not bundle, install, or version-pin `jtr` — that's the user's responsibility, same as `gh`. Recommended install (from the README): `uv tool install git+https://github.com/BD-AI-SDLC/jtr.git`, followed by `jtr init <ticket-url>` and `jtr auth pat`. CLAUDE.md should link to the jtr README for setup rather than restate it.
- **`-y` is mandatory on every write.** `jtr comment` previews-then-prompts by default. The hook must always pass `-y` (or `--yes`) — without it the script hangs on a vanished TTY. Covered by a dedicated regression test. (Same applies to any other `jtr` write — `edit`, `transition`, `assign` — though the v1 hook only invokes `comment`.)
- **Audit trail comes for free.** `jtr` appends every write attempt (success and failure) to `.jtr_audit.jsonl` in its config dir. Comments posted by the worca hook show up there with full before/after state, independent of worca's own state files. Useful for debugging "did the comment actually post?" without round-tripping to the ticket UI.
- **Jira wiki markup vs. markdown.** `ticket.description` returns Jira's wiki markup (`*bold*`, `+highlight+`, `\r\n`). Claude reads it fine; no conversion needed in v1. If output quality suffers, a follow-on can run it through a converter (`jira2md` or similar) — but YAGNI.
- **Comment noise.** Four comments per pipeline run on a chatty repo could clutter a ticket. The `write_back: false` flag lets a project mute it; per-event filtering (only post on PR + completion, skip start) is a possible v2 refinement.
- **Privacy / data exfiltration.** Comments include token counts, cost, branch names, run IDs, and PR URLs. None of this is sensitive in typical Bosch-internal use, but the `write_back: false` flag is the user's escape hatch.
- **Auth failure UX.** First-time users with no `jtr` config get an error from `subprocess.run` — we surface its stderr verbatim plus a one-line hint. Don't try to detect "is jtr authenticated" upfront — it's a moving target across `jtr` versions.
- **Governance.** No new governance rules. The hook script runs in the user's shell with the user's permissions — same as any other `worca.hooks` entry.
- **Breaking changes:** None. New optional source type, additive config key, opt-in hook script.
- **Migration:** None.

## Test Plan

### Unit Tests

| Layer | Test | Validates |
|-------|------|-----------|
| Python | `test_normalize_jira_ticket_happy_path` | Title, body, source_ref correctly mapped from canonical JSON |
| Python | `test_normalize_jira_ticket_appends_comments` | `## Comments` section built with author + date + body |
| Python | `test_normalize_jira_ticket_no_comments` | No `## Comments` section when comments array is empty |
| Python | `test_normalize_jira_ticket_empty_description` | Body is just the `## Comments` section (or empty if neither) |
| Python | `test_normalize_jira_ticket_subprocess_failure` | RuntimeError with stderr passthrough + auth hint |
| Python | `test_normalize_jira_ticket_invalid_ref` | ValueError for `jtr:` (empty), `jtr:NOHYPHEN` |
| Python | `test_normalize_jira_ticket_passes_cwd` | Subprocess invoked with `cwd=project_root` |
| Python | `test_jira_url_regex_valid` | `https://host/path/browse/KEY-1` → captures base_url + key |
| Python | `test_jira_url_regex_rejects_malformed` | URL without `/browse/` segment doesn't match |
| Python | `test_ensure_jtr_config_existing_dir_noop` | `./.jtr/` already exists → no `jtr init` invoked |
| Python | `test_ensure_jtr_config_runs_jtr_init` | Missing `./.jtr/` → `jtr init <url>` called with `cwd=project_root` |
| Python | `test_ensure_jtr_config_failure_raises_with_hint` | `jtr init` non-zero → RuntimeError including install hint |
| Python | `test_check_jtr_auth_success_silent` | `auth status --json` returns 0 → no-op |
| Python | `test_check_jtr_auth_failure_raises_with_fix` | `auth status --json` returns structured error → RuntimeError surfaces `fix:` field |
| Python | `test_source_dispatcher_sniffs_jira_url` | `normalize("source", "<jira-url>", project_root=...)` triggers `_ensure_jtr_config` + `_check_jtr_auth` + `normalize_jira_ticket` |
| Python | `test_source_dispatcher_handles_jtr_canonical` | `normalize("source", "jtr:KEY-1", project_root=...)` skips init, runs pre-flight + fetch |
| Python | `test_source_dispatcher_jira_url_no_double_init` | Second call with same URL doesn't re-run `jtr init` (already-exists short-circuit) |
| Python | `test_source_dispatcher_unknown_url_falls_through` | A non-GitHub, non-Jira URL passed to `--source` raises `Unknown source reference format` |
| Python | `test_jira_hook_run_started_template` | Stdin event → expected `jtr comment <KEY> -y "<body>"` argv |
| Python | `test_jira_hook_pr_created_template` | Same for PR event |
| Python | `test_jira_hook_completed_template` | Same for completion event with token/cost fields |
| Python | `test_jira_hook_failed_template` | Same for failure event |
| Python | `test_jira_hook_interrupted_template` | Same for `pipeline.run.interrupted` event |
| Python | `test_jira_hook_cancelled_template` | Same for `pipeline.run.cancelled` event |
| Python | `test_jira_hook_always_passes_dash_y` | Every invocation includes `-y` to skip preview/confirm — regression guard against the hook hanging on stdin |
| Python | `test_jira_hook_uses_project_root_cwd` | `WORCA_PROJECT_ROOT` env var → passed as `cwd=` to `subprocess.run` (worktree-mode regression guard) |
| Python | `test_jira_hook_falls_back_to_cwd_with_warning` | Missing `WORCA_PROJECT_ROOT` → cwd defaults to `os.getcwd()` with stderr warning |
| Python | `test_jira_hook_non_jira_source_noop` | `source_ref` starts with `gh:` → no subprocess invoked |
| Python | `test_jira_hook_write_back_false_noop` | `write_back: false` → no subprocess invoked |
| Python | `test_jira_hook_missing_jtr_silent` | `FileNotFoundError` from subprocess logged, not raised |
| Python | `test_jira_hook_malformed_event_silent` | Stdin not JSON → logged + exit 0 |

### Integration / E2E Tests

- **Manual smoke (Phase 1):**
  1. Fresh worca repo with no `./.jtr/`. Run `worca run --jtr <full-ticket-url> --dry-run`. Verify the auto-init message, then the pre-flight auth error pointing at `jtr auth pat`.
  2. Run `jtr auth pat` in that repo. Re-run the command. Verify the WorkRequest prints with the ticket title.
  3. With `./.jtr/` now set up, run `worca run --jtr <KEY-N> --dry-run` (bare key). Verify same result.
- **Manual smoke (Phase 2):** Run a no-op pipeline against a sandbox ticket via both `run_pipeline.py` and `run_worktree.py`. Verify three comments (start, PR-opened, completed) appear in both modes. Then flip `worca.sources.jira.write_back: false` and verify silence.
- Automated integration tests via `tests/integration/` would require either (a) mocking `jtr` end-to-end via `mock_claude` style stand-in, or (b) a live Bosch network — both are out of scope for v1.

### Existing Tests to Update

- `tests/test_work_request.py` already has cases for the dispatcher's `gh:`/`bd:` sniff. Add a parallel `jtr:` case rather than altering existing ones — additive change.
- No tests should break.

## Files to Create/Modify

| File | Action | Phase |
|------|--------|-------|
| `src/worca/orchestrator/work_request.py` | Modify (add 4 helpers + extend `--source` dispatcher) | 1 |
| `src/worca/utils/env.py` | Modify (add `"jtr"` to `_TOOLS`) | 1 |
| `tests/test_work_request.py` | Modify (URL parser, auto-init, pre-flight, normalizer, dispatcher tests) | 1 |
| `CLAUDE.md` | Modify (Jira-URL / `jtr:` under `--source` + per-repo `./.jtr/` setup) | 1 |
| `src/worca/sources/__init__.py` | Create | 2 |
| `src/worca/sources/jira/__init__.py` | Create | 2 |
| `src/worca/sources/jira/hook.py` | Create | 2 |
| `tests/test_sources_jira_hook.py` | Create | 2 |
| `CLAUDE.md` | Modify (write-back hook config) | 2 |
| `docs/plans/W-076-jira-source-adapter.md` | Create (this file) | — |

## Out of Scope

- **Edit-in-place comments.** v1 is append-only. `jtr` confirmed: `jtr edit` only handles a fixed field set (`summary`, `description`, `priority`, `labels`, `fixVersions`) — comments are not editable via the CLI today. Switching to a single rolling comment would need a `jtr` extension or direct Jira REST access, both out of scope.
- **Status transitions.** No `On Hold → In Progress → Done` transitions. `jtr transition <KEY>` exists and works, but state names vary per Jira project and auto-transitioning is risky without per-project config (e.g. `worca.sources.jira.transition.on_pr_opened = "In Review"`). Natural follow-on once one project is fully wired.
- **Short refs without project prefix.** `jtr:1234` resolving to `EXPFAM-1234` via `worca.sources.jira.default_project` — 5-line follow-on, not needed because the URL auto-init flow already gives users a frictionless first run, and post-init they can use bare keys with the project prefix (`worca run --jtr BIRM-594`). (`jtr` itself already auto-scopes JQL queries via the `JTR_PROJECT` env var in its `.env` — a worca-side default would mirror that.)
- **`/worca-install` auto-init.** Having `/worca-install` prompt for a sample Jira ticket URL and run `jtr init` as part of repo setup would shave one command off first-run, but it muddies the install skill's "set up worca" scope. Skip for v1; the first `worca run --jtr <url>` does the same thing on demand.
- **Plan-link auto-detection.** Jira tickets don't use a `## Plan` convention; the planner always runs for Jira sources. A `--as-plan` flag that materializes the ticket body as `plan_path` (skipping planner) is a possible follow-on.
- **Priority / label mapping.** `Medium → P3` etc. is mechanical but adds opinions worca doesn't need yet.
- **Fan-out from epics.** "Run a fleet across every story in epic PROJ-100" is a natural extension once the single-ticket path exists — separate plan.
- **Jira attachments → `--guide`.** Pulling a design doc attached to a ticket and feeding it through `attach_guide()` is desirable but requires `jtr` attachment support (unverified) — separate plan.
- **SourceAdapter abstraction.** Considered during design; rejected because the existing event bus + shell hooks already provide the extension point for write-back. Introducing a protocol class would be over-engineering for one bidirectional source.
- **Bundling or auto-installing `jtr`.** Users install it themselves, same as `gh` / `bd`.
