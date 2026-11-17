# Forms and suggestions

| Rule | What | Why | Held by |
|---|---|---|---|
| `form.dialog` | A step that needs fields is the one Dialog: its title, its fields, a foot whose button names what happens (`Start at 16:40`) with a quiet Cancel before it. Its backdrop covers the whole window, bar and top bar too, it sits centred, and the page under it does not move (from classic's full-window `.viewer-modal`); its focus is `keys.dialog-focus` | One dialog to learn, and nothing shifts behind it | design-system-settings-redesign |
| `form.fields` | A form is labelled fields in fixed places, never a sentence of pickers: a Field for what you type, a PickField (a label over a field-shaped button that cuts a long value short) for a choice, a FieldPair for two fields that are one choice (Engine and model), a Checkbox with one line of help (from classic's labelled selects and its Advanced checkboxes) | You know where each field is before you read it, and a pick never moves another field | design-system-forms-redesign |
| `form.grid` | Fields sit in a FormGrid: two columns of fixed places, one column under 560px; a wide field takes the row | The form keeps its shape whatever is picked | design-system-forms-redesign |
| `form.fold` | The rarer fields open in place inside their own border (FieldFold, `More options`), its closed line saying what is inside | The everyday form stays short, and nothing opens a second dialog | design-system-forms-redesign |
| `form.readback` | A form reads its choice back in one supporting line under the fields (FormReadback: `Runs weekdays at 07:45 · next Tue 17 Nov, 07:45`); it is never a control | Facts lead, a sentence supports (`stillhet.scan-first`) | design-system-forms-redesign |
| `form.default-named` | A default always says what it is: `the Default workflow`, `main (the project's default branch)` | The word Default alone names nothing | stillhet-new-task-forms-host |
| `form.inspect-value` | A fact on an inspect view is a FieldValue: a label over its value in a field's place, with nothing to press | A page that only shows reads like the form that made it, and offers no edit it cannot do | design-system-forms-redesign |
| `form.check-at-save` | A Dialog's fields are checked once, when you press its Save or Next: what is wrong stays in the status line, the Dialog stays open, and typing clears the line once it is mended. A Save that changed nothing closes without a toast | One moment, and no Save that turns off while you are still typing | by hand |
| `form.name-limit` | A name you type (a title, a schedule's name) stops at 80 characters | A name has to fit on a row and in a card | by hand |
| `form.stepped` | A setup of several steps is one Dialog with the Stepper at its head, one step per screen, Back and Next in its foot; nothing changes until the last step's button | You can walk back without undoing anything | by hand |
| `form.view-dialog` | A view that only shows (a workflow graph at full size, the whole diff) is a Dialog without a form: its head, the view, Close | Looking closer is not a step | by hand |
| `form.one-note` | A problem with a choice shows under the field before the step is taken, as one ChoiceNote at a time: what it means and the ways out as buttons, its text at body size. A refusal's words are only in its note, never also in the form's error line | A refused start tells you why and how out, where you pressed Start | stillhet-new-task-refusals-host |
| `form.suggest` | Worca's text runs on a helper job, named in its sparkle's tooltip; if it cannot write (an error, or no answer in 20s) the field keeps its text, says so in grey with Try again, and the form still submits | A suggestion never blocks you | by hand |
| `form.rewrite` | A rewrite is a suggestion of the whole text: shown beside the field, taken with Use this, undone with Undo; gaps are amber marks naming a perspective | The person's words are never lost, and what is still open stays visible | by hand |
| `form.composer` | There is one composer, in Chat only: on the cards' rail and as wide as the cards, and on Chat home at one height under its heading. No other page has one (`stillhet.chat-first`) | One place to type to Worca, and it never shifts | worca-sweep |
| `form.composer-modes` | Starting anything is the composer: you pick Ask, Task or Schedule, or a starter, and its button names what will happen. A typed message is never read as a task | One way in, and ordinary stays ordinary | worca-sweep |
| `form.composer-forms` | The labelled forms open from Chat: the composer's More holds `New task form…` and `New schedule form…`, and a schedule's card and row have `Edit…` in ⋯. Tasks and Schedules open no form | The form is a second way to say it, in the same place work starts | by hand |
| `form.composer-queue` | While Worca replies, a message you send waits above the composer, on its rail and no wider: up to three rows, oldest first, each with Remove, and one line saying when they go. A quiet **Queue** beside Stop queues exactly as Enter does | A message you wrote is never lost, and nothing is sent you did not see coming | stillhet-chat-queue-host |
| `form.queue-pauses` | A finished reply sends the oldest queued message, one per reply. A stopped or failed reply, or one that ended while the chat was closed, pauses the queue: the line says why and **Send now** sends it; a refused send never drops the text | Nothing goes out after something went wrong unless you say so | stillhet-chat-queue-host |
| `form.new-task` | New task is one Dialog of labelled fields in a fixed order with one readback line (the table below). The project's saved engine and tags fill an untouched form, and Cost tags offers Save as default | Every choice classic's New run offers has one home | stillhet-new-task-options-host |
| `form.preset-field` | Preset is a field only when one exists for the project; its menu offers Update preset while it is modified, Duplicate and No preset. A broken preset blocks Start in the form's note, each item with Reset to default | A saved setup is one pick, and a stale one says what broke | stillhet-new-task-presets-host |
| `form.task-source` | A ticket source is a segment beside Write it and From file, on its own row once picked. Its connection is checked first (not connected: a ChoiceNote with Open the Marketplace page and Test connection), then its Profile and its own inputs as labelled fields, then its tickets: a search Field over ListRows with a check and the picked one's preview | A ticket becomes a task without leaving the form | stillhet-new-task-source-host |
| `form.project-target` | From Advanced the Project field lists the workspaces under a Workspaces header, as a target. `Add project…` is its last item before No project: Project name and a folder Field with Browse… (the FolderBrowser) in the same Dialog, Save off while either is empty | A project you do not have yet never sends you away from the form | stillhet-new-task-projects-host |
| `form.waits-for` | A task that waits for another leads its Source branch with `the task before it's branch`, and `Start now instead` drops the wait | Waiting is a choice you can see and undo | stillhet-new-task-options-host |
| `form.locked-choice` | An engine that is locked is an off item with its reason in its tooltip (`Copilot: off while the credential broker is on`); a field that cannot be changed live is off and says `Cannot be changed here yet` | A choice you cannot make says why, and is never missing | stillhet-new-task-options-host |
| `form.schedule-page` | A schedule's page is an inspect view: its facts as FieldValues in fixed places with the readback line under them, and no field, draft or Save. Its head holds Run now (Stop while its task runs), Pause or Resume, Skip next time or Keep next time, and **Change in its chat**; ⋯ holds Keep in view and Delete | A schedule is changed where work starts, and its page only shows and answers | by hand |
| `form.schedule-change` | **Change in its chat** opens the schedule's chat with its form open (the same form its card's **Edit schedule…** opens); a schedule with no chat gets one, holding its card. The form's Save applies nothing: what it changes is proposed in that chat (`panel.schedule-change`) | One way to change a schedule, from every place, and nothing changes unseen | stillhet-schedule-change-host |
| `form.add-project` | Add a project by hand is one form with a Segmented: One folder, New folder, Several folders, Clone (the table below). A refusal is the field's error or `Could not …` in plain words | Every way classic adds a project, in one place | stillhet-projects-add-ways |
| `form.rename-project` | A project is renamed from its ⋯: `Rename…` opens a ConfirmForm under its head with one Field `Its name` (`form.name-limit`). A name another project has is the Field's error; its key and its folder never change | A name is yours to fix without removing and adding the project again | stillhet-projects-host-actions |
| `form.remove-owned` | Removing a project whose folder Worca made says so before Yes (`Worca made its folder, so the folder goes too; its tasks stay, and its schedules stop`); any other project keeps its folder and the strip says that | A folder is never deleted unasked | stillhet-projects-host-actions |
| `form.link-remote` | Link a repository… on a project only on this computer asks its address first: a ConfirmForm with one Field `Its repository address` (`https://`, `ssh://` or `git@`); nothing is pushed | Worca cannot guess an address, and a link with no address would fake it | stillhet-projects-host-actions |
| `form.workspace-edit` | Edit by hand opens with the workspace's Name, then its projects (Take out, Add one); every change is one draft with the DraftBar. Save stops at the first part the server refuses and names what was saved; the draft keeps the rest | A half-saved edit says exactly what stuck | stillhet-workspaces-host-actions |
| `form.plugin-setup` | Set it up happens on the plugin's own page: a ConfirmForm under its head, one Field per required value (a secret is a password Field; one already set reads `Set; type to replace`), one part and one Save per target the values are saved with. A plugin that asks for nothing says so | A plugin is ready where you found it, and a refusal changes nothing | stillhet-marketplace-host-actions |
| `form.update-asks` | An update that asks for something new asks first, in a ConfirmStrip (`Update jira-source to 0.2.0? It now asks for …`); one that asks for nothing new goes on one press | Nothing new reaches a plugin without your word | stillhet-market-live |
| `form.export-folder` | Exporting a workflow as a Worca plugin asks for its Folder in the export form itself, with its hint; a refusal names the action and the server's reason and writes nothing | The one thing the plugin needs is asked where you choose it | stillhet-workflow-live |
| `form.import-confirm` | A workflow file that runs scripts on your machine asks before it is imported (`It runs N scripts on your machine. Import it?`); Cancel imports nothing | A file never runs code on your machine without your word | stillhet-workflows-host-roundtrip |

## The forms' fields

Labels are written as the form shows them. Chat opens the forms with `StillhetCenters.newTask(keep)`,
`.newSchedule(keep)` and `.editSchedule(id)`; `keep` presets fields.

| Form | Fields, in order | More options |
|---|---|---|
| New task | Project · Preset (when one exists) · What should it do (Write it, From file, a ticket source) · Workflow · Engine and model · Source branch · Base branch | Title · New branch · Start from · When it is done · Pull requests (Shaper: one PR or a PR per slice) · Guardrails · Cost cap · Cost tags · Checkboxes: Run on the source branch, Create a draft PR, Ask me at each step, Worca may answer for me, Run without memory, Mock mode · Add files… |
| New schedule | Name · What should it do · Project · Workflow · Engine and model · Repeats (Once asks for Date and time) · At (a time input, any minute) | Source branch · `When a run is done` · Time zone · Expert: `While one still runs`, Stop after, `When runs fail`, Notify |
| Edit schedule | Name · What should it do · Repeats · At | none |
| A schedule's page (FieldValues) | What it does · Repeats · At (or Date and time, or Runs after) · Project · Workflow · Engine and model · Preset (when it has one) | Expert: `While one still runs`, `When runs fail`, A missed time, How late it may start, Stop after, Notify |

## Add a project, by way

| Way | Asks for |
|---|---|
| One folder | Choose folder… (the FolderBrowser), the probe line under its Field, Use git for a plain folder |
| New folder | Its name, Use git, and where it will be made |
| Several folders | The FolderBrowser in a Dialog, then the review list; skipped rows keep their reasons until renamed and retried |
| Clone | Repository address, Branch, Folder name (it names the project and its clone) |

## A schedule's cases

| Case | The page says |
|---|---|
| A one-off | `Once`, with its Date and time |
| Waits for a task | `Runs after TITLE` in place of a time |
| Runs a saved preset | The preset's name, or `preset deleted` |
| A time is skipped | Skip next time reads **Keep next time** |
| A series reached its end | It sits in its own section, **Ended**, with no next time and no Run now |
| Delete | Its notice names the one-offs that wait for it (they will be marked missed) |

## The note under New task's text

One at a time, the first that applies:

| Note | Blocks Start | Ways out |
|---|---|---|
| A broken preset | Yes | Reset to default, per item |
| The engine refuses | Yes | The Allow unguarded Checkbox |
| The project is out of sync | Yes | Start from the remote, Start anyway, Cancel |
| Team policy | Never | none: grey, or amber with a warning |

Chat's TaskProposal shows the same start-time notes and the saved defaults, and no presets or ticket source.

## Which helper job writes what

| Text | Helper job (Models › Jobs) |
|---|---|
| PR titles and descriptions, stacked ones too | PR description |
| A task's title and branch | Run naming |
| Drafted answers and change requests | Drafts |
