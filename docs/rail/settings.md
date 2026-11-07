# Settings

| Rule | What | Why | Held by |
|---|---|---|---|
| `set.one-place` | Settings opens from the profile menu only; the sidebar holds places | A setting and a place are different things | worca-sweep |
| `set.one-row` | One row per decision, its state in words; fine-tuning folds under Customise | Reads like sentences | align-check |
| `set.at-once` | A row takes effect at once; only a reset of many, and a step others see, confirm | No Save button | by hand |
| `set.sentence` | A sentence is built from its values and reads right for every option; where one decision dominates, its picker is in the head | A hard-coded summary goes stale, and a sentence written for the default breaks on the rest | settings-sentences |
| `set.one-fact` | One fact has one home; everywhere else reads it, never a copy | Copies drift: a channel on here and off there | by hand |
| `set.one-choice` | A choice is a picker in a sentence, not ⋯, Dialog, Save; a ⋯ with one item is a button; a row with nothing more to show has no click | Three steps where one would do | by hand |
| `set.fold` | Customise only fine-tunes its row; a list or a link farm gets its own place | A fold is not a junk drawer | by hand |
| `set.records` | A record is a ListRow in a List after the rows, never a SettingsRow | Different things look different | by hand |
| `set.search` | Search finds every row, folded row and record, and lands on it; in the one Worca it finds chats, tasks and schedules too, each under its area's head with its mark | Nothing is hard to find, and you always know where it lives | pulse-sweep |
| `set.changed` | A row with a value off Worca's default has one tiny neutral dot after its name; its tooltip says `Changed`, then each value with its default. A fold's row shows it if anything inside differs, and the exact row inside does too. No reset on a row | You see what you moved, and from what, without a word on every row or a button to mis-press | design-system-components |
| `set.flags` | A Labs switch writes the one flag store; what it gates follows, and a section it gates says how to turn it on | A switch that changes nothing is a lie | by hand |
| `set.read-level` | A section read at one mode and changed at a higher one shows its edits off, each saying why | You see the rule that binds you, and who can change it | by hand |

**Settings**: one place, opened from the profile menu (the sidebar holds places in Worca, never Settings; Interface
mode, Appearance and going away live in the profile menu only). Opening it turns the sidebar into its menu, its content
fading over `change` while the page changes at once: `‹ Back to Worca`, then the sections under five group heads, in
this order (Work: Runs, Presets, Labels, Automations · AI: Models, Chat, Memory · Access: Team policy, Guardrails ·
Add-ons: Plugins, Connectors · Worca: General, Notifications, Labs). It opens on the first section the mode shows; a group
with nothing at this mode has no head. **Levels:** a section's level is its most open content's, and what is above it
inside says so by its own `min` (Models is Expert; Speech is Expert inside Chat). Team policy can be read at Advanced and changed at Expert: everyone a policy constrains sees why a choice is
locked; only an admin changes it. **One row per decision, in the section that owns it:** limits are Runs': the warning line, what a start does near a
limit, and what a paused run does. Notifications says only how you hear of them; its Usage row links to Runs › Limits. **A setting or a place:** a setting is a choice about how
Worca behaves, set rarely, taking effect at once; a place is where you do work and come back to. So the Marketplace
*store* is a place in the sidebar, while what you installed (Plugins), Connectors, Models and Team policy are
settings. On a narrow screen Worca's sidebar stays, Settings opens
on its menu as a list, and a section has `‹ Settings` above its title. The top bar's search finds every section head, group, row, folded
row and record by its name or its words, and lands on it with the flash, opening its Customise (or its Dialog). A folded
row its state hides lands on the row it folds under. Mocks:
`plans/rail/mocks/settings-*.png`, `settings-open-light.gif`.

**Sections, in order.** Moving a row never removes it: it stays reachable, and search finds it.
- Runs: Spending · Starting (with Schedules) · Limits · Away mode · Machine (Capacity, Tools, Network).
- Presets, Labels, Guardrails: one section each.
- Automations: Waiting · Projects · Recent.
- Models: Defaults · Jobs · Sign-ins (Claude sign-in and each provider's record) · Catalogue (Built-in models, Import and
  Sharing fold under its Sources row).
