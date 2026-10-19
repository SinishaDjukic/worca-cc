# Requirements

Turn an idea into a clear, testable feature spec with Worca **before** anything is built. Experimental:
turn on **Requirements** in Settings › Experimental (the `requirements` flag), or start Worca with
`WORCA_FLAGS=requirements`. With the flag off the page, its routes and its live updates are all gone.

## How it works

1. **New feature** on the Requirements page: a title, a few sentences, and the project or workspace it is for.
2. **Worca looks at the code once** (a read-only temporary copy, removed straight after) and writes, in
   plain words, what already exists in that area. You see it under *What Worca found in the code*;
   **Look again** refreshes it. Turn it off per project or workspace in **Project context**.
3. **The interview**: rounds of at most 3 questions, each with options and a recommended answer, at most
   6 rounds. **Skip, use recommended** answers the rest for you; **Finish now** ends it early. Earlier
   rounds stay on the page, folded, with the answers you gave. Whatever is still open when the interview
   ends becomes an assumption.
4. **The spec** fills in as you answer: goal, actors, main flow, edge cases, business rules, out of scope,
   acceptance criteria (`R-po-1`, `R-po-2`, …), assumptions (`A-1`, …) and open questions. Edit any section:
   Worca keeps your text (**Let Worca rewrite this** hands it back). Add or remove criteria: a criterion
   you removed never comes back. Confirm or reject each assumption.
5. **Save to specs/** writes `specs/FEAT-<n>-<title>.md` into the project's folder without committing.
   **Copy Markdown** and **Download .md** work for workspaces too.

If a look or a round fails (no reply, an unreadable reply, the spending limit, or a Worca restart), the
page says why and offers **Try again**, which re-runs exactly what failed. **Archive** hides a feature
from the list; **Show archived** lists it again, and **Restore** brings it back where it was.

No run, branch or worktree is created. Each look and round is one model call; its cost is shown on the
feature, counts toward your spending limit, and is part of the spend in Statistics and the account menu.
Worca runs at most four requirements looks or rounds at a time.
