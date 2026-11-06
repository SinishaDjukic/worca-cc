# The look: type, colour, surfaces

| Rule | What | Why | Held by |
|---|---|---|---|
| `look.type-roles` | Every text takes a role from the scale; a head is never weaker than what it heads | The hierarchy reads the same everywhere | ds-check |
| `look.tokens` | Colours, sizes and corners come from tokens, one family of neutrals, one surface | A page has no look of its own | ds-check |
| `look.running-needs-apart` | Running and needs-you are two colours that read apart at 8px | They ask for opposite things from you | by hand |
| `look.inter-at-graduation` | Inter replaces Poppins at graduation, one switch for everyone | Two faces on screen at once reads as a mistake | by hand |
| `look.scrollbars` | Scrollbars are thin and appear as the mouse moves or while something scrolls, then go | A quiet page; nothing shifts when they show | design-system-components |
| `look.violet-apart` | Violet means merged, or Worca writing in a field; never both | A dot never means AI | by hand |

## Type roles
The type scale below, named by what it does on a Rail page.
| Role | Token | Weight | For |
|---|---|---|---|
| Headline | `--fs-page` 22 | 600, tracking −0.02em | the state word: what is read first |
| Title | `--fs-subpage` 18 | 600, tracking −0.02em | the page title, one line with an ellipsis (a tap shows it whole); a page with no state word (a list, Settings) keeps it at `--fs-page` 22 |
| Heading | `--fs-section` 15 | 600, tracking −0.01em | a section's head on a page (a settings section, a tab's section); a step above the rows it heads, never the same size |
| Value | `--fs-section` 15 | 600 | figures: time, cost, changes |
| Body | `--fs-body` 13 | 400 (the live or asking row 600) | rows, questions, text |
| Meta | `--fs-meta` 12 | 400, `--ink-2` | the metadata line, times, figure labels, details |
| Caption | `--fs-caption` 11 | 400 | chips, hints; `--ink-3` only for marks and separators |

A head is never smaller or weaker than what it heads: a step larger (a page's sections: Heading over Body rows), or the
same size, heavier and in `--ink` (a list's or a menu's groups: Body 600 over Body 400 or 500 rows). Never a caption
over the items it names. `ds-check` compares every head with its items.

## The Rail look
Calm and state-first: the look refines the current one and never adds a character of its own (no display faces, no
drawn rails, no new hues). Mocks: `plans/rail/mocks/visual-language-refined-*.png`. The prototype and the app keep
today's look until the Rail ships; these values replace it then. The Pulse prototype (`pulse.html`) already shows
the Rail look, so it can be judged in use.
- **Type:** Inter, bundled (400, 500, 600), in place of Poppins, at graduation, one switch for everyone (`look.inter-at-graduation`); JetBrains Mono stays for code, branches and ids. No
  700: titles and the state word are 600 with −0.02em tracking, buttons 500.
- **One surface:** the page and the card share one background (`--bg` = `--panel`); the card keeps its 1px `--line`.
  The card has one divider, above the Figures; its other zones are split by space.
- **One family of neutrals,** slightly cool, for every grey, line and fill:

| Token | Light | Dark |
|---|---|---|
| `--bg`, `--panel` | #FFFFFF | #141416 |
| `--canvas-2`, `--side-bg` | #FAFAFA | #18181B |
| `--field`, `--surface` | #F4F4F5 | #1F1F23 |
| `--hover`, `--side-sel-bg` | #F0F0F2 | #222227 / #26262B |
| `--ink` | #18181B | #EDEDEF |
| `--ink-2` | #63636B | #A1A1A9 |
| `--ink-3` | #A1A1A9 | #6E6E76 |
| `--line` | #EEEEF0 | #26262B |
| `--line-2` | #E2E2E6 | #35353B |
| `--float`, `--float-line` (menus, panels, popovers) | #FFFFFF, `--line` | #1D1D21, #323238 |

- **Running and needs-you stay apart:** `--peach` #B39A0E / #ECD86A (lighter, lemon) and `--amber` #E07A1F / #EE8A2C
  (deeper orange). The two dots must read as two colours at 8px, side by side in Pulse, in both themes.
- **The step bar is quiet:** 4px; a step to come is `--line`, a finished one #C9C9CF / #4A4A52; only the live, asking
  or failed cell has colour.
- **The metadata line:** the branch is `--ink-2`, so the PR number and the phrase read first.
- **Depth in dark:** a floating surface is a step lighter than the page (`--float`) with a hairline (`--float-line`);
  the shadow alone does not show on dark.

## Violet, kept apart
Violet has two meanings that never meet: the merged status dot (a state), and Worca writing for you inside a field
(the sparkle, the Suggested chip, the shimmer). A dot never means AI, and a suggestion is never a dot or a badge.

## Scrollbars
Thin, in `--line-2`, on a clear track. They appear as the mouse moves, on the page and on any scroller under the pointer, and while something scrolls; 0.8s after it stops, they fade out. They keep their room whether shown or not, so nothing shifts. `watchScrollbars(document)` marks what shows; the look is `rail-look.css`'s.
