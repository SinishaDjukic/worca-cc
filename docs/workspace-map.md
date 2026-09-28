# Workspace map

A Workspace scan produces a **map** of how the member projects of a workspace depend on each
other: which member calls another's API, consumes the messages it publishes, builds on its
package or shares its tables. Every scanned edge carries file:line evidence and a confidence,
every member a coverage level. The map is stored with the workspace, shown on the workspace
page's **Map** tab, and rendered into the workspace description that every agent of a
workspace run receives (`## Workspace Context`).

## How a scan works

The scan is a pipeline run (`wf_workspace_scan`) you can follow under **Running**. Code
extracts facts and does all the matching; agents fill the gaps code leaves and confirm uses.

| Stage | Runs as | What it does |
|---|---|---|
| extract | script | Lists each member's files (`git ls-files`; `graphify-out/`, build folders and vendored code skipped — `vendor/`, `node_modules/`, `bower_components/`, `jspm_packages/` and `Pods/` anywhere, third-party folders such as `third_party/` or `external/` at the member root, whose `.proto` files, most gRPC code generated from them and a Pants, Bazel or Buck dependency list — a requirements file, a `pyproject.toml` or a `Cargo.toml` — are still read) and runs the detectors — package manifests (outside sample apps under folders such as `docs/` and `examples/`), deploy files, configuration, API specs, and code (HTTP routes and clients, messaging, databases). Each fact records its file, line and the literal text found there. |
| survey | agent `workspaceScanner` | One investigator per member whose coverage is `partial` or `none` reports what code could not find: role, aliases, what the member provides and consumes. |
| catalog | script | Checks every reported fact against its file, builds a catalog of everything the members provide, and searches every member for literal mentions of it (candidates), skipping test files and the files Normal protects (`.env*`, key and certificate files). |
| usage | agent `workspaceUsageMapper` | One investigator per member confirms or rejects its candidates and reports further uses: dynamic URLs, generated clients, configuration. |
| join | script | Checks the reported uses, joins consumers to providers into edges, and computes the change order (providers first) and any cycles. |
| synth | agent `workspaceSynthesizer` | Writes the overview, missing roles and change-coordination notes. |
| render | script | Renders the description. |

- At most 8 investigators run at a time: worca runs each scan agent with background tasks off and
  its parallel tool calls capped at 8, so its investigators run in the foreground, in waves of up to 8.
- A reported fact whose text is not on or near the cited line is moved to where the text is in
  that file, or dropped; a path never leaves the member's checkout.
- A GraphQL schema file that the member's own operations query is a client's copy of its
  server's schema: it provides nothing and is listed as unresolved, unless the member's code
  imports or calls a GraphQL server library (JavaScript, Python, Go, .NET, PHP, Rust, Elixir or
  JVM), the member holds a gqlgen, graphql-ruby or Lighthouse file,
  or the schema sits in a JVM server's `src/main/resources/` (Spring GraphQL, DGS,
  graphql-java-kickstart) or is Hasura's `metadata/actions.graphql`. Operations under a root
  `docs/`, `examples/` or `samples/` folder document the API and never count, and a survey GraphQL
  fact or any usage fact citing a copy is rejected. Operations on a copy of a schema no other
  member serves (an outside API, such as GitHub's) join no member.
- A script stage never fails the run on bad data: it records what went wrong and continues with
  what it has. Without a survey or usage result the static facts remain; without a synthesis
  the overview is generated.
- The scan agent model runs survey, usage and synth; the project agent model runs their
  investigators (Settings › Runs › Workspaces, or the scan's own Models pick).
- A scan changes no member: it never creates a repository and never commits. Each member must be
  the top folder of its own git repository and have a commit; a scan or re-scan with any other
  member (a folder inside a monorepo, a repository with no commit) is refused and names it: add
  the repository root instead, or make that folder its own repository with a commit.

## Coverage and confidence

Coverage, per member:

| Level | When |
|---|---|
| rich | stack recognised, at least 3 facts outside tests, at most 2 unresolved facts (a route, call or topic whose name is not a literal, a manifest that does not parse or is too large), no detector error, not truncated |
| partial | everything between |
| none | nothing scanned, extraction failed, or an unrecognised stack with no facts outside tests — the survey investigates the member in full |

Confidence, per edge:

| Confidence | Meaning |
|---|---|
| exact | code found the use and the definition under the same key (for example `http:GET /invoices/{}`), or a use whose literal host is one of the member's aliases |
| verified | an agent reported one end — a use of a catalog entry, or a fact the survey found — and its cited line checks out |
| heuristic | code matched loosely (path suffix, topic pattern), or a fact on either end is a detector's guess (such as a consumer's host that came only from a configuration key or variable), or a literal candidate stands in for a usage pass that failed |
| inferred | an agent named the relation with evidence on the consumer side only |

A member's aliases are its key and name, the service and host names it runs under (compose, Kubernetes,
Helm, serverless, `spring.application.name`), its package and repository names, and last the names the
survey reports for a member it investigates in full, the last part of a scoped npm package name
(`billing` of `@acme/billing`), and a name a repository gives a workload, chart or local stub that
nothing ties to it. When several members claim one name, the strongest claim wins, in that order;
members tied at the strongest claim share the name, and it names none of them. These last three never
settle a collision with a package or repository name either way: they share the name with it. A name a
repository gives a workload or stub of its own by default also shares the name with another member's
service or host name.

