# Worca Rail: the waves after Wave 1

Shaped 5 Nov 2026. The goal: the library, the tokens and the design system lead, and every page of
Worca is built from them (`docs/rail/`). Each wave **redesigns** its pages from what they are for, and does not
recolour or patch the old page: a page keeps only what earns its place, and everything on it comes from the library.

## How every wave works

The same six steps, in order. A wave is not handed to Worca before step 4 is done.

1. **What the page is for.** One sentence per page, who uses it and how often, its states (empty, loading, working,
   needs you, failed, done), and what it drops or merges. Simplifying is part of the brief: fewer controls, fewer
   sections, one action per state (One Rail › the philosophy).
2. **Mock the open choices.** PNG or GIF for each real choice, decided before anything is built.
3. **Into the one Worca prototype.** The page joins `plans/rail/prototype/index.html`, built only from the library, and
   passes the gates (`docs/rail/gate.md`).
4. **The design system first.** Every need the page found and the DS lacked becomes a rule, a catalog entry, a component
   with its test and gallery example, and a check, before the page uses it. No page keeps a hand-built version.
5. **One Feature to Worca's Shaper.** The pages and the missing functionality (each gap with its API, after the surface
   that needs it), sliced, Ask me before each run on, behind the `rail` flag.
6. **Done when** the pages pass the gates in the app's test suite with the flag on, the old parts they replace are in
   `rail-retires.json`, and the prototype case equals the app.

## The order

| Wave | Pages | Why now | Size |
|---|---|---|---|
| **1** | Run and group pages, Pulse, Settings, the shell and navigation | The core of a run | 3 Features |
| **1.5 The DS holds** | No page: the design system's own consistency (below) | Every later wave builds on it; cheap now, costly later | small |
| **2 The daily loop** | Runs list, New run, Chat home, a chat thread and its run cards, Ask worca's side column | Used every session; the Runs list's end column started this | large |
| **3 Building blocks** | Workflows (list and canvas), Requirements and Shaper features (the Plans tab), Schedules, Projects, Workspaces (list, map, create) | Where work is set up | large |
| **4 Store and insight** | Marketplace and Plugins, Skills, Statistics, Team metrics, Usage and costs at full size, C4 and graph views, Artifacts and diff viewers, the terminal and logs | Read more than acted on; charts and tables patterns | large |
| **5 Edges and graduation** | Getting started and the setup assistant, Away screensaver, empty and error pages, the browser extension's sidebar, docs-site and changelog look; then graduation | Last pages; then the old design leaves | medium |
| **6 Chat is the product** | Chat and builds become one: a build is the engine under a conversation, not a thing people manage | The end state of the product, not a page redesign; to shape (below) | to shape |
| **7 Micro-frontends** | The app splits into independently built features on one shell and one design system | Last: it moves code, not looks, once every page is Rail | to shape |

The `rail` flag stays the one switch across the waves: each wave's pages join it, so there are still only two states to
test, today's Worca or Rail. Graduation (Wave 5) removes the flag, every part in `rail-retires.json` and the
`:root[data-rail]` scopes, and the Rail tokens become the base tokens.

## Wave 2: an idea to shape

**Task estimation advisor.** A full AI feature, entirely about usage: a setting, and a helper job on Haiku in Models › Jobs. It
reads the task, workflow, project and what is left of each limit, with similar runs' real usage as evidence, and says so when
history is thin. In New run: size and share of the limit, plus a warning or a better provider. On the run card: estimated
against used.

## Wave 1.5: the design system holds (after Wave 1 merges)

Done in Agreed: all five items below. They stay here as the record of what was agreed.

The consistency work we agreed on, in this order. It keeps the philosophy and makes "everything has one place" true of
the design system itself.

1. **One concern, one place.** `docs/design-system.md` keeps today's foundations (the tests read them) until
   graduation; the Rail rules move to chapters under `docs/rail/` behind one index. Each rule lives once, with a short
   id, one line, why, and the check that holds it ("checked by hand" otherwise). A docs check fails a duplicate id or a
   check that does not exist.
2. **One rail, one end: the row primitive.** `row()` with four slots (rail, text, end, ⋯); `list()` lays its rows on one
   grid, so every end shares one left and one right edge (as wide as the widest end, with a cap) and the title gives way
   first. ListRow, StepRow, SettingsRow, group member rows, Pulse rows and route rows are built on it, and the alignment
   check covers every row container on a Rail page. The end-column rule (on hold since 5 Nov) comes with it.
3. **Generated, not copied.** The component docs and the Design System artifact are generated from
   `docs/design-system-catalog.json` and the components; nothing is copied by hand.
