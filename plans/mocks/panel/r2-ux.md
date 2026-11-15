# Panel r2 · UX: one line you can trust, before or after you send

Mock: `r2-ux.png` (from `r2-ux.html`, rendered 1440 wide with `r2-ux-shot.mjs`, a copy of `shot.mjs`). It shows the composer at rest, with values changed, and after Enter, plus the chat list at rest, with its scope menu open, and narrowed.

## Changed since r1

- **List sentence at rest: dropped.** Both users called it noise, and they were right; I had only shortened it. The scope moves into the title's ⌄ (from the earlier choose-after mock).
- **Values: ink, not grey.** Marta read grey values as status. In Rail, `--ink-2` at meta size *is* the status style, so mine looked the same as it. The dotted underline is gone.
- **Changed values: ChangedDot.** In r1 a changed value was bold ink, which can't work once every value is ink. The dot is the DS's existing mark for "off its default".
- **"as usual": gone.** Marta said a bare fold hides everything. Workflow and base now live in the last value's menu.
- **Effort: plain words** (quick, standard, thorough, deepest), not low/high.
- **New chat: unchanged in place, two additions.** ⌘N anywhere, and the conversation composer says *Reply in Node 24…*, so you can tell you are continuing a chat.

## The five disagreements

**1. Before or after: one design serves both.** The line sits on the composer, so Dana checks and changes values *before* sending. Send shows the proposal (the start rule stays) with **Start focused**, so Dana presses Enter twice and never reaches for the mouse. Marta reads the same line on the card and changes a value there, *after*. The line is shown once: it moves from the composer to the card. Each value is its own picker, reached with Tab from the text and filtered by typing, which is Dana's keyboard path. Values remember the last choice per repo. I rejected a ⌘Enter "skip the proposal" path, because it would make two ways to start a task, and the proposal is what keeps a message from being read as a task.

**2. List sentence at rest: none.** The title is the scope: `Chat ⌄` opens one menu with *what* (Everything, Needs you, Running) and *where* (projects), each with its count. Sort and group sit at the menu's foot. Narrowed, the title reads `Needs you · billing-api ✕`, and the redundant group head goes. Tradeoff: sort and group become two clicks, but nobody on the panel changes them.

**3. Clickable versus status.** With values in ink, the repo at 500 (the brightest, as Dana asked) and `·` separators in `--ink-3`, the line no longer looks like a status line. The mode word keeps the one ⌄, which marks the row as choices. Hover fills a value with a 4px corner, and focus names it in a tooltip ("Repo · Tab from the text"). I dropped the connector words; both users found them wide, and the separators carry the reading.

**4. Violet or ink: neither.** Violet means Worca is writing (`form.suggest`), so it must not mean "you changed this". A changed value gets the ChangedDot after it, and "Back to usual" sits in its menu.

**5. "high".** Effort words now say what they do: `Opus 5.5, thorough`. Model and effort stay one picker, and its tooltip says "how long it thinks". Workflow and base never appear while they are the repo's usual.

**New chat.** I keep the first-row `+ New chat ⌘N`, with a word, at the top of the list, which is where Marta looks. ⌘N and the home composer cover Dana. It is lit on Chat home, because the empty composer there is that new chat. The composer's attach + becomes a paperclip, so + means "new" in exactly one place. Tradeoff: the row costs one row of height; dropping the list sentence gives two back.

## Changes to docs/rail

- **SentencePicker, composer use:** values `--ink` 400, the repo 500, `·` separators, no per-value chevron, ChangedDot for changed values, each value a Tab stop. Effort names: quick, standard, thorough, deepest. The last value's menu holds workflow and base.
- **ListSentence:** removed at rest. The list title takes a scope menu with counts and reads `Scope · project ✕` when narrowed. The `components.md` row "Narrowing a list" changes to match.
- **form.composer:** Send shows the proposal with Start focused. A conversation's placeholder names the chat. New chat is the list's first row plus ⌘N. `R.barHead` drops its `action`.
- **Out of scope but flagged:** the red ✕ on a row reads as "failed" when it means "needs you". The mock uses the question mark in amber.
