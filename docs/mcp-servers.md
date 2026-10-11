# MCP servers

Worca has its own MCP registry: servers installed **for worca only** — never written into your Claude
Code config (`~/.claude.json`, `.mcp.json`) — that pipeline agents and Ask Worca can call. It lives
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
- **General** is built in. Ask Worca always uses it, and so do a project's runs until the project turns it off (below).
- A project picks any number of sets on its **Sets** tab (Projects → a project → Sets). **Include
  General in runs** (on by default) adds General to its pipeline runs; Ask Worca always includes
  General, and a workspace run includes it when any member does. A project with no sets, General
  off and no team policy requiring MCP servers gets no registry servers ("No MCP servers in runs on
  this project").
- Different credentials per project ⇒ different sets: **Duplicate** a set (the copy starts with
  the same members, values and secrets), replace what differs, assign it. Duplicating a Team set
  gives an ordinary set with the same members, values and secrets.
- Deleting a set removes its values, secrets and test results; the confirm lists the projects that
  used it and flags those left with no servers. A deleted set's id is never reused.

## Bundled servers

The built-in marketplace ships these servers as plugins. Install one on the **Marketplace** page
(**Available**), then add its server to a set (**Connectors › Sets › Add server**) and fill in its fields.
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
  in pipeline agents; turn one off.
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
`linear`; Ask Worca has no guardrails, so no deny rule binds a chat's copies
([guardrails.md](guardrails.md)).

## What each surface gets

- **Pipelines:** every agent of a run gets the servers of the sets its project (or, for a workspace,
  its members) resolves to, plus its policy's Team set (for a workspace run, the workspace policy's
  only). New Pipeline › Advanced › **Sets**
  lets you switch memberships off for one run (schedules keep the choice); skipped memberships show
  their reason. Workspace scans and memory defragment runs get none. A workspace attaches no sets of its
  own: its Overview lists what its runs get, each row with the member project that brings it.
- **Ask Worca:** General plus the sets of every project in play — the pinned or page project (a
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
- with **Create and run scripts** on, an Ask script runs with worca's privileges;
- Claude Code's own session transcripts (`~/.claude/projects`) are not redacted;
- a proxy URL with credentials reaches every registry stdio server;
- with the [credential broker](credential-broker.md) on, registry secrets are delivered to agents
  and each run warns how many are visible.

A registry server is a network path outside Ask web access and outside guardrail presets; which sets
include it is the guard ([guardrails.md](guardrails.md)).

## One registry per worca

The registry is per `WORCA_HOME`. On a shared instance every signed-in person edits the same sets
and replaces (never reads) the same secrets, and every person's runs and chats use them — see
[remote-access.md](remote-access.md#limits).
