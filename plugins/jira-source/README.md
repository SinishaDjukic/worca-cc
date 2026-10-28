# jira-source (worca-cc plugin)

Pull tasks from Jira issues into worca-cc's New Pipeline, Ask Worca and
scheduled runs, and write results back as an issue comment (optionally moving
the issue through a named transition). Works with Jira Cloud and Jira Data
Center / Server.

![A Jira profile under Marketplace › Installed, connected](screenshots/plugin-profile-light.jpg)

![New run with Jira as the task source: project, JQL filter and the issue list](screenshots/new-run-jira-light.jpg)

## Install

    worca plugin install jira-source

## Setup

The source is **multi-profile**: add one profile per Jira site (Marketplace ›
Installed › jira-source › Profiles) and bind each project or workspace to the
profile its tickets live in. Each profile has its own settings and token.

| key | type | default | meaning |
|---|---|---|---|
| baseUrl | text | — | the site, e.g. `https://acme.atlassian.net` or `https://jira.example.com` |
| email | text | — | **Jira Cloud**: the email of the account the API token belongs to. Leave blank on **Data Center / Server** |
| token | secret text | — | a Jira Cloud API token, or a Data Center personal access token |
| transitionOnComplete | text | — | optional: a transition or status name (e.g. `Done`) to move the issue to when a run that writes back finishes successfully |

Authentication follows the email field: with an email the token is sent as
Basic `email:token` (Jira Cloud API tokens), without one as a Bearer personal
access token (Data Center / Server 8.14+).

Cloud and Data Center page search results differently, so the plugin asks the
site which it is (`/rest/api/2/serverInfo`, anonymously first, then with the
token) and remembers the answer per profile and URL. A Cloud site on a custom
domain is therefore handled like any other Cloud site. Only when the site does
not answer does the plugin guess from the hostname (`*.atlassian.net` and
`*.jira.com` are Cloud, the rest Data Center), and it asks again next time.

**Test connection** always asks afresh and checks the email field against the
answer: a Cloud site with no email, or a Data Center site with one, is named as
an email error before any token is tried.

The token is stored in
`~/.worca-cc/plugins/jira-source/data/secrets.json` (mode 0600, never in the
DB). Any of:

1. A token typed into the field. Jira Cloud:
   <https://id.atlassian.com/manage-profile/security/api-tokens>. Data Center:
   your avatar › Profile › Personal Access Tokens.
2. Environment indirection — set the field value to
   `{"$env":"WORCA_JIRA_TOKEN"}` and export `WORCA_JIRA_TOKEN` in the worca
   server's environment; the token never touches disk. With several sites,
   give each further profile its own `WORCA_JIRA_TOKEN_<NAME>`, e.g.
   `{"$env":"WORCA_JIRA_TOKEN_DC"}`.

The token needs to browse the projects you pick from and, for write-back, to
add comments and transition issues. A token is only as narrow as its account:
use an account that sees only what worca should.

### Why the token never reaches an agent

worca resolves `{"$env":…}` in its own host process when it reads the plugin
config, and hands the value to the connector in its config. Connector children
get only `PATH`, `HOME` and the proxy and CA variables. `WORCA_JIRA_TOKEN` and
every `WORCA_JIRA_TOKEN_<NAME>` are strip-only variables: worca removes them
from the environment of every claude, script, action and git call it spawns,
and never reads them itself.

If you point a profile at a variable with any other name, that variable stays
visible to the agents worca runs.

Verify with "Test connection" in the settings UI, or:

    worca plugin exec jira-source jira validateConfig

## Inputs

- **Project** — picked from the site's projects. Leave it empty to search
  across every project the filter matches.
- **JQL filter** — a JQL condition. worca wraps it into one query scoped to the
  chosen project, newest first:

      project = "<project>" AND (<your filter>) ORDER BY updated DESC

  An `ORDER BY` in your filter replaces the default order. The default,
  `assignee = currentUser() AND statusCategory != Done`, lists your open
  issues. Free text in the task browser adds `text ~ "<text>"`.
- **Write result back** — `no` (default) or `yes`, pinned on the run when it
  starts. Write-back is opt-in: only a run started with `yes` comments or
  transitions; a run with no value pinned is treated as `no`. Ask Worca fills
  in `no` unless you ask it to write back.
