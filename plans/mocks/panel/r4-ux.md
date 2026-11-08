# Panel r4 · UX: one line narrowed, the reason on the row

Mock: `r4-ux.png` (from `r4-ux.html`, rendered with `r2-ux-shot.mjs`). It shows the desktop list (at rest, its menu, narrowed), the composer (Tab order, engine menu) and a 375px phone (drawer at rest, narrowed). Everything the users passed in r3 stays.

## Changes

1. **Narrowed is one line.** The quiet ListSentence drops its connector words ("Showing", "from") and keeps only its values, each still a SentencePicker: `Needs you ⌄  billing-api ⌄  ✕  2`. The ✕ is Rail's remove mark (the ✕ on ListEditor's items and on IntentChip). It *is* Reset view, which stays as its tooltip and its accessible name, so nothing is renamed. The group head goes, because the line already says it.
2. **The reason is on the row.** Under Needs you, a row's one end (`list.one-end`) is its reason in Rail's words: **Asks you** or **Waits for your OK**. It takes the place of the time, which moves into the tooltip. The rule of one fact at the end still holds, and the title ellipsises first. Elsewhere the end stays the time or git's icon. Red is only for Failed.
3. **The filters say they are filters.** Sam read ⋯ next to Needs you as the group's actions. At rest, the ListSentence folds to its first word, **All chats ⌄**, a quiet SentencePicker at the right of the first head. Its menu has Showing and From with counts, then Sort and Select. Rail forbids a View menu or a filter icon (`components.md`, "Narrowing a list"). The sentence's own word does not break that rule, and it tells you what the list shows.
4. **Effort hints: plain words win.** The menu lists *quick, standard, thorough, deepest* with no hint, as Sam asked. Dana's need is met by search: typing `high` finds *thorough*, and the matched CLI name then shows as the item's hint. Every item's tooltip carries both names. Why: everyone reads the menu, but only people who already know the CLI name need it, and they type rather than scan.
5. **Keys and words.**
   - Tab from the text goes repo → engine → finish → Customise. Shift+Tab goes back to the text, and then to Task ⌄ and +.
   - **New chat:** ⌥⌘N stays, because `keys.reserved` forbids ⌘N in a browser (the browser owns it). Proposed amendment, **new to Rail:** "a combo the browser owns may be an alias where Worca is its own window (desktop app, installed PWA)". With that, ⌘N also works there, from the same table row (`keys.one-table`; no per-user rebinding). Both keys focus the new chat's composer.
   - **Customise** gets a tooltip naming what it holds (*workflow and where it starts · Default workflow · from the latest dev*), and a ChangedDot when one of those is changed.
   - **Phone:** at 760px and below the bar is a drawer, so its head keeps the bar's width. `narrow.md`'s 480px rule (a labelled button keeps only its icon) covers the top bar, not BarHead. Proposed line for `narrow.md`: "BarHead's action keeps its word; the title gives way first."

## Rail mapping, changed rows only

| Element | Rail | Status |
|---|---|---|
| List scope at rest | ListSentence folded to its first word (All chats ⌄) on the first head | variant: `quiet` ListSentence (was: folded into ⋯) |
| List scope narrowed | ListSentence values only + ✕ (= Reset view) + count, one line | variant: `quiet` ListSentence (was: full sentence + Reset view) |
| Why a row waits | the row's one end under Needs you: Asks you / Waits for your OK; details stay in the Tooltip | `list.one-end` amended: "a waiting row's end is its reason" |
| Engine CLI names | CompactMenu find matches them; the hint shows only for a match; also in the Tooltip | CompactMenu find, as is (was: always shown as the hint) |
| Composer Tab order | text → values → Customise; Shift+Tab → text → Task ⌄ → + | as is (`keys.focus`), order written into `form.composer` |
| Customise | Tooltip with what it holds; ChangedDot when changed | as is |
| New chat key | ⌥⌘N; ⌘N as an alias in the app or PWA | **new to Rail:** `keys.reserved` amendment |
| BarHead on a phone | the action keeps its word, the title ellipsises | `narrow.md` line added |
