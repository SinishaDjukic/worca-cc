# Terminal

A terminal in the tool panel on the right side of every Worca page. The shell runs on the Worca server, in the
folder of what you are looking at, and every command you run is recorded with its output, exit code,
duration, who ran it and when.

> **What this means:** the shell runs as the user Worca runs as, in folders whose code agents wrote.
> On a hosted Worca it is off unless an administrator sets `WORCA_TERMINAL_REMOTE=1`.

## Where it opens

Open a terminal with the Terminal icon in a run's or a chat's header, the terminal button next to a project's
name, or Ctrl+\` on any page. It focuses the newest terminal tab of the page, or opens one: that reattaches the
page's running shell, or starts one.

| Page | Folder |
| --- | --- |
| A running run | its live worktree. The terminal warns that the pipeline is still changing those files. |
| A finished run | its checkout (see [Actions](actions.md)). With none yet, Worca makes the checkout first. |
| A workspace run | one terminal per member; the select next to the folder picks the member and opens its shell in a new tab. |
| A run with No project | its own `work/` folder while it runs or is paused; once it ends there is none (its files are its Artifacts). |
| A chat | the chat's newest worktree of its project if it still exists, else the project's own folder. A chat with No project, or one scoped to a workspace, has no terminal (its icons are disabled with the reason), and neither has a chat before its first message. |
| A project page | your own checkout of the project (the folder you registered), on whatever is checked out there. |
| Any other page | no terminal and no panel: the Runs list, Workflows, Settings and the like have no tool icons, so the panel steps aside there. Its tabs and shells keep running, and it opens again as you left it when you go back to that run, chat or project. |

### The tool panel

The panel holds tabs of four kinds: **Terminal**, **Browser** (a web page, see below), **Files** (a read-only
browser of the folder; a file opens in the same viewer as run artifacts: markdown rendered with a Preview / Source
switch each tab remembers, highlighted code, tables, images, PDF, audio and video, HTML in a sandbox, LikeC4, and
Office documents as PDF when LibreOffice is installed, else as a simplified in-browser preview with Download) and **Changes** (the uncommitted changes of a project or chat folder, `git diff HEAD` plus
new files; a run shows its own diff). Several tabs of one kind can be open. Each shell is its own tab.

Two more kinds open only from a chat: **Design** (a design chat's stage, see docs/design.md) and **Run**: a run opened
from a chat (its card's Open, a link) shows in a Run tab beside the chat, the run page's own screen with its tabs and
**Open full page**, instead of a panel of its own. A chat has one Run tab, which follows the run its address names
(`#chat/<thread>/run/<id>/<tab>`): another run reuses it under its own title. Picking another tab (or the Overview)
steps the address back to the chat and keeps the Run tab in the strip; picking it again reopens its run. Escape, Back
or the tab's × close it. A new chat with no thread yet keeps the run beside the conversation until its first send.

