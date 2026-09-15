# Ship-log design reference

The changelog page is the "Worca — 3-Day Ship Log" design: a warm off-white
canvas, big rounded white cards, one accent ribbon, screenshots in browser
frames, and a small animated demo beside every feature. It reads like a
product launch page, not a release note. Everything here is already encoded
in `template.html`; this document says what each part is for so the copy
and the demos land in the right shape.

## Principles

1. **One capability per section.** A section has one headline, one
   screenshot, one demo. If a theme needs two headlines it is two sections.
2. **Show the mechanism, not the menu.** The demo animates the thing the
   feature *does* — a flag appearing, a value being masked, a precedence
   resolving — in a 2–3 second loop. It is never a second screenshot.
3. **Outcome headlines.** *Spend caps that pause, not kill.* *Define once.
   Use everywhere.* The h2 states what the user gets; the sub explains the
   feature that delivers it.
4. **Facts as chips.** Counts, limits, guarantees go in chips, numbers in
   `<b>`. Chips are scannable proof; the sub is the argument.
5. **Motion is progressive.** Content reveals on scroll, ribbons drift with
   scroll position, demos loop on timers. With `prefers-reduced-motion`
   everything is visible immediately in its final state — the page must be
   complete with no motion at all.
6. **Real pixels.** Screenshots come from a seeded, sandboxed Worca — never
   mocked-up UI, never a private catalog.
7. **One file.** Logo and screenshots are inlined as data URIs; the page has
   no external requests and survives being saved, mailed, or published.

## Tokens

Defined on `:root` in the template. Do not add colours; pick from these.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#ECEAE4` | page canvas |
| `--card` / `--card-2` | `#FFFFFF` / `#F6F4EF` | section cards / demo cards, shot toolbar |
| `--ink` / `--ink-2` / `--ink-3` | `#14151A` / `#56534C` / `#8B8780` | text / secondary / labels |
| `--line` | `#E2DFD7` | every border |
| `--ocean` / `--ocean-deep` | `#4B5ED2` / `#3A49AC` | accent: hero ribbon, kicker dot, rail, focus |
| `--wash` / `--wash-2` | `#DDE3F7` / `#EBEEFA` | hero gradient |
| `--coral` / `--coral-soft` | `#EEA47D` / `#F8E3D5` | receipts ribbon |
| `--lime` / `--lime-2` | `#DEEFC4` / `#EDF6DC` | positive notes |
| `--ok` / `--warn` / `--bad` / `--info` | `#38854F` / `#DFA23F` / `#C9524A` / `#5B94C8` | kicker dots by area, pills |
| `--r-lg` / `--r-md` / `--r-sm` | 28 / 18 / 12 px | section / demo & shot / rows |
| `--shadow` | `0 18px 50px -22px rgba(20,21,26,.28)` | shots, winning rows, float chips |

Type: system sans (`--sans`), 16px/1.5 body; `--mono` for anything that is
a value — dates, ids, env keys, counts in chips. Headlines are weight 800,
tracking −0.035em, `text-wrap:balance`. `h1` clamps 44–92px, `h2` 34–58px.

**Kicker dot colour by area** (keep the mapping stable across entries so
readers learn it):

| Area | Dot |
| --- | --- |
| New view / composer / UI | `--ocean` (default) |
| Routing, models, connectivity | `--info` |
| Budget, cost, limits | `--warn` |
| Team, plugins, sharing-in | `--bad` |
| Sharing-out, export, docs | `--ok` |
| Receipts | `--coral` |

## Page anatomy

```
.wrap (max 1280)
├── .top            brand logo · mono chip "changelog · v1.1.1 → v1.2.0"
├── section.sec.hero #s0
│   ├── svg.ribbon  ocean band, mono uppercase feature names on a textPath
│   ├── .sec-head   kicker · h1 (2 lines) · sub · chips (first one .acc)
│   └── .shot       hero screenshot, rotated 1.6°, two .float-chip "NEW · X"
├── section.sec #s1 … #sN-1      one per feature
│   ├── .sec-head   kicker(dot) · h2 · sub · chips
│   └── .grid2[.flip]   .demo + .shot   (or .demo + .demo when there is no UI)
├── section.sec.polish #sN       receipts
│   ├── svg.p-ribbon  coral band "TESTS · NUMBERS · PROOF"
│   ├── .sec-head   kicker(coral) · h2 "Shipped, tested, verified live."
│   └── .bubs       six .bub — a circle (number or cropped image) + two lines
├── .foot           "WORCA · changelog · <range>"  ·  mono date
└── nav.rail        fixed dots, one per section, built from the ids
```

