# Panel r1 · UX: the quiet sentence

Mock: `r1-ux.png` (from `r1-ux.html`), today next to the proposal for the composer and the sidebar head.

## Why it feels heavy

1. **Every value is 600 and `--ink`.** Today's composer has seven values at 600 among `--ink-3` connectors. That is
   seven bright islands on one line, the same weight as a Heading (`look.md`: Heading 15/600). The sentence outweighs
   the placeholder above it, which is where you actually write. A choice row ends up louder than the content.
2. **Seven chevrons.** One ⌄ per value adds seven extra marks and makes the line read as a form spelled out in words.
   The bold weight already says "this is a value", so the chevron says it a second time.
3. **Defaults speak as loudly as choices.** `Default` workflow, `origin · latest` and `open a PR` say "as always". Three
   of seven values carry no information, yet they weigh as much as `billing-api`, the one value you must check.
   This breaks `rail.quiet`.
4. **Connectors make it longer, not clearer.** `on … with … on … from … then` adds five words, and `on` appears twice.
   Model and effort are two pickers (`Opus 5.5 ⌄ high ⌄`) for what is one choice.
5. **Line count.** At body size the sentence wraps to two lines in the composer. In the sidebar, `Showing all from all
   projects by date ⋯` wraps to two lines above every list. So the chrome is taller than the first row.
6. **Placement of +.** In the bar head, the + is a 15px glyph between the title's ⌄ and the hide toggle: three marks of
   equal weight. It sits away from the chats it adds to, does not say what it makes (chat, task?), and sits next to the
   composer's own + (attach), which means something different. On Chat home it does nothing new, because the empty
   composer already is a new chat.

## Principle

**The sentence speaks at meta size in plain words, and only what differs from the default takes ink.**

## Proposal

### (a) The choice design: the quiet sentence

- **Size and weight:** the sentence is Meta (12/400). Connectors are `--ink-3` and values `--ink-2`. Only the mode word
  (`Task`) is 13/500 `--ink`, because it is the one choice that changes what Send does.
- **No chevrons.** A value carries a 1px dotted underline in a line tone, which shows it opens. Hover and focus fill it
  with `--hover` (as `.spick-b` does today), without reflow, so `rail.still` holds. Keys stay the same (toggleMenu).
- **Defaults fold into one word.** Clauses at their default collapse into a trailing picker, **as usual**. It opens a
  CompactMenu of divided rows (Workflow · Default, From · origin · latest, Then · open a PR). Change one and it
  leaves the fold and joins the sentence with its own connector (`…, then push only`). The result is
  `Task on billing-api, Opus 5.5 high, as usual`: one line, three pickers.
- **Engine is one picker:** model and effort together (`Opus 5.5 high`), as the composer rule already says ("its engine
  carries its effort").
- **Changed reads as changed:** a value off its default turns `--ink`/500. It does not use violet, because violet means
  Worca is writing (`form.suggest`), and the readout exploration reused it.
- **The list uses the same rule:** `Showing all by date ⋯` on one meta line. `from all projects` folds away at its
  default. Narrowed, it reads `Showing needs you from billing-api`, the changed words in ink, and **Reset** takes the ⋯'s
  place. The group head that repeats the filter goes. Counts stay in the menus, as today.

The sentence stays on the page, so it is not hidden behind a popover (readout) or moved into the proposal (choose
after). You still see and change everything where it acts, in one click. Ordinary stays ordinary: Ask has no sentence
at all, and Task is still a mode you pick.

### (b) New chat

- **Move the + out of the bar head into the list's first row:** `+ New chat ⌘N`. It is a ListRow with the + in the
  mark's place on the rail, sticky under the head, and it is lit while you are on Chat home (the empty composer is
  that new chat). Tasks and Schedules get `+ New task` and `+ New schedule` the same way.
- The bar head keeps only the title (its ⌄ opens the places) and the hide toggle. One tool, so nothing to weigh.

### Tradeoffs

- The New chat row costs about 30px of list height, against the two-line sentence it replaces, which saves about 20px.
  The net change is roughly zero.
- **As usual** hides three choices behind one word. Someone who always changes the base branch pays one extra click.
  Mitigation: a value you changed last time stays out of the fold (it joins the sentence), so the fold learns.
- Meta size lowers the hit target height. The hover fill, the 3px ring and the keys keep it usable. Touch needs a
  ≥32px row, which the composer foot already has.
- Dotted underlines are a new affordance. It is one tone and one pixel, but it has to be the only way the DS marks a
  word as pickable.

## What changes in docs/rail

- `components.md` › SentencePicker: Meta 12/400, values `--ink-2` with a dotted underline, no chevron. A changed value is
  `--ink`/500. Defaults fold into **as usual**. Remove "each choice with its count" from the visible sentence (counts
  live in the menu).
- `components.md` › ListSentence: one meta line, default clauses omitted, Reset replaces ⋯ while narrowed. The example
  changes to `Showing all by date`.
- `forms.md` › `form.composer`: "the sentence is one line at meta size; clauses at default fold into as usual; the
  engine is one picker". Add New chat as the list's first row and drop the bar's +.
- `look.md` › Type roles: add the row "Sentence | `--fs-meta` 12 | 400, values `--ink-2`, changed 500 `--ink`".
- `R.barHead`: remove `action`. `listController` gains a `create` row spec (sticky, with its key hint).
