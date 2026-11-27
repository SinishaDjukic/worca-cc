// "How it works" copy for the work areas: Chat, Design, Runs, New run, Schedules, Statistics and
// Team metrics. Static data only: no imports, no state, no DOM. area-guides.mjs freezes and serves it.
// Every `controls` row names a label the copy mentions and the source file that draws it, so the
// copy test can keep the words in step with the page.

export const WORK_GUIDES = {
  chat: {
    title: 'How Chat works',
    tour: 'ask',
    steps: [
      { id: 'what', title: 'What Chat is', paras: [
        'Chat answers from Worca’s own records: your runs, their diffs, your workflows and your schedules.',
        'Ask “What changed in the last run?” and it reads the run instead of guessing.',
      ] },
      { id: 'scope', title: 'Pick what it looks at', paras: [
        'The scope pill in the composer sets what Chat can see: No project, one project, or a whole workspace.',
        'Narrow the scope and the answers get more specific.',
      ] },
      { id: 'cards', title: 'Suggested changes are cards', paras: [
        'When Chat proposes something, it shows a card. Nothing changes until you apply it.',
        'A run card offers Start run to begin now, or Schedule… to begin later.',
      ] },
      { id: 'home', title: 'The Chat home', paras: [
        'Most quick-action tiles only set up the composer, and you still press send. Add project opens the Add project dialog, and Track a run and Explain a diff ask you to pick a run first.',
        'Pin the chats you return to, and archive the ones you are done with.',
      ] },
    ],
    controls: [
      { label: 'Start run', file: 'ui/public/ask-panel.mjs' },
      { label: 'Schedule…', file: 'ui/public/ask-panel.mjs', find: "'Schedule…')" },
    ],
  },

  design: {
    title: 'How Design works',
    tour: null,
    steps: [
      { id: 'library', title: 'Your designs', paras: [
        'Design opens on “What should we design?” with your newest designs under it. Show all designs lists every one, and Search designs finds one by name or kind.',
        'Describe what you want, attach a logo or notes, and send.',
      ] },
      { id: 'kinds', title: 'Pick a kind', paras: [
        'A design is a Web page, a Presentation, a Pitch deck, a Video or a Document.',
        'You can pick a project too. Worca reads its brand to match the look, and never writes to the project.',
      ] },
      { id: 'build', title: 'How it is built', paras: [
        'A lead agent plans the design, then one agent builds each section, then the lead reviews the whole.',
        'The agents panel lists every agent, what it is doing and what it has cost.',
      ] },
      { id: 'manage', title: 'Rename and Delete', paras: [
        'Both live in the menu of the chat head. Delete is off while a build runs.',
      ] },
    ],
    controls: [
      { label: 'What should we design?', file: 'ui/public/design/studio.mjs' },
      { label: 'Show all designs', file: 'ui/public/design/designs-grid.mjs' },
      { label: 'Search designs', file: 'ui/public/design/designs-grid.mjs' },
      { label: 'Rename', file: 'ui/public/design/library.mjs' },
      { label: 'Delete', file: 'ui/public/design/library.mjs' },
    ],
  },

  runs: {
    title: 'How Runs work',
    tour: null,
    steps: [
      { id: 'what', title: 'What a run is', paras: [
        'A run takes one task through a workflow of agents and leaves the result on its own branch.',
        'Your own branch stays untouched until you decide to ship.',
      ] },
      { id: 'list', title: 'The list, in sections', paras: [
        'Runs sort themselves: Needs you comes first, then Running, Waiting and Recent. The Show filter narrows the list to Finished, Ready to ship or Archived.',
      ], art: {
        kind: 'sample',
        caption: 'Made-up examples, not yours.',
        items: ['Add a dark mode — Needs you', 'Fix the checkout total — Running', 'Rename the Web shop footer — Recent'],
      } },
      { id: 'page', title: 'A run’s page', paras: [
        'Open a run for its status line, what it has cost, the changes it made and the workflow graph with each agent’s step.',
      ] },
      { id: 'questions', title: 'Questions that wait for you', paras: [
        'An agent can stop and ask you something. The run then shows under Needs you until you answer.',
      ] },
    ],
    controls: [
      { label: 'Archived', file: 'ui/public/runs-view-menu.mjs', find: "'Archived']" },
    ],
  },

  new: {
    title: 'How starting a run works',
    tour: 'run',
    steps: [
      { id: 'target', title: 'Pick a target and describe the task', paras: [
        'Choose a project, a workspace, or No project, then write what you want done, such as “Add a dark mode”.',
      ] },
      { id: 'auto', title: 'Let Worca propose a workflow', paras: [
        'With the workflow set to Auto, Worca reads your task and proposes a workflow for it.',
      ] },
      { id: 'start', title: 'Start the run', paras: [
        'Press Start run. The run opens on its own page, where you can watch it.',
      ] },
      { id: 'human', title: 'Review the proposal', paras: [
        'With Auto and Human in the loop on, the run’s page shows the proposal first. Choose Accept & run to go ahead, or Cancel run to stop.',
      ] },
    ],
    controls: [
      { label: 'No project', file: 'ui/public/new-run/new.html' },
      { label: 'Auto', file: 'ui/public/app.js', find: "name: 'Auto'" },
      { label: 'Human in the loop', file: 'ui/public/new-run/new.html' },
      { label: 'Accept & run', file: 'ui/public/app.js' },
      { label: 'Cancel run', file: 'ui/public/app.js' },
      { label: 'Start run', file: 'ui/public/new-run/new.html' },
    ],
  },

  schedules: {
    title: 'How Schedules work',
    tour: null,
    steps: [
      { id: 'what', title: 'Runs that start later', paras: [
        'A schedule starts a run for you at a time you pick, once or on a repeat.',
        'Press Schedule a run to make one. Schedules show from the Advanced level up.',
      ] },
      { id: 'tabs', title: 'Three tabs', paras: [
        'Activity is what your schedules did: started, completed, missed, failed, skipped and paused runs, with an All, Unread and Problems filter. Once holds one-time schedules. Repeating holds the ones that come back, such as every Monday.',
      ] },
      { id: 'limit', title: 'An honest limit', paras: [
        'A scheduled run starts only while Worca is running and your machine is awake.',
        'If Worca was not running at a slot, the run starts late within the grace window, unless the schedule is set to skip missed slots. Otherwise the slot is marked missed. A one-time run then waits for you to reschedule or dismiss it, and a repeating one moves on to its next slot.',
      ] },
    ],
    controls: [
      { label: 'Schedule a run', file: 'ui/public/scheduled-runs/schedules.html' },
      { label: 'Activity', file: 'ui/public/scheduled-runs/schedules.html' },
      { label: 'Once', file: 'ui/public/scheduled-runs/schedules.html' },
      { label: 'Repeating', file: 'ui/public/scheduled-runs/schedules.html' },
    ],
  },

  stats: {
    title: 'How Statistics work',
    tour: null,
    steps: [
      { id: 'what', title: 'What it counts', paras: [
        'Statistics add up what your runs spent, how long they took and how they ended. It shows from the Advanced level up.',
      ] },
      { id: 'views', title: 'Ranges and views', paras: [
        'Pick a date range, then switch between Overview, By person and Cost.',
      ] },
      { id: 'filters', title: 'Filters', paras: [
        'Filter by cost tag or by person to narrow the numbers.',
        'Runs without that tag, or from someone else, are left out of the totals you see.',
      ] },
      { id: 'export', title: 'Take it with you', paras: [
        'Export CSV on the By person table saves the rows on screen as a spreadsheet file. The Cost view has its own Download CSV.',
      ] },
    ],
    controls: [
      { label: 'Overview', file: 'ui/public/statistics/stats.html' },
      { label: 'By person', file: 'ui/public/statistics/stats.html' },
      { label: 'Cost', file: 'ui/public/statistics/stats.html' },
      { label: 'Export CSV', file: 'ui/public/stats-view.mjs' },
      { label: 'Download CSV', file: 'ui/public/cost-report.mjs' },
    ],
  },

  'team-metrics': {
    title: 'How Team metrics work',
    tour: 'teamMetrics',
    steps: [
      { id: 'what', title: 'A team record in git', paras: [
        'Team metrics keep a shared record of your team’s runs on a git branch, so every teammate sees the same numbers.',
        'It shows at the Expert level.',
      ] },
      { id: 'views', title: 'Two tabs', paras: [
        'Overview adds the record up. Timeline is a calendar of work items: runs grouped by ticket or branch, plus pull requests created outside Worca.',
      ] },
      { id: 'on', title: 'Switch it on per project', paras: [
        'Open a project, go to its Team tab and choose Set up metrics…. Nothing is shared until you do.',
      ] },
    ],
    controls: [
      { label: 'Overview', file: 'ui/public/team-metrics/team-metrics.html' },
      { label: 'Timeline', file: 'ui/public/team-metrics/team-metrics.html' },
      { label: 'Set up metrics…', file: 'ui/public/team-metrics-surfaces.mjs' },
    ],
  },
};