- **Issue** — picked in the task browser. Pasting a key (`SHOP-123`) or an
  issue URL (`…/browse/SHOP-123`, or a board link with `selectedIssue=`) skips
  the filter and fetches that one issue, whatever its state or project.

## Task ids

Task ids are issue keys, for example `SHOP-123`. The site comes from the
profile the run is bound to, which worca pins on the run, so the result is
always reported to the Jira the issue came from.

## Task body

The run's task is the issue's description and its comments, converted from
Jira's rendered HTML to markdown (the same on Cloud and Data Center).

## Write-back

When the run pinned **Write result back: yes**, every run result posts one
comment with the run summary and its links (the pull request, when there is
one), as Jira wiki markup.

With `transitionOnComplete` set and a successful run, the plugin first lists
the issue's available transitions and applies the first one whose name, or
whose target status, matches it (case-insensitive), then posts the comment with
a closing line saying what happened:

- `Moved to Done.`
- `Already in Done.` — nothing was changed.
- `Could not move to "Shipped" from "In Progress" (available: Start, Resolve).`
  — fix the setting; the run is not marked as a failed write-back.

If Jira refuses the transition itself (for example a required field on the
transition screen), the write-back fails before anything is posted, so a retry
from the results view posts the comment once.

## Export

Worca's Requirements page can send a feature's spec to Jira as an issue (**Export ▾ › Export to Jira…**), through the
same connection (profile) as above; the token never leaves the plugin. The plugin answers `capabilities()` with
`export: true` and implements the optional export ops:

- **exportOptions** — the projects, the project's issue types (not sub-tasks), the priorities and the multi-line text
  fields that can hold acceptance criteria, from create metadata (`/rest/api/2/issue/createmeta/<project>/issuetypes`,
  Jira Cloud and Data Center 8.4 or later; an older Data Center cannot be set up for export). `doneStatus` is
  **Transition on completion**.
- **createTicket** — a v2 issue with the description in wiki markup, the labels Worca sends, the priority and the
  criteria field, and Worca's marker as the hidden issue property `worca.export` (in the create body, or set right after
  it where a site refuses that). Worca uses the marker and the label `worca-FEAT-<n>` to find an issue whose create
  answer was lost, instead of making a second one.
- **updateTicket** — rewrites summary, description, issue type, priority and the criteria field; labels are only added,
  so labels the team set in Jira stay. The field has to be on the edit screen.
- **commentTicket** — adds the comment Worca previewed.
- **ticketState** / **findTicket** — read an issue's description back. Each create and update returns a fingerprint of
  the stored description (line endings and trailing spaces do not count), so Worca can tell when the description was
  edited in Jira since the last export.

A field Jira refuses comes back as Jira's message naming it ("Jira needs a value for “Team” in SHOP."), and a deleted
issue as gone; nothing is created then. Run results of a run started with **Report back** are written back as described
above.

## Import

Worca's Requirements page can start a feature from a Jira issue (**New feature › From a ticket…**), through the same
connection (profile); the token never leaves the plugin and nothing is written to Jira. The plugin answers `capabilities()`
with `import: true` and implements the optional import ops:

- **importOptions** — the projects, for the picker's project select.
- **searchTickets** — the project's most recently updated issues, or a text search (`text ~ "…"`), 20 a page; a pasted key
  or issue link finds that issue in any project. Never your saved JQL filter. On Jira Cloud an empty search in all projects
  lists the issues updated in the last year (`updated >= -365d`).
- **importTicket** — the summary, the rendered description as Markdown (an image becomes "(image: <name>)", a table row
  "| a | b |", a person's link their name), the criteria from a multi-line text field (the export setup's criteria field, else
  one named "Acceptance Criteria"), the newest 50 comments with the author's display name only (comments restricted to a
  group or role are left out and counted; app and automation authors are marked), the attachments' names and sizes, and the
  description's fingerprint (so a later export can tell when it was edited in Jira).
- **downloadAttachment** — one attachment the product owner picked, into a file the host names. Only from the site's own
  address with the connection's auth; Jira Cloud's one redirect to its signed media address is followed over https without
  the token. The size is checked before and during the download (25 MB), and a partial file is deleted.

A 404 (and a Data Center 403) is "not found, or this connection cannot see it".
