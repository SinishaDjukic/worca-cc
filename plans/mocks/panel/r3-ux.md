# Panel r3 · UX: the same design in Rail's own parts

Mock: `r3-ux.png` (from `r3-ux.html`, 1440 wide via `r2-ux-shot.mjs`). Folds in Dana and Marta (r3) and Sam, a first-day user (r2).

## Rail mapping

| Element | Rail | Status |
|---|---|---|
| Ask / Task / Schedule word | Composer's sentence, standard SentencePicker | as is |
| Mode menu explains each mode | CompactMenu item `help`, shown as a second line | variant: `described` CompactMenu |
| Repo, engine, finish values | SentencePicker | variant: `quiet` (400 ink; the where 500; ⌄ in `--ink-3`; spacing instead of "·") |
| A value's plain-words hint | Tooltip (`watchTooltips`) | as is |
| Changed or remembered value | ChangedDot (`changedDot`, as on SettingsRow) | as is; tooltip leads "Changed from the default" |
| Back to the default | "Reset to default" in the value's menu (actions.md: Reset to defaults) | as is |
| Workflow, where it starts | Customise, the composer's fold (`form.composer`) | as is (r2's in-menu home dropped) |
| Engine search, CLI name | CompactMenu find field, item hint | as is |
| + (context) and voice | Composer's own | as is (r2's paperclip dropped) |
| Send's name | "its button names what will happen": *Propose task* | as is |
| Proposal | TaskProposal: kicker *Proposed task*, title in place, Start, Not now | as is, plus timing rules below |
| Worca rewriting the title | violet shimmer (`motion.md`) | as is |
| Esc on the proposal | keyboard: Esc closes what is on top, which is Not now | as is |
| New chat | BarHead's one action, with its label; ⌥⌘N (`keyboard.md`) | variant: labelled, not `iconOnly` |
| List scope at rest | ListSentence folded into the list's ⋯ (a CompactMenu with the same words and counts) | variant: `quiet` ListSentence |
| List scope narrowed | ListSentence in full, with Reset view | as is |
| Needs-you mark | KindMark, question centre, `--amber`; red only for failed | as is |
| Why a row waits | row Tooltip's first line: *Asks you* or *Waits for your OK* | as is (`list.one-end`) |
| Effort words quick / standard / thorough / deepest | none | **new to Rail.** Proposed rule: an engine's effort is named for what it does, and the CLI's name is the item's hint |

## Changed since r2

- **Scope left the title.** BarHead's title ⌄ already opens the places, and Sam guessed exactly that. At rest the scope sits in the list's ⋯; when narrowed, it returns as Rail's ListSentence.
- **New chat is BarHead's labelled action, not a new first row.** It still has its word and sits at the top of the list, as both users asked. The key is Rail's ⌥⌘N, not ⌘N.
- **Values keep a quiet ⌄.** Sam saw only "Task ⌄" as clickable. The chevron is in `--ink-3` and the values are at 400 weight, so this is four light chevrons on one line, not seven bold ones.
- **No "·" separators; spacing instead.** The ChangedDot is now the only dot in the line.
- **Workflow and base moved back to Customise,** with plain row names (*Workflow*, *Starts from*).
- **The paperclip went back to the composer's +.** The + no longer reads as "new", because New chat now has its word.

## Open points resolved

1. **Changed mark versus separator.** With the "·" gone, only one kind of dot appears in the line. Its tooltip leads with *Changed from the default*, which answers Sam's guesses of "unsaved" and "live".
2. **The proposal must not wait.** TaskProposal draws on the first Enter, with your words as its title and Start focused. Worca's title arrives in place under the violet shimmer; its reason fills in, and shows nothing before 300ms (EmptyState). Start works at once. A task started early keeps your words as its title.
3. **Esc and Not now** remove the card and put the text back in the composer with its values still set. This follows the keyboard rule "Esc closes what is on top".
4. **Why a row waits.** The first line of the row's Tooltip uses Rail's words: *Asks you* or *Waits for your OK*. It shows on hover, on focus and on long-press. The amber ? stays; red is kept for Failed.
5. **Phone, first tap.** A tap on a value opens its CompactMenu at once, through toggleMenu. The hint is a Tooltip, which is long-press only (`narrow.md`), so a tap never just shows a hint. The menu stays 16px inside the window.
6. **Per-repo memory.** A value kept from your last task on a repo is still changed from the default, so it wears the ChangedDot. Its tooltip says *Kept from your last worca-cc task · Default: Opus 5.5, thorough*. A remembered value never looks like a default. Check it in the build.

## Sam's other points

- **Task versus Ask versus Schedule:** the mode menu explains each one every time (the described variant). There is no one-time tour, because Rail has no onboarding layer.
- **"thorough":** both the engine's Tooltip and its menu item's help say *thinks longer, slower and costs more*.
- **The proposal surprised Sam:** Send's tooltip names the step (*Propose task · Enter*), so the card is expected.

## Rules that change

- `components.md`: SentencePicker gets a `quiet` variant (composer values). CompactMenu gets a `described` variant. ListSentence gets a `quiet` variant (folds into the list's ⋯ at its defaults). BarHead's action may carry a label.
- `forms.md` › `form.composer`: TaskProposal draws at once and Start never waits; Not now and Esc restore the text and values; per-repo memory shows the ChangedDot.
- `lists.md` › `list.sentence`: "above the list when off its defaults; in the list's ⋯ at rest".
- **New:** effort names (small-rules).
