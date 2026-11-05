# Shaping · Wave 1.5 b: the decisions Wave 1 left open

Status: **agreed** 5 Nov 2026: all six recommendations (`docs/rail-agreed`, enrolled with Wave 1.5). Each slice of Wave 1
built a default so it could ship; these are the choices behind those defaults, and the recommendation is the decision.

| # | Decision | Built default | Options | Recommendation | Mock |
|---|---|---|---|---|---|
| D1 | Navigation on narrow screens | today's app already does both: the 60px icon rail is forced at 761–1080px, and at 760px and below the full column becomes the drawer (`ui/public/shell/collapsible-sidebar.css`); slice 2 kept it | **A** keep today's (rail on tablets, drawer on phones) · **B** the DS's wording, the icon rail at 760px and below | **A, and correct the DS text.** On a 375px phone a 60px rail takes a sixth of the width from the one thing on screen; on a tablet the rail keeps every place one tap away. The DS sentence (Narrow screens) says 760 where the app's break is 1080/760. | none: today's app already shows it |
| D2 | The needs-you count | on the Runs row and on the Pulse badge | **A** both · **B** Pulse only · **C** the Runs row only | **B, Pulse only.** Each fact once (Rail): Pulse is the one place for "what needs you", the Runs row stays a place. In the chat-first Worca (Wave 6) Pulse lists the conversations waiting on you, so the count already lives there. | `mocks/agreed-1.5b-d2-needs-count.png` |
| D3 | Team policy's level | Expert (today) | **A** Expert · **B** Advanced (the prototype) | **B, Advanced to read, Expert to change.** Everyone a policy constrains should see why a choice is locked; only an admin changes it. | none: a level, not a look |
| D4 | Where "Paused runs" sits | Settings › Runs | **A** Runs (what a run does when it pauses) · **B** Notifications › Limits (how you hear about it) | **A, with a link from Notifications.** The row decides run behaviour (resume when the limit resets, or wait for you); Notifications only says how you hear about it. One row per decision, in the section that owns the decision. | none: a place, not a look |
| D5 | The run page's two remaining stand-ins | off, each with its reason on a second line | **A** keep them visible and off, with the reason · **B** hide what cannot be done yet | **A.** A disabled control that says why teaches what is coming and where; Rail's rule ("a disabled control says why") already holds it. Slice 4 replaced 6 of the 8. | none |
| D6 | When the type moves to Inter | Poppins until graduation | **A** at graduation, one switch for everyone · **B** with the `rail` flag now, Rail pages only · **C** a wave earlier, everywhere behind the flag | **A.** Two faces on screen at once (Rail pages in Inter, today's in Poppins) reads as a mistake; Inter arrives when nothing old is left. Bundle it in Wave 5. | none: a mock would show only the face |

## What a pick changes

- D1 A changes only the DS sentence; B would add the icon rail on phones (slice 2's `rail-shell`).
- D2 B removes the count from the Runs row with the flag on; Pulse's badge stays the one count.
- D3 B moves Team policy's section to Advanced and keeps its edits at Expert.
- D4 A keeps the row; Notifications gets a "Paused runs: set in Runs" link row.
- D5 and D6 change nothing now.