4. **Decisions left open by Wave 1,** settled before Wave 2 (each slice built a default):
   - Narrow screens: the DS says the sidebar becomes a rail of icons at 760px and below; the app keeps the drawer.
   - The needs count shows on the Runs row and on the Pulse badge: one place or both.
   - Team policy at Expert (today) or Advanced (the prototype).
   - Paused runs under Runs (built) or under Notifications › Limits (the prototype).
   - Stand-in wording on the run page ("Pause after this step" off with its reason, "Continue without cap").
5. **The type.** The DS names Inter in place of Poppins; Wave 1 keeps Poppins. Decide when the type moves: with
   graduation (one switch for everyone) or a wave earlier behind the flag.

## Wave 6: Chat is the product, builds are the engine (to shape)

The final product stage: people talk to Worca in Chat, and the build (today's run, with its workflow, steps, branch and
PR) becomes a hidden engine inside the conversation. Nobody should have to manage builds. It is not shaped yet; these
are the challenges to work through, not decisions:

- **What stays visible.** A conversation needs the outcome (what changed, can I ship it), the questions only a person can
  answer, cost and limits. Which of the run page's parts survive as cards in Chat, and which go behind a "how it ran"
  view for experts (the interface levels may be the line)?
- **Runs static, Chat interactive** (decided 25 Oct): a build stays statically dispatched and Chat does the steering.
  Hiding builds keeps that rule; it changes where a build is seen, not how it runs.
- **The navigation model.** "A thing opens as a full page" assumes a run is a thing. If the conversation is the thing,
  what is a run's address, what does a link or a notification open, and does the Runs list survive as an operations
  view (all builds across chats, for teams and admins) or disappear?
- **Builds with no conversation.** Schedules, automations, a ticket from a tracker, a re-run, a PR fix run: whose chat do
  they belong to, or do they open one?
- **Features and Shaper.** A Feature is many builds over hours; its feature card already lives in a chat thread. Is one
  chat one feature, or can a chat hold several?
- **Pulse and needs you.** Pulse lists runs that need you today; in the end state it lists conversations waiting on you.
- **Teams.** Shared visibility of a teammate's builds, review and ship by someone else, audit: a private chat is not a
  team surface.
- **Ordinary stays ordinary** (decided 18 Oct): no message is intercepted or rerouted by keywords; a build starts from
  Ask Worca's own tools or an explicit button on a card.
- **What Waves 2–5 should not lock in.** Wave 2 redesigns the Runs list, Chat and run cards: it should be shaped toward
  this end state (the run card as the build's face in Chat, the Runs list as an operations view), so it is not
  redesigned twice.

## Wave 7: micro-frontends (to shape)

The last wave changes how the app is built, not how it looks: each feature (`ui/public/FEATURE/`, the #919 split) becomes
an independently built and loaded frontend on one shell. Questions to shape:

- **Why, and for whom.** Independent releases per feature, teams owning features, plugins shipping their own pages, or a
  smaller first load. The answer decides how far the split goes.
- **The shared core.** The design system (tokens, components, CSS parts) as one versioned package every frontend uses,
  so the DS stays the leader; the shell (sidebar, top bar, trail, Pulse) and the router as the host.
- **Contracts.** How a frontend mounts, registers its routes and addresses, reads flags and levels, and gets the live
  WebSocket frames and shared state without reaching into another feature.
- **Styles.** Tokens stay global; each frontend's CSS scoped so one cannot restyle another; no copy of the components.
- **Build and delivery.** The app ships today as one Node server serving `ui/public/`; how frontends are built, versioned
  and loaded (an import map, module federation or plain ES modules per feature), offline and in the Docker image.
- **Gates.** Each frontend passes the DS checks on its own and in the composed app.
- **Order.** After Wave 6: the chat-first product decides which features exist as frontends at all.

## What each wave has to settle

- **Wave 2:** Chat stays interactive and runs stay static (a run is dispatched; steering lives in Chat). A run from Chat
  opens beside the conversation today, while "a thing opens as a full page" holds everywhere else: settle the Chat run
  panel's place in the navigation model. The Runs list takes the list sentence, grouping, selection and the row
  primitive. New run becomes the Dialog form pattern (one framing sentence, SentencePickers, presets, the near-limit
  note).
- **Wave 3:** the Workflows canvas is a full-bleed editor (no page header); its tray and sheets need the layer pattern.
  Requirements and Shaper features share the feature card with the group page.
- **Wave 4:** charts and tables get their patterns (tables keep row lines; lists do not). The Marketplace exceptions
  (tile grid, facet rail) are reviewed against Rail rather than carried over.
- **Wave 5:** the browser extension and docs-site consume the same tokens and components (the extension has its own
  build); graduation also removes the peach and amber tokens' old arms.

## Kept from Wave 1

- Hand-off as one Feature per wave, sliced; Ask me before each run on; every plan checked against the flag before
  approval.
- What a page teaches becomes the design system's, in the same wave, before the page ships.
- Small features ship without a flag of their own; the `rail` flag is the wave's switch, not a per-feature one.
