# Settings

| Rule | What | Why | Held by |
|---|---|---|---|
| `set.one-place` | Settings opens from the profile menu only; the sidebar holds places | A setting and a place are different things | worca-sweep |
| `set.one-row` | One row per decision, its state in words; fine-tuning folds under Customise | Reads like sentences | align-check |
| `set.at-once` | A row takes effect at once; only a reset of many confirms | No Save button | by hand |
| `set.records` | A record is a ListRow in a List after the rows, never a SettingsRow | Different things look different | by hand |
| `set.search` | Search finds every row, folded row and record, and lands on it | Nothing is hard to find | pulse-sweep |
| `set.flags` | A Labs switch writes the one flag store; what it gates follows, and a section it gates says how to turn it on | A switch that changes nothing is a lie | by hand |
| `set.read-level` | A section read at one mode and changed at a higher one shows its edits off, each saying why | You see the rule that binds you, and who can change it | by hand |

**Settings**: one place, opened from the profile menu (the sidebar holds places in Worca, never Settings; Interface
mode, Appearance and going away live in the profile menu only). Opening it turns the sidebar into its menu, its content
fading over `change` while the page changes at once: `‹ Back to Worca`, then the sections under four group heads
(Worca: General, Notifications, Team policy, Labs · Work: Runs, Presets, Labels, Automations · AI: Models, Providers,
Chat, Guardrails, Memory · Add-ons: Plugins, Connectors). **Levels:** Team policy can be read at Advanced and changed at Expert: everyone a policy constrains sees why a choice is
locked; only an admin changes it. **One row per decision, in the section that owns it:** limits are Runs': the warning line, what a start does near a
limit, and what a paused run does. Notifications says only how you hear of them, and links there. **A setting or a place:** a setting is a choice about how
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

**Labs.** One row per flag: its name, what it does, its stage (Chip), its Switch. The section's meta says Labs features
may change, break or disappear in any release. A flag locked by `WORCA_FLAGS` has its Switch off, the tooltip saying
`Locked by WORCA_FLAGS`. Reset all is off, saying why, while every feature is at its default. A row or section a flag
gates carries `flag` in the model and follows the switch at once; Labels, Automations, Naming, Summaries and Ticket
updates do. Opened directly while off, a section says so and offers Open Labs.

**What the tab rows mean, where it matters.**
- Folders: changing the Worca folder does not move data. Worca starts fresh under the new folder and leaves the old one.
- Diagnostics write to the run log, never a credential; a set `WORCA_DEBUG_SPAWN` overrides the switch.
- Chat's turn limit is 1 to 500, per message.
- Copilot's usage comes from GitHub. A Gemini quota is set by the person (Google reports none) and Worca counts against it.
- Levels: Sync is Advanced, the proxy Simple, New guardrail set Expert. A row that needs git says so in its tip and is
  hidden on a machine without git; the same goes for a version from a source checkout, which offers no Update.

**About** is a small state machine, one row per fact: Version (Update when there is one, Check now when not), Command
(copyable), Last update (the failed result, with Dismiss; its npm output under Customise), What's new, Changes.

**A stepped Dialog** (Forms): Setup assistant's Run setup: Check, Network, Access, Models, Limits, Review; the last step's
button is Apply. Nothing changes until then. A choice inside it is an OptionList.

**Team policy** reads at Advanced, its edits off with the reason; at Expert they act, and a change opens a pull request
on the policy's repository. Sections: Policy, Effective policy (Table), Defaults (Create a PR when a run finishes, its
spending caps, workspace runs), Required plugins, Blocked, Guardrail sets, Models, MCP servers.

**Models** keeps roles per engine, a record each. A step or helper job is a record that follows its role until
overridden: Override, Test, Clear; Show all lists the rest. There are 11 helper jobs. A factory default says `(default)`;
signed out of Claude Code, one line says which lose theirs, and a run that needs one is refused, never given another
model. **Chat** lists its chat channels as records: Switch, state (Chip), Test, and what stops it working in its meta line.
**Plugins** holds Ticket updates for a tracker: its projects, All projects, and a rule per project as records.
**Memory** has Team memory: which notes load, sync, sharing and undo, and each note's state.