- Chat: Assistant · Channels · Speech (each URL folds under its row) · History.
- Memory: Notes (health is its meta line; Defragment now, Expert, is its head's action) · Restore points · Proposals · Team memory.
- Team policy: Not published (while a change waits) · Effective policy · Defaults · Rules (groups: Required plugins, Blocked, Guardrail sets, Models, MCP servers) ·
  Editing (Home and Consent fold under its row).
- Plugins: Installed (groups: Trackers, Chat channels, Others; Ticket updates folds under its tracker; Sources is the head's action).
- Connectors: Servers · Sets · Skills.
- General: Setup (Browser extension, its paired browsers under its fold) · Storage · Credentials · About.
- Notifications: Channels · Updates.
- Labs: Features, grouped by stage, Beta first.

**A settings tab** (a section of Settings): its title, then one meta line saying what it decides, then its sections
(SettingsSection). A row (SettingsRow) is its name on the left and one sentence beside it, the choice a SentencePicker in
it (`Send [what needs you ▾] to [desktop ▾]`), and at its right end a Switch when it is only on or off, then its
buttons; it takes effect at once. More detail
folds under the row behind Customise. A row off its default or its group carries the Changed dot (`Total: default $1,000 a month`); a record has none, the rows folded under it do. A reset of many rows sits in
its section's head and confirms in the strip, under the top bar and on screen wherever the page is scrolled. **One row per decision a person makes**, saying the
current state in words (`All runs pause at $1,000 a month; one run at $50 (your team's)`), built from the values, never a summary typed by hand; its fine-tuning folds under Customise,
never a row of its own on the page. A folded row belongs to its row: it sits in the sentence's column, its name a small
label (Meta size, `--ink`) over its sentence, never the page's name column again. A row's actions are quiet buttons,
one besides Customise; a bordered or red button lives only in a Dialog or the ConfirmStrip (a step that cannot be
taken back, such as deleting every chat, is the section head's action and asks first). A value that is a path, a list or a text shows as words with `Change…`, which opens
a Dialog with its Fields. **A record is not a setting**: a tab that keeps records (presets, labels, models, plugins,
rules, an event log) puts them as a List of ListRows after its rows, under its own head; the row opens the thing, its
own actions are in its ⋯ (one action is a button on the row; the one answer it waits for, Approve, is too), never a SettingsRow per record. A row that shows
everything it has opens nothing: no click, no Dialog repeating its line. Choosing a model is a picker in a sentence
(Models' Helper jobs, Roles, Chat's engine models), and clearing it is picking the default. A link to a section above your
level is not offered. A record's meta wraps here, so a problem can always be read on touch. A tab that is one list has no
section head repeating its title. **One fact, one home:** a channel's switch and state are Chat's, a plugin's being installed
is Plugins'; a cap is Team policy's and Runs reads it; a count reads its list.

**Labs.** One row per flag, under its stage (SettingsGroup; Beta, then Experimental): its name, what it does, its Switch. The section's meta says Labs features
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

**About** is one row: `Version 1.19 · Up to date` (or `New version: 1.20`, or what failed), Update when
there is one, Try again after a failure, Check now when not. A small state machine under its Customise: Other versions,
Updates, Release notes; when behind, Command (copyable), Last update (the failed result in the words of a failure, with Dismiss, and its npm output; a
failed Update opens the fold); then Repository and the two ways to report.

**A stepped Dialog** (Forms): Setup assistant's Run setup: Check, Network, Access, Models, Limits, Review; the last step's
button is Apply. Nothing changes until then. A choice inside it is an OptionList.

**Team policy** reads at Advanced, its edits off with the reason; at Expert they act, as the app's editor does: every
edit (a picker, a Change…, Edit policy, Unblock) only waits, marked `Not published`, and the head section lists what waits.
`Publish to worca-policy` asks in the strip, then makes one commit on the home's `worca-policy` branch, which every
teammate's Worca reads. `Cancel editing` drops the changes; `Copy for PR` gives the JSON, for whoever cannot push there.
Until then Effective policy and Runs still read what is published. There is no pull request of Worca's own. Sections:
Effective policy (Table), Defaults (Create a PR when a run finishes, its spending caps, workspace runs), Rules, Editing.

**Spending: one word.** A cap *pauses*. At a cap a run stops at its next step and waits; you can continue past it, and past a
team cap that is recorded for the team (once per run, or once per period for a total). The tighter of yours and your team's
wins, and Budget says the effective value, and whose. A hard cap does not exist: the app treats `hard` as soft, and
an unattended run only warns, as nobody can continue it. So Settings never says soft or hard: the table's Kind says `Pauses`.

**Models** keeps roles per engine, one sentence each, under Roles' Customise. A step or helper job is one sentence that follows
its role until another model is picked, with Test; what it offers follows the Engine, and a job set to a model the new engine
lacks goes back to its role. There are 11 helper jobs. Roles and Memory defragment keep the app's words: the action is
`Defragment now`, never tidy. A factory default says `(default)`;
signed out of Claude Code, one line says which lose theirs, and a run that needs one is refused, never given another
model. **Chat** lists its chat channels as records: Switch (off until set up, saying why), state (Chip: Connected, Off or Not set up), Test, and what stops it working in its meta line. A channel's plugin in **Plugins** installs and sets it up and links here; Notifications lists working channels only.
**Plugins**: a tracker folds its Ticket updates under its record (ListRow `fold`, behind the flag): its projects, All
projects, and a rule per project as records. **Sources** is the Installed head's action: a Dialog with its records.
**Models › Sign-ins** holds what was Providers: every link about a sign-in, a key or a quota lands there.
**Memory** has Team memory: which notes load, sync, sharing and undo, and each note's state.

