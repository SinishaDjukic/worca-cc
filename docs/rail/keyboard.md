# Keyboard

| Rule | What | Why | Held by |
|---|---|---|---|
| `keys.one-table` | Every key is a row of the one table; a page asks what a key means, it never reads the key itself | The sheet can never disagree with the keys | design-system-logic |
| `keys.not-typing` | No key fires while you type in a field | Typing stays typing | design-system-logic |
| `keys.reserved` | No shortcut uses a combo the browser owns | It could never reach the page | design-system-logic |
| `keys.sheet` | `?` opens the Keyboard shortcuts sheet, drawn from the table | It is how keys are found | design-system-components |
| `keys.esc-strip` | Esc takes back the confirm strip or short form that shows, once nothing lies over it: `watchStrips` presses its Cancel; a form with something typed stays, as a Dialog does | A question you did not mean goes the way it came | design-system-components |
| `keys.focus` | Focus is visible, and a redraw leaves it on the same row, or the one beside a row that left | You keep your place | by hand |

The table is `SHORTCUTS` in `shortcuts.mjs`. A page names where the focus is, and the table answers:
`shortcutAction(keyFacts(e, rowSelector), { scopes, selecting, can })`.

| Where | Keys |
|---|---|
| Anywhere | ⌘K Search or ask, even from a field · `?` this sheet · Esc closes what is on top |
| A list | ↑ ↓ or J K move · Enter opens; and, in a list that has the action (`can`): `.` row menu, ← → fold, S stop, E archive, R rename, P pin, G and ⇧G group, ⌫ delete |
| A list with selecting | Space selects the row · ⇧↑ ⇧↓ extend · ⌘A selects all · Esc ends selecting, then closes the panel |
| Chat | ⌥⌘N new chat · ⌘\\ show or hide the chats · ⌘⇧L go to the chats · ⌥↑ ⌥↓ previous and next chat |
| The run page | L labels · Ctrl+` terminal · arrows, Home and End move through tabs, stages, the ship choice and a menu |

⌘ is Ctrl off a Mac, and either works everywhere; `keyGlyph` and `keyHint` write the right one. Space and Enter act only
with the focus on a row, so a button keeps its own. A list whose rows cannot be acted on together (Pulse's Now) has moving and
opening only. The things allowed in a field are a field's own way out: Esc, the arrows from a menu's own field
into its items, and Chat's ⌥⌘N, ⌘\\ and ⌘⇧L, since you are in its composer.

A new key is a row in the table. The sheet is a Dialog with no form, only Close (`openShortcutsSheet`); while it is up it
holds every key, and closing it puts the focus back. It lists the rows of where you are: a list's row with `can` only
in a list that has that action, the run page's only on the run page.