- **Header icons.** Run and chat pages show the Overview icon, then four tool icons: Terminal, Browser, Files and
  Changes. A tool icon focuses the newest tab of that kind on the page, or opens one; Shift-click always opens another.
  Shortcuts: Ctrl+\` Terminal, Ctrl+Shift+F Browser, Ctrl+Shift+E Files, Ctrl+Shift+G Changes. Ctrl+\` on a
  terminal tab hides the panel again.
- **Suggested.** The **+** page also lists the page's running Actions services, recent addresses and the
  project's repository on GitHub (that one opens in a window of its own: GitHub refuses to be framed).
- **Tabs belong to what was in view.** A tab opened on a run belongs to that run, on a chat to that chat, on a
  project page to the project. The panel shows the page's project tabs, a thin divider, then the run's or chat's
  tabs. Right-click a tab (or its menu key) for **Move to project**, which keeps it beside every run and chat of
  that project. A workspace run or chat has no single project, so Move to project is off there. Tabs of other
  pages are hidden, not stopped: the **+** page lists every kind with its shortcut and counts the tabs in other
  chats and runs.
- **Keys and order.** Arrow keys move between tabs, Delete closes one, Shift+Arrow (or a drag) moves it.
- **Closing.** The **×** on a terminal tab closes that terminal, or type `exit` in it. A terminal that has run a
  command asks first; one that has not closes at once. In a shell without recorded commands (sh, fish, cmd.exe)
  any line you submitted counts. Hide (the panel's own **×**) keeps every shell running; opening the panel again
  reattaches them.
- **Size.** Drag the panel's edge to resize it, or maximize it over the whole window. Below 880 px wide it is a
  full-screen sheet. The open tabs, the width and maximize are kept per browser.
- **Archiving** a run or a chat closes its shells and its tabs.

#### Overview

The **Overview** is what the panel shows for a run, chat or project page while no tab is selected. It is not a tab:
the first header icon always comes back to it, and closing the last tab lands on it. It is a quiet list of sections,
each with a count; a click on a section's label folds it (the choice holds until the page reloads), and a section with
nothing in it is hidden. Arrow keys, Home and End move between its rows.

- **Chat:** Environment (the project or workspace, the engine and model, the branch of the run it follows),
  Context (folded at first; the context window, topics, agents and worktrees, the same as the composer's
  context popover), Runs the chat started (live status and cost; a click opens the run), Pull requests (their
  state; a click opens the pull request), Artifacts (the files the chat showed and the files it saved in its output
  folder, newest first, 5 then **Show all**) and Background (its running commands and its runs' running Actions,
  each with **Stop**).
- **Run:** its status, branch, project and whether it is checked out; its pull request, artifacts and running Actions.
- **Project:** its recent runs and their pull requests.

On the Chat page the composer's context meter opens the Overview with Context unfolded. In the side column, and in a
new chat before its first message, it opens the context popover as before. A new chat and a starting run have no
Overview (the icon says why); a chat without a project has one, while its tools stay off.

`GET /api/ask/threads/:id/overview` answers the chat's started runs (a run card's run, or one of its schedules',
never a run it only follows and never a PR fix run), their pull requests and the chat's applied pull request cards,
its shown and saved files (at most 50 each, newest first) and the followed run's branch. A saved file opens in a
Files tab through `root=out` (the chat's output folder; links in it are never followed).

A second shell of a folder is numbered, like `demo · main 2`. A shell opened in a branch folder (see below) is a
project tab named `<project> · <branch>`. Below the terminal is its folder, with a warning or the member select
when they apply. When the shell ends (you typed `exit`, or it died) or Worca restarts, the terminal says so and
starts a new one only when you press Enter.

### Browser tabs

A Browser tab has Back, Forward, Reload, an address bar and **Open in your browser**. A **local address**
(`localhost:5173`, `127.0.0.1`, `[::1]`; `:5173` alone works too) opens through Worca's preview proxy,
`/preview/<port>/<token>/`, so on a hosted Worca it shows the dev server on the *server's* machine. Any other
address loads directly.

- **Which ports.** Any port on this machine's loopback by default, never Worca's own port. Settings › Runs › Actions ›
  **Preview ports** can narrow this to *Actions range only* (the Actions port range, default 4400–4499, and the ports
  of running Actions). A hosted Worca is always *Actions range only*, and the choice shows locked there: on a server,
  any loopback port would reach its internal services. Hosted Worca previews only when Actions are on
  (`WORCA_ACTIONS_REMOTE=1`).
- **Isolation.** The page runs in a sandboxed frame without its own origin: it cannot read Worca's pages or call
  its API, and it has no cookies, local storage or service workers. Each tab gets a token for its port; Reload
  and a Worca restart mint a new one.
- **Addresses the page builds itself.** The proxy moves root-relative URLs in the HTML (`src`, `href`, `action`,
  `srcset`, CSS `url()`) under the prefix, adds an import map for module imports, and a small script for URLs
  made in JavaScript (WebSocket, fetch, XMLHttpRequest, EventSource, script, link and image `src`, `setAttribute`
  of a URL attribute, `innerHTML`, and the text of a `<style>`). Stylesheets (`text/css`) get their `url()` and
  `@import` moved too. That covers the dev-server assets, fonts and HMR sockets of Vite and Next (checked with a
  real Vite 5 and Next 14 dev server, HMR included). HTML a script fetches (htmx, Turbo) gets its URLs moved,
  without a second script. Not covered: `location` set to a root-relative path, `srcset` set from a script,
  workers, an app's own client-side router (it sees the `/preview/…` prefix: give it a base path, or open it
  externally), a page whose Content-Security-Policy blocks inline scripts, an answer compressed although the proxy
  asks for none (it passes unrewritten), and https dev servers. Next may log a hydration warning about the moved
  `src` of server-rendered images; it is harmless.
- **Sites that refuse framing.** A proxied page sent with `X-Frame-Options` or a `frame-ancestors` that leaves
  Worca out shows "This site cannot be shown here" with **Open externally**. For other sites the browser does not
  tell Worca (it shows its own error page, which loads like any page), so after a few seconds the tab says the site
  may not allow being shown here, with Open externally; the bar's button is always there. An Action whose Open
  link goes to another site keeps opening it in your browser's own tab.
- **Open externally** opens the address itself when Worca runs on your machine, else the proxied page in a new
  browser tab.
- **Dev server.** An empty Browser tab lists the running services of its run or project and, while the project
  has no service Action, offers its dev server from `package.json` (`dev`, else `start`): "Dev server:
  `npm run dev`, on a free Actions port — **Use this**". Use this saves it as a project Action (`PORT` auto, opened at
  `http://localhost:{PORT}`, ready when the port answers), adds the tool's port flag when it ignores `PORT` (Vite,
  Astro, Angular, webpack, Parcel, Gatsby, Storybook, Wrangler, Eleventy, React Router, VitePress:
  `npm run dev -- --port {PORT}`). A
  workspace runner (`turbo dev`, `pnpm --filter web dev`) may not pass `PORT` on to the server: if its ready check
  never passes, edit the saved Action's command (Project page › Actions). A script that names its own
  port keeps it ("port 3001"), and so does a tool the flag cannot reach (behind `concurrently`, a pipe or a
  background `&`): the Action holds that tool's default port. A script pinned below port 1024 is not offered. A run's
  checkout has no `node_modules`, so when `package.json` declares dependencies and the project has no setup command,
  Use this sets one too (`npm ci` with a lock file, else `npm install`; `pnpm install`, `yarn install`, `bun install`);
  the offer says so. A workspace run's tab offers nothing: add the dev server to a member project's Actions. Use this then starts it (in a run tab in
  that run's checkout; elsewhere in the project's newest finished run, like the editor's **Try**) and opens it
  once it is ready. Open on a running service (its run's Actions tab, the Overview strip, the sidebar's Running
  actions globe) opens a Browser tab too; Ctrl- or middle-click keeps your browser's own tab.
- **Pick element.** The cursor button on a local preview. Click it, then click an element in the page: the chat
  composer gets `element-<time>.png` (a fresh server-side load of the page, clipped to the element) and
  `picked-element-<time>.md` (address, selector, box, HTML snippet; untrusted page data). Esc cancels. The button is
  disabled with a tooltip on other sites and before a page loads. When the element is not on a fresh load (after
  clicks or a sign-in), only the `.md` goes, and a note says why.
- **The chat's tab tools.** `open_tab`, `screenshot_tab` and `read_tab` reach this chat's tabs and its project's tabs,
  never another chat's or a run's. The panel mirrors those lists to the server (the `tool_tabs` table), so the tools
  work from Discord or the CLI too. A tab the assistant opens carries a mark and joins the strip when the chat is next
  on screen. Captures run in a headless Chrome on the Worca server (`WORCA_CHROME` overrides the browser) through
  the same preview rules, on a fresh load: what you clicked or signed into is not in them. Other sites follow the
  chat's web allowlist. The tools are off under agent isolation and in the Workflows chat.

### Links from the chat

File paths and web links in the chat's answers open in tabs of the panel, in the chat's own tab group. Settings ›
Chat › **Links in answers** › *Open chat links in the panel* (default on) turns this off: then web links open a new
browser tab, as before, and file paths stay text. The chat cannot change this setting.

- **File links.** A repository path (`ui/public/app.js`, `src/core/`), with a line (`:120`, `:120-140`, `#L120`,
  `#L120-L140`), or a bare file name (`app.js`) becomes a link only when the server confirms it exists in the chat's
  root (`POST /api/ask/files/resolve`, in batches); anything else stays text. A bare name links only when exactly one
  file of the root has that name. A click opens a Files tab at the line (a line past the end goes to the last line),
  or brings the tab forward when that file is already open. A markdown file opened at a line shows its Source view.
  Links are buttons: Tab reaches them and they announce "File src/a.js, line 120, opens in the panel".
- **The root.** A chat that follows a run (its newest run link whose run still exists) resolves against that run:
  per member, its live or checked-out folder, else its feature branch when the folder is gone (an archived or
  finished run), read from git. A chat that follows no run resolves against the folder its Files tab shows (its
  newest worktree of the pinned project, else the project checkout). Branch files above 25 MiB are not previewed
  or downloaded from the panel.
- **Refused.** Absolute paths, `~`, drive letters, UNC paths, `..`, control characters, `.git`, symlinks leaving the
  folder (and any symlink on a branch), credential files (the rule `show_files` uses: keys, `.env`-style files,
  `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.azure`, `.worca-cc`, worca's databases) and worca's own files
  (`.claude/rules/worca/`, `.claude/skills/readiness-rubric/`). A refused path is never a link, the same as one that
  is not there.
- **Web links.** A plain click on an `http(s)` link opens a Browser tab of the chat (or brings forward the tab
  already showing that address). These keep the browser's own new tab: a click with Ctrl, Cmd, Shift or Alt, or a
  middle click; `mailto:` and `tel:`; an address with a login; worca's own pages other than its home page (an
  artifact, an API file, a preview); a loopback port the preview would refuse (a notice says "Port 5173 is not
  previewed here"); sites known to refuse being framed; and sites found refusing earlier in this browser session.
  worca's own home page (with any `#…` route) opens in place. `javascript:`, `data:`, `file:` and `blob:` links do
  nothing. A local address (`localhost:5173`) goes through the preview proxy as above. The answer labels each web
  link "…, opens in the panel" or "…, opens in a new tab".
- **Known refusers.** github.com, gitlab.com, bitbucket.org, google.com, youtube.com, gmail.com, facebook.com,
  instagram.com, x.com, twitter.com, linkedin.com, microsoftonline.com, live.com, outlook.com, office.com,
  microsoft365.com, sharepoint.com, dev.azure.com, visualstudio.com, atlassian.net, atlassian.com, slack.com,
  discord.com, notion.so, figma.com, stackoverflow.com, stackexchange.com, reddit.com, amazon.com, npmjs.com,
  apple.com, icloud.com, paypal.com, stripe.com, openai.com, chatgpt.com, claude.ai, anthropic.com, okta.com,
  auth0.com (and their subdomains), and any host whose first label is `accounts`, `login`, `signin`, `sign-in`,
  `auth`, `sso`, `oauth` or `identity`.
- **The framing check.** Before framing another site, the Browser tab asks `POST /api/tools/frame-check`. The server
  sends one HEAD (GET on 405/501, body never read) without cookies and reads only `X-Frame-Options` and CSP
  `frame-ancestors`. It asks only public hosts on their default port, checks every DNS answer when it connects,
  never goes through a proxy, re-checks each redirect (at most 3) and gives up after 4 s. Verdicts are kept per
  origin for an hour (an unknown answer for a minute). On a hosted worca the chat's web access and allowlist apply:
  web off or a host not allowed means no request. A site that refuses shows "This site cannot be shown here" with
  **Open externally**, and the browser remembers the origin for the session (later clicks open it outside). With no
  verdict the tab frames the page and keeps the few-seconds hint.
- **The address.** A Browser tab shows the real host beside the address bar; an international name (`xn--…`) is
  marked and its tooltip gives the real address.
- **open_tab for files.** The assistant can open `open_tab {kind: 'files', path, line?, endLine?}`: that file or
  folder of the chat's root, at the line. A missing or refused path, or a bad line (past the end, on a folder or a
  binary file, `endLine` before `line`), is an error the assistant sees. A file or address already open is brought
  forward instead (every page holding the tab takes the new line). At most 3 `open_tab` calls per turn open or
  bring forward a tab, sub-agents included; refused calls do not count.
- **Limits.** A site that refuses only on GET, or only on some paths, can still show the browser's error page: the
  hint with Open externally stays. A refusal found after an answer rendered changes its link label only on the next
  render (the click is right at once). A proxy-only network gets no verdicts. A loopback port the page could not
  foresee as refused shows the proxy's refusal with Open externally.

### Branch folders (API only)

The panel does not offer them, but `POST /api/projects/<key>/terminal` with a `branch` still opens a
terminal in `~/.worca-cc/terminal/worktrees/<project>/…`, a worktree of that branch. Without `branch` it
opens in the project's own folder, which Worca never removes. If the branch is checked out somewhere
else (often your own checkout), the branch folder is a **detached** copy of its latest commit, and
commits made there are not on the branch. Worca never deletes the branch. These folders follow **Keep
checkouts** (Settings › Runs › Actions): with `never` a clean folder goes when its last terminal closes;
otherwise it stays until `DELETE /api/projects/<key>/terminal/worktrees` removes it. **Max checkouts**
caps how many stay. A folder with uncommitted changes, or a detached copy holding commits no branch,
remote or tag reaches, is never removed automatically; the DELETE needs `force: true` for it.

## Sessions

Each terminal has an id, a folder, a status (`running`, `exited`, `closed`, `interrupted`), an exit
code and its output. It survives a page reload: its tab comes back and replays the last 512 KB. It ends when the
shell exits (type `exit`), when its tab's **×** or `DELETE /api/terminal/sessions/<id>` closes it, or when Worca stops. A terminal left running by a
Worca that crashed is stopped on the next start and shows as `interrupted`. At most 16 run at once.

When a run finishes, its worktree is removed (and re-created if a keep policy keeps it). A terminal
open there says so: `cd "$PWD"`, or type `exit` and press Enter for a new one. Before it is removed, Worca commits what is in
the worktree onto the run's branch, so changes you make in a running run's terminal become part of
the run's commit. To keep your own changes apart, wait for the run to finish and use its checkout.

## Recorded commands

In bash and zsh, Worca loads your own `~/.bashrc` / `.zshrc` and adds a few lines that mark where each
command starts and ends. Each command is recorded for the audit log as a block: the command, its exit
code, duration and output (the last 256 KB), who ran it and when. The panel does not show them; read
them through the API: `GET /api/terminal/sessions/<id>` lists a terminal's newest commands, and
`GET /api/terminal/sessions/<id>/blocks/<n>` returns one with its output. Other shells (sh, fish,
cmd.exe, PowerShell) work, but their commands are not recorded. A command typed with a leading space is
still recorded: the record is the audit.
When bash leaves a line out of its history (`HISTCONTROL=ignorespace`, `ignoredups` or `ignoreboth`,
which Ubuntu's default `.bashrc` sets), the block shows only the line's first command: a repeated
`cd x && make` is recorded as `cd x`.

The marks carry a secret that is new for each terminal and hidden from the programs you run, so output
that merely contains a mark (a `cat` of a file, another tool's shell integration) never creates a
command or an audit entry. Code that runs inside the shell itself (a file you `source`, a direnv hook)
can read that secret; programs the shell starts cannot. If your `.bashrc` installs its own `DEBUG` trap
after Worca's lines, or your zsh setup clears `precmd_functions`, commands are not recorded. Commands
typed in a shell you start inside the terminal (`bash`, `ssh`, `docker exec`) are part of that one
command's block, not blocks of their own.

Keys you type in the terminal are the shell's: Escape and Ctrl+K never act on the Worca page around it.
Ctrl+\` shows and hides the terminal from anywhere.

If a command prints faster than the page can draw it (`yes`, a large `cat`), Worca skips ahead: the
terminal jumps to the latest output instead of queueing everything. The recorded block still keeps its last 256 KB.

## Environment

| Variable | Value |
| --- | --- |
| `WORCA_RUN_ID`, `WORCA_BRANCH`, `WORCA_PROJECT_KEY`, `WORCA_MEMBER` | the run's facts |
| `WORCA_WORKTREE` | the folder |
| `WORCA_TERMINAL_SESSION` | this terminal's id |
| `WORCA_PORT_<ACTION>_<NAME>`, `WORCA_URL_<ACTION>` | each running action's ports and URL (`WORCA_PORT_<MEMBER>_<ACTION>_<NAME>` on a workspace run) |

They are read when the terminal opens: start the action first, then open a terminal. GitHub tokens and
Worca's own `WORCA_HOME` are not passed on, as for Actions. Neither is `PORT`, which is Worca's own
port: an app you start here picks its default port, or the one you give it. Because `WORCA_HOME` is not
passed on, a `worca` command typed here uses the default home (`~/.worca-cc`); on a Worca that runs with
another home (the Docker image uses `/worca`), run `export WORCA_HOME=/worca` first.

## Stop

Ctrl+C typed in the terminal stops the running command. With node-pty it reaches the program as in any
terminal. Without node-pty (see below) the terminal calls the stop API instead
(`POST /api/terminal/sessions/<id>/stop`, which is also there for scripts): it sends Ctrl+C to the
running command and, if that command is still running 3 seconds later, kills every process the
terminal started, including jobs you put in the background with `&`. There is no foreground job to aim
at, so the first Ctrl+C also reaches those background jobs. A stop through the API is recorded with who
stopped it. In a shell without blocks (sh, fish, cmd.exe), Worca cannot tell when a command ends, so
the stop API sends Ctrl+C only and never escalates. On Windows over pipes there is no Ctrl+C to
send: Stop ends the command after the 3 seconds (see Windows).

To end a terminal, type `exit` or press its tab's **×**; `DELETE /api/terminal/sessions/<id>` closes it from outside. The stop
and close APIs always work, even when the terminal is turned off. Discarding a run's checkout closes
the terminals open in it, as it stops the run's Actions. Archiving a run closes its terminals; archiving or
deleting a chat closes the chat's terminals, Ask's and the ones you opened from it.

## API

The tool panel uses these routes. They are for pages served by this Worca only (same origin, never a caller
that could be an agent). The browser never names a folder: it sends ids, and Worca resolves the folder.

- `POST /api/ask/threads/<id>/terminal` starts a shell in the chat's folder (see the table above).
- `GET /api/tools/files?scope=…&path=` lists one folder level (at most 2000 entries).
- `GET /api/tools/file?scope=…&path=` reads one file as text (the first 512 KB; a binary file is shown as a note, with no text).
- `GET /api/tools/changes?scope=…` returns the changes: a run's diff, or `git diff HEAD` plus new files of a
  project or chat folder.
- `POST /api/preview/sessions {port}` mints a Browser tab's token: `201 {port, token, base}`. Refused with
  `403 PORT_NOT_ALLOWED` (Preview ports set to *Actions range only*, or a hosted Worca, and the port is outside the range and running Actions), `403 SELF`, `400 BAD_PORT`,
  `409 WORCA_INSTANCE` (another Worca answers on that port), and `403 ACTIONS_DISABLED` where Actions are off.
- `GET|POST|… /preview/<port>/<token>/<path>` and WebSocket upgrades on it: the proxy, to `127.0.0.1` then
  `::1`. Its own answers (an expired token, nothing listening, a page that refuses framing) are small sandboxed
  pages that tell the tab their code.
- `GET /api/projects/<key>/dev-server` answers `{suggestion}` (null once the project has a service Action);
  `POST` saves it as a project Action: `201 {action, config}`, `409 HAS_SERVICE`, `404 NO_DEV_SCRIPT`. The body
  carries no command.
- `GET /api/tools/tabs?scope=chat&threadId=<id>` (or `scope=project&projectKey=<key>`) answers the scope's mirrored
  tabs, the assistant's undelivered ones included; `PUT` with `{tabs, seen}` replaces the list. A tab the assistant
  opened and the page has not seen stays. Run scopes are refused (`400`), a gone or archived chat is `404 SCOPE_GONE`.
- `POST /api/tools/browser/pick {url, selector, viewport}` renders a local preview on a fresh load and answers the
  element's screenshot `{png, width, height}` (base64); `409 NOT_LOCAL` / `NOT_FOUND` otherwise.
- `POST /api/ask/tabs {op, input}` is the chat tools' bridge: loopback callers only, with the turn's own token in
  `x-worca-ask-tabs` (it lives as long as the turn and is never written to disk).

`scope` is `project&projectKey=<key>`, `run&runId=<id>` (with `projectKey`, `workspaceId` or `projectDir`, and
`member` on a workspace run) or `chat&threadId=<id>`. A path never leaves the folder: `..`, absolute paths and
any `.git` folder are refused, and a link pointing outside the folder (or to `.git`) is listed but cannot be
opened.

## Audit log

Every open, command, stop and close is recorded with the person (the same attribution as runs) and the
time. Blocks and audit rows are kept. `GET /api/terminal/audit?runId=<id>` lists a run's.

## Security

- The browser never chooses the folder, the shell or the environment: Worca picks them from the run or project.
- **Hosted mode:** off unless the server starts with `WORCA_TERMINAL_REMOTE=1`. With it on, anyone signed
  in can run commands as the server user: that is the point, but know it before you turn it on.
- With agent isolation on, callers inside the box (which could be an agent) can never use the terminal.
  The same gap as for Actions remains: in **local** mode there is no identity, so a request an agent loops
  back through a published port cannot be told apart from a person. Run an isolated box in remote mode.
- The shell runs as the Worca server's user, not as the agent user, exactly like an Action. Code you run
  here (the run's tests, `npm install` of a branch agents wrote) has the server's access.
- Only pages served by this Worca can use it. A page on another port of the same machine (another dev
  server, or a service an Action started) is refused with `403 TERMINAL_CROSS_ORIGIN` and sees no terminal
  traffic.
- **The preview proxy** reaches this machine's loopback only, on the allowed ports (see Browser tabs); the
  address carries no host. It strips Worca's and the identity proxy's credentials (cookies, Authorization,
  `cf-*`, the identity headers of oauth2-proxy, Google IAP, AWS ALB, Pomerium and Azure App Service, forwarded
  headers) from what it sends, gives the dev server the app's own `Origin` only for the preview page itself
  (another site's `Origin` goes up as sent, for the dev server's own check), and `Set-Cookie`, `Clear-Site-Data`, HSTS and reporting
  headers (`NEL`, `Report-To`) from what comes back. Every page it serves carries `Content-Security-Policy: sandbox` without `allow-same-origin`, so a previewed
  app runs in an opaque origin even when opened in a tab of its own. Because the frame's opaque requests reach the
  dev server with the app's own `Origin`, the app cannot tell its own pages from content it sandboxes itself; so a
  port where another Worca answers (a run's Action of worca itself) is never previewed: its sandboxed HTML artifacts
  would pass that Worca's origin check. The proxy asks again each time it re-resolves a port (every few seconds),
  so a tab's link minted for a dev server stops working once a Worca answers on that port instead. Open such a Worca in a browser tab of its own. Behind an identity proxy (Cloudflare Access,
  an issuer) the frame's requests carry no `SameSite=Lax` cookie: set the access cookie to `SameSite=None`, or the
  frame shows the sign-in page.

## Chat (agent mode)

Every chat is in agent mode wherever the host allows it (there is no per-chat switch): Chat
can run shell commands in Worca terminals to check and finish work: tests, builds, linters, `git status`,
and file changes through commands when you ask for them. It runs in a run's folder (a run with no project has none), or in the folder of the chat's project (the chat's
scope, or a member of its workspace); another project's folder is refused until you change the chat's scope.

- **A shared terminal.** Ask opens its own terminals, labeled `Ask · <chat title> · <folder>`, at most 3
  per chat. They are tabs of their chat in the tool panel (hidden on other pages, and counted on the **+**
  page), with the same live output, and you can type in them. Ask never types into a terminal you opened.
  - **Ask's tab waits for you.** A command Ask starts never opens the panel, never switches its tab and
    never takes the keyboard: it shows live in the chat, and its tab is in the panel when you open it.
    Click the folder on a command card (Show in terminal on a summarised one) to show its tab and type
    there. Once that shell has closed (idle close, or a Worca restart) the click says so: the control
    turns to a disabled **Shell closed** with the reason as its tooltip, and the output stays in the
    card. Moving to another page shows that page's own tabs; Ask's tab stays with its chat.
  - **Your commands in Ask's tab.** They never wake the chat. Your next message carries a line in its
    context listing what you ran there since then (command, exit code, block id, redacted like other
    command text, the newest 3), so "I ran the migration, continue" works, and Ask can read the output.
  - **The shell is kept.** A `cd`, `export` or activated virtualenv (yours or Ask's) carries over to
    Ask's next command, as long as the shell is still inside the target folder (the project's folder, or
    the run's checkout). Each command is checked against the folder the shell is really in. A shell that
    left the folder is never used: Ask opens a fresh one in the folder and leaves yours alone. If you are
    running something in Ask's tab, Ask uses another of its terminals.
  - **When all 3 are yours.** If every Ask terminal of the chat is busy with your commands, or you moved
    them out of the folder, Ask's command is refused with a message saying so; free one or `cd` back.
    Ask reuses one of its terminals for another folder only if you have not typed there for 10 minutes.
  - **Idle close.** An Ask terminal closes after 10 idle minutes (your typing and commands there count
    as activity) and when the chat is deleted.
- **In the chat.** Each command shows as a card with the whole command line and a **Stop** button. Its
  live output is folded: click **Output** (it counts the lines) to show it; it stays open as it grows.
  When a command ends, the chat wakes with `[worca event] terminal block <id> exited <code>`, unless
  Ask already saw the end while it waited. Ask can also list and read the commands you ran here
  (`list_blocks`), so "why did this fail?" works on your own commands.
- **Environment.** Ask's shells start from a cleaned environment: `PATH`, `HOME`, locale, proxy and CA
  variables and `SSH_AUTH_SOCK`, and nothing else from the server. On Windows they also keep the system variables (`SystemRoot`,
  `USERPROFILE`, `TEMP`, …). No model, GitHub or server tokens. Your
  shell rc files (`.bashrc`, `.zshrc`, `.zshenv`) are not loaded, so tools put on `PATH` only there (nvm,
  pyenv) come from the server's own `PATH` instead. Pagers are off and git never asks for a password.
- **The command check.** Before anything is typed, Worca refuses a command that names its own files or
  credential paths (`~/.worca-cc`, the database, `.env*`, `~/.ssh`, `~/.aws`, `~/.claude`, …), calls
  Worca's own HTTP API, or is hard to undo (`git push --force`/`--delete`, `rm -r` outside the folder,
  `sudo`/`doas`, `mkfs`, `dd` to a device, `shutdown`). The check follows `cd` between steps, looks
  through wrappers (`xargs`, `nice`, `timeout`, `env`, …), `bash -c "…"`/`eval`, and git's global
  options, and treats an `rm -r` target built from `$(…)` or piped into `xargs` as outside the folder.
  It also refuses `gh auth token` (and `gh auth status --show-token`), and a command with a newline.
  For `gh` and `glab` it refuses deletes (`gh repo delete`, `gh api -X DELETE`, …), a forced ref or a repository
  made public (`gh repo edit --visibility public`, the same through `gh api`), `gh pr merge --admin` and
  `gh gist create --public`; for `az`, any `delete` subcommand.
  Command lines and output that reach the model or the card are redacted. This check
  is a rail against mistakes and naive prompt injection, **not a sandbox**: an obfuscated command (a path
  built from variables, a `../../..` walk out of a run's checkout) can get around it.
- **Limits.** At most 3 commands run at once per chat. A command is stopped after 30 minutes
  (`stopped_by: ask:cap`). `wait_for` waits at most 240 seconds; longer work ends the reply and waits for
  the event.
- **Audit.** Ask's commands are recorded like yours, with `actor: ask:<chat id>` in the audit log and
  `source: ask` on the block. Opening an Ask terminal on a run adds "Terminal opened by Chat" to the
  run's audit.
- **Where it is off.** On a hosted Worca, agent mode follows the terminal: off unless
  `WORCA_TERMINAL_REMOTE=1`. With agent isolation on, agent mode is off: the
  shell would run as the server user, not the agent user. Only bash and zsh record commands (Git Bash on
  Windows), so a terminal with another shell (sh, fish, cmd.exe) cannot run Ask's commands.

## Without node-pty

The terminal uses `node-pty`, an optional native module: prebuilt on macOS and Windows, compiled on
Linux (it needs python3, make and a C++ compiler; the `-full` Docker image has them). Without it,
terminals run over plain pipes: commands, blocks and Stop work, but full-screen programs (vim, top,
less) and arrow-key history do not, and the terminal says so. Ctrl+D on an empty line closes the
shell's input: the program reading it gets end-of-input, and the shell then exits too.
`WORCA_TERMINAL_PTY=0` forces this mode.
node-pty 1.1.0's macOS package ships its `spawn-helper` without the execute bit; Worca sets it the
first time a terminal opens. If it cannot (a read-only install), or node-pty still fails to start a
shell, terminals use pipes and the banner gives the reason. `worca doctor` reports the helper's
state and prints the `chmod +x` fix.

## Windows

Terminals run **Git Bash** (from Git for Windows), with the same command blocks, Stop and Ask
commands as bash elsewhere. Worca looks for `bash.exe` in this order:

1. `WORCA_TERMINAL_SHELL` — the full path of a shell (read when a terminal opens; set it before starting Worca)
2. `CLAUDE_CODE_GIT_BASH_PATH` (the variable Claude Code reads)
3. `%ProgramFiles%\Git\bin\bash.exe`, `%ProgramFiles(x86)%\Git\bin\bash.exe`, `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`
4. `bin\bash.exe` of the Git install whose `git.exe` is first on `PATH`

WSL's `bash.exe` (in `C:\Windows\System32`, or the WindowsApps alias) is never used: it runs Linux on another
filesystem. When no Git Bash is found the shell is `cmd.exe` (`ComSpec`): a working terminal without
blocks, where Ask cannot run commands; Ask's error and `worca doctor` say how to fix it. Folders are
recorded as Windows paths (`C:/Users/…`), and Ask's command check reads the session folder in each
form a command may use (`C:\…`, `C:/…`, `/c/…`).

Stop: under node-pty (ConPTY) it sends Ctrl+C. Over plain pipes Windows has no Ctrl+C for another
process, so the command is ended 3 seconds later (`taskkill /T /F` on its processes); the shell keeps
running. Closing a terminal ends Git Bash and everything it started. At boot, Worca lists a dead server's
MSYS commands only through a Git Bash that its own configuration would pick; a shell path in the pid file outside
that set gets only `taskkill /T` on the recorded pid, and a shell path containing `..` gets no MSYS listing.

## Troubleshooting

| You see | Why, and what to do |
| --- | --- |
| "Full-screen programs … do not work here" | node-pty is not installed. Install build tools and reinstall, or use the `-full` image. |
| No commands recorded for a terminal | The shell is not bash or zsh, or your rc file replaced `PROMPT_COMMAND` / `precmd_functions` after Worca's lines ran. |
| "The terminal is turned off on this hosted deployment" | Set `WORCA_TERMINAL_REMOTE=1` on the server. |
| "This folder was removed when the run finished" | Type `exit`, then press Enter: the new terminal opens in the run's checkout (Worca makes one if needed). |
| 409 "At most 16 terminals" | Close one. |
| 403 `TERMINAL_CROSS_ORIGIN` | The page's address differs from the `Host` the server received, for example a proxy that rewrites `Host`. Forward `Host` unchanged. |
| `bash: !": event not found` | Bash history expansion, as in any bash: quote `!` with single quotes. |
| "no Git Bash was found" (Windows) | Install Git for Windows, or set `WORCA_TERMINAL_SHELL` to the full path of `bash.exe` and restart Worca. `worca doctor` prints the shell a terminal would use. |
