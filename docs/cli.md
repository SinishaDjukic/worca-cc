# CLI

Every `worca` command runs the same engine as the web UI. Below are the commands you'll use most, then the full
list of subcommands.

## Common commands

```bash
# run a pipeline against a project (--project defaults to the current directory)
worca --project /path/to/your/project --prompt "Add a /search endpoint"
worca "Add a /search endpoint"     # bare prompt, from inside the project

# use a markdown brief as the prompt (a relative path is read from the project)
worca --project /path/to/your/project --file ./brief.md --title "Search feature"

# let worca pick the workflow for the task (Auto), review the proposal first
worca --project /path/to/your/project --prompt "Add a /search endpoint" --workflow auto

# Auto run with no proposal and no questions (loop-budget, recovery, cost and error pauses still apply; add --yes when nothing can answer them, e.g. in CI)
worca --project /path/to/your/project --prompt "Add a /search endpoint" --workflow auto --no-human

# run the agents on another engine (beta: codex, copilot, cursor, gemini, goose, opencode, qwen)
worca --project /path/to/your/project --prompt "Add a /search endpoint" --engine codex

# pick the run's guardrail set (default: Normal on a new install; every engine but Claude needs permissive or --allow-unguarded-engine)
worca --project /path/to/your/project --prompt "Add a /search endpoint" --engine codex --guardrails permissive

# register a project: the current folder, or a clone into the projects folder
worca add
worca add --clone https://github.com/you/your-repo.git

# pause with Ctrl+C (twice stops it), continue later (survives restarts)
worca resume <pipelineId>

# see every run from the terminal — no browser, no Worca server needed
worca runs
worca runs --status paused
worca runs <pipelineId>    # one run in detail (any unique prefix; --json for machines)

# read a run's live log from the terminal; -f follows (Ctrl-C detaches, the run continues)
worca logs <pipelineId>
worca logs <pipelineId> -f

# stop a live or paused run, or pause a live one — even one started in another terminal
worca stop <pipelineId>
worca pause <pipelineId>   # resume later with: worca resume <pipelineId>

# run it later: once, or on a repeat (it starts while `worca ui` is up, or this terminal waits with --wait)
worca --project /path/to/your/project --prompt "Upgrade dependencies" --at "tomorrow 02:00"
worca --project /path/to/your/project --prompt "Upgrade dependencies" --at 02:00 --wait --yes
worca --project /path/to/your/project --file ./nightly.md --every "weekdays 02:00"
worca --project /path/to/your/project --file ./poll.md --every "30m 09:00-18:00 weekdays"
worca schedule list

# offline demo — full pipeline, no tokens
worca --project /path/to/your/project --prompt "demo task" --mock --yes

# share a saved pipeline: as JSON, or as a plugin folder bundling your agents, scripts + skills
worca workflow export wf_my-flow --format json --out my-flow.json
worca workflow import my-flow.json
worca workflow export wf_my-flow --format plugin --target ./my-flow-plugin
worca workflow export wf_my-flow --format plugin --marketplace <id> --dry-run

# scripts: list, scaffold and test a script card — no server needed
worca script list
worca script new runTests --runtime shell
worca script test runTests
worca script test shell --param command="npm test" --cwd .
worca plugin init my-plugin
worca plugin new-script tidy --dir ./my-plugin
worca plugin validate ./my-plugin --run-cases

# the browser extension packaged with Worca
worca extension --open          # the packaged browser extension folder

# is this project ready for its coding agents? (exit 2: not ready)
worca readiness
worca readiness --project shop --engine codex

# feature flags
worca flags                     # list them
worca flags on smartRunNaming   # a Labs feature, off by default
```

## All subcommands

`worca --help` lists every subcommand and flag, and most subcommands have their own `worca <subcommand> help`:

- The project registry: `add`, `list` and `remove`. These are top-level, so it's `worca list`, not
  `worca projects list`.
- The rest: `ui`, `run --preset`, `resume`, `runs`, `logs`, `stop`, `pause`, `schedule`, `workflow`, `script`,
  `plugin`, `marketplace`, `models`, `config`, `flags`, `metrics`, `policy`, `memory team`, `container`, `broker`,
  `proxy`, `exec-env`, `e2b`, `secrets`, `setup`, `extension`, `readiness`, `doctor` and `version`.
- `worca container up --hardened` starts the [Hardened box](hardened-box.md), and `worca container status`
  then prints its posture report.
- `exec-env spec` shows, sets or clears a project's environment spec. See
  [Project environment spec](environment-spec.md).
- `exec-env list|status|build` lists the execution environments, shows a project's builds as the running server sees
  them, and builds a project's E2B template or Local sandbox (Docker) image in that server. See
  [E2B](e2b.md#building-and-rebuilding-a-project-environment) and [Local sandbox (Docker)](local-sandbox.md#project-images).
- `e2b sweep` removes this instance's orphan E2B sandboxes. See [E2B](e2b.md#cleaning-up-orphan-sandboxes).
- `container build` builds the box image from the projects' environment specs. See
  [Building the box image](environment-spec.md#building-the-box-image).
- The secret vault (the `secretVault` flag): `worca secrets status` names the OS key store that would hold the
  vault key (macOS Keychain, Windows Credential Manager, Secret Service or Windows DPAPI on WSL2), its state
  (ready, locked or unavailable) and whether the vault can be read. It always exits 0 and never writes.
  `worca secrets reset [--yes]` moves an unreadable vault aside (`worca-vault.enc.unreadable-…`) so a new one can
  start; it asks first, keeps the OS key, and refuses a readable or locked vault (exit 1). `worca doctor` adds a
  `secrets:` line while the vault is in use. `worca secrets status --check` tests the OS store round trip (a throwaway
  item written, read back and deleted) without moving anything: exit 0 when it passes, 1 when it fails.
  `worca secrets export [--yes]` writes every vaulted secret back into its config file (0600), deletes the vault and its OS
  key and turns the flag off; it refuses while the Worca app runs for the home or `WORCA_FLAGS` sets the flag (exit 1),
  and a cancel exits 2. `worca secrets ack` stops the message about secrets moved into the vault (also Settings ›
  About › Got it). `export`, `reset`, `ack` and `status --check` refuse to run from an agent. See
  [Secrets and the vault](secrets.md).

## Exit codes

For scripts and CI wrappers, `worca` exits with:

- `0` when the run finished, or when an interactive run paused and you can resume it.
- `1` on a hard error, a stop, or an interactive pause forced by an error.
- `2` on a usage error.
- `3` on any pause under `--yes`. The run parked itself (auth, quota, a usage or cost limit, retries used up, a
  step error) and nobody is attached to resume it.

Nothing is thrown away on a pause. The cause is printed with the pause block on stdout, and
`worca resume <pipelineId>` picks the run up where it stopped, on the model it was started with (`--model`, or the
one picked in the UI).

## The `/worca` skill (inside Claude Code)

```bash
worca --install /path/to/your/project
```

This copies Worca's agents and the `/worca` skill into the project's `.claude/` folder. Files already there are
kept, and `--force` overwrites them.

To have `/worca` in every project, install into your home folder instead:

```bash
worca --install ~
```

Claude Code loads `~/.claude/agents/` and `~/.claude/skills/` in every project, so the agents and the skill are then
available everywhere. Add `--force` to overwrite copies from an older Worca version.

Then open Claude Code in a project and run:

```
/worca Add a /search endpoint with pagination
```

The skill starts the same deterministic orchestrator as the CLI, and `/worca --ui` starts the web UI.
