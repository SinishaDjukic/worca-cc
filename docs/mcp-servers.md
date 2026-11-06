# MCP servers

Worca has its own MCP registry: servers installed **for worca only** — never written into your Claude
Code config (`~/.claude.json`, `.mcp.json`) — that pipeline agents and Chat can call. It lives
on the **Connectors** page (Advanced; its **Sets**, **Servers** and **Skills** views) and in four files
under `~/.worca-cc/mcp/` ([storage.md](storage.md)). A set holds skills as well as servers: see
[skills.md](skills.md).

## Catalog and sets

- The **catalog** (the **Servers** view) is what is installed: servers shipped by plugins
  (`mcpServers` in the plugin manifest, plugin API 5), servers added by hand (**Add MCP server**),
  and servers a team policy requires ([team-policy.md](team-policy.md)). Nothing is configured there.
  Badges: `plugin disabled`, `also in your Claude Code config` (the name is also a server in your
  `~/.claude.json`), `no longer required by <home>`, `name provisional`.
- A **set** (the **Sets** view) holds servers **and their configuration**: each (set, server)
  membership has its own values and secrets. The same server can sit in several sets with different
  credentials. There is no per-server and no per-project configuration.
- **General** is built in. Chat always uses it, and so do a project's runs until the project turns it off (below).
- A project picks any number of sets on its **Sets** tab (Projects → a project → Sets). **Include
  General in runs** (on by default) adds General to its pipeline runs; Chat always includes
  General, and a workspace run includes it when any member does. A project with no sets, General
  off and no team policy requiring MCP servers gets no registry servers ("No MCP servers in runs on
  this project").
- The project's **Sets** tab also lists the servers of the repository's own `.mcp.json`, when it has
  any. A run starts only the approved ones, on every engine. An approval counts only where a
  repository cannot put one ([models.md](models.md)). On Claude, worca names the rest in
  `disabledMcpjsonServers` of the settings it passes at each spawn, because Claude Code started in
  `-p` would otherwise start every one of them. **Approve** names a server in the project's untracked
  `.claude/settings.local.json`; when git tracks that file, approve it in `~/.claude/settings.json`.
- On Claude, a pipeline agent loads only the run's own servers (its sets, the project's `.mcp.json` and
  local scope), not those of your `~/.claude.json`, your Claude Code plugins or your claude.ai connectors:
  their tool definitions would ride every call of every agent. An agent still loads all of them when its
  agent file names one of their tools (e.g. a plugin's Playwright), and so does every agent of a run that
  uses an approved server of the repository's committed `.mcp.json`.
- Different credentials per project ⇒ different sets: **Duplicate** a set (the copy starts with
  the same members, values and secrets), replace what differs, assign it. Duplicating a Team set
  gives an ordinary set with the same members, values and secrets.
- Deleting a set removes its values, secrets and test results; the confirm lists the projects that
  used it and flags those left with no servers. A deleted set's id is never reused.

## Bundled servers

The built-in marketplace ships these servers as plugins. Install one on the **Marketplace** page
(**Browse**); its last step, **Set up in Connectors**, opens Connectors › Servers. Then add its server to a
set (**Connectors › Sets › Add server**) and fill in its fields.
Worca runs no OAuth flow, so each server takes a token or uses a CLI you are logged in to. Each
plugin's `README.md` says where to get its credentials.

| Plugin | Server | Runs | Fields |
|---|---|---|---|
| `cloudflare-mcp` | `cloudflare` | `https://mcp.cloudflare.com/mcp` | **Cloudflare API token** (required) |
| | `cloudflare-docs` | `https://docs.mcp.cloudflare.com/mcp` | none |
| `atlassian-mcp` | `atlassian` | `https://mcp.atlassian.com/v2/mcp` | **Base64 of email:API token** (required) |
| `firebase-mcp` | `firebase` | `npx -y firebase-tools@latest mcp` | **Project directory**, **Feature groups**, **Service account key file** (all optional) |
| `railway-mcp` | `railway` | `railway mcp local` (Railway CLI ≥ 5.44.0) | **Railway account token** (optional) |
| `notion-mcp` | `notion` | `npx -y @notionhq/notion-mcp-server` | **Notion integration secret** (required) |

- Pipeline agents call these servers' tools without asking. Give each token only the permissions
  your agents need; a broad token lets an agent delete what the token can reach.
- A server you also have in Claude Code (your `~/.claude.json` or a Claude Code plugin) loads twice
  in a pipeline agent that loads your Claude Code servers too (above); turn one off.
- `firebase` and `railway` fall back to your own `firebase login` / `railway login` when their
  key or token is blank. Under agent isolation the server runs as the agent user, who has neither:
  fill in the key file or token.
- `firebase` and `notion` run through `npx`, which keeps one copy of each package per OS user,
  shared by every project. A new `firebase-tools` release is installed on the next start; that
  normally fits the startup limits in **Limits and costs** below, and
  `plugins/firebase-mcp/README.md` shows what to do on a slow connection.
- Notion's and Railway's hosted servers accept OAuth sign-in only, so `notion-mcp` and
  `railway-mcp` run the local servers. Notion no longer actively maintains its open-source server.

## Adding a server by hand

**Add MCP server** asks for a name (`a-z`, digits and `-`, starting with a letter, up to 20
characters; `worca` is reserved), a type (`stdio`, `http` or `sse`), the command and arguments
or the URL, environment variables or headers, and a description.

- A row marked **per set** becomes a field each set fills in; what you type is its default.
  **Secret** implies per set and takes no value here.
- `{name}` in Arguments or the URL declares a required field. A URL placeholder in the path or query
  can be marked secret (one that is the value of a parameter such as `api_key` starts secret); an
  argument can never be secret, because `ps` shows every process's arguments.
- **Bearer token** (http/sse) adds a secret `token` field sent as `Authorization: Bearer …`.
- The form checks as you type: no `${` or control characters in plain text, no literal that looks
  like a token ("looks like a secret — make it a secret field"), `https:` (plain `http:` only for localhost).
- Commands are absolute or found on `PATH`; relative paths are refused.
- **Edit definition** keeps the name (to rename, add a new server and remove this one); changing the
  type or the fields keeps each set's values whose field still exists with the same secret flag.
  **Remove** takes the server out of every set with its secrets.

## Configuring a membership

In a set, **Add server** picks from the catalog and asks for that set's values. Each member card
shows its switch (off keeps the configuration and starts nothing), its **copy name**, the fields,
and its state: `18 tools · tested 3d ago`, `stale` (something changed since the test), `not tested`,
`<field> not set · skipped until set`, `token rejected`, `plugin disabled`, `off`, or
`tool too long for 64: <tool>`.

- Secrets show as set, with their age; **Replace** swaps one. Worca never shows a stored secret.
- An **OAuth** token (from a provider's OAuth flow; worca runs none) is refreshed by hand: paste the
  new token with Replace. After 30 days its age turns amber.
- **Test** starts the server exactly as a run would, lists its tools (2 minutes at most — a first
  `npx` download fits, and warms the cache for runs) and stops it and
  everything it started. Saving a complete membership, applying a plugin update on the
  Marketplace page and editing a manual definition run Test in the background for the memberships that are
  on (a switched-off one starts nothing), and so does a Team Install / Turn on / Update. An http/sse
  Test does not go through `HTTPS_PROXY` unless worca runs with
  `NODE_USE_ENV_PROXY=1` (on a Node release that has it).

### `$env` secrets and what a server sees

A secret can name a variable of worca's own environment instead of holding a value (**or read it
from an MCP_… variable**). The name must match `MCP_[A-Z0-9_]{1,60}`: you expose a variable to the
registry on purpose, and no worca, Claude, GitHub or model credential can be routed into a server.
An unset or empty variable leaves the field "not set".

Every stdio server starts through worca's launcher with **only** these variables: `HOME LOGNAME PATH
SHELL TERM USER TMPDIR LANG` and every `LC_*` (Windows: `APPDATA HOMEDRIVE HOMEPATH LOCALAPPDATA PATH
PATHEXT COMSPEC PROCESSOR_ARCHITECTURE SYSTEMDRIVE SYSTEMROOT TEMP TMP USERNAME USERPROFILE
PROGRAMFILES`), the proxy and CA variables (`HTTP_PROXY HTTPS_PROXY NO_PROXY`, lower-case too,
`NODE_EXTRA_CA_CERTS SSL_CERT_FILE SSL_CERT_DIR REQUESTS_CA_BUNDLE`), plus what its definition
declares. A server that needs anything else declares it, as a field or an `$env` secret.

## Copy names

Each membership runs as its own **copy**: General's copy keeps the server's base name (`sentry`), any
other set's copy carries the set (`sentry_billing`, `sentry_shop`), even when it is the only copy in
a run. Names never change once given. When a pipeline's project, committed, local or user-scope
config already has a server of that name, the copy runs as `<copy>_w` and the run warns (if that is
taken too it is skipped). In a pipeline, a deny rule on `mcp__linear__…` reaches every copy of
`linear`; Chat has no guardrails, so no deny rule binds a chat's copies
([guardrails.md](guardrails.md)).

## What each surface gets

- **Pipelines:** every agent of a run gets the servers of the sets its project (or, for a workspace,
  its members) resolves to, plus its policy's Team set (for a workspace run, the workspace policy's
  only). New Pipeline › Advanced › **Sets**
  lets you switch memberships off for one run (schedules keep the choice); skipped memberships show
  their reason. Workspace scans and memory defragment runs get none. A workspace attaches no sets of its
  own: its Overview lists what its runs get, each row with the member project that brings it.
- **Chat:** General plus the sets of every project in play — the chat's project or workspace (a
  workspace brings its members) and **every project the chat has a worktree on** — and the Team set of
  each one's policy (a workspace's own policy, not its members'). The chat's model
  can open a worktree on any registered project without asking, and that project's servers and skills join
  from the next message; the chat says so. The composer's **Sets · N** button is a per-chat picker
  (sets, then their servers and skills) whose choices apply from the next message.
- Problems at start (`failed`, `needs-auth`, disabled by your Claude Code settings, blocked by
  managed policy) become run warnings or a muted line in the chat.

## Limits and costs

- At most 12 copies per Ask message and 24 per pipeline agent; project sets are kept first, then
  Team sets, then General.
- Tool names are `mcp__<copy>__<tool>`, at most 128 characters (64 for models behind the bridge);
  a longer tool is withheld and its server still starts. Under the 64 limit a copy with no current
  Test result is skipped.
- Every Ask message starts its stdio servers afresh, three at a time, each given 60 s to start;
  pipelines start them on every agent spawn with 2 minutes each, and **Test** waits 2 minutes too.
  That fits a first `npx` download of a large package (firebase-tools: 33.5 s measured). Your own
  `MCP_TIMEOUT` in worca's environment (whole milliseconds, 1000 or more) replaces all three. A
  server that hangs holds its slot for the whole limit: if every server hangs, about 5 minutes
  before Ask's first answer and up to about 16 minutes per pipeline agent (normally: 12.5 s
  measured for five slow servers). A change of servers between messages costs one prompt-cache miss.
  In a pipeline agent the limit also covers your own Claude Code servers, which load in the same
  spawn. Through Cloudflare ([remote-access.md](remote-access.md)), which ends a request after
  100 s, a longer Test shows `HTTP 524`; worca still finishes it, and reopening the **Connectors**
  page shows the result.

## What can still read a secret

Values live only in `~/.worca-cc/mcp/secrets.json` (mode 0600) and reach processes as spawn
environment; config files hold `${MCPSECRET_…}` references. Still:

- a pipeline agent has Bash and can print its own environment — its transcript is redacted, but
  files it writes (artifacts, the diff, commits, PR text) are not;
- in a pipeline, project, local and user-scope stdio servers, hooks and Claude Code plugins inherit
  the `claude` environment;
- without agent isolation any pipeline agent can read `secrets.json`; under agent isolation one
  person's agents share a user and can read each other's process environment;
- with **Create and run scripts** on, an Ask script runs with worca's privileges (a draft or a
  changed script only after the user presses Run or Save on its card);
- Claude Code's own session transcripts (`~/.claude/projects`) are not redacted;
- a proxy URL with credentials reaches every registry stdio server;
- with the [credential broker](credential-broker.md) on, registry secrets are delivered to agents
  and each run warns how many are visible.

A registry server is a network path outside Ask web access and outside guardrail presets; which sets
include it is the guard ([guardrails.md](guardrails.md)).

## Chat

The chat reads the registry and prepares changes to Manual servers; it never writes one itself.

- **`list_mcp_servers`** returns every server in the registry: Manual, plugin and Team. For each
  server it gives the id, name, origin (`Manual`, the plugin name, or `Team · <home>`), the type
  (`stdio`, `http` or `sse`), the command and arguments or the URL, the env names or header names
  with their text, the fields, the sets it is in, and which run engines can attach it (with the
  reason for the others). For each set it gives whether the server is enabled there and each
  secret's state: `set`, `not set`, or the `$MCP_…` variable it reads. No secret value is ever
  returned. A literal that looks like a token, or that sits under a secret-named env or header name,
  shows as `••••`.
- **Scope** in worca means a server's origin (Manual, a plugin, Team) and the sets it is in, as
  `list_mcp_servers` returns them. A server reaches chats and runs only as an enabled member of a set
  (General, or a set assigned to a project).
- **`propose_mcp_change`** (kind `add`, `edit` or `remove`) changes **Manual servers only**. It
  returns a card that shows every command, argument, URL, env name and header name word for word,
  with the warnings and what applying does. The user clicks **Add**, **Save** or **Remove**, or
  **Decline**. Plugin and Team servers are read-only from chat: they change with their plugin or
  their team's policy. An edit sends the whole new definition back, as `list_mcp_servers` returned it. A value it
  shows as `••••` and sends back as `••••` keeps the stored value there; the card pins the stored
  definition by a digest, so it never carries a stored value the chat cannot see.
- **Apply saves the definition only.** An added server is in no set: turn it on in a set on
  Connectors › Sets. An edit re-tests the sets the server is in; a remove takes it out of every set
  with its values, secrets and test results.
- **Secrets never pass through the chat.** An env or header given as `{"secret": true}`, a value
  under a secret-looking name, and a whole-value `${VAR}` all become an empty secret field. The user
  fills it in each set, by pasting the value or by picking an `MCP_` variable from worca's
  environment. A value the model sends for such a name is dropped and the card says so. A
  secret-looking literal anywhere else (an argument, a non-secret env name, the note) is refused,
  and the error names the place, never the value.
- **An edit card warns about kept secrets.** When the command line or the URL changes, the card adds
  `secret <label> (stored in <sets>) will now be given to <command or host>` for each stored secret
  field the new definition keeps. When only env or header entries are added or changed (for example
  `NODE_OPTIONS`, `LD_PRELOAD` or a proxy variable), it adds `secret <label> (stored in <sets>) stays
  while <rows> change: check them before applying`.
- **A stale card fails.** An edit or remove card pins the definition it was made from. If the stored
  definition changed meanwhile (on the Settings page, say), Apply fails with
  `<name> changed since this card was made — ask the chat again`.
- An isolated agent cannot apply a card; only a person's click can.

When the user acts on a card, the chat gets one of:

```
[worca event] mcp card <id> applied; "<summary>"; <detail>
[worca event] mcp card <id> declined; "<summary>"
[worca event] mcp card <id> failed: <error>; "<summary>"
```

### Import from other tools

`discover_mcp_servers` lists the MCP servers other tools define. It only reads: it never writes those
files or watches them. User-level files are read only on a local worca (not in a container, not hosted);
project files come from the chat's pinned project, or each member of its pinned workspace.

| Tool | User-level file | Project file | Root key |
|---|---|---|---|
| Claude Code | `~/.claude.json` (`mcpServers`, and `projects["<project path>"].mcpServers` for the pinned project) | `.mcp.json` | `mcpServers` |
| Claude Desktop | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\…`, Linux `~/.config/Claude/…` | none | `mcpServers` |
| Cursor | `~/.cursor/mcp.json` | `.cursor/mcp.json` | `mcpServers` (transport in `type` or `transport`) |
| VS Code | `mcp.json` in the user profile folder (`~/Library/Application Support/Code/User`, `%APPDATA%\Code\User`, `~/.config/Code/User`) | `.vscode/mcp.json` (comments allowed) | `servers` |
| Codex | `~/.codex/config.toml` (or `$CODEX_HOME`) | `.codex/config.toml` | `[mcp_servers.<name>]` |
| Gemini CLI | `~/.gemini/settings.json` | `.gemini/settings.json` | `mcpServers` (`httpUrl` is HTTP, `url` is SSE) |

Each server shows its tool, source file, name, transport, and command and arguments or URL. It also shows
whether worca already has it (the same name and the same command or URL), and why it cannot be imported, if it
cannot. Every env and header value shows as `••••`. A missing file is listed as missing, and a malformed
one as an error that names the line, never the content.

`propose_mcp_change` kind `import` takes up to 10 of those ids and returns one card (**Import**). A
secret, which is a `${VAR}`, `${env:VAR}`, `${input:…}` or `$VAR` reference, a value under a
secret-looking name, or a token-shaped value, becomes an empty secret field. Its value is never copied:
the user pastes it, or picks an `MCP_` variable, on Connectors › MCP servers. A server with a secret in an
argument or in its URL, `${…}` inside a longer value, or a transport worca lacks (`ws`) is not imported,
and the card says why. Applying adds the definitions as Manual servers in no set.

A credential inside a longer value also counts as a secret: a URL login (`postgres://user:password@host`),
a URL with a secret query parameter or fragment, a header line (`Authorization: Bearer …`) in an argument or
env value, or a `NAME=value` argument under a secret-looking name (`docker -e API_KEY=…`, `--env=DB_PASSWORD=…`).
Arguments of a shell wrapper (`sh -c '…'`) are shown as written and checked only for those shapes, and a short
flag followed by a plain word (`-p hunter2`) is not recognised: the card shows every argument in full before
you apply it. The chat lists at most 100 servers and says how many more there are.

These file facts were not confirmed against each tool's documentation, so treat them as best effort: VS Code's
user-profile `mcp.json` with root `servers`, Codex `bearer_token_env_var` and `env_http_headers`, and Codex
reading a project `.codex/config.toml`. A wrong guess lists nothing for that file; it never fails. For the
JSONC files (VS Code, Gemini CLI) the line and column of a parse error are approximate, because comments are
stripped before parsing.

#### From the Servers view

A person can do the same import without the chat. On Connectors › MCP servers, the Servers view has
**Import from other tools**:

- The dialog lists what the files above hold, with the same masking, flags and per-file errors. It scans this
  machine's user-level files and, if you pick one, a registered project's files. On a container or hosted worca
  the user-level files are not read, and the dialog says so: pick a project to scan its files.
- Tick up to 10 servers. Each ticked row has a worca name, prefilled with the suggested one; change it when that
  name is taken or none could be made. Servers already in worca, and servers that cannot be imported, cannot be
  ticked.
- **Review** shows the import card the chat would show: the definition rows, the empty secret fields, the
  variable notes, the skipped servers and the ones already in worca. Nothing is written yet.
- **Import** adds the definitions as Manual servers in no set. Turn them on in a set to use them. They are
  written together: if another tab or the chat took one of the names meanwhile, none of them is added.
- If the files or worca's servers changed since the review, Import answers that they changed and offers
  **Review again**. The import writes only what you reviewed.

The routes are `GET /api/mcp/discover?project=<key>` (read-only) and `POST /api/mcp/import`. The POST takes
`{ projectKey, servers: [{ id, as }] }` and answers the review with a `digest`. The same body with `apply: true`
and that `digest` writes. Under agent isolation both need the UI token, like every Connectors route. An apply
from a caller that may be an agent is refused (`MCP_IMPORT_AGENT_BLOCKED`): a person confirms an import.

## One registry per worca

The registry is per `WORCA_HOME`. On a shared instance every signed-in person edits the same sets
and replaces (never reads) the same secrets, and every person's runs and chats use them — see
[remote-access.md](remote-access.md#limits).
