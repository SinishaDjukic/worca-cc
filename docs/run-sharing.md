# Run sharing

Run sharing lets teammates see each other's runs without a server. Like team memory and
[team metrics](team-metrics.md), it uses a dedicated branch of the project's `origin`: **`worca-runs`**.

With **Share my runs** on, Worca keeps a small record of each of your runs on the branch, and History lists your
teammates' records next to your own runs (see [Teammates' runs in History](#teammates-runs-in-history)).

Run sharing is a Labs feature (flag `runSharing`, off by default). It stays in Labs while the record format may
still change. With the flag off, nothing is pushed, the Settings card is hidden and
`GET /api/projects/:key/runs-share` answers 404.

## The switch

Open a project's **Settings › Run sharing** and set **Share my runs** to On. The switch is:

- **off by default**, and per developer and per project (it lives in this machine's Worca, not in the repository);
- separate from team metrics' **Include my runs** switch: one does not turn on the other;
- refused when the project cannot reach a `worca-runs` branch: git must be installed, the project must be a git
  project (not a Folder project), and it must have an `origin` remote.

Turning it **on** takes effect with the next run: a run that is already running when you switch it on is not shared.
Turning it **off** stops pushes at the next flush. Records already pushed stay on the branch. A run that was still
running keeps its last record (often `running`) and gets no more updates, so it shows as **stale**, the same as a run
whose machine crashed.

## What is stored

One JSON file per run at `runs/<personKey>/<runId>.json`, at most 2048 bytes, with exactly these keys:

| Key | What it holds |
|---|---|
| `v` | `1`, the record version |
| `runId` | the run's 8-character id |
| `personKey` | 16 hex characters that identify you (see below) |
| `workflowId` | the workflow's id, or `null` |
| `status` | `running`, `pausing`, `paused`, `done`, `error`, `stopped` or `interrupted` |
| `phase` | the run's phase, or `null` |
| `stage` | `plan`, `build`, `review`, `ready` or `null` |
| `progress` | 0 to 1, or `null` |
| `costUsd` | the run's cost so far |
| `startedBy` | your git name (or the person who started the run), or `null` |
| `startedAt` | when the run started |
| `updatedAt` | when Worca wrote this record |
| `finishedAt` | when the run ended (`done`, `error`, `stopped`, `interrupted`), else `null` |
| `prUrl` | the run's pull request link (https, without query or login), or `null` |

There is no prompt, title, branch name, file path, node label or log. The branch's first commit also adds a
`README.md`; nothing else is ever written.

While a run is active its record is pushed at most once every 30 seconds per project, only when something changed,
and at once when the run ends. A run that changes nothing gets one keep-alive push every 10 minutes, so a record that
stops changing for more than 20 minutes belongs to a run that is gone. A PR link found after the run ended adds one
more push, but only for a run this machine already shared: older runs are never published. A failed push is tried
again 30 seconds later, then after a wait that doubles up to 10 minutes, until it lands.

### Your person key

With team metrics' attribution set to **git user** (the default), `personKey` is a hash of your git email. Anyone who
knows that email can compute the same hash. To stay anonymous, set the project's team-metrics attribution to **none**:
`startedBy` is then `null`, the key is random for this machine, and the commits are authored by `Worca`.

## Teammates' runs in History

Whenever a registered git project's `origin` has a `worca-runs` branch, the Runs list shows your teammates' runs as
read-only rows mixed with your own. Each one carries a badge with the name of the person who started it (or
**Teammate** when the record names nobody). This works with **Share my runs** off: reading never needs the switch,
but it happens only while the Labs flag is on.

- **Mine / Team / All** in the Runs head picks whose runs the list shows (**All** by default). The filter appears
  once a teammate's run has loaded. **Team** with nothing to show says "No teammates' runs yet."
- Worca fetches the branch at most once a minute per project, while a Runs page is open.
  A fetch times out after 30 seconds; after a failure Worca tries again 15 seconds later and keeps the last rows it read.
- Opening a teammate's row shows a read-only summary: status, phase, cost, who started it, the project, when it
  started and was last updated, and its pull request link. There is no stop, resume, delete or rerun, and a teammate's
  row is never selected.
- A running record that has had no update for over 20 minutes is marked stale (its machine stopped or crashed).
- Rows from your own person key are never shown as a teammate's: the key from your git email and this machine's own
  key are both left out.
- A record that is not exactly the format above (an extra key, a non-https link, over 2048 bytes, a symlink, or a path
  that does not match its record) is skipped.
- Worca lists at most 500 records per project. Anyone with push access can fill them and so hide other records.
- Teammates' records carry no labels, so a Label filter hides them.

## Keeping the branch small

Worca keeps both the files and the history of `worca-runs` bounded, from the sharers' own machines (there is no
server-side job):

- **Old records are deleted after 14 days.** A finished record (`done`, `error`, `stopped`, `interrupted`) is
  deleted once its `finishedAt` is more than 14 days old. Any other record (`running`, `pausing`, `paused`) is deleted
  once its `updatedAt` is more than 14 days old, so a run paused or idle for 14 days is hidden from teammates until it
  next updates. The deletes ride along in a normal publish commit ("worca-runs: 1 run(s), 2 expired"): any sharer's
  publish prunes everyone's old records, judged by the publisher's clock. A record Worca cannot read (another format,
  a newer record version, a path that does not match its record) is never deleted.
- **The history is compacted to a single commit.** After a push, when the branch has more than 200 commits, the
  publisher replaces it with one commit holding exactly the current files, and pushes it with
  `--force-with-lease=refs/heads/worca-runs:<tip>`. If a teammate pushed in the meantime, git refuses that push, the
  teammate's commit stays, and a later publish tries again. If the push is refused for another reason (a rule that
  blocks force pushes), each publisher waits an hour on its own before it tries again.
- Teammates' fetches follow the rewrite: Worca always fetches the branch with a `+` refspec, and a publisher whose
  copy is older rebuilds its commit on the new one. Each machine keeps the old commits in its own object store until
  its next `git gc`.

## Branch protection

Worca pushes to `worca-runs` directly, without a pull request. Normal pushes are fast-forwards; the compaction above
is the one force push Worca makes, on this branch only. So `worca-runs` must be exempt from both rules: the one that
requires pull requests and the one that blocks force pushes.

- A repository whose rules protect every branch rejects the normal pushes. The card then shows "Push rejected ·
  branch protection" with the fix: exempt `worca-runs` from branch protection in the repository rules.
- A rule that only blocks force pushes stops the compaction, not the sharing: publishing goes on and the history keeps
  growing. The Run sharing card does not warn about it (Worca logs one `run sharing:` line). Check with
  `git rev-list --count origin/worca-runs` after a `git fetch origin worca-runs`: a count far above 200 means the
  compaction is blocked.

If your CI runs on every branch, exclude `worca-runs` from its branch triggers: each push is a commit there.

## Stopping run sharing

Each person switches **Share my runs** off for themselves. Deleting the branch
(`git push origin --delete worca-runs`) clears every record, but each teammate whose 'Share my runs' is on recreates
it on their next run: everyone must switch it off.

## Known gaps

- Workspace runs and runs without a project are not shared.
- A push cut short when Worca shuts down (it waits up to 5 seconds) is lost; the record stays at its last pushed state
  until the run resumes.
- Anyone with push access to the repository can write into any path of the branch.
- Clock skew: a publisher whose clock runs fast deletes records early, by at most its skew. A record with a
  far-future `finishedAt` is never deleted.
- In a shallow clone the commit count stops at the shallow boundary and may never pass 200, so that machine never
  compacts; any teammate with a full clone does.
