// Worca Levels ladder (v2): the five usage levels and the items that move a person up. A level's `items`
// are what it asks for; an item is either a single thing or a "pick any N" of `choices`.
// Pure constants, no Node-only imports (served to the browser at /src/shared).

export const WORCA_LEVEL_COUNT = 5;

export const WORCA_THRESHOLDS = Object.freeze({
  runnerSteps: 6,
  runnerRealRuns: 3,
  hookedRuns: 10,
  hookedDays: 3,
  hookedPick: 2,
  hookedProjects: 2,
  prsOpened: 1,
  parallelFeatures: 2,
  holicMergedPrs: 5,
  holicPick: 2,
  repeatingScheduleRuns: 3,
  addonsAtOnce: 2,
  holicProjects: 3,
  councilDays: 20,
  councilWindow: 30,
  nudgeAt: 0.75,
});

const T = WORCA_THRESHOLDS;
const SCHEDULES_HINT = 'Schedules. Not in your sidebar in Simple mode; the button opens it.';

/** A single item: one condition. `href`/`openLabel` null means the item has no page to open. */
function item({ id, label, hint, href = null, openLabel = null, onlyFor, threshold, unit, parts }) {
  const out = { id, label, hint, href, openLabel, kind: 'single' };
  if (onlyFor) out.onlyFor = onlyFor;
  if (threshold !== undefined) out.threshold = threshold;
  if (unit) out.unit = Object.freeze([...unit]);
  if (parts) out.parts = Object.freeze(parts.map((p) => Object.freeze({ ...p })));
  return Object.freeze(out);
}

/** A "pick any `need`" item over `choices`. */
function pick({ id, label, hint, need, choices }) {
  return Object.freeze({
    id, label, hint, href: null, openLabel: null, kind: 'pick', need,
    choices: Object.freeze(choices.map(item)),
  });
}

function level(index, key, name, copy, items) {
  return Object.freeze({
    index,
    key,
    name,
    ...copy,
    avatar: `/assets/worca-levels/${key}.svg`,
    items: Object.freeze(items),
  });
}

