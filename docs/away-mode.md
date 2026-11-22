# Away mode

A run often stops to ask you something. Away mode lets Worca answer those questions while you're away, within
limits you set, and records every answer so you can check it later.

## What Worca answers

Away mode is on during your away hours, or once you turn on **Away** in the account menu (the corner at the foot of
the sidebar). While it's on, Worca answers what a run would otherwise wait on: clarifying questions, mid-step
questions, input forms, review-loop gates, proposed workflows and retries of failed steps.

On a Shaper run Worca answers every stop too: Clarify, Requirements, the slice outline and each plan. A passing check
is approved; a failing one goes back once with the check's findings, then is approved as written. Every answer that
decides what to build is flagged *please check*. Two stops still wait for you: **Ask me before each run**, because you
set it yourself, and Requirements whose check still fails, because they cannot be approved.

When the agent is sure enough of its own recommendation, Worca trusts it. Otherwise a read-only review, on the
run's engine, scores each option. It can only read files. It weighs each option against your Worca memory, how
easily the choice can be undone, scope, the codebase's conventions and cost. If Worca is unsure of an answer, it
still gives it, but flags it *please check*.

## Choosing when and where

**Settings › Runs › Away mode** (Advanced) holds the settings:

- the away hours and time zone
- *Only runs I marked* or *All runs*
- the method, and the model and effort that weigh the options
- the limits
- *Always wait for me on…*, for kinds of question Worca must never answer

A project's **Away mode** tab overrides any of these for that project.

To mark a run, tick *Mark this run: worca may answer for me* on New pipeline, or pass `--night` on the CLI. A marked
run is answered during the day too, once a question has waited 30 minutes.

On the run page, *Away mode on this run* overrides the setting for one run: *As set up*, *Answer for me now* or
*Never on this run*.

## Limits

Away mode is bounded on purpose:

- While critical or major issues remain at a review loop that has spent its cycles, the run continues with a flag.
  Away mode buys no extra fix round unless you configure one.
- A failed step is retried up to 3 times. Then the run pauses.
- A run pauses after 20 answers by default.
- An optional spend cap pauses runs that reach it. It counts across all projects from the start of the away
  stretch.

Your own cost caps always hold. Worca goes past the team's soft cap only if you allow it.

## Every answer on record

The run card carries a note like "Away mode: 5 answers while you were away — 2 to check". Its **See the answers**
opens the Q&A tab, where each answered question says who answered it. Its **Answered for you** list holds every other
answer: review-loop gates, proposed workflows, retries and each Shaper stop, with what Worca did and why, the ones to
check marked. The run's cost breakdown counts what the Away mode reviews cost.

A short notice tells you when away hours start and end, and a violet dot sits on your avatar while you're away.
Turning **Away** off in the account menu ends it.

## The screensaver

The screensaver is no longer part of Away mode. It is a setting in **Settings › General › Appearance**, off by
default. Turn on **Screensaver** and pick **Start after** (5 to 30 idle minutes, 5 by default).
