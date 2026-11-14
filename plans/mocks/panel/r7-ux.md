# Panel r7 · UX: the sentence comes back as what will happen

Mock: `r7-ux.png` (from `r7-ux.html`, rendered with `r2-ux-shot.mjs`).

The sentence is built by a **template** from the current values. No model is involved, so it is instant, always true and free. It appears in two places with the same words:
- the send button's Tooltip (on hover, focus and long-press);
- TaskProposal's reason line, under its title.

A value that carries a ChangedDot is set in ink at 500 weight. A default that says nothing stays out, as it does on the line; Customise holds it. The task's title is the only text a model writes, under the violet shimmer.

## Templates

| Case | Sentence |
|---|---|
| Ask | Worca will answer from {repo} with {engine}, {effort}. **Nothing is changed.** |
| Task, now | Worca will change {repo} with {engine}, {effort}, starting from {base}, then {finish}. **Nothing starts until you press Start.** |
| Task, later | … then {finish}. It starts {when}; nothing runs before then. |
| Task, after a task | … then {finish}. It starts when {task} is done. |
| Task, repeating | … then {finish}. It runs {every} at {time}, the first time {next}. |
| Shaper | Worca will ask you up to 3 questions on {repo}, write a plan for {reviewers} to review, and change nothing until you approve it. |
| Preset | Prefix: *Preset {name}:* followed by the Task sentence. |
| Other workflow | {workflow's own line} replaces *change*, e.g. *build and review quickly*. |
| Schedule | Worca will run this on {repo} {every} at {time}, each time as a new task that {finish}. The first run is {next}. |

| Value | Words |
|---|---|
| quick / standard / thorough / deepest | working quickly / at its usual pace / thinking longer than usual / thinking as long as it needs |
| A Codex or Gemini level | the same words |
| open a PR | then open a PR into {base} |
| leave a branch | then leave the work on a branch for you |
| push to the source | then push to the source branch |
| base | starting from the latest {base} branch |
| workflow Default, memory, guardrails | left out unless changed; if changed, a short clause (*under strict guardrails*) |

Rules:
- One sentence for what happens, then one for what does not happen. Write "Worca will", in the present, no jargon.
- The base branch is always said, because a PR's meaning depends on it.

## Rail basis

- `form.composer`: *its button names what will happen*.
- `form.dialog`: *a foot that names what happens*.
- Tooltip (`watchTooltips`): quick, and shown on hover, focus and long-press.
- TaskProposal's `why`: the reason line that already sits under the title.

So no new part is needed: a template fills two slots Rail already has.

## Continue or Propose

The sentence settles it: **Propose**.
- With the tooltip saying exactly what happens and that nothing starts yet, the button only has to name the next step.
- *Propose* matches the card it opens, whose kicker reads **Proposed task**: one word family from button to card.
- *Continue* names no step. *Start* would be untrue.
- Schedule keeps **Schedule**; Ask keeps its arrow.

## Changes since r6

- The plain sentence is back, as an explanation rather than as pickers: in the button's tooltip and the proposal's reason line. It updates as you change a value on the card.
- A later *when* renames Start to **Schedule**, and the sentence says when the task starts.
- **Row ⋯:** **Select (Space)** comes first. For advanced users, *Add to group* and *Delete* sit under **More ›**, with Delete last after a rule. Seven lines.
- **Showing all ⌄** has **Keyboard shortcuts ?** as its ruled foot. The › rows drop their separator, so the menu stays at seven lines.
- **Engine:** the top find field also searches Other engines (*gem* → Gemini Pro, Gemini Flash). The three recent models keep a stable order: a new model takes the least used slot, and the list never reshuffles.

## Rule edits

- `forms.md` › `form.composer`: "the button's tooltip and the proposal's reason are one templated sentence of what will happen and what will not; changed values in ink; the Task button is **Propose**."
- `components.md` › TaskProposal: "`why` is the template's sentence while Worca writes the title".
- `components.md` › row ⋯: "Select first; at most seven lines, the rest under More ›".
- `small-rules.md`: the effort words, now also as the phrases in the table above.
