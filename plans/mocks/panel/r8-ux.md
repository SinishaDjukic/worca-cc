# Panel r8 · UX: on the card, the sentence is the control

Mock: `r8-ux.png` (from `r8-ux.html`, rendered with `r2-ux-shot.mjs`). It shows the card starting now, with a value changed, starting later, with a finish that names the branch, on a 375px phone, and the nit fixes.

## What changes

- TaskProposal's **sentence slot** now holds the plain sentence, and its values are SentencePickers inside it: *Worca will change [billing-api ⌄] with [Opus 5.5, thinking longer ⌄], starting from [the latest dev branch ⌄], [now ⌄], then [open a PR ⌄]. Nothing starts until you press Start.*
- **The separate value line is gone.** Each fact appears once, which answers Dana's and Marta's "it says it twice".
- **The why slot under the title stays empty.** The model writes only the title.
- This is **SentencePicker as Rail already defines it**: "a picker in the sentence it changes". The prototype's proposal is already a sentence of pickers with connector words (`proposalHtml`). Only its words change, now coming from the template.

## Style, and why

- **Size: body (13).** The card is where you read before Start. Meta (12) suits a summary line, not a sentence you check word by word.
- **Values:** quiet SentencePicker style, in ink at 400 weight, the repo at 500, each with a light ⌄ in `--ink-3`.
- **Connector words in `--ink-3`.** The closing promise (*Nothing starts until you press Start*) is in `--ink-2`.
- **ChangedDot** stays after a changed value, before its ⌄.
- **The sentence wraps freely.** A picker never breaks inside itself (narrow.md: "a word stays with its picker").

## One template, two renderings

- The template turns values into words.
- On the card, those words are pickers. In the composer button's tooltip, the same words are plain text.
- Each menu lists its choices in the sentence's own words: *open a PR / leave the work on a branch for you / push straight to dev*. Whatever you pick reads straight into the sentence.
- The values in the sentence are repo, engine and thinking, from, when, and finish. Workflow and everything else stay in Customise; a non-Default workflow adds one quiet line under the sentence.
- A later *when* makes the closing sentence *Nothing runs before then* and turns Start into **Schedule**.

## Phone (375)

- The sentence wraps to four lines, and Start sits right under it, above the composer, with no scrolling (Marta).
- The composer line at 375 shows the mode and repo; the engine follows on the next line if needed.

## Nits

- **Tooltip on focus waits 500ms** (Dana), so Tab then Enter never flashes it. Hover keeps Tooltip's own delay, and long-press shows it on a phone.
- **"push to the source branch" now names the branch** (Sam): *push straight to dev*.
- **Keyboard shortcuts at the Showing menu's foot** is now in ink, with **?** in a keycap, so it no longer looks disabled (Sam).

## Rule edits

- `components.md` › TaskProposal: "its sentence is the template's sentence with SentencePickers for repo, engine, from, when and finish; there is no separate value line; why stays empty unless Worca has a reason the sentence does not say".
- `forms.md` › `form.composer`: "the button's tooltip renders the same template as plain text; on focus it waits 500ms".
- `small-rules.md`: the finish words name the branch.
