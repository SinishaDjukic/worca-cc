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
  cert stores, container secrets under `/run/secrets/`) from agent Read/Edit
  and blocks publication commands
  (`git push`, `npm/yarn/pnpm publish`). It also protects Worca's own state
  (the DB, secrets, settings and MCP registry) from Read/Edit and blocks edits
  to Worca's `plugins`, `scripts`, `agents`, `workflows` and `policy` dirs.
  Never breaks a pipeline: commits, installs, tests, and `curl localhost` all
  still work.
- **Strict** (wire id `secure`) — Normal plus: environment scrub on agent
  spawn (the spawned `claude` gets a minimal env: base vars, the proxy/CA
  connectivity vars, every `ANTHROPIC_*`/`CLAUDE_*` var, and the set's
  allowlist — nothing else), network egress binaries denied (`curl`, `wget`,
  `nc`, `ssh`, `scp`, `rsync`, ...), git network subcommands (`clone`,
  `fetch`, `pull`, `ls-remote`, `remote add|set-url`), DNS tools (`dig`,
  `nslookup`), `socat`, `openssl s_client` and download CLIs (`aria2c`,
  `lynx`, `w3m`) denied, `gh`/`docker push` and cloud CLIs
  (`aws`, `gcloud`, `az`) denied, `WebFetch`/`WebSearch` denied, and home-dir
  credential stores (`~/.ssh`, `~/.aws`, `~/.config/gh`,
  `~/.git-credentials`, `~/.claude/.credentials.json`, `~/.gnupg`, ...)
  protected from the Read/Edit tools.

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

A deny rule on an MCP server also reaches its [MCP registry](mcp-servers.md) copies: a rule
`mcp__<s>` or `mcp__<s>__<tool>` whose `<s>` is a registry server's base name
or declared name gains one rule per copy of that server in the run
(`mcp__linear__delete_issue` → `mcp__linear_billing__delete_issue`,
`mcp__platform-linear_team-platfor__delete_issue`), and a rule on a copy name
follows its `_w` rename. The original rule stays, and the run's `denyCount`
counts the added ones.

