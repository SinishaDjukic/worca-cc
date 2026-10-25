---
name: adding-a-forge
description: Read before adding or changing a code host (forge) — GitHub/Azure DevOps/Bitbucket; lists the two-way forge splits a new forge silently falls through.
paths: src/core/forge.mjs, src/core/host-credentials.mjs, src/core/git-info.mjs, src/core/marketplace-publish.mjs
updated: 2026-10-25T16:03:47.209Z
author: Bulibas
---

Making `forgeOf` (src/core/forge.mjs) return a new id flips almost nothing by itself. Most sites split forges two ways,
`=== 'azure'` versus "everything else is GitHub", so a new forge silently takes the GitHub/gh path. Found while planning
Bitbucket (#907, 2026-10-25):

- `src/core/marketplace-publish.mjs` `publishTargetOf` builds the clone URL as `forge === 'github' ? github : azure`.
  Any other truthy forge gets an Azure URL built from undefined `org`/`project`. Return null for it first.
- `git-info.mjs` `prProviderFor`, `createPr`, `prMergeable`, `findPrForBranch`, `prLifecycleState`, and the watch
  dispatch (`azureWatch`) all test `=== 'azure'`. `ghUsable`/`azureBaseRemote` key on the Azure credential only.
- `ui/server.mjs` skips gh-only body edits and the GitHub "Closes" line with `=== 'azure'` / `!== 'azure'`
  (`refreshSliceBody`, `adoptOnePr`, `runSourceIssue`). `forgeOfPrUrl` is null for GHE, so `!== 'github'` would also
  skip GHE.
- Credential strips: `stripHostCredentials` is the one strip for every child spawn. `gitEnvFor`'s GitHub arm and
  `azureEnv` strip only the OTHER known forge, so a new forge's env keys leak into git calls for the others unless
  those arms strip them too. `hostLookupNeeded` must open for the new credential, or pushes never read the push URL.
- Hand-written key lists pin "no credential reaches a child": `test/spawn-args`, `actions-spawn`,
  `graph-script-runner`, `claude-runner-broker`, plus `tools/test.mjs`, which deletes the developer's own variables.

- Untested by default (a cycle-2 mutation sweep, 2026-10-25): git-sync `readCred`'s new arm and the
  `(info.githubRepo || info.azure || …)` conditions in `fastForward` and `readEnvFor` (Resolve and the #620 merge-tree
  check on a PRIVATE repo), and `pluginGitEnv`. Copy the Azure fetch / fast-forward tests in `test/git-sync.test.mjs`
  (runner answers `remote get-url` with the forge URL) and add a merge-tree env test in `test/git-sync-base-merge.test.mjs`.
- Still untested after two sweeps (impl review cycle 1, 2026-10-25), in the REST PR adapter `src/core/pr/bitbucket.mjs`:
  the same-repo (fork) filter in each lookup is a SEPARATE guard per function (`openPr`, `findPrForBranch`,
  `listPullRequestsForBranches`, `readPr`): a test for one does not cover the others (`findPrForBranch`'s survived).
  The query-literal escape (`lit`, BBQL quotes/backslashes) also survived: assert the decoded `q=` of a branch holding `"`.

Find the splits: `git grep -nE "forge\)? ?(===|!==) ?'(github|azure)'|\.forge (===|!==) '(github|azure)'" -- src ui`.
