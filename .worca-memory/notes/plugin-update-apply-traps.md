---
name: plugin-update-apply-traps
description: Read before fs code over skill/plugin folders (copy, rm, mount, import, update, git archive), fault-injecting node:fs, or working a skills-registry plan (P1-P7)
paths: src/core/plugin-store.mjs, src/core/plugin-repo.mjs, src/core/mcp/plugin-lifecycle.mjs, src/core/mcp/team.mjs, src/core/skills-registry/**, src/core/run-harness.mjs, ui/server.mjs, tools/test.mjs, test/plugin-skills-lifecycle.test.mjs, test/skills-registry-*.test.mjs, test/mcp-views-skills.test.mjs, test/ask-*skills*.test.mjs
updated: 2026-10-24T15:55:36.602Z
author: Denislav Prinov
---

Store, resolvers, git URLs: [[mcp-store-defect-classes]]. SKILL.md frontmatter as the CLI reads it: [[claude-cli-binary-scan]].

## String-compared rm guards are bypassed by aliases
- `materializeSkillMount`'s guard compared SPELLINGS while `rmSync` acts on the real folder: `/private/tmp/…` vs `WORCA_HOME=/tmp/…`, a parent symlinked into the library or a `.claude` dir, an NFD spelling (APFS ignores normalization), `.claude.`/`CLAUDE~1` on Windows each deleted the protected tree. Fix: `realpathSync.native` of the deepest EXISTING ancestor + the rest, NFC, case fold; compare with each root's realpath; test `.claude` on the real path. Prove with a re-spelled root and a sentinel file in a mkdtemp scratch.
- `fs.cpSync` checks "copy into itself" on paths as given (`/private/var` vs `/var` recursed to ENAMETOOLONG): compare `realpathSync.native` paths (JS `realpathSync` keeps typed case/NFD; neither resolves a firmlink). A failed copy of a 0555 source leaves an unremovable stage: chmod the partial copy first. An unreadable file over 1 MB passes `precheck` and fails the copy. Never `chmod -R` a scratch that may hold a hardlink to a root-owned file: unlink by exact name first.

## Name-based skips and catalog reads
- `copySkillTree` skipped the entry NAMED `.git` but dereferenced links (`notes.md -> .git/config` copied a 0600 credential as 0640): check the REAL path relative to the root (`rel.split(sep).includes('.git')`; same for `.claude-plugin`). N links to one folder copy it N times, 2N chained links 2^N folders: limits must bound folders and links too.
- Read a catalog file with lstat first, never `readFileSync(join(dir, 'SKILL.md'))`: the catalog keeps entries whose SKILL.md is a link or FIFO (`valid:false` with `dir`), so EVERY reader of a catalog `dir` needs P1's guard (regular file, no link, <= `SKILL_LIMITS.fileBytes`) — `teamSkillConsent` hung on a FIFO, a route served `SKILL.md -> /etc/hosts`. Async: realpath containment + `fsp.open(…, O_RDONLY|O_NONBLOCK)` + `fh.stat().isFile()` + size. Linked plugins (`code:'linked'`) keep anything. Probe a FIFO only under `spawnSync({timeout})`.
- Equal hash ≠ loads the same: `skillHash` covers only `inspect.mjs`'s file RECORDS (a `.claude-plugin/` folder, folder link, escaping or broken link add a problem and no record): compare validity too.
- Two kinds of `kind:'symlink'` finding: a refused link (path in `problems`) and an allowed in-folder file link imported as a copy (path in `files`) — never badge both "leaves the folder".

## The pre-update version dir is gone by apply time
`updatePlugin` runs `gcVersions(name, [candidate7, entry.pinnedSha7])` BEFORE `applyMcpUpdate`, keeping the LOCK's pin, not `currentTarget(name)`: after a rollback gc deletes the current version. Apply removes exactly what the preview listed (`cand.manifestDelta.<removed…>` from `fetchCandidate`); never recompute a delta from version dirs. Repro: install a, update to b, re-point `current` to `versions/<a7>`, commit c dropping a held skill, `updatePlugin`. Preview cost: export `<subdir>/skills` alone unless `git ls-tree -r <sha> -- <subdir>/skills` lists a `120000 ` link.

## Git pathspecs are case-sensitive; the catalog's file system is not
- A plugin shipping `Skills/` loads on macOS while `git ls-tree/archive -- <subdir>/skills` sees nothing (`ls-tree` refuses `:(icase)`): list `git ls-tree -z --name-only <sha> -- <subdir>/` and fold names with `name.toUpperCase().toLowerCase()`. Pin with a test skipped unless the FS is case-insensitive.
- Link chains that look inside but climb out (`d -> .` + `up -> d/..`) pass a textual `findEscapingSymlinks`; JS `realpathSync` normalizes `d/..` lexically.
- `git add -A` never records case-only renames on macOS: build both cases with `git hash-object -w --stdin` + `git update-index --add --cacheinfo 100644,<sha>,Skills/b/SKILL.md`. Prove Linux-CI counts on a case-sensitive image (`hdiutil create -size 400m -fs 'Case-sensitive APFS'`, attach `-nobrowse -mountpoint`, `TMPDIR=<mnt>/tmp/`). A `finally { await rm(scratch) }` throws ENAMETOOLONG past PATH_MAX: fall back to `rm -rf`.

## `git ls-tree` does not bound what `git archive` writes
- Bytes: archive applies the FETCHED tree's `.gitattributes` (`export-subst` turned 42 KB of `$Format:%<(16000)%H$` into 32 MB; `ident`, `eol=crlf`). After `git init --bare <scratch>` write `info/attributes` = `* -export-subst -export-ignore -ident -text -eol -filter -working-tree-encoding`.
- Folders: each folder above a blob and each gitlink extracts (299 entries under a 400-deep tree = 119 900 folders): count folders above each entry on the exact bytes (read `execFile` output as `latin1`, strip by `Buffer.byteLength(pick) + 1`); macOS bare repos set `core.precomposeunicode=true` (NFD pathspecs over-strip): set it `false` and fail closed unless every row starts with the latin1 pick + `/`. Build such repos with `git mktree -z --missing` + `commit-tree` + `update-ref`.
- Code inserted between a one-line `if {…}` and its `else if` steals the else chain: put new code inside the braces.

## Fault-inject a named `node:fs` import
Modules import fs by name: patch the CJS object, then `syncBuiltinESMExports()` BEFORE the first `await import()` (also rebinds `node:fs/promises`); match the path so only the target call fails:
```js
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const real = fs.writeFileSync;
fs.writeFileSync = function (p, ...a) {
  if (armed && /library\.json\.[0-9a-f]{8}\.tmp$/.test(String(p))) throw Object.assign(new Error('ENOSPC: injected'), { code: 'ENOSPC' });
  return real.call(this, p, ...a);
};
syncBuiltinESMExports();
```
This proved `applyUpdate` has no rollback (a throw after the folder swap leaves new files under the old hash); a crash-window note does not cover a thrown, recoverable error.

## Skills-registry plans (P1-P7)
- Plans: the store, or the main checkout's gitignored `docs/superpowers/plans/2026-10-06-skills-registry-*.md`. Only P1 may change P1's modules. P1↔P7 gaps were closed in P7 refine cycle 1: re-verify, do not re-derive (hosted gating is P7's job; `GET /api/skills/:id/skill-md` needs P1's lstat guard; a paste without frontmatter never commits). P7's jsdom fixtures drift from the server (a missing skill is `valid:false, problems:[]`): capture real bodies from a sandbox home.
- Chain order P1 → P2 → P3 → P4 → P5 (not the INDEX's): read "Requires" against `git log <checkpoint>..HEAD`. A named import of a missing export fails to LINK every importer: P4 reads `import * as policyEffective` + a `_skillDeviations` seam (`[]` without P5); P5 adds no second `skillDeviations` call. Before P5, `normalizePolicyDoc` drops `skills.required`.
- Env seams: `WORCA_CLAUDE_MANAGED_SETTINGS=<file>` with `{"disableSideloadFlags": true}` fakes a sideload-disabled host (delete in `finally`). `CLAUDE_CONFIG_DIR` passes through the runner and `skillHostFacts()` reads `$CLAUDE_CONFIG_DIR/settings.json` (reds `mcp-views-skills`, `ask-api-skills` where exported, e.g. Docker): `tools/test.mjs` deletes it (grep first; else `env -u CLAUDE_CONFIG_DIR`); tests set a sandbox dir in `before()`.
