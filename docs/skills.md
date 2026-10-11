# Skills

A **skill** is a folder with a `SKILL.md` (instructions, a name and a description in its frontmatter) and,
optionally, scripts and reference files. Worca's skills are registry members exactly like MCP servers: they
sit in **sets** ([mcp-servers.md](mcp-servers.md)), sets are attached to projects, and every pipeline agent and
Ask Worca turn gets the skills its project's sets hold — without anything being written into your repository
or your Claude Code config. Everything lives on the **Connectors** page (Advanced) and under
`~/.worca-cc/skills/` ([storage.md](storage.md)).

## Where skills come from

The **Skills** view (Connectors › Skills) is the catalog:

- **Plugin skills** — every `skills/<name>/SKILL.md` an installed plugin ships. They come and go with the plugin;
  a disabled plugin's skills are listed (`plugin disabled`) and skipped in runs.
- **Imported skills** — **Import skill** copies a skill into Worca's own library from
  - a **folder** (type the path or **Browse…**),
  - a **git URL** (an optional ref and folder in the repository; fetched shallow, the way plugins are). A repository
    holding several skills offers its skill folders to pick from,
  - a **pasted** `SKILL.md` (the Name is used only when the SKILL.md names none; a pasted skill has no origin, so it
    never updates — remove it, import it again and add it back to its sets),
  - **your Claude Code skills** (`~/.claude/skills`).

  On a hosted Worca (remote access on) only **Git URL** and **Paste** are offered, and the git URL must be
  `https://host/owner/repo` as typed — no port, credentials, query or encoded characters — and match
  `WORCA_CLONE_ALLOW` when the deployment sets it, as project clones do: the server's folders, its `~/.claude/skills`,
  its own repositories (`file://`) and its keys (`ssh://`) are not yours. As for a project clone, git follows a redirect
  that host answers with, so `WORCA_CLONE_ALLOW` vouches for the host you name, not for where it sends git. A skill
  imported from a folder, your Claude Code skills or a non-https git URL before remote access was turned on does not
  update there.

Import is two steps. Worca first stages a copy and shows a preview: the name, every file with its size, and flagged
rows — executables, inline shell blocks (`` !`cmd` ``), token-shaped text, `${` references, a symlink (one to a file
inside the folder is imported as a copy of its target; one that leaves the folder, points at a folder or is broken is
never copied, and the import is refused),
a `.claude-plugin/` folder, `${CLAUDE_PLUGIN_ROOT}` references, and a frontmatter `hooks:` (badged **declares
hooks**). Nothing is saved until you press **Import** under this notice:

> Worca copies these files into its library. Agents may read them and run the scripts where their guardrails allow.

with, when they apply, these lines:

> Its inline shell blocks (!`cmd`) run in pipeline runs without guardrail checks; Ask Worca never runs them.
>
> This skill declares hooks — they run shell commands outside Worca's guardrails when the skill is used.

**Back**, **Cancel** or closing the dialog discards the copy. The name comes from the SKILL.md's `name:` (or from the folder when the
SKILL.md has none) and cannot be changed in the preview: to import under another name, edit the `name:` line and
preview again. A name already in the library is refused; remove the existing skill first.

Limits: 300 files, 1000 links and folders, 1 MB per file, 8 MB in all; no `.claude-plugin/` folder inside; a name is lowercase letters,
digits and single hyphens, at most 64 characters (`synced` and `anthropic-skills` are reserved), and the
frontmatter `name` must equal the folder name. A skill that breaks a rule is listed as `invalid` and never
mounted. When `skills/library.json` is damaged or was written by a newer Worca, the Skills view says so and
no imported skill is listed, used or changed until the file is fixed (or Worca is updated).

## Sets hold skills

A set's detail page has a **Skills** section next to its servers. **+ Add skill** picks from the catalog (a
skill already in the set, or another skill with the same name, is greyed: a name appears once per set). Each
card shows the switch (off keeps it in the set and delivers nothing), the name agents call, the source, the
file / script / shell-block counts, a **declares hooks** badge when it has them, the state (`in runs`, `off`,
`plugin disabled`, `invalid: …`, `the skill is no longer installed`, `references its plugin's other files`, or for
Team skills `turn on in the team checklist`), **Remove** and **View SKILL.md** (read-only). A skill has no values, no
secrets and no Test.

Memberships live in `mcp/sets.json` next to the servers. A Worca from before skills keeps every set's skills when it
writes that file — except General's: when General holds no MCP server, that older build drops General, and its skills
with it, on its next write.

