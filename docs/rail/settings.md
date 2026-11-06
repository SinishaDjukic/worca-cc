# Settings

| Rule | What | Why | Held by |
|---|---|---|---|
| `set.one-place` | Settings opens from the profile menu only; the sidebar holds places | A setting and a place are different things | worca-sweep |
| `set.one-row` | One row per decision, its state in words; fine-tuning folds under Customise | Reads like sentences | align-check |
| `set.at-once` | A row takes effect at once; only a reset of many confirms | No Save button | by hand |
| `set.records` | A record is a ListRow in a List after the rows, never a SettingsRow | Different things look different | by hand |
| `set.search` | Search finds every row, folded row and record, and lands on it | Nothing is hard to find | pulse-sweep |

**Settings**: one place, opened from the profile menu (the sidebar holds places in Worca, never Settings; Interface
mode, Appearance and going away live in the profile menu only). Opening it turns the sidebar into its menu, its content
fading over `change` while the page changes at once: `‹ Back to Worca`, then the sections under four group heads
(Worca: General, Notifications, Team policy, Labs · Work: Runs, Presets, Labels, Automations · AI: Models, Providers,
Chat, Guardrails, Memory · Add-ons: Plugins, Connectors). **Levels:** Team policy can be read at Advanced and changed at Expert: everyone a policy constrains sees why a choice is
locked; only an admin changes it. **One row per decision, in the section that owns it:** Paused runs is Runs' (what a run
does when it pauses), and Notifications has a link row to it. **A setting or a place:** a setting is a choice about how
Worca behaves, set rarely, taking effect at once; a place is where you do work and come back to. So the Marketplace
*store* is a place in the sidebar, while what you installed (Plugins), Connectors, Models, Providers and Team policy are
settings. On a narrow screen Worca's sidebar stays, Settings opens
on its menu as a list, and a section has `‹ Settings` above its title. The top bar's search finds every row, folded
row and record by its name or its words, and lands on it with the flash, opening its Customise. Mocks:
`plans/rail/mocks/settings-*.png`, `settings-open-light.gif`.

**A settings tab** (a section of Settings): its title, then one meta line saying what it decides, then its sections
(SettingsSection). A row (SettingsRow) is its name on the left and one sentence beside it, the choice a SentencePicker in
it (`Tell me about [needs you ▾] on [desktop ▾]`), and at its right end a Switch when it is only on or off, then its
buttons; it takes effect at once. More detail
folds under the row behind Customise, and a row that differs from its group says Changed. A reset of many rows sits in
its section's head and confirms in the strip; nothing else confirms. **One row per decision a person makes**, saying the
current state in words (`Runs pause at $1,000 a month; one run has no limit`); its fine-tuning folds under Customise,
never a row of its own on the page. A folded row belongs to its row: it sits in the sentence's column, its name a small
label (Meta size, `--ink`) over its sentence, never the page's name column again. A row's actions are quiet buttons,
one besides Customise; a bordered or red button lives only in a Dialog or the ConfirmStrip (a step that cannot be
taken back, such as deleting every chat, is the section head's action and asks first). A value that is a path, a list or a text shows as words with `Change…`, which opens
a Dialog with its Fields. **A record is not a setting**: a tab that keeps records (presets, labels, models, plugins,
rules, an event log) puts them as a List of ListRows after its rows, under its own head; the row opens the thing, its
own actions are in its ⋯, never a SettingsRow per record.
