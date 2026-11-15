# Marta, engineering lead: user panel, round 1

## My typical visit
I open Worca between meetings for about two minutes. I'm asking one thing: **is anyone waiting on me?** I look at "Needs you 2" first, and that's the only number I care about. I click the top row, read the question or the PR, answer or approve, and leave. Maybe once a day I start a task, like "bump Node to 24 on billing-api", and then forget about it until it needs me.

What's noise to me: "Showing all from all projects by date ⋯" sits above my list on every visit and says nothing. I never change it. It pushes Needs you down two lines, and on my phone that's a third of the screen. The little branch icon and the red ✕ on "Update Node to 24" confuse me. Is the red ✕ an error, or does it mean "needs you"? I can't tell if it failed or just wants an answer.

## Where I expect "new chat"
Today it's a tiny + in the header, next to the sidebar toggle, and it reads like "add a list" or "add a project". In every chat app I use (Slack, ChatGPT, Teams), "New" is either a clear button with a word on it at the top of the list, or I just start typing in the box at the bottom. Honestly, the composer *is* my new chat. If the box on the home page always starts a fresh conversation, I'd barely need the +. If it stays, give it a word: **"+ New"**, at the top of the list where my eye already is, not tucked among icons.

## Reading today's composer sentence
"Task on billing-api … then open a PR". I get it, and I like that it reads like English.
- **Means something to me:** Task, billing-api, open a PR.
- **Half-clear:** Opus 5.5 (a model, fine, I never touch it), "high" (high what? effort? priority? cost?).
- **Jargon:** "with Default" (default *what*?), "origin · latest" (no idea and don't care), the "+" in front (add what?).
Seven chevrons over two lines makes a simple "do this" feel like filling in a form.

## The three mocks
**Quiet sentence.** I like "Task on billing-api ⋯": one line, and the words I care about. Hiding the list sentence until I filter is exactly right, and "Showing billing-api ✕" when filtered is clear. What annoys me: dotted underlines are hard to spot, and ⋯ hides *everything* else, so I'd never find "push only" if I wanted it. It would help.

**Choose after.** This matches how I think: I type what I want, Worca proposes, I press **Start** or change one thing. "billing-api · Opus 5.5 high · from latest · opens a PR" next to Start is a summary I can check in one glance. The list title as the scope ("Needs you · billing-api ✕") is clever and saves room, and the menu with counts (Needs you 2, Running 3) is the most useful thing on any of these pages. What annoys me: it's one extra step before anything runs. That's fine for me since I start one task a day, but someone firing off lots of tasks might hate it. The + in that header is still an unlabeled icon.

**Readout.** It's tidy, and violet for "you changed this" is nice. But "billing-api · Opus 5.5 high · PR" in grey looks like status text, not something I can click. "All · by date" under the title is still a line that tells me nothing. It would help a little.

**Favourite: Choose after.** It gives me the least to read before I've said what I want, and a clear Start/Not now after.

## What I'd want
A home page that opens on Needs you, with no filters shown. One box that says "Ask or start something…", and new chats come from there. Worca shows a short proposal card with Start, which is where I'd change repo or model if I ever do. The list scope lives in the title, with counts. And there's one clear "New" with a word on it.

## Keep
1. The sentence idea as a *summary* ("billing-api · opens a PR"): plain words, readable.
2. Needs you at the top, with its count.
3. Proposal plus Start / Not now before a task runs.

## Kill
1. "Showing all from all projects by date" on screen when nothing is filtered.
2. "origin · latest" and "with Default" in anything I see by default.
3. The bare + icons (in the header and in front of the composer). Use words.