A workspace run enforces the run's ONE selected set uniformly on every member
— nothing is unioned across member projects — and a workspace scan runs as a pipeline under the Normal set, like a memory
defragment run. The scan's script stages (extract, catalog, join, render) are
worca's own programs, not `claude` spawns: no deny rule reaches them. Extract
reads the files its detectors claim in each member's checkout, `.env` and
`.env.*` files such as `.env.example` included, which Normal protects from
agents; checking a line an agent cites reads that file whatever its name; the
catalog's literal search skips every file Normal protects
(see [workspace-map.md](workspace-map.md#guardrails)).
Repo `.claude/settings.json` `permissions` are honored:
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

- **Worca's state protection is tool-level.** The Read/Edit denies on Worca's DB,
  secrets and code dirs do not stop an agent with Bash (`sqlite3`, `node -e`)
  from reaching the DB, and only the conventional `.worca-cc` home basename is
  matched. Container mode is the real containment.
- **MCP registry servers are outside the presets.** No preset denies `mcp__*`,
  and Strict's exfil and publish denies (`Bash(gh)`, `curl`, `WebFetch`, …) do
  not constrain a registry server's tools, which every agent of the run can
  call. A team that wants a tool off writes a deny rule, which then reaches every
  copy (above). Ask Worca has no guardrails, so deny rules never bind the chat's
  copies.
- **What "no code changes" means for Ask Worca with MCP servers.** Native write
  tools stay denied, but a server included in a chat may have write tools (a
  filesystem server, GitHub push/merge, Jira create), and it is a network path
  outside Ask web access: the allowlist, the SSRF checks, the team's web caps and
  `ask-web.jsonl` do not apply to it, and neither do guardrail presets. Which sets
  include a server is the guard; the chat's prompt rules only reinforce it.
- `Read` denial is the load-bearing secret guard; Claude Code does not consult
  `Write(path)` rules (so Worca emits `Read`+`Edit` only), and Bash denies are
  prefix matches — `sh -c "curl …"`, `/usr/bin/curl`, and `git -c k=v push`
  evade them (a leading `VAR=val` or a `timeout`/`nice` wrapper does *not*).
  Env scrub is the real exfil control, but it is **not containment**: with
  `HOME` retained, credential *files* stay readable to any subprocess an agent
  spawns (`node -e` + `fetch`), so deny rules alone don't stop indirect reads —
  for OS-level enforcement run Worca in a container ([docker.md](docker.md)):
  the box holds no host credentials, mounts only the projects you name, and
  the egress overlay makes non-allowlisted hosts unreachable at the packet
  level. The Normal and Strict sets also deny `Read` on `/run/secrets/**`,
  where a compose secret (an API key via `apiKeyHelper`) lands.
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
- Strict's deny list cannot stop egress from interpreters (`node -e` /
  `python -c` with a fetch — tests need them) or from the browser MCP tools
  (`browser_navigate` accepts any URL, and the manual web-UI-testing agent
  needs them). The real egress control is the container egress overlay
  ([`docs/docker.md`](docker.md), `docker/compose.egress.yml`). A hosting
  platform's outbound network policy (`WORCA_EGRESS_MODE`) uses the same proxy
  without the overlay's internal network, so it holds only tools that honour
  `HTTPS_PROXY`: an interpreter's raw socket still goes direct there
  ([remote-access.md → Outbound network policy](remote-access.md#outbound-network-policy-hosting-platform)).
- Exempt from scrub/deny: UI-triggered utility agents outside pipeline runs
  (overview generation, agent generation), the `graphify` graph-build
  subprocess, and the `claude --help`/`--version`
  capability probe. In-run title generation IS scrubbed.
- Script nodes (the Workspace scan's extract, catalog, join and render stages
  included) are worca's own child processes, not `claude` spawns: no deny rule
  reaches them, and they start from the run's scrubbed environment when its
  set scrubs (the scan runs under Normal, which does not scrub).
- **Ask Worca sandbox.** The in-app assistant (`Ask Worca`) is a headless
  `claude` spawned by Worca itself, never inside a project folder: its cwd is
  `<worcaHome>/tmp/ask`, its built-in tools are reduced to `Task` (`--tools
  Task` — no Bash/Read/Write/Edit exist in the process), only Worca's own MCP
  server and the chat's [MCP registry](mcp-servers.md) copies are loaded
  (`--strict-mcp-config`, `--allowedTools Task,Read,Grep,Glob,mcp__worca`, plus
  `ToolSearch` and one `mcp__<copy>` grant per copy when the chat has any, under
  `--permission-mode dontAsk`; see the MCP registry limitation above), user hooks/plugins/skills are dropped
  (`--setting-sources project`, `--disable-slash-commands`; a turn that mounts skills from the chat's sets
  instead gets the `Skill` tool, one `--plugin-dir` per set, one `Skill(<plugin>:<skill>)` allow per skill
  and `disableBundledSkills`, and keeps slash commands; every turn sets `disableSkillShellExecution` and
  denies `Read` on the skill library, `<worcaHome>/skills/`), the env is
  scrubbed like a Strict run, and Task sub-agents run in the foreground of the
  same process with the same pool (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`).
  Belt-and-braces deny rules cover `Bash`/`Edit`/`Write`/`WebFetch`/… and
  worca's own state (`Read(//**/worca-cc.db*)`, the home's `store/`, `runs/`,
  `plugins/`, `tmp/` subtrees and `settings.json`, `Read(//**/secrets.json)`,
  `Read(//**/.env*)`) plus `~/.ssh`, `~/.aws` and the other credential stores in
  `ASK_DENY_RULES`. **Anchoring matters:** a permission
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
  into a repository: the native `Read`/`Grep`/`Glob` tools see the checkout as
  files, and the `git` tool serves history, diffs and search.
  **What the native file tools can reach — an accepted trade-off.** The chat runs
  `--tools Task,Read,Grep,Glob` under `dontAsk` (never Bash/Write/Edit, so nothing
  it reads can be turned into a write). Granting `Read` scoped to the worktree
  subtree was probed on claude 2.1.241 (gate E1) and found NOT to scope: a path
  matched by no rule is *read* — `unmatched ⇒ allow`, verified outside the process
  cwd — so the grant is effectively read access to the whole disk minus the deny
  list; and `Grep` returned the contents of a file under a denied path, ignoring
  both a `Read(<path>)` and a `Grep(<path>)` deny (the CLI reports that only
  `Read(path)` rules are matched by file permission checks). Symlink and `..`
  escapes out of the allowed subtree were blocked correctly. Re-probed on
  2.1.251 (2026-08-30) with the shipped recipe: a file under `ask/<thread>/wt/`
  reads, Globs and Greps; `store/`, the DB and `.env` are refused; a file outside
  every rule is still read (`unmatched ⇒ allow` persists); and `Grep` under a
  denied directory was refused this time. On 2026-08-30 the user chose this
  grant over a hardened worca-side reader, accepting those limits. Because a deny beats an allow and the chat's worktrees live inside the
  home, the home is no longer denied as a whole: `ASK_DENY_RULES` enumerates
  worca's own state instead (`worca-cc.db*`, `worca.db*`, `settings.json`,
  `store/`, `runs/`, `plugins/`, `tmp/`, every `secrets.json` and `.env*`) plus the
  common credential stores (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`,
  `~/.claude`, `~/.netrc`, `~/.npmrc`, `~/.config/gh`). `askWorktreeAllowRules()`
  names the thread's own `ask/<threadId>/wt/**` subtree — explicit intent that
  also keeps the worktrees readable should the engine ever gain `unmatched ⇒
  deny`. Rule 7 of the system prompt confines the model to the worktree path;
  that is guidance, not enforcement.
  **How the `git` tool defends itself** (it is the one file-access surface that
  permission rules do not govern): (1) `src/core/ask/git-allowlist.mjs` allows a
  fixed read set (`diff`, `log`, `show`, `status`, `blame`, `rev-parse`,
  `merge-base`, `grep`, `shortlog`, `describe`, `ls-files`, `ls-tree`), list-only
  `branch`/`tag`, always-`--detach` `checkout`/`switch`, and `fetch` against a
  configured remote NAME only — `push`/`pull`/`commit`/`config`/`cat-file` and
  every unknown subcommand are refused, as are the arbitrary-read/exec options
  (`-c`, `--git-dir`, `--work-tree`, `-C`, `--exec-path`, `--ext-diff`,
  `--textconv`, `--output`/`-o`, `--upload-pack`/`--receive-pack`, `--no-index`,
  `--contents`, `-f`/`--file`, `--filters`, `--color`, `--color-words`/`--color-moved`, and any
  `-O…`), the output-SHAPE flags that move a header or a path off its line
  (`--graph`, `--line-prefix`, `--src-prefix`/`--dst-prefix`/`--no-prefix`/
  `--default-prefix`, `--relative`, `--submodule`), and `--format`/`--pretty` on
  the path-list subcommands (`ls-tree`/`ls-files`). A positional that resolves to
  a bare BLOB is refused everywhere (`diff <blob> <blob>`, `grep <pat> <blob>`) and
  a tree for `show`; every colon suffix of a positional is checked against the
  protected paths (`:0:.env`, `leak:.env`, `:/.env`, `-L1,5:.env`). (2) git is
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
  **Branch fetches outside the worktrees** (#527). Three more Ask paths fetch:
  `list_branches` (unless called with `fresh:false`), `open_worktree`'s fallback
  for a branch only the remote has (a bare name resolved to `<remote>/<name>`, or
  a `<remote>/<name>` pushed since the last fetch), and `propose_run`'s check of
  its `sourceBranch`. Each runs `git fetch --prune --no-tags <sync.remote>` in the
  **project folder**, not in an Ask worktree, through the same 45-second cache the
  app uses, so it only moves that remote's remote-tracking refs and `FETCH_HEAD`:
  nothing is fast-forwarded, no branch is created and no working tree is touched
  (`src/core/ask/branch-deps.mjs` is pinned to import no write helper). The
  credential differs by mode. In classic mode the tools run in the MCP child,
  whose env is scrubbed, so the fetch carries no worca GitHub credential: git
  falls back to the user's own credential helpers or ssh-agent, and on a hosted
  instance with an env-only token a private remote answers `auth`, which
  `list_branches` reports as `stale` with the last fetch time. In relay mode the
  tools run inside the worca server, so the fetch uses worca's read credential.
  Tokens are never forwarded into the MCP child's env.
  **Scripts the chat can write and run.** With **Create and run scripts**
  (Settings → Ask Worca, on by default) the assistant holds four more worca MCP
  tools: `list_scripts` and `get_script` read the registry, `save_script` writes
  a script to the user layer (`~/.worca-cc/scripts`) and `test_script` runs one
  in worca's test bench — both **without a confirmation card**, by an explicit
  user decision on 2026-09-18. A script is a child process with worca's
  privileges and **no sandbox**, so a successful prompt injection in anything the
  chat reads (a repository file, a diff comment, an attachment, a run's output)
  becomes code execution on this machine. None of what follows blocks that;
  these are the limits that remain. The system prompt states that only the
  user's own messages are a reason to save or run a script and that everything
  read through a tool is data. Every chat-authored script is stamped
  `createdBy` / `updatedBy: ask:<threadId>`. Replacing an existing key needs an
  explicit `overwrite: true`; built-in and plugin scripts are never written over,
  and there is no delete tool. A bench run uses a scratch folder unless the user
  pinned a project for the chat, and never another project's checkout — a saved
  case runs as saved, and one whose folder is another project is refused. Every
  call is a line in the thread. Sub-agents are told never to call either writer. Turn
  the switch off and `save_script` / `test_script` are not registered for the
  session at all — the two readers stay, and the prompt section goes with them.
  **Web access (off by default).** Settings → Ask Worca → Web access gives the
  assistant `web_fetch` (GET one https page, HTML converted to text) and, when a
  search endpoint is configured, `web_search`. They are worca MCP tools; the
  native `WebFetch`/`WebSearch` stay denied. Every rule is enforced by worca's
  server, not by the prompt:
  - **The allowlist is the control.** One host per line: `example.com`, or
    `*.example.com` for its subdomains only. Any other host is refused before a
    connection, and so is a redirect to one (at most 3 hops, each re-checked).
    A wildcard over a domain where anyone can host a site is refused
    (`*.github.io`, `*.vercel.app`, `*.co.uk`, …); list the exact host instead.
  - **New sites are approved in the chat.** When Ask wants a host that is not
    allowed, it calls `propose_web_access` and ends its turn. The card shows the
    host, the reason and the exact URL: **Allow for this chat** (recorded on the
    card; other chats are unaffected), **Always allow** (the exact host joins the
    allowlist above) or **Deny**. The click is re-checked against the chat's
    current web access, so a card fails if web access was switched off or the
    host is outside the team's cap. Web access with an empty allowlist is on,
    with every site going through a card. Sub-agents cannot ask.
  - **Any site, without asking** (off by default) skips the allowlist and the
    cards; every other rule below still applies. It is risky: a page or a file
    Ask reads can then make it send data to any site inside a URL. A team
    allowlist cap still binds it.
  - **Data-in-URL rule** (defence in depth): https only, the default port, no
    credentials, no IP-literal hosts, a query of at most 256 characters, a path of
    at most 512, and no long token that looks like encoded data (base64, hex,
    keys). Short runs of data still pass, so a site sees every URL Ask requests
    from it — only allowlist hosts you trust with that.
  - **SSRF:** a host that resolves to any loopback, private, link-local
    (cloud metadata), CGNAT, ULA or other reserved address is refused; the check
    runs on the address actually dialled. Pages are capped at 2 MiB and 100 000
    characters of text, 15 s per call; only text types are read. The text reaches
    the chat in pages of 20 000 characters, 30 000 at most (Claude Code moves a
    larger tool result into a file the chat cannot read). Node's `https`
    ignores `HTTPS_PROXY`, so a proxy-only network cannot use web access in v1.
    On a worca with no route to the internet (`compose.egress.yml` puts it on an
    internal network) every fetch fails; when the host name does not resolve, or
    the connection is refused or times out before the host answers, the error
    says this worca may not have internet access instead of only the network
    code (the log entry keeps the code).
  - **Search** is any GET JSON API: an https URL template with `{query}` (and
    optionally `{key}`), plus an optional key header and prefix. The key is always
    a `${VAR}` reference read from worca's environment — never stored in
    `settings.json`, and never a `WORCA_*`, `ANTHROPIC_*` or `CLAUDE_*` variable.
    Its value is never written to disk either: the named variable is passed
    through the chat's process environment to worca's MCP server, so no file the
    chat can read holds it. When agents run under their own users, the web tools run in
    the worca server itself (the tool relay), and the key never reaches the
    agent user's process.
  - **Team policy only narrows it.** `ask.webEnabled` can only be "off" (it
    switches web access off for chats pinned to the project) and
    `ask.webAllowedDomains` caps each developer's own list (hosts outside it are
    dropped). A policy never switches web access on or adds a host: the policy
    branch is writable by anyone who can push to the repository.
  - **Log:** every call, refused ones included, is one JSON line in
    `~/.worca-cc/logs/ask-web.jsonl` (redacted, clipped URLs; never page text,
    queries or keys; rotated at 5 MB). The chat is denied `Read` on `logs/`.
  **Agent mode (on by default, per chat).** The Agent switch in the Ask composer
  lets the assistant run shell commands in Worca terminals (`run_command`,
  `read_output`, `wait_for`, `stop_command`, `list_blocks`): tests, builds, git
  status, and file changes through commands when you ask for them. The shell runs
  as the Worca server's user, like a person's terminal and Actions. It starts from
  a cleaned environment (PATH, HOME, locale, proxy and CA variables and
  `SSH_AUTH_SOCK`; no model, GitHub or server tokens, and none of your shell rc
  files), and every command passes a check first: Worca's own files and API,
  credential paths, force pushes, `rm -r` outside the folder, `sudo` and similar
  are refused. Ask's terminals are shared with you: a shell you (or Ask) moved
  with `cd` is kept only while it stays inside the project folder or the run's
  checkout, and the check runs against the folder the shell is really in; a shell
  outside it is never used. That check is a rail against mistakes, not a sandbox: an
  obfuscated command can get around it. `Edit` and `Write` stay denied for the
  chat itself. With agent isolation on, agent mode is off: a server-user shell
  would undo the isolation. See [Terminal](terminal.md#ask-worca-agent-mode).
