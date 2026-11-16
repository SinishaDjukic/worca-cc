# Keyboard

| Rule | What | Why | Held by |
|---|---|---|---|
| `keys.one-table` | Every shortcut is a row of the one table (`SHORTCUTS` in `shortcuts.mjs`); a page asks what a key means (`shortcutAction`), it never reads the key itself | The sheet can never disagree with the keys | design-system-logic |
| `keys.not-typing` | No shortcut fires while you type in a field, but a field's own way out: Esc, the arrows from a menu's field into its items, and Chat's ⌥⌘N, ⌘\\ and ⌘⇧L in its composer | Typing stays typing | design-system-logic |
| `keys.reserved` | No shortcut uses a combo the browser owns | It could never reach the page | design-system-logic |
| `keys.sheet` | `?` opens the Keyboard shortcuts sheet, drawn from the table for where you are: a list's row with `can` only in a list that has that action | It is how keys are found | design-system-components |
| `keys.esc-strip` | Esc takes back the confirm strip or short form that shows, once nothing lies over it (`watchStrips` presses its Cancel); a form with something typed stays, and a strip whose quiet side is an answer (`data-esc="back"`) is closed by its owner | A question you did not mean goes the way it came | design-system-components |
| `keys.focus` | Focus is always visible, as one ring of 2px ink, and never dropped: a redraw hands it to the control at the same address, or to the row beside one that left, else to the menu's trigger or the dialog's opener (`watchFocusBack`) | You keep your place | design-system-settings-redesign |
| `keys.skip-link` | Skip to content is the page's first Tab stop, shown only while focused, and lands on the page's heading | The keyboard reaches the page without walking the bar | design-system-shell-redesign |
| `keys.list-stops` | A list is one Tab stop: the row you are on, then only that row's fold and its ⋯ | Tab crosses a list in a step, not a row at a time | design-system-shell-redesign |
| `keys.arrows-stay` | The arrows move through rows only from inside the list; Left and Right fold and open what is under a row | A key pressed on the page never moves something out of sight | design-system-shell-redesign |
| `keys.search` | The top bar's search is a combobox, left aligned and 240px at rest; it grows to 440px on focus or while results show, in a column of its own, so the icons at its right never move. ↓ and ↑ reach the results, Enter opens one, and the focus lands on the opened page's heading | One search that is always in the same place and fully usable by keyboard | design-system-shell-redesign |
| `keys.menu-focus` | A menu that opens takes the focus (the chosen item, else the first; a field first): ↓ ↑ Home End and type-ahead move in it, ↓ on a closed trigger opens it, Tab from the trigger enters and Shift+Tab leaves (`watchChoiceKeys`) | Every menu works the same by keyboard, without a page writing it | design-system-settings-redesign |
| `keys.radio-arrows` | In a radio group every arrow moves the choice, the group is one Tab stop on its chosen answer, and the page's own shortcuts never see the key | A question is answered as a native radio is | design-system-settings-redesign |
| `keys.dialog-focus` | A Dialog takes the focus (`[autofocus]`, else its first field, else its first control) and keeps Tab inside; Esc closes an open picker first and the dialog second, and the focus returns to the opener (`watchDialogs`) | What lies over the page holds the keyboard until it is gone | design-system-settings-redesign |
| `keys.row-keys` | Space and Enter act only with the focus on a row, so a button keeps its own; a list whose rows cannot be acted on together has moving and opening only | A key never does two things | design-system-logic |
| `keys.glyphs` | ⌘ is Ctrl off a Mac, and either works everywhere; `keyGlyph` and `keyHint` write the right one | A hint shows the key you have | design-system-logic |

A page names where the focus is, and the table answers:
`shortcutAction(keyFacts(e, rowSelector), { scopes, selecting, can })`. A new key is a row in the table.

| Where | Keys |
|---|---|
| Anywhere | ⌘K Search or ask, even from a field · `?` this sheet · Esc closes what is on top |
| A list | ↑ ↓ or J K move · Enter opens; and, in a list that has the action (`can`): `.` row menu, ← → fold, S stop, E archive, R rename, P pin, G and ⇧G group, ⌫ delete |
| A list with selecting | Space selects the row · ⇧↑ ⇧↓ extend · ⌘A selects all · Esc ends selecting, then closes the panel |
| Chat | ⌥⌘N new chat · ⌘\\ show or hide the bar · ⌘⇧L go to the chats · ⌥↑ ⌥↓ previous and next chat |
| A task's page | L labels · Ctrl+` terminal · arrows, Home and End move through the stages, a tab row and a menu |
