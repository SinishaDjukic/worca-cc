# R1 — Dana (senior backend, 10–20 tasks/day, 3 repos, 14" laptop)

## Three tasks in a row, today

1. **Same repo.** I type the task and hit Enter. Fine. But first my eyes go over the whole two-line sentence to check it says billing-api. Seven bold words with chevrons, and I'm hunting for the repo in the middle of them. Every single time.
2. **Different model.** I go for the mouse, find "Opus 5.5" in the sentence, then "high" next to it (two pickers for one decision), pick, come back to the text box. The sentence reflows and wraps differently, so my next glance lands somewhere else.
3. **Different repo.** I click billing-api and pick another one. Then I re-read the whole sentence, because I don't trust that model, effort and workflow carried over the way I think they did.

What slows me down: re-reading the sentence before every send, and no keyboard way in. I want Tab or a shortcut to the repo picker, then type-to-filter. On a 14" screen with the sidebar open, two lines of composer chrome is a lot.

## "New chat"

I expect it where I'm already looking when I decide to start something: **the composer** (or ⌘N anywhere). The sidebar + sits up top next to the collapse icon, which is a window control. It looks like "add project" or "add section", and it's the farthest point from where I type. What I actually do today is scroll to the composer on the current page and type, and half the time that continues the current chat when I wanted a fresh one. A key like ⌘N, plus a visible "New" right where the composer is, would fix it. Keep the sidebar + if you like, but it shouldn't be the main way in.

## The three mocks

**Quiet sentence.** I like that defaults disappear and only changes show. What annoys me: "Task on billing-api ⋯" hides model and effort, and I change those many times a day, so I'd be opening ⋯ all the time. Also, a line that changes shape depending on what's set means I never know where to look. The list side (no sentence until you filter, then an ✕) is good. Daily use? Maybe.

**Choose after.** The composer is lovely and clean. But I don't want a proposal plus a Start click for every task. That's an extra round trip 15 times a day, and I'd rather fix the repo *before* I send than after. "Worca's pick" guessing my repo makes me nervous. The scope-in-title list is great though: "Needs you · billing-api ✕" says exactly why the list is short. Daily use: the list yes, the composer no.

**Readout.** **My favourite.** One meta line, `billing-api · Opus 5.5 high · PR`, sits in the same spot every time, so I check it in one glance. The repo is brighter, which is right. Changed values turn violet, so I can see what I overrode. Click it to get the full sentence when I need it, plus "Same as last time". Annoyances: the popover is still mouse-only, and each value should be its own click target (click "Opus 5.5 high" to open the model picker right away, not the whole sentence). Daily use: yes.

## What I'd want

Readout, with every value directly clickable and keyboard reachable (e.g. `/` or Tab from the text box cycles repo → model → finish, then type to filter). It should remember my last choice per repo. ⌘N starts a new chat, focused in the composer. For the list, use Choose-after's title-as-scope.

## Keep

1. Values on show before I send (no blind sends).
2. Changed values marked (violet) and reset by ✕.
3. Model and effort as one choice.

## Kill

1. The two-line connector-word sentence on the page ("with … on … from … then").
2. "Showing all from all projects by date" when nothing is filtered.
3. The + next to the collapse icon as the only obvious "new chat".
