---
name: worca-changelog
description: Build a "What's new in Worca" changelog page for @worca/app — a scroll-revealed, screenshot-led ship log in the established Worca design (hero ribbon, kicker/headline/chips per feature, live demo cards, receipts) — from the merged PRs since a reference version, then publish it as an Artifact. Triggers on "changelog", "what's new", "ship log", "release notes", "worca-changelog", or any request to write up what shipped since a version.
---

# Worca changelog entry

A changelog entry is a **self-contained HTML page** in the ship-log design,
built from the PRs merged since a reference version, and published as an
Artifact. It is not a bullet list of commits: every section sells one
user-facing capability with a headline, a screenshot, and a small live demo
of the mechanism.

The output is written into `docs/changelog/` **on the current branch, left
uncommitted**. This skill never branches, commits, pushes, or opens a PR —
see Step 7.

The design, layout and writing rules live next to this file — read both
before writing a line of copy or markup:

- `DESIGN.md` — tokens, components, section anatomy, demo recipes, voice.
- `template.html` — the page skeleton with every component wired up. Copy
  it; never restyle it.
- `inline-assets.mjs` — turns local `<img src>` paths into data URIs so the
  page publishes as one file.

**Usage:**

- `/worca-changelog` — offer the last stable release as the delta start
- `/worca-changelog --from:1.1.1` — delta since that version (tag or bare version)
- `/worca-changelog --from:1.1.1 --to:worca-app-v1.2.0-rc.3` — explicit end ref (default `HEAD`)
- `/worca-changelog --no-publish` — build the file, skip the Artifact

---

## Step 1: Resolve the range

The delta runs from a **reference version** to an **end ref**. A stable
release is the natural reference: it is the last thing a `latest` user has,
so "what's new since it" is exactly the RC's story.

```bash
# Last stable release: highest worca-app-v tag with no pre-release suffix.
git fetch --quiet --tags origin
STABLE=$(git tag --sort=-v:refname | grep -E '^worca-app-v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
LAST_RC=$(git tag --sort=-v:refname | grep -E '^worca-app-v[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$' | head -1)
echo "stable: $STABLE   npm latest: $(npm view @worca/app version)   last rc: $LAST_RC"
node -p "require('./package.json').version"     # the version this entry describes
```

If `--from:` was **not given**, do not pick silently: **offer the last stable
release** with `AskUserQuestion`. Put it first and mark it recommended; the
other options are the last RC and "other" (free text). If the stable tag and
`npm view @worca/app version` disagree, say so in the question — one of them
is stale.

A bare version (`1.1.1`) means the tag `worca-app-v1.1.1`. Verify the tag
exists (`git rev-parse -q --verify refs/tags/<tag>`) before using it; stop on
a miss rather than guessing at a nearby tag.

The end ref defaults to `HEAD`. The entry's **version label** is
`package.json`'s version at the end ref (`git show <to>:package.json`).

Print the resolved range and continue:

```
Changelog range:  worca-app-v1.1.1  →  HEAD  (1.2.0-rc.3)
```

---

## Step 2: Collect the delta

Both views, always — PRs give the story, the first-parent log catches what
landed without a PR.

```bash
FROM=worca-app-v1.1.1; TO=HEAD
SINCE=$(git log -1 --format=%cI "$FROM")
gh pr list --state merged --base dev --search "merged:>=${SINCE%%T*}" --limit 200 \
  --json number,title,body,mergedAt,url,labels \
  --jq "[.[] | select(.mergedAt > \"$SINCE\")] | sort_by(.mergedAt) | .[] | \"#\(.number)\t\(.mergedAt[:10])\t\(.title)\""
git log "$FROM".."$TO" --first-parent --format='%h %s'
```

Read every PR body (`gh pr view <n> --json body --jq .body`). The body is
where the user-facing framing lives; the title is often internal.

Then **cluster into 4–7 themes**. A theme is something a user can point at
in the product: a new view, a new command, a behaviour that changed. Fold
these in rather than giving them a section:

- `chore(release)` bumps, CI, test-only and Windows-path fixes → the
  receipts section, as numbers.
- Refactors and internal plumbing → mention in the sub of the feature they
  enable, or drop.
- Bug fixes → one "Fixes" theme only if there are several visible ones;
  otherwise a chip on the relevant feature (`<span class="chip">no more X</span>`).

Order themes by how much a user will care, biggest first. The hero's chips
and ribbon list them in that order.

---

## Step 3: Collect the receipts

The closing section carries six numbers. Compute them; never estimate.

```bash
git diff --shortstat "$FROM".."$TO"                      # files, +lines, -lines
git rev-list --count --first-parent "$FROM".."$TO"      # commits on dev
gh pr list --state merged --base dev --search "merged:>=${SINCE%%T*}" --json mergedAt \
  --jq "[.[] | select(.mergedAt > \"$SINCE\")] | length"  # PRs merged
git diff --stat "$FROM".."$TO" -- '*.test.mjs' 'test/' | tail -1   # test lines
npm test 2>&1 | grep -E '^# (tests|pass|fail) '           # suite size, must be 0 fail
```

Pick the six that tell the story (tests green, lines landed, PRs merged,
schema versions bumped, a security property, a round-trip proven). Two of
the six may be a cropped screenshot instead of a number — see `DESIGN.md`.