export const WORCA_LEVELS = Object.freeze([
  level(
    1,
    'curious',
    'Curious',
    {
      tint: 'blue',
      hue: 235,
      tagline: 'set up and ready to build',
      description: 'Set up and signed in to a model. Everyone begins here, ready to try a first run.',
      hat: 'beanie',
      phrase: 'Curious',
      recap: 'finished setup and signed in to a model provider',
    },
    [
      item({ id: 'setupFinished', label: 'Finish setup', hint: 'The Setup Assistant takes a couple of minutes.' }),
      item({
        id: 'providerSignedIn',
        label: 'Sign in to a model provider',
        hint: 'Claude Code, Copilot or any other provider counts.',
      }),
    ],
  ),
  level(
    2,
    'runner',
    'Runner',
    {
      tint: 'teal',
      hue: 195,
      tagline: 'runs a pipeline end to end',
      description: `Orchestrates one pipeline: Getting started steps 1 to ${T.runnerSteps} and ${T.runnerRealRuns} real runs.`,
      hat: 'W headband',
      phrase: 'a Runner',
      recap: `finished Getting started steps 1 to ${T.runnerSteps} and ${T.runnerRealRuns} real runs`,
    },
    [
      item({
        id: 'runnerSteps',
        label: `Getting started steps 1 to ${T.runnerSteps}`,
        hint: 'Connect a model, add a project and do your first runs.',
        href: '#getting-started',
        openLabel: 'Open Getting started',
        threshold: T.runnerSteps,
      }),
      item({
        id: 'realRuns',
        label: `${T.runnerRealRuns} real runs`,
        hint: 'A run that finishes, is not a demo run and costs something.',
        href: '#new',
        openLabel: 'Open New pipeline',
        threshold: T.runnerRealRuns,
        unit: ['real run', 'real runs'],
      }),
    ],
  ),
  level(
    3,
    'hooked',
    'Hooked',
    {
      tint: 'purple',
      hue: 295,
      tagline: 'builds with worca every few days',
      description: `Builds regularly: ${T.hookedRuns} real runs, a pull request and ${T.hookedPick} more things tried.`,
      hat: 'flat cap',
      phrase: 'Hooked',
      recap: `run ${T.hookedRuns} real runs on ${T.hookedDays} days, created a PR and tried ${T.hookedPick} more things`,
    },
    [
      item({
        id: 'hookedRuns',
        label: `${T.hookedRuns} real runs on ${T.hookedDays} days`,
        hint: `Real runs that finish, spread over at least ${T.hookedDays} different days.`,
        href: '#new',
        openLabel: 'Open New pipeline',
        parts: [{ id: 'runs', of: T.hookedRuns }, { id: 'days', of: T.hookedDays }],
      }),
      item({
        id: 'prOpened',
        label: `${T.prsOpened} pull request opened`,
        hint: 'Let a run create a PR on your project.',
        href: '#new',
        openLabel: 'Open New pipeline',
        threshold: T.prsOpened,
      }),
      item({
        id: 'teamSetUp',
        label: 'Team set up',
        hint: 'Turn on Team metrics and Team policy.',
        href: '#team-policy',
        openLabel: 'Open Team policy',
        onlyFor: 'team',
        parts: [{ id: 'metrics', of: 1 }, { id: 'policy', of: 1 }],
      }),
      pick({
        id: 'hookedPick',
        label: `Pick any ${T.hookedPick}`,
        hint: `Do any ${T.hookedPick} of these.`,
        need: T.hookedPick,
        choices: [
          { id: 'scheduledRunDone', label: 'A scheduled run finished', hint: SCHEDULES_HINT, href: '#schedules', openLabel: 'Open Schedules' },
          { id: 'workspaceRunDone', label: 'A workspace run finished', hint: 'Workspaces, under Manage.', href: '#workspaces', openLabel: 'Open Workspaces' },
          { id: 'addonInstalled', label: 'Install an add-on', hint: 'Marketplace, under Add-ons.', href: '#marketplace', openLabel: 'Open Marketplace' },
          { id: 'prMerged', label: 'Merge a pull request', hint: 'Merge a pull request a run opened.', href: '#new', openLabel: 'Open New pipeline' },
          {
            id: 'twoProjects',
            label: `Real runs on ${T.hookedProjects} projects`,
            hint: `Finish real runs on ${T.hookedProjects} different projects.`,
            href: '#projects',
            openLabel: 'Open Projects',
            threshold: T.hookedProjects,
          },
        ],
      }),
    ],
  ),
  level(
    4,
    'worcaholic',
    'WorcaHolic',
    {
      tint: 'orange',
      hue: 65,
      tagline: 'runs the whole pod',
      description: `Orchestrates the whole pod: parallel features, ${T.holicMergedPrs} merged pull requests and ${T.holicPick} power moves.`,
      hat: 'black W cap',
      phrase: 'a WorcaHolic',
      recap: `run ${T.parallelFeatures} features at once, merged ${T.holicMergedPrs} pull requests and tried ${T.holicPick} power moves`,
    },
    [
      item({
        id: 'parallelFeatures',
        label: `Run ${T.parallelFeatures} features at the same time`,
        hint: 'Both have to finish successfully.',
        href: '#new',
        openLabel: 'Open New pipeline',
        threshold: T.parallelFeatures,
      }),
      item({
        id: 'prsMerged',
        label: `${T.holicMergedPrs} merged pull requests`,
        hint: 'Pull requests your runs opened that were merged.',
        href: '#new',
        openLabel: 'Open New pipeline',
        threshold: T.holicMergedPrs,
        unit: ['merged PR', 'merged PRs'],
      }),
      pick({
        id: 'holicPick',
        label: `Pick any ${T.holicPick}`,
        hint: `Do any ${T.holicPick} of these.`,
        need: T.holicPick,
        choices: [
          {
            id: 'repeatingScheduleRuns',
            label: `A repeating schedule with ${T.repeatingScheduleRuns} finished runs`,
            hint: SCHEDULES_HINT,
            href: '#schedules',
            openLabel: 'Open Schedules',
            threshold: T.repeatingScheduleRuns,
          },
          {
            id: 'addonsAtOnce',
            label: `${T.addonsAtOnce} add-ons at once`,
            hint: `Have ${T.addonsAtOnce} or more installed at the same time.`,
            href: '#marketplace',
            openLabel: 'Open Marketplace',
            threshold: T.addonsAtOnce,
          },
          {
            id: 'threeProjects',
            label: `Real runs on ${T.holicProjects} or more projects`,
            hint: `Finish real runs on ${T.holicProjects} different projects.`,
            href: '#projects',
            openLabel: 'Open Projects',
            threshold: T.holicProjects,
          },
        ],
      }),
    ],
  ),
  level(
    5,
    'council',
    "Worca's Council",
    {
      tint: 'green',
      hue: 150,
      tagline: 'council member',
      description: `Builds on ${T.councilDays} of the last ${T.councilWindow} days.`,
      hat: 'graduation cap',
      phrase: "part of Worca's Council",
      recap: `been active on ${T.councilDays} of the last ${T.councilWindow} days`,
    },
    [
      item({
        id: 'councilDays',
        label: `Any ${T.councilDays} active days in the last ${T.councilWindow}`,
        hint: 'A day counts when a real run of yours finished. Weekends count too.',
        href: '#new',
        openLabel: 'Open New pipeline',
        threshold: T.councilDays,
        unit: ['active day', 'active days'],
      }),
    ],
  ),
]);
