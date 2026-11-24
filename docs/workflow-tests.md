# Workflow tests

**Labs, off by default.** Flag `workflowTests` (Settings › Labs, or `worca flags on workflowTests`).

Keep versions of a workflow, keep real requests as examples, and try a new version on them before your team runs it.
Worca tries every example a few times on two versions and shows what got better or worse. With the flag on, a workflow
has three pages, **Canvas**, **Tests** and **Versions**, in the switch at the top of the workflow editor.

## How it works

1. **Save version** keeps the workflow as it is now. You choose which version new runs use.
2. **Collect examples**: real requests this workflow gets, from past runs or written by hand.
3. **Say what a good result needs**: the Basics, automatic checks, and your criteria in your own words.
4. **Test a version**: Worca tries every example 3 times on two versions. **Compare** shows what got better or worse.

Test tries are hidden runs. They are not in the Runs list, Statistics or team metrics, never send chat notifications, and
cannot be paused or resumed. Their cost counts in your spending limit ([Costs](costs.md#hard-limits)).

With the flag off, runs use the workflow as saved on the canvas, and the pages are hidden. Versions, history and
examples are kept. Turning the flag on again puts the version marked in use back in charge: canvas saves made while it
was off reach runs only after **Save version** and **Use**.

## Versions

Your changes stay in a draft until you choose **Save version**. Every run remembers which version it used.

- **Save version** (top bar, or the **Versions** page) lists what changed since the latest version and takes an
  optional note. **Also use vN for new runs** makes it the version in use. Your first version is in use at once. When
  nothing changed, there is nothing to save.
- The top bar says which version runs use: **v3 in use**, or **Draft · new runs use v3** when the draft has changes.
- **Use for new runs** on a version row switches new runs to it, from the Runs page, schedules and chats. Runs already
  going keep their version. The dialog lists what differs from the version in use.
- **Restore into draft** puts a version back on the canvas. New runs keep the version in use until you use another.
- **Every save** lists the workflow as it was just before each save, restore, delete or change of step defaults.
  Worca keeps the last 50, so any change can be undone with **Restore**. Numbered versions are never removed. This
  history is kept only while workflow tests are on: saves made with the flag off are not listed.
- A version keeps the workflow's steps and settings. Agents and scripts always run today's text from the Library, in
  every version.
- **Versions…** in a Library row's ⋯ menu opens the page. Built-in and plugin workflows have no versions.
- **Export…** has a **Version** field: the version in use (the default), another version, or **Your draft**
  ([Sharing a pipeline](workflows.md#sharing-a-pipeline)).

## Examples

An example is a real request with everything Worca needs to try it again without you. The Tests page lists them, with
their checks and their latest result per version (**3 of 3 passed**, **Not tried**).

- **From past runs.** On first use, the Tests page lists recent runs of the workflow; pick 3 to 10 different kinds,
  including ones whose result was not good. Later, use **Add from a past run**, or **Use as test example** in the More
  menu of a finished run's page. Say whether the result was **Good: keep it like this** or **Not good enough**: that
  version then shows as good or not good on the example until it is tested. Runs on a Folder project or on several
  projects cannot become examples yet. No past runs yet: **Run it once**, or **Or write an example yourself**.
- **Written by hand.** **New example**: a name, the request, and up to 8 files of at most 5 MB each.
- **Answers to questions.** Nobody watches while a test runs. Add each question Worca may ask with your answer. **If
  Worca asks something else**: **Worca picks a sensible answer**, or **The try counts as failed**.
- **How many tries**: 1, 3 or 5 per example. More tries give a surer result, and cost more.
- **What a good result has** is a note for people. Worca does not check it.

**Try your draft once now** tries the draft on one example, without a test.

## Checks

A try passes only when every check is met. Checks are counted exactly, without AI. [Your criteria](#your-criteria) are
checked by AI, and a criterion that is not met also fails the try (see below for when a criterion does not decide).

- **Basics**: **Finishes without an error**, **Finishes without needing help from someone**, **Costs at most** a
  dollar amount, **Sent back for fixes at most** N times. A question Worca answered with its own pick still meets the
  second one. A review loop that runs out of rounds fails the first.
- **Automatic checks** (**Add an automatic check**): **Length in words**, **Has these sections**, **Must mention a
  text**, **Must not mention a text**, **A file with this name is in the result**, **A Library script** (met when the
  script finds no problems; only a script that returns a verdict can be used), and the
  [exact checks](#exact-checks) **Every quote is in the files**, **Numbers come from the files**, **No personal data**
  and **Links work**.
- Checks on an example with a project: **The command passes** (such as `npm test`, stopped after 1, 5, 10 or
  30 minutes), **Changes only files under …** some folders, **Leaves these files unchanged** (names or patterns such as
  `test/**`), **Changes at most N files**, and **A file with this name is added or changed**. A text check can read a
  file in the project instead of the final result (**Read from**).

## Test a version

**Test a version** picks two versions to **Compare** (a saved version with another, or with your draft), the
examples, and **Tries per example** (**1 · quick look**, 3 or 5).

- Results that are still valid are reused: when nothing in the workflow or the example changed since, the older
  version's earlier results count again and only the other version is tried. The dialog says how much that saves.
- **Do a free quick check first.** Worca makes sure every step of the workflow is connected, without AI.
- The dialog shows the estimate and **Stop if the cost goes over**, which starts at 1.5 times the estimate rounded up to
  the next $5. The test stops at that limit.
- Up to three tries run at once. One test per workflow runs at a time, and none starts while Worca checks your criteria.
  You can close the page: Worca tells you when the results are ready.
- **Stop testing** keeps the tries that are done. **Finish the rest** makes the others later, without paying twice.
- A try Worca itself could not run (it could not prepare its copy, start the try or run a check) is made again once and
  never counted. If it fails again, the test stops.

## Compare

**In short** says in a few fixed sentences what changed, and **Look at it** opens the example to look at first. The
tiles show **Tries passed**, **Cost per try**, **Time per try**, **Sent back for fixes** and **Passed every try**.
**By example** gives each example's result, better, worse or same, and **What you changed since** lists the changed
steps and settings.

Compare shows a difference only when it is big enough to trust: cost at least 20% and $0.01 a try, time at least 20% and
10 seconds, sent back for fixes at least 0.5 times a try, each with at least 2 finished tries on each side. An example
whose result differs by one try or less says **Might be luck: only 3 tries.**, with **Try 3 more** (up to 10 tries of
an example in a test). An example that both versions fail most tries of counts as the same, and In short names it.

Click an example to see it **side by side**: what each version wrote, per try, **What was checked**, the questions Worca
asked, and **Would have sent**.

## Connectors

- **Pretend** (the default): your connectors are replaced by stand-ins. Nothing is posted or sent, and **Would have
  sent** shows what each try would have sent. Anything the workflow reads from them comes back empty. A connector is
  switched off when Worca cannot pretend for it (claude.ai connectors, servers in your own Claude Code settings or a
  project file, or one never tested in Connectors); the dialog names each. A stand-in offers the tools with their
  descriptions when the connector was last tested with workflow tests on; after a Test made with them off it offers the
  tool names only, so test the connector again for a closer stand-in.
- Pretend also switches off your personal Claude Code plugins, skills, agents and hooks, and the project's own hooks
  and plugins. The project's instructions stay on. Your sign-in, your deny rules and your sandbox are carried over.
- **Real**: tries use your real connectors. If the workflow posts or sends something, it does it in every try.
- Script steps run as in a normal run in both modes. Steps on another engine keep that engine's own connectors,
  plugins and settings.

## Tests on a project

An example can work on a Git project (**Where it starts**). Folder projects, and projects with Git LFS or submodules,
cannot be tested yet.

- **Start point**: a branch's newest commit, kept the same until you change it, so both versions start from the same
  code. **Include my changes that are not committed yet** saves them with the example (at most 5 MB). When the branch
  has newer commits, the example shows **Moved on**; **Start from the latest** moves it, and both versions are tried
  again from there.
- Each try works in Worca's own copy of the project, deleted after the checks. Your folder and your branches are never
  touched. The list of changes and the full diff stay to read.
- **Before each try, run** (under **For developers**): a setup command such as `npm ci`, filled in from the project's
  setup. If it fails, the test stops and no try counts as failed.
- Test a version shows the disk and time a test needs, and does not start when the disk is too full.
- **The command passes** is met when the command passes, or, with **It breaks nothing that passed before**, when no test
  that passed on the start point fails, is skipped or is gone after the change, and no fewer tests pass. Worca runs the
  command once on the start point first (**Before the change**) and keeps that result for 7 days. Use it when some
  tests already fail on the start point. Test names are read from TAP, node:test, pytest, Jest and Vitest output; any
  other command is compared by whether it passed. A flaky test can show as broken.

**Safety limits.** Pushes, pull requests and issues are stopped, with any engine, and common publish commands with
Claude Code. Each answers "Not sent: this is a test." and shows under Would have sent, also with Real connectors. It is
not a network block yet: a program's own web calls, a publish that signs in with a token kept in a file, a publish run
from inside a script, or a push or web call with a token the agent reads from a file or from git's settings are not
stopped. Git still sends a login kept in `~/.netrc` (`_netrc` on Windows) when a try pushes in a way Worca does not
stop, so do not keep forge logins there while you test. Also:

- Hooks and env values an agent writes into the project's settings during a try apply in its later steps, and can undo
  parts of Worca's guard there. The project's own sign-in and telemetry helpers (`apiKeyHelper`, `awsAuthRefresh`,
  `awsCredentialExport`, `otelHeadersHelper`) and its other settings, env included, stay on in Pretend, as in a normal
  run; telemetry they turn on is not stopped.
- While a try runs, an agent can read the settings file Worca hands Claude Code for it, as it can read your own settings
  in a normal run. A try cut short by a crash can show its connector calls without hiding the secrets in them.
- One of your own deny rules can block a tool the workflow needs, a Pretend stand-in included, and the try then fails,
  as a normal run would. The try's log says how many of your deny rules it follows.
- Your sign-in setting (for example `ANTHROPIC_BASE_URL`) from your Claude Code settings beats a model profile's own
  routing, and the sign-in values reach the commands an agent runs, as in a normal run. A model profile that sets
  `CLAUDE_CONFIG_DIR` changes which Claude Code settings Worca reads your sign-in and guards from.
- Worca turns off `autoAllowBashIfSandboxed` in a try that does not load your settings. This is checked in the settings
  Worca hands Claude Code, not yet in a run on Linux or macOS.
- A project's `CLAUDE.md` can still import files outside the project, as in a normal run.
- A file Worca stages for a try stays in the temp folder until the next start if Worca is killed.
- Worca reads project settings the way Claude Code 2.1.318 does; a later Claude Code may read them differently.
- A review loop set to carry on with `onExhausted: 'clean'` is not noticed as out of rounds.
- Test names are read only from TAP, node:test spec, pytest (`-rA` or `-v`), Jest verbose and Vitest verbose output,
  and failures only from their defaults.
- Pretend tries made before plugins were switched off can still be reused.

[Where Worca keeps its state](storage.md#workflow-tests-on-a-project-v104) has the full detail.

## Your criteria

Write the sentences a good result makes true, in your own words, for example "names a goal with a number": up to 12 per
example, 3 to 300 characters each. On every try, Worca answers yes or no for each one, and says why.

- **Checked with**: the AI model that checks them, chosen per example (Claude models; the call has no tools). Worca
  suggests one the workflow does not use to write, so it does not mark its own work. After each model, the list says who
  pays for its checks, as far as Worca can tell ([Costs](costs.md#hard-limits)). Changing the model starts the trust
  tests for these criteria again.
- What Worca reads is the result: what the workflow's last step hands to its end, and for an example with a project
  also the changes the try made (its diff). Write criteria about these. When a coding workflow's last step writes no
  text, its result is only the changes, so a criterion such as "the summary names the cause" cannot be met.
- Side by side shows **Your criteria · checked by Worca**: **Why Worca says yes** (or no), and **Proof from the
  result** (or **Proof from the changes**), a quote Worca must find there. Code quoted from the changes is found as it
  reads in the file, without the diff's + and − marks. A verdict without proof is asked once more, then not counted.
  Answer **Agree** or **Disagree** (**Undo** takes it back).
- After you change the criteria, Worca can check the stored tries again without running the workflow: **Check them on
  these tries** on Compare. Until then they show "Not checked yet". **Stop checking** stops it.
- The checks cost money. They count in the spending limit, and those made for a test also in its own cost limit.

A criterion that does not decide a try says why:

| Words | Why |
|---|---|
| Not checked yet | It is new, or the check has not run on this try |
| Not checked: the try did not finish | The try stopped before a result |
| Not checked: the try left no result | There was nothing to read |
| Not checked: the spending limit is reached | Your spending limit stopped the check |
| Not checked: this test reached its cost limit | The test's own limit stopped it; **Test again** to check |
| Not checked: Worca's answer could not be read | Twice, the reply could not be read |
| Not checked: Worca's proof was not in the result | Twice, the quote was not found |
| Not checked: the check did not run | The call failed |
| Not checked: you stopped the check | You pressed **Stop checking** |

A criterion that is Unreliable, or that was not checked on every finished try of an example, does not decide for that
example: it neither fails a try nor changes better or worse. Any other criterion that is not met fails the try, even when
its checks passed.

### Exact checks

Four checks need no AI and give the same answer every time: **Every quote is in the files**, **Numbers come from the
files**, **No personal data** (e-mail addresses; phone numbers that start with + or 0 and have 9 to 15 digits; bank
account and card numbers that pass their check digits) and **Links work** (at most 20 links per result). When a
criterion is about quotes, numbers, personal data, links or a stated figure, Worca suggests the exact check: a
**Switch** link beside "Can be checked exactly…" on the criterion, or **Switch to an exact check** under "Worca
suggests" in the example's dialog. **Add an exact check** adds any other.

### Check the checker

**Check the checker** (from **Confirm 4 results** on a new criterion, or **Fix it** on an unreliable one) takes a good
result and has it broken on purpose in three ways. You answer **Right** or **Wrong** for Worca's verdict on each of the
4 results. After **Wrong**, **Worca suggests clearer words**: **Use these words and check again**, or **Keep my words**.
The good result is **A result you liked**, else the newest passed try, else the past run you called good.

### How far you can trust it

Each criterion shows a mark:

- **Confirm 4 results**: new, with no Check the checker round yet. It counts, but you have not confirmed that Worca
  judges it your way.
- **Needs your answers**: a round is done, but Worca has fewer than the 10 answers it needs. It counts.
- **Reliable**: at least 10 answers, and Worca agreed with at least 80% of them, and with at least 70% both where it said
  yes and where it said no (a side is held to 70% only once it has 3 answers).
- **Unreliable**: at least 10 answers, below those bars. It is shown, but never decides better or worse until you fix it.

**How reliable is Worca's checking?** (the **Can you trust Worca's checking?** card on the Tests page) shows six tests,
worked out from the answers and rounds you already have: **Planted mistakes**, **Asked again** (the same result 3 times),
**Order swapped**, **Longer is not better**, **Proof for every verdict** and **Agreement with people**, which waits for 10
answers ("100% · of 6 answers (Worca needs 10)"). Order swapped and Proof for every verdict are Good from 80% once they
have at least 10 samples. **What to do** lists the criteria to fix or confirm.

### By criterion and the pair question

**By criterion** on Compare shows each criterion's met count per version and how far Worca's checking of it can be
trusted. For each example with criteria or a result you liked, Worca also answers **Which result is better overall?**
(or **closer to the one you liked**): it reads the first try of each version without knowing which wrote which, in
both orders. That answer does not change what Compare counts.

### Suggestions

In **Use this run as a test example**, Worca can turn your note into criteria; click one to keep it.
Suggestions and clearer words are paid calls too.

## How the exact checks and Check the checker work

### Every quote is in the files

This check looks at text in double quotation marks and uses a fixed, short rule. A quote is checked when:

- it is long: at least eight words with a letter, however it is introduced; or
- it has at least three words and its speaker (one to four words) is named in one of three forms:
  1. `<speaker> said:` and then the quote, on the same line or the next (`Dana said: "..."`, or `One customer told us:`
     with the quote on the next line). The verbs are said, says, wrote, writes and told us, each followed by a colon,
     and no others. The speaker counts from the start of its line or clause (`In March, the finance lead said: "..."`).
  2. The quote, then `, <speaker> said` (or says, wrote, writes, told us): `"...," Dana said.`
  3. The quote, then an em or en dash and the speaker, starting with a capital letter, on the same line or the next.
     Markdown emphasis and a role are allowed: `— Dana`, `— **Dana**`, `— Product manager at Acme`, `— Dana, finance
     lead`.

Nothing else names a speaker: no bare colon (`Dana: "..."`), no brackets (`"..." (Dana)`), no other verb or tense (`The
button should say: "..."`, `Copy to add: "..."`, `Dana noted: "..."`).

A word of a screen names nobody (`The button says: "..."`, `"..." — Button label`, `"..." — Invoices page`; also Error,
Hint, Title, Tooltip, Email, Page, CTA and the like). A speaker is such a name when:

- after a leading "the", "this", "that", "a" or "an", all its words are such words;
- its last word is one, in lower case or in capitals (`The main CTA says:`); or
- it follows "the", "primary" and the like in Title Case (`— Primary Button`).

A name or role that only holds one is still a speaker and is checked (`— Larry Page`, `— Field sales lead`). In form 2,
"which", "as" and "and" are not speakers when a lower-case word follows (`"...", as the brief says.`; `"...," as Dana
said.` is checked).

The known gaps of this rule:

- A short quote introduced any other way is not checked, even when a person is named: `Dana said "..."` without the
  colon, `"..." said Dana`, `According to Dana, "..."`, `Users say: "..."`, `"..." (Dana, finance lead)`, `"..." - Dana`
  with a hyphen, or `— the finance lead` in lower case.
- A speaker with a role in brackets is not checked in forms 1 and 2: `Dana (finance lead) said: "..."`, `"...," Dana
  (finance lead) said.` Form 3 accepts it (`— Dana (finance lead)`).
- A short quote with an em dash and a capitalised note that is not a person is checked as if it named one (`"..." —
  Mobile`, `"..." — Shown in the toolbar`), and so is a screen part that is not on the list (`It says:`, `The tagline
  says:`).

How quote marks are read:

- Outside a quote, a `"` right after a digit (`8.5" × 11"`) is an inch mark.
- Inside a quote, it ends the quote, unless a word follows and the quote's real closing mark comes later in the
  paragraph (`"We print on 8.5" paper and file it."`).
- Quote marks in code are not quotes.
- A quote never runs across a table row, a table cell or a blank line.

### Numbers come from the files

This check looks at every other number of the result, example values, percentages and prices too (`$12/user/month`,
`12/user/month`, `30/60/90-day`, `USD5000`, `USD750-EUR800`, `€9.99`).

It skips:

- dates, clock times, list and section numbers;
- a single digit without a decimal part or a %;
- the digits in ids, hashes, links, file paths and code (`2026/11/drafts`, `2026/reports/final`, `EUR2024-INV-0042`);
- the number of a standard's name (ISO 8601, RFC 4180, IEEE 754, UTF-8, SHA-256, EN 16931, DIN 5008).

A result wrapped in a ` ```markdown `, ` ```md ` or ` ```text ` fence, or in a fence that is never closed, is checked as
prose. A code block inside such a fence stays code. The files keep all their numbers.

### Links work

This check opens each link through the same guarded web access as Ask: https only, port 443, public addresses only, at
most 20 links per result.

Worca does not open a link that looks like it carries data: one that is too long, or whose path, query or host name
looks encoded.

Behind `HTTPS_PROXY`, a host only the proxy can resolve is not checked by Worca (best effort, like Ask), and any host
name in a result may reach internal services on port 443 behind the proxy.

### How Check the checker plants its mistakes

Check the checker plants its mistakes in every place that makes the criterion true. The checking model writes three
broken copies of the good result's written text, one call each. Each copy has the criterion broken everywhere it is met,
with everything else kept, and each is broken in a different way named in a few words.

- The call is told that the copy must make the criterion false: rewording, writing numbers as words, reformatting or
  moving text is not a break, and every place must change. So a criterion stated in several sections is really broken.
- A project result's changes (its diff) are never sent to these calls and never broken. Each broken copy is checked with
  the diff as it was, and a good run of a project example is checked with its diff too, as its tries are.
- A result with no written text at all is broken whole, its diff included.

Worca checks the good result first. It uses a copy only when the copy:

- differs from the good result and from the copies before it;
- is between half and one and a half times as long;
- came back whole, and leaves nothing out behind a placeholder such as "[rest unchanged]"; and
- no longer holds the passage that proved the criterion on the good result (the proof of an earlier check of that
  result, else of the first check of this round; compared loosely).

A copy that still holds that passage is asked for once more, and that call is given the passage to break too. When the
copy still holds it, or a copy fails another of these checks, the round does not finish ("This round did not finish.
Start a new round."), and the calls it made are still counted.

Copies are not checked for a passage when:

- nothing proved the criterion on the good result;
- the proof is shorter than 12 characters (counting its parts, not the "…" between them);
- the proof was quoted from a project's diff; or
- the proof is only a heading, a short label wholly in bold (`**Success metric:**`: at most 4 words, or ending with a
  colon), a table's header row or a line of marks, which a correct copy keeps.

A good result whose written text is longer than 40,000 characters is not broken. Check the checker does not start, says
"This result is too long for Worca to break on purpose. Check the checker works on results up to about 40,000
characters.", sends nothing and costs nothing.

Each of the 4 results is then checked, asked twice more, and once with filler text added: 16 checks.

### What a card shows

A card shows lines of its copy that changed in meaning, never the good result's own lines. A line the model only tidied
(a dash, case or marks) or only moved does not count. Changed lines are found by a line diff, so a copy that also adds
or removes a line still shows its breaks.

When they all fit, the card shows every changed line, joined with " … ". When they do not, it picks the lines that
changed most, as many as fit, and shows them in the copy's order, each cut between words around its change, so it may
not show every broken place.

### Criteria that are not a good fit

Only the written text is broken, so some criteria do not suit Check the checker:

- A criterion about the changes themselves on a project example ("Adds a test for the parser", "Changes no file outside
  src/") cannot be broken: every copy keeps the diff, so the planted cards still meet it.
- A criterion about formatting alone ("Uses H2 headings", bold, case) cannot be broken in a way Worca accepts, since
  copies are compared without case and marks; its rounds do not finish.

An exact check fits these better: **Has these sections**, **The command passes**, or the checks of which files may
change (**Changes only files under …**, **Changes at most N files**). For these, add the exact check yourself with **Add
an exact check**. Worca offers **Switch to an exact check** only for criteria about quotes, numbers, personal data,
links or a stated figure.

### Free mistakes and your answers

Worca's own free mistakes (numbers removed, a made-up quote added, a part removed) are used only when the checking is a
mock, which costs nothing. A "met" on one that cannot know the criterion is not counted as missed unless you said Worca
was wrong. A planted card that Worca judged met is not counted as missed when you answered Right on it.

### Length limits

A result longer than 200,000 characters is cut there before Worca checks a criterion on it, and the example's files and
request after 100,000.

## Where it is kept

The versions, examples, tries and answers are rows in Worca's database; Worca's copies of your projects live under
`<worcaHome>/workflow-tests/`. See [Where Worca keeps its state](storage.md#workflow-history-and-versions-v102); examples and tries are in
[Workflow tests (v103)](storage.md#workflow-tests-v103) and answers in [Your criteria (v105)](storage.md#your-criteria-v105).
