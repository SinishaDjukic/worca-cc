# Settings

| Rule | What | Why | Held by |
|---|---|---|---|
| `set.one-place` | Settings opens from the profile menu only and turns the bar into its side menu; the sidebar holds places. A setting is a choice about how Worca behaves, set rarely; a place is where you do work and come back to | A setting and a place are different things | worca-sweep |
| `set.one-row` | One row per decision, in the section that owns it: its name, then its value first and short (body size, full ink), and its control at the row's end. A row with no value may say in one short line what its control does, when its name alone does not; beside a value that line is the row's hint (the name's tooltip, and read to a screen reader), never a second line, unless `keepLine` names the fact it holds (`list.one-line`). A line that restates the name or the value goes, and a row never has two quiet lines (`stillhet.scan-first`; from classic's Settings cards: a label, its value, its control at the right) | The value is found without reading a sentence | design-system-settings-redesign |
| `set.one-edge` | A tab's title, its section heads, the rows' names and the dividers share one left edge, and every control one right edge; a section head is section size, 600, with 40px above it and 4px below | A tab is read straight down, and a head is never weaker than its rows | align-check |
| `set.at-once` | A row takes effect at once; only a reset of many, and a step others see, confirm | No Save button | by hand |
| `set.sentence` | A row's value, its supporting line and its pickers' words are built from its values and read right for every option; a value stays under 64 characters, a line under 150, a picker's word under 24 | A hard-coded summary goes stale, and a line written for the default breaks on the rest | settings-sentences |
| `set.one-fact` | One fact has one home; everywhere else reads it, never a copy (a cap is Team policy's and Tasks reads it; a channel's set-up is its plugin's and Chat links to it) | Copies drift: a channel on here and off there | by hand |
| `set.one-choice` | A choice among a few values is a RowPicker at the row's end: a labelled field 208px wide that takes effect at once, never ⋯, a Dialog or Save. A long value folds inside it with its whole text in the tooltip | One step where three were, and a pick never moves the row | design-system-settings-redesign |
| `set.picks-line` | A row with several choices holds them in one line under its supporting line, each a 168px RowPicker under its own label | Each choice keeps its name and its place | design-system-settings-redesign |
| `set.fold` | A row with more to show clicks as a whole line: it highlights on hover, its chevron turns, no word changes and nothing moves. The opened part sits behind a 2px line at its side, its values on the parent's value edge | You see where an opened part starts and ends | design-system-settings-redesign |
| `set.fold-fine-tunes` | A fold only fine-tunes its row; a list or a set of links gets rows of its own (Budget's Team caps and Usage are two rows, each with its button). A row with nothing more has no click | A fold is not a junk drawer, and nothing pressable does nothing | by hand |
| `set.long-value` | A value that is a path, a list or a text shows as words with `Change…`, which opens a Dialog with its Fields | A long value is read on the row and edited where there is room | by hand |
| `set.row-actions` | A row's actions are quiet bordered buttons; a ⋯ with one item is a button. A red button lives only in a Dialog or the ConfirmStrip, and a reset of many rows is its section head's action and asks first | The page stays calm, and what cannot be taken back asks | by hand |
| `set.records` | A record (a preset, a label, a model, a plugin, a rule) is a ListRow in a List after the rows, under its own head, never a SettingsRow: one line, its name, then its facts as its `value` on the rows' value edge (`list.one-line`); the row opens the thing and its own actions are in its ⋯ | Different things look different | by hand |
| `set.search` | The top bar's search finds every section, row, folded row and record by its name or its words and lands on it with the flash, opening its fold or its Dialog; a folded row its state hides lands on the row it folds under | Nothing is hard to find, and you always know where it lives | pulse-sweep |
| `set.changed` | A row with a value off Worca's default has one tiny neutral dot after its name; its tooltip says `Changed`, then each value with its default. A fold's row shows it if anything inside differs, and the row inside does too; no reset on a row | You see what you moved, and from what, without a button to mis-press | design-system-components |
| `set.levels` | A section's level is its most open content's, and what is above it inside says so by its own `min`; a link to a section above your level is not offered | A mode hides what it must and never leads to a dead end | by hand |
| `set.read-level` | A section read at one mode and changed at a higher one shows its edits off, each saying why (Team policy reads at Advanced and changes at Expert) | You see the rule that binds you, and who can change it | by hand |
| `set.appearance` | Appearance is the viewer's own, kept in this browser: Theme, Background, Breathing background, Text size (`look.text-size`) and Pulse icon motion, which is still by default | How Worca looks on a device is that device's, never the team's | by hand |
| `set.sign-ins` | Models › Sign-ins lists each provider as a row that opens its settings: what it is, its state with Sign in, Sign out or Edit, its usage, its models with Import models. A provider not set up says in its row that no task can run through it | Every link about a sign-in, a key or a quota lands in one place | by hand |
| `set.team-draft` | An edit to Team policy only waits: a DraftBar (Discard quiet, Publish filled) shows while a change waits, and every staged change says what it was (`$3,000 a month · was $2,000 a month`). Until Publish, Effective policy and Tasks read what is published | A policy change reaches the team in one deliberate step | by hand |
| `set.spend-word` | A cap pauses: Settings never says soft or hard, and the table's Kind says `Pauses`. The tighter of yours and your team's wins, and Budget says the effective value and whose | One word for what a cap does, as the app behaves | by hand |
| `set.flags` | A Labs switch writes the one flag store, and what it gates follows at once; a section it gates, opened while off, says so and offers Open Labs | A switch that changes nothing is a lie | by hand |
| `set.flag-shows` | A switch about how work runs shows, while on, on the thing it changes (Shared session on a workflow's page, Requirements first in Shaper's own line) | You see the switch where it acts | by hand |
| `set.flag-locked` | A switch set by the server stays off and its tooltip says `Locked by WORCA_FLAGS`; a write it waits for shows Saving, and a refusal says why at the end of its line | A switch you cannot move says who holds it | stillhet-settings-labs-live |
| `set.not-live` | On a live Stillhet, a section that is all sample shows its title and one line, and a sample row shows its name and the line: `Not in Stillhet yet: turn Stillhet off from the top-bar switch to use it`. It shows no value and holds nothing to click | A sample value reads as Worca's real setting | stillhet-settings-not-live-rows |
| `set.not-wired` | A control that is real but not wired yet is disabled, shows its value, and gives the same sentence as its reason (`NOT_LIVE_SENTENCE`); its section says the sentence once, in its meta | You see the real value and why you cannot change it here | stillhet-settings-not-live-rows |

## A row, built

```js
R.settingsRow({ name: 'Budget', value: '$1,000 a month', note: 'All tasks pause when it is spent',   // the note is the row's hint
  end: R.button({ label: 'Change…', kind: 'quiet' }) })
R.settingsRow({ name: 'Archive', value: 'Never', end: R.rowPicker({ id: 'arch', label: 'Archive', text: 'Never', items }) })
```

`picks` holds a line of RowPickers (`set.picks-line`); `fold` makes the whole line the trigger (`set.fold`); a Switch
goes in `end` when the row is only on or off.

## The side menu, in order

A group with nothing at this mode has no head; Settings opens on the first section the mode shows. Moving a row never
removes it: it stays reachable, and search finds it.

| Group | Tab | Its sections |
|---|---|---|
| Work | Tasks | Spending (Budget, Team caps, Usage) · Starting · Limits · Away mode · Machine |
| Work | Presets (Advanced) | Presets |
| Work | Labels (flag `runLabels`) | Labels |
| Work | Automations (Advanced, flag `gitAutomations`) | Waiting · Projects · Recent |
| AI | Models (Expert) | Defaults · Jobs · Sign-ins · Catalogue |
| AI | Chat (Advanced) | Assistant · Channels · Speech · History |
| AI | Memory (Advanced) | Notes · Restore points · Proposals · Team memory |
| Access | Team policy (reads at Advanced, changes at Expert) | Not published (while a change waits) · Effective policy · Defaults · Rules · Editing |
| Access | Guardrails (Advanced) | Sets |
| Add-ons | Plugins (Advanced) | Installed (Sources is its head's action) |
| Add-ons | Connectors (Advanced) | Servers · Sets · Skills |
| Worca | General | Setup · Storage · Credentials · About |
| Worca | Appearance | Theme · Background · Breathing background · Text size · Pulse icon motion |
| Worca | Notifications | Channels · Updates |
| Worca | Labs | Features, by stage, Beta first |

## What the rows mean, where it matters

| Row | Means |
|---|---|
| Tasks › Limits | The warning line, what a start does near a limit, and what a paused task does. Notifications only says how you hear of them and links here |
| A cap | At a cap a task stops at its next step and waits; you can continue past it, and past a team cap that is recorded for the team. An unattended task only warns, as nobody can continue it |
| Chat › Assistant › Abilities › Prompt check | A switch, off by default, saved to the chat pref `chat.promptCheck`; shown in the composer (`panel.chat-composer`) |
| Chat › Channels | Each chat channel is a record: Switch (off until set up, saying why), its state, Test, and what stops it in its meta. Its set-up is on its plugin's page (`panel.plugin-manage`) |
| Chat's turn limit | 1 to 500, per message |
| Models › Jobs | A step or helper job follows its role until another model is picked, with Test; a job set to a model the new engine lacks goes back to its role. A factory default says `(default)` |
| Signed out of Claude Code | One line says which jobs lose their model; a task that needs one is refused, never given another model |
| Copilot's usage, a Gemini quota | Copilot's comes from GitHub; a Gemini quota is set by the person and Worca counts against it |
| Memory | The action is `Defragment now`, never tidy |
| Team policy › Rules › Model access | The engines and models the team may use |
| Team policy › Publish | `Publish to worca-policy` asks in the strip, then makes one commit on the home's `worca-policy` branch, which every teammate's Worca reads; `Copy for PR` gives the JSON for whoever cannot push there |
| Plugins › a tracker | Its Ticket updates fold under its record (behind its flag): its projects, All projects, and a rule per project |
| General › Folders | Changing the Worca folder does not move data: Worca starts fresh under the new folder and leaves the old one |
| General › Diagnostics | Write to the task's log, never a credential; a set `WORCA_DEBUG_SPAWN` overrides the switch |
| General › Setup assistant | A stepped Dialog (`form.stepped`): Check, Network, Access, Models, Limits, Review; the last step's button is Apply |
| General › About | One row: `Version 1.19 · Up to date` (or `New version: 1.20`, or what failed), with Update, Try again or Check now. Live it reads `GET /api/app/version`, and Check now posts `/api/app/version/check` |
| A row that needs git | Says so in its tip and is hidden on a machine without git; a version from a source checkout offers no Update |
| Labs | One row per flag under its stage: its name, what it does, its Switch. Reset all is off, saying why, while every feature is at its default |