From the Skills view, **Add to set** puts a skill in a set; **Check for updates** (a library skill with a folder,
git or Claude Code origin) shows what changed at the origin and **Update** applies it — never on its own. A check
that found changes marks the skill **update available** until you Update or Remove it; Worca forgets the mark when
it restarts, so check again after a restart. **Remove** takes a library skill out of every set and deletes its files.
Plugin skills update with their plugin: the plugin's update preview lists `new skill: x` lines; a changed or removed
skill that a set holds reads `SKILL CHANGED: x — in <sets>` or `SKILL REMOVED: x — leaves <sets>` (one no set holds,
`changed skill: x` / `removed skill: x`), and uninstalling a plugin takes its skills out of every set.

## Names: `/<set>:<skill>`

Each set reaches a spawn as **one generated plugin named by the set's short name** (its slug, at most 12 characters;
the set's page shows it as "skills load as `billing:`"), so agents always call a set's skill by its set:
`/billing:deploy-checklist`, `/general:release-notes`. The same skill in two sets is two names, and
no skill is ever renamed. A skill your project commits under `.claude/skills` keeps its bare `/name`; a set's skill
is offered to agents only as `/<set>:<skill>`.

A skill imported from your Claude Code skills exists twice: your personal `/x` keeps loading in pipelines, and agents
call the imported copy `/<set>:x` — a copy that changes only when you Check for updates.

When this machine already has a Claude Code plugin with that name (any `enabledPlugins` key in Claude Code's
`settings.json`, on or off, or a plugin folder under `~/.claude/skills`), or another set already loads under it, the
set loads as `<name>-set:` (then `-set-2`…) instead of hiding the other, and the set's page says so ("loads as
`billing-set:` — a Claude Code plugin named billing is installed").

**Scripts:** refer to a skill's own files with `${CLAUDE_SKILL_DIR}` (the skill's folder). A skill copied out of a
real plugin that uses `${CLAUDE_PLUGIN_ROOT}` points at the generated plugin, which holds only `skills/`: such
references break, and the catalog and the import preview flag them.

## What each surface gets

- **Pipelines:** every agent of a run (and its sub-agents) gets the skills of the sets its project resolves to —
  a workspace run gets its member projects' sets and the workspace policy's Team set; workspaces attach no sets of
  their own. The skills come on top of your personal `~/.claude` skills, plugins and hooks, which pipeline agents
  keep loading. A skill's inline shell blocks (`` !`cmd` ``) run in pipeline runs without guardrail checks: they run
  when Claude Code renders the skill, not as a tool call a guardrail sees. New Pipeline › Advanced › **Sets** lets you
  switch a skill off for one run; skipped skills show their reason, and the run's Overview shows a **Skills from
  sets** block with the skills it got. Workspace scans and memory defragment runs get none. Delivered as copies under
  the run's own folder: an agent's edit never reaches the library or a plugin.
- **Ask Worca:** General plus the sets of the projects in play, as for MCP servers. The `Skill` tool is on only
  for a turn that mounts at least one skill, and **inline shell blocks never run in Ask** (every Ask turn runs with
  Claude Code's `disableSkillShellExecution`). The composer's **Sets · N** picker switches skills per chat.
- **Project page › Sets** lists *Skills in runs on X* with each skill's status; a workspace's Overview shows the
  servers and skills its runs get, each with the member project that brings it.
- **Hooks:** a skill whose frontmatter declares `hooks:` is shown, never refused. Its hooks run shell commands
  outside Worca's guardrails when the skill is used — in pipelines and in Ask alike.

At most 24 skills per pipeline spawn and 12 per Ask turn (a skill in two sets counts twice); project sets are kept
first, then Team, then General.
Each mounted skill's description enters the agent's prompt, so a long list costs tokens on every spawn.

## Team policy

A team policy can require plugin skills (`skills.required`, [team-policy.md](team-policy.md)): each developer
turns each one on with consent (the dialog shows the SKILL.md, its scripts and shell blocks, and the plugin's
pinned commit); never automatically — a skill turned off later turns back on without the dialog. A policy home you
trust on the Marketplace page installs its missing required plugins without the checklist, and
updates to required skills apply without another review when you trust this home.

## Windows and managed machines

- Copies never hold symlinks (a link becomes a copy of its file); on Windows they carry no exec bits either, and a
  skill that ships `.sh` scripts is badged "shell scripts — Windows", since they may not run there.
- A machine whose managed Claude Code settings set `disableSideloadFlags`, or a Claude Code without
  `--plugin-dir`, gets no set skills: runs and chats go on without them and say so ("skills from sets not
  loaded …") — a run once in its log, a chat in its **Sets** picker or on the turn. If Claude Code refuses the flag
  at start anyway, Worca drops the skills and starts that spawn again once without them.
