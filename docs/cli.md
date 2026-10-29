# CLI

Every `worca` command runs the same engine as the web UI. `worca --help` lists them all; most subcommands have their own `worca <subcommand> help`.

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

# feature flags
worca flags                     # list them
worca flags on smartRunNaming   # a Labs feature, off by default
```

Run `worca --help` for every subcommand — the project registry (`add`,
`list`, `remove`, top-level: `worca list`, not `worca projects list`), `ui`,
`run --preset`, `resume`, `runs`, `logs`, `stop`, `pause`, `schedule`,
`workflow`, `script`, `plugin`, `marketplace`, `models`, `config`, `flags`,
`metrics`, `policy`, `memory team`, `container`, `broker`, `proxy`, `setup`,
`extension`, `doctor`, `version` — and flag; most have their own
`worca <subcommand> help`.

## Exit codes

For scripts and CI wrappers: `0` the run finished (or an
interactive run paused and you can resume it); `1` a hard error, a stop, or an
interactive pause an error forced; `2` a usage error; `3` any pause under
`--yes` — the run parked itself (auth, quota, a usage or cost limit, exhausted
retries, a step error) with nobody attached to resume it. Nothing is discarded
on a pause: `worca resume <pipelineId>` picks the run up where it stopped — on
the model it was started with (`--model`, or the one picked in the UI) — and
the cause is printed with the pause block on stdout.

## The `/worca` skill (inside Claude Code)

```bash
worca --install /path/to/your/project
```

This copies Worca's agents and the `/worca` skill into the project's
`.claude/` folder (files already there are kept; `--force` overwrites them).
To have `/worca` in every project, install into your home folder instead:

```bash
worca --install ~
```

Claude Code loads `~/.claude/agents/` and `~/.claude/skills/` in every
project, so the agents and the skill are then available everywhere. Add
`--force` to overwrite copies from an older Worca version.

Then open Claude Code in a project and run:

```
/worca Add a /search endpoint with pagination
```

The skill starts the same deterministic orchestrator as the CLI;
`/worca --ui` starts the web UI.