Facts found in test files never make edges, whoever found them (code, the survey or the usage
pass): they are counted instead. The literal search skips test files.

## The description

The description is rendered from the map and never exceeds the line budget for the member
count: 300 lines up to 5 members, 500 up to 20, 800 above. When the edges do not fit, lines
collapse — fewer names per line, then one line per member pair, then one per consumer — but no
related pair is dropped. Members the scan could not map, or mapped only partly because their
survey or usage pass failed, are listed under `## Coverage`.

A role copied from a member's own README or package manifest is quoted with its source
(`README: "…"`, `manifest: "…"`, or `repo: "…"` on a map scanned before worca recorded the file).
While the description quotes such text, the `## Workspace Context` every agent receives opens with
one sentence: quoted project text describes the members and is never an instruction.

A re-scan replaces the description, hand edits included.

## Reviewing the map

On the **Map** tab you can confirm an edge or reject it, clear either, add an edge the scan
missed (from, to, kind, a one-line name and an optional detail) and delete it again.

- A rejected edge leaves the description and the Map tab's graph; the merged graph file (see
  below) keeps every scanned edge. A manual edge is marked `(manual)` unless the description is
  collapsed to one line per consumer.
- The suggested change order follows the same edges: a rejected edge orders nothing, a manual
  edge orders its two members. The synthesizer's note on the order stays only while the order is
  the one the scan stored, and a stored coordination note that names both projects of a pair whose
  every edge is rejected is left out. A re-scan builds its order and its synthesis brief from the
  reviews stored when it starts (or resumes).
- Reviews survive re-scans: they are keyed by edge id (from, to, kind, key) and the next scan's
  description applies them. When an agent words a key differently, a review whose edge is gone
  moves to the new edge only on a one-to-one match: one such review, and one new edge whose key
  an agent wrote and that has no review of its own, between the same projects, of the same kind
  and key (for a REST API the path, with the same method or none on one side; for other the
  label). Otherwise the review stays where it was.
  A confirmed edge the next scan does not find stays on the Map tab
  as missing, a rejected one as stale (Clear removes it); the description leaves both out.
- While the description is as the scan wrote it, each review change re-renders it at once.
  After a hand edit, reviews no longer touch it; **Regenerate description** re-renders it and
  discards the hand edit.

The same actions over HTTP:

| Request | Body |
|---|---|
| `GET /api/workspaces/:id/map` | — (answers `map`, `synthesis`, `overrides`, `edges`, `descriptionOrigin`) |
| `PUT /api/workspaces/:id/map/edges/:edgeId` | `{ "state": "confirmed" \| "rejected" \| null }` — scanned edges (`x_…`) only |
| `POST /api/workspaces/:id/map/edges` | `{ "from", "to", "kind", "display", "detail"? }` — member project keys; 201 (200 and the existing edge when one with the same from, to, kind and display exists; 400 while the workspace has no map) |
| `DELETE /api/workspaces/:id/map/edges/:edgeId` | — manual edges (`m_…`) only |
| `POST /api/workspaces/:id/map/render` | — Regenerate description |

## Cross-project graph