---

## Step 4: Capture screenshots

Every feature section wants a real screenshot; a section with no UI surface
(a CLI change, a policy) gets two demo cards instead, as `template.html`
shows for `s3`.

Follow the sandbox recipe in `docs/screenshots.md` — `HOME` and `WORCA_HOME`
both set to a throwaway dir, seeded mock runs, demo projects with plausible
names — so nothing private lands in a published page. Run the mock server
from the current checkout; the sandbox is runtime state only and produces
no branch, worktree, or commit of its own. Then, with the UI running (the
`run` skill knows how), capture at **1440 × 900**, light theme, and save as
PNG under:

```
docs/changelog/shots/<VERSION>/<section-id>.png     e.g. shots/1.2.0-rc.3/s1.png
```

Crop in markup, not in the file: the `.shot .crop` container takes
`max-height`, and the `<img>` takes `width:130%;max-width:none;margin:…` to
zoom on the part that matters. Keep the original so a later re-crop is free.

Compress before inlining — screenshots dominate the page weight:

```bash
sips -s format jpeg -s formatOptions 82 s1.png --out s1.jpg      # macOS; ~5× smaller
```

---

## Step 5: Write the copy, then the page

Read `DESIGN.md` → *Voice* before writing. The shape of every section is
fixed; only the words and the demo change:

| Slot | Rule |
| --- | --- |
| kicker | 1–2 words naming the area: `Budget`, `Routing`, `Team`. Dot colour from the palette table. |
| h2 | ≤ 7 words, a full sentence with a period, states the outcome not the feature: *Spend caps that pause, not kill.* |
| sub | 1–2 sentences, ≤ 52ch measure. What changed, why it matters. No "we", no "now supports". |
| chips | 3–4 facts. Numbers go in `<b>` (`<b>11</b> built-ins`). No sentences. |
| demo | A 10–20 line CSS/JS loop that shows the *mechanism* — precedence, masking, a flag appearing. Reuse a recipe from `DESIGN.md` before inventing one. |
| shot | The screenshot in a `.shot` frame with a one-line `.shot-cap` that says what the reader is looking at. |

Build the page:

1. Copy `template.html` to `docs/changelog/worca-app-v<VERSION>.src.html`.
2. Fill every `{{…}}` slot; delete the sections you don't need, duplicate
   the ones you do. Keep ids sequential (`s0` hero … `sN` receipts) — the
   dot rail is built from them.
3. Set the hero ribbon text to the section names, uppercased, `·`-separated,
   **repeated twice** so the drift never shows the end.
4. Point every `<img src>` at the local file (logo: `ui/public/assets/worca-logo.png`).
5. Inline and check weight:

```bash
node .claude/skills/worca-changelog/inline-assets.mjs \
  docs/changelog/worca-app-v<VERSION>.src.html \
  docs/changelog/worca-app-v<VERSION>.html
```

The script fails above 15 MB (the Artifact ceiling is 16 MB) and warns
above 4 MB — the sibling ship logs weigh ~1.6 MB. Over 4 MB means a
screenshot went in as PNG; go back to Step 4.

6. Open the built file in a browser and check, in this order: reveals fire
   as you scroll; every demo loops; the rail dot follows the section; no
   horizontal scroll at 390 px wide; `prefers-reduced-motion` shows every
   demo in its final state. Fix in the `.src.html`, rebuild.

The `.src.html` is the editable source and travels with the built file —
the built one is what gets published, the source is what gets edited next
time. Both are written into the working tree of the current branch (Step 7).

---

## Step 6: Publish

Unless `--no-publish`:

1. Load the `artifact-design` skill (the Artifact tool requires it before
   any publish; the page's design is already settled, so the pass is
   confirmation, not redesign).
2. Publish `docs/changelog/worca-app-v<VERSION>.html` with:
   - title: `Worca — What's new in <VERSION>` (the `<title>` tag already says this)
   - favicon: `🚢` on first publish, omitted on redeploys
   - description: one sentence — the hero sub is usually right.
3. Record it in the index, `docs/changelog/README.md` — one row per entry:
   version, range, date, artifact URL. Create the file from the header in
   `DESIGN.md` → *Index* if it does not exist.

Redeploys of the same version go to the same URL: edit the source, rebuild,
publish the same path again. A new version is a new file and a new URL.

---

## Step 7: Leave it on the current branch

The entry stays **in the working tree of the branch that is checked out**.
Do not create a branch, a worktree, a commit, a push, or a PR for it — a
changelog is release material, and the release engineer decides when and
how it lands (folded into the release commit, its own PR, or not at all).
One PR per changelog is exactly the churn this rule avoids.

Show what is waiting, then stop:

```bash
git status --short docs/changelog/
```

Finish with the summary:

```
Changelog entry ready

  Range:      worca-app-v1.1.1 → HEAD (1.2.0-rc.3)
  Sections:   6 features + receipts
  Page:       docs/changelog/worca-app-v1.2.0-rc.3.html  (1.4 MB)
  Artifact:   <url>   |   not published (--no-publish)
  Files:      uncommitted on <branch> — 9 files under docs/changelog/
```
