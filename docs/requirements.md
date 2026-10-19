# Requirements

Turn an idea into a clear, testable feature spec with Worca **before** anything is built. Experimental:
turn on **Requirements** in Settings › Experimental (the `requirements` flag), or start Worca with
`WORCA_FLAGS=requirements`.

## How it works

1. **New feature** on the Requirements page: a title, a few sentences, and the project or workspace it is for.
2. **Worca looks at the code once** (a read-only temporary copy, removed straight after) and writes, in
   plain words, what already exists in that area. You see it under *What Worca found in the code*. Turn
   it off per project or workspace in **Project context**.
3. **The interview**: rounds of at most 3 questions, each with options and a recommended answer, at most
   6 rounds. **Skip, use recommended** answers the rest for you; **Finish now** ends it early.
4. **The spec** fills in as you answer: goal, actors, main flow, edge cases, business rules, out of scope,
   acceptance criteria (`R-po-1`, `R-po-2`, …), assumptions (`A-1`, …) and open questions. Edit any section:
   Worca keeps your text. Confirm or reject each assumption.
5. **Save to specs/** writes `specs/FEAT-<n>-<title>.md` into the project's folder without committing.
   **Copy Markdown** and **Download .md** work for workspaces too.

No run, branch or worktree is created. Each look and round is one model call; its cost is shown on the
feature and counts toward your spending limit.
