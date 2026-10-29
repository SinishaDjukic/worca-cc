# Away mode

While you are away, Worca answers the questions a run would otherwise wait on, within limits you set, and records every answer.

- **Runs keep going while you're away** — during your away hours, or after you turn on **Away**
  in the account menu (the corner at the foot of the sidebar), Worca answers what a run would wait on: clarifying
  questions, mid-step questions, input forms, review-loop gates, proposed workflows and failed-step
  retries. It trusts the agent's recommendation when the agent is sure enough. Otherwise a
  read-only review (it can only read files), on the run's engine, scores each option against your
  Worca memory, how easily it can be undone, scope, the codebase's conventions and cost. An answer it is unsure of is
  still given, but flagged *please check*.
- **You choose when and where** — **Settings › Runs › Away mode** (Advanced level) sets the away
  hours and time zone, *Only runs I marked* or *All runs*, the method, the model and effort that
  weigh the options, the limits, and *Always wait for me on…* for kinds Worca must never answer.
  A project's **Away mode** tab overrides any of these for that project. You mark a run with *Mark
  this run: worca may answer for me* on New pipeline, or with `--night` on the CLI. A marked run is also
  answered by day once a question has waited 30 minutes. On the run page, *Away mode on this run*
  (*As set up*, *Answer for me now*, *Never on this run*) overrides one run.
- **Bounded on purpose** — while critical or major issues remain, a review loop gets at most one
  extra fix round (configurable), then continues with a flag. A failed step is retried up to 3
  times, then the run pauses. A run pauses after 20 answers by default. An optional spend cap,
  counted across all projects from the start of the away stretch, pauses runs that reach it. Your
  own cost caps always hold; Worca passes the team's soft cap only if you allow it.
- **Every answer on record** — the run page lists *Answered for you* (question, answer, reason
  and the deciding model), one group per ask, with the answers to check marked and listed first.
  A note above it reads like "5 answers while you were away — 2 to check". A
  short notice says when away hours start and end, and a violet dot sits on your avatar while you
  are away; turning **Away** off in the account menu ends it.
- **A small easter egg** — while you are away with **Keep awake** on, leave the Worca window in front and untouched
  for 5 minutes and a screensaver takes over: the wordmark drifts across the window with one line on how your runs
  and chats are doing. Moving the mouse or pressing a key brings the page back. `AWAY_SCREENSAVER` in
  `ui/public/away-screensaver.mjs` turns it off.

