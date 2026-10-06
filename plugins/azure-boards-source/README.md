# azure-boards-source (worca-cc plugin)

Pull tasks from Azure Boards work items into worca-cc's New Pipeline, and write
results back as a work item comment (optionally moving the item to its type's
Completed state).

## Install

    worca plugin install azure-boards-source

## Setup

| key | type | default | meaning |
|---|---|---|---|
| organization | text | — | the name in `https://dev.azure.com/<organization>` |
| token | secret text | — | a personal access token with **Work Items: Read & write** and **Project and Team: Read** |
| closeOnComplete | select yes/no | no | move the work item to its type's Completed state when a run finishes successfully |

The token is stored in
`~/.worca-cc/plugins/azure-boards-source/data/secrets.json` (mode 0600, never in
the DB). Any of:

1. A PAT created at `https://dev.azure.com/<organization>/_usersSettings/tokens`
   with the **Work Items (Read & write)** and **Project and Team (Read)** scopes
   only. Project and Team (Read) fills the Project picker: without it the token
   is accepted but no projects, and so no work items, are listed.
2. Environment indirection — set the field value to
   `{"$env":"WORCA_ADO_BOARDS_TOKEN"}` and export `WORCA_ADO_BOARDS_TOKEN` in the
   worca server's environment; the token never touches disk.

The field is required: there is no fallback to another credential. The Boards
token is kept separate from worca's Code token (`WORCA_ADO_TOKEN`, used for git
and pull requests) on purpose, so a Work Items PAT is never used for Code calls
and a Code PAT is never handed to this plugin unless you type
`{"$env":"WORCA_ADO_TOKEN"}` yourself.

### Why the token never reaches an agent

worca resolves `{"$env":…}` in its own host process when it reads the plugin
config, and hands the value to the connector in its config. Connector children
get only `PATH` and `HOME`. `WORCA_ADO_BOARDS_TOKEN` is a strip-only variable:
worca removes it from the environment of every claude, script and action it
spawns, and never reads it as its own Azure DevOps credential.

If you point the field at a variable of your own, pick one of the names worca
strips (`WORCA_ADO_BOARDS_TOKEN`, or deliberately `WORCA_ADO_TOKEN`); any other
name stays visible to the agents worca runs.

Verify with "Test connection" in the settings UI, or:

    worca plugin exec azure-boards-source azure-boards validateConfig

## Inputs

- **Project** — picked from the organization's projects.
- **WIQL filter** — a WIQL condition. worca wraps it into one query scoped to
  the chosen project, newest first:

      SELECT [System.Id] FROM WorkItems
      WHERE [System.TeamProject] = @project AND (<your filter>)
      ORDER BY [System.ChangedDate] DESC

  The default, `[System.AssignedTo] = @Me AND [System.State] <> 'Closed'`,
  excludes only `Closed` (the Agile process). Scrum and Basic projects close
  items as `Done` or `Removed`, so use:

      [System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed', 'Done', 'Removed')

  Free text in the task browser adds `[System.Title] CONTAINS '<text>'`.
- **Work item** — picked in the task browser. Pasting `#123` or a work item URL
  (`https://dev.azure.com/<org>/<project>/_workitems/edit/123`) skips the
  filter and fetches that one item, whatever its state.

## Task ids

Task ids are `org/project#id`, for example `acme/My Project#123`.

## Write-back

On every run result the plugin posts a comment with the run summary and its
links. With `closeOnComplete: yes` and a successful run, it reads the work
item's type, lists that type's states, and moves the item to the state in the
**Completed** category (Agile calls it `Closed`, Scrum and Basic `Done`). An
item already in the Completed or Removed category is left alone.

## Pull request link

When worca also has `WORCA_ADO_TOKEN` configured and Ship-it opens the pull
request in the same organization, the PR is created with `workItemRefs`, so the
work item shows the PR under Development.