Alternate `.grid2` and `.grid2.flip` from section to section so the
screenshot swaps sides; the eye keeps moving.

## Components

- **`.kicker`** — pill with a dot. Text is 1–2 words, uppercase by CSS.
- **`.chip`** — pill fact. `.chip.acc` is the dark one; only the hero's first
  chip uses it. `<b>` inside a chip is mono and dark — for numbers.
- **`.shot`** — browser frame: three-dot toolbar + `.crop` + `<img>`. Zoom
  with inline styles on the img (`width:130%;max-width:none;margin:-6% 0 0 -18%`)
  and `max-height` on `.crop`. Always follow with `.shot-cap`.
- **`.float-chip`** — absolutely-positioned callout on the hero shot:
  `<small>New</small><span>Feature</span>`. Two per hero, no more.
- **`.demo`** — card-2 background, `.dlabel` uppercase label first, then the
  animation. Ends with `.env-note` when a one-line takeaway helps.
- **`.rv`** — reveal-on-scroll. Put it on `.sec-head`, each `.grid2` child,
  each `.bub`. `.d1`/`.d2` stagger siblings by 80ms steps.
- **`.bub`** — receipts item. `.im` is an 86px circle holding either
  `<span class="big">2,273</span>` or a cropped `<img>` (`width:300%` and a
  negative `left`/`top` to aim at the interesting part).

## Demo recipes

Every demo is markup + a class toggle on a `setInterval`. The template ships
these six; reuse before inventing:

| Recipe | Shows | Mechanism |
| --- | --- | --- |
| **Precedence** (`.cat-demo`) | layers resolving to one winner | rows with `.win` / `.dim`; static, no loop needed |
| **Mask / reveal** (`.env-demo`) | a secret shown only on demand | toggle `.reveal` every 2.6s, button text flips |
| **Meter + flag** (`.meter-run`, `.cost-banner`, `.cap-steps`) | a run crossing a threshold | 4-phase loop: fill width, pill text, banner `.show`, numbered steps `.on` |
| **Grouped picker** (`.dd-demo`) | grouping + a collision suffix | toggle `.collide` to fade `.sfx` in |
| **Review rows** (`.con-demo`) | red-flagged changes + a green guarantee | static `.red-chip` rows + `.con-note` |
| **Policy flip** (`.pol-demo`) | a heuristic changing a default | toggle `.flip` on one `.prow`; the `.warn-note` sibling fades in |

Inventing a new one: keep it to one toggled class, one interval of 2–3s,
≤ 20 lines of CSS, and add its final state to the reduced-motion block in
the script (`if (reduced) { … add the class …; return; }`).

## Voice

- **Headlines** are outcomes: *If the endpoint hides costs, you'll know.*
  *Ship your models to the team.* Present tense, second person implied,
  ≤ 7 words, ending in a period.
- **Subs** explain the change in one or two sentences and may name the
  feature. Prefer concrete nouns (`base URL`, `--yes`, `0600`) to
  adjectives. Never "we've added", "now supports", "improved".
- **Chips** are noun phrases or short guarantees: `merged at spawn`,
  `secrets never exported`, `<b>3</b> groups`. A chip can carry one glyph
  (`⚠cost`) when the product shows it that way.
- **Captions** (`.shot-cap`) tell the reader where they are looking: *The
  editor: efforts, label, and the full routing env per model.*
- **Receipts** are two lines: a bold claim (`Tests green`) and the number
  behind it (`8 new suites · +1,703 test lines`). Middle dots separate
  facts, never commas.
- Use `·` between facts, `—` for an aside inside a sub, `→` only inside
  mono text. No exclamation marks anywhere on the page.

## Screenshots

- 1440 × 900, light theme, seeded demo data per `docs/screenshots.md`.
- Hero: the one view that carries the release. Sections: the surface the
  feature lives on, zoomed so the feature is the largest thing in frame.
- JPEG at quality ~82 for full views; PNG only for crops that are mostly
  text and under 150 KB.
- Alt text names the view and the state: *Model editor — routing env with
  masked values, copy and reveal.*

## Index

`docs/changelog/README.md` starts with this header and gains one row per
entry, newest first:

```markdown
# Changelog

Each entry is a self-contained page in the ship-log design, built with
`/worca-changelog` from the PRs merged since the previous release.

| Version | Since | Date | Page | Artifact |
| --- | --- | --- | --- | --- |
```
