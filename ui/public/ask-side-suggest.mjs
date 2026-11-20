// ui/public/ask-side-suggest.mjs — Ask worca beside the page: the side column's empty state (a new chat) names what
// to ask about the page on screen. Pure; the copy is Lead call L10's. A suggestion only fills the composer.

const ASK_WORCA = Object.freeze({ heading: 'Ask worca', items: Object.freeze(['What needs me?', "What's ready to ship?"]) });
const RUN_VIEWS = new Set(['running', 'history-detail']);
// The table's run rows by the statuses app.js really gives a run: an interrupted or canceled run stopped too, a pausing
// one waits, a starting one runs.
const STOPPED = new Set(['stopped', 'error', 'failed', 'interrupted', 'canceled']);
const WAITING = new Set(['paused', 'waiting', 'pausing']);
const RUNNING = new Set(['running', 'starting']);

const PAGES = Object.freeze({
  runs: ['Ask about your runs', ["What's ready to ship?", 'What needs me?']],
  schedules: ['Ask about schedules', ['Is anything scheduled right now?', 'Schedule a run every night']],
  projects: ['Ask about your projects', ['Which projects have Team metrics off?', 'Which projects are behind origin?']],
  'project-detail': ['Ask about this project', ['What ran here this week?', "What is in this project's memory?"]],
  stats: ['Ask about spending', ['What did runs cost this month?', 'Which workflow costs the most?']],
  'team-metrics': ['Ask about this chart', ['Why did spend jump?', 'Who ran the most this month?']],
  'team-policy': ['Ask about this policy', ['What does this policy allow?']],
});

function runItems(status) {
  if (STOPPED.has(status)) return ['Why did it stop?', 'What did it change?', 'Start a run after this one'];
  if (WAITING.has(status)) return ['What does it need from me?', 'What did it change so far?'];
  if (RUNNING.has(status)) return ['What is it doing now?', 'What did it change so far?'];
  return ['What did it change?', 'Is it ready to ship?', 'Start a run after this one'];
}

/** `{ heading, items }` for a page context; `runStatus` is the run chip's status, `diffPath` the Diff file open. */
export function sideSuggestions(ctx, { runStatus = '', diffPath = '' } = {}) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  if (RUN_VIEWS.has(c.view)) {
    const items = runItems(runStatus);
    return { heading: 'Ask about this run', items: diffPath ? ['Explain the changes in this file', ...items] : items };
  }
  if (c.view === 'workspaces' && typeof c.pageWorkspaceId === 'string' && c.pageWorkspaceId) {
    return { heading: 'Ask about this workspace', items: ['What ran here this week?', 'Which members have Team metrics off?'] };
  }
  if (Object.hasOwn(PAGES, c.view)) return { heading: PAGES[c.view][0], items: [...PAGES[c.view][1]] };
  return { heading: ASK_WORCA.heading, items: [...ASK_WORCA.items] };
}