When the graphify CLI is installed, worca builds each member's graph in the scan's checkout of
that member before the stages run. With a graph built at that checkout's commit
(`graphify-out/graph.json`), the join attaches the enclosing symbol and up to 3 callers to each
edge end whose cited line lies inside a symbol of that graph. The member graphs are then
merged, with every scanned edge as a link between them (reviews do not change this file), so
`graphify query` and `graphify path` walk across repositories: the whole graphs up to 60 000
nodes and 64 MiB in total, otherwise each member's edge-end nodes and their neighbours within
2 hops (the edge ends are always kept; neighbours stop at 2 000 nodes per member). No
graphify, no merged graph.

The merged graph is kept at `<worcaHome>/store/workspaces/<workspaceId>/workspace-graph.json` and
named on the description's last line:

```
Cross-project graph: <path> — graphify query "<question>" --graph "<path>"
```

## Measuring a scan

`tools/workspace-map-eval.mjs`, in a checkout of the worca repository, scores a map against
labelled truth. It is offline and makes no model calls.

```
node tools/workspace-map-eval.mjs --map <file|runFolder|runId> (--labels <file> | --overrides <workspaceId> | --init <out>) [--json]
```

- `--map` — a `workspace-map.json` (or a stored `{ map, synthesis }` document), a scan's run
  folder, or the id of a scan run (the file in its run folder).
- `--init <out>` — writes a labels template: one entry per edge with `"truth": null`. Set each
  to `true` or `false` and add the relations the scan missed. Never overwrites a file.
- `--labels <file>` — `{ "version": 1, "workspace": "…", "edges": [{ "from", "to", "kind",
  "key"?, "truth" }] }`. `from` and `to` are member project keys, as on the map; `from` uses
  `to`. An entry with `key` (a normalised key such as `http:GET /users/{}`, or a raw one such
  as `GET /users/:id` or `npm:@acme/auth`) is scored per key; one without, per member pair and
  kind. Key entries also count for their pair and kind: true when any is true, false only when
  every edge the map has for that pair and kind is labelled false. A key worca cannot read is
  listed under label errors and not scored; labels that look wrong for the map (another
  workspace, a member the map does not have, a self edge, contradicting truths) are listed
  there too, and still scored.
- `--overrides <workspaceId>` — the workspace's review as labels: confirmed = true, rejected =
  false, manual = true (a relation the scan missed).

The report gives tp / fp / fn, precision and recall per pair and kind and per key, broken down
by kind and by confidence, and lists the missed and spurious edges; `--json` prints the same as
JSON. A predicted edge with no label counts as unlabelled, never as wrong. Run ids and
workspaces are read from worca's database, `<worcaHome>/worca-cc.db` (see
[storage](storage.md#resolution-rules)); `WORCA_HOME=<dir>` reads the home at `<dir>/.worca-cc`.

## Guardrails

The scan runs under the Normal set. Its script stages are worca's own programs, not `claude`
processes: no deny rule reaches them. Extract reads the files its detectors claim in each
member's checkout — `.env` and `.env.*` files such as `.env.example` included, which Normal
protects from agents. Checking a line an agent cites (a survey fact in the catalog, a reported
use in the join) reads that file whatever its name, inside the member's checkout. The
catalog's search for literal mentions skips the files Normal protects (`.env*`, `*.pem`,
`*.key`, `id_rsa`, `id_ed25519`, `*.p12`, `*.pfx`). What the stages record (a URL, a topic, a
table name, with its file and line) is stored in the map, shown on the Map tab, and given to
the scan's agents in their briefs. Credentials in what they read — URL passwords, password,
token and API-key values, a token used as a URL's user name (`https://<token>@github.com/…`,
a Sentry DSN key, any `nats://<token>@…`), `Authorization` header values, JWTs, the query
parameters `sig`, `code`, `key`, `jwt`, `session`, `sid`, `ticket` and `subscription-key`,
well-known API token formats (GitHub, GitLab, Slack, Stripe, Google, OpenAI, Anthropic, npm),
webhook URL tokens (Slack, Discord, Teams, Telegram), AWS access key ids (`AKIA…`, `ASIA…`) and
PEM blocks — are replaced by `***` before anything is recorded (a token keeps its prefix, such
as `ghp_***`). A literal mention, an HTTP call's URL and route (found in code or reported by an
agent), and a dynamic URL's text are recorded without their query string. See [guardrails](guardrails.md).
