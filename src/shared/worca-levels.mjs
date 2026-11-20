// Worca Levels ladder: the five usage levels and the actions that move a person
// up. Pure constants, no Node-only imports (served to the browser at /src/shared).

export const WORCA_LEVEL_COUNT = 5;

export const WORCA_THRESHOLDS = Object.freeze({
  parallelFeatures: 2,
  addonsAtOnce: 2,
  teamMetricsRuns: 10,
  councilDays: 30,
  councilDailyRuns: 2,
});

const SCHEDULES_HINT =
  'Schedules. Not in your sidebar in Simple mode; the button opens it.';

function action({ id, label, hint, href, openLabel, threshold }) {
  return Object.freeze({ id, label, hint, href, openLabel, threshold });
}

function level(index, key, name, copy, actions) {
  return Object.freeze({
    index,
    key,
    name,
    ...copy,
    avatar: `/assets/worca-levels/${key}.svg`,
    actions: Object.freeze(actions.map(action)),
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
      tagline: 'new to orchestration',
      description:
        'New to orchestration. Everyone begins here, exploring a single agent pipeline.',
      hat: 'beanie',
      phrase: 'Curious',
      recap: null,
    },
    [],
  ),
  level(
    2,
    'runner',
    'Runner',
    {
      tint: 'teal',
      hue: 195,
      tagline: 'runs a pipeline end to end',
      description:
        'Orchestrates one pipeline: Getting started, a first requirement, a feature run to the end.',
      hat: 'W headband',
      phrase: 'a Runner',
      recap:
        'finished Getting started, wrote a requirement and ran a feature to the end',
    },
    [
      {
        id: 'gettingStarted',
        label: 'Finish Getting started',
        hint: 'Nine short steps. Starts with connecting Claude Code.',
        href: '#getting-started',
        openLabel: 'Open Getting started',
      },
      {
        id: 'firstRequirement',
        label: 'Write your first requirement',
        hint: 'Opens Requirements.',
        href: '#requirements',
        openLabel: 'Open Requirements',
      },
      {
        id: 'firstFeatureDone',
        label: 'Run a feature to the end',
        hint: 'Start a requirement and let it finish.',
        href: '#requirements',
        openLabel: 'Open Requirements',
      },
    ],
  ),
  level(
    3,
    'hooked',
    'Hooked',
    {
      tint: 'purple',
      hue: 295,
      tagline: 'extends the pipeline',
      description:
        'Extends orchestration: an add-on, a space, a schedule, Statistics.',
      hat: 'flat cap',
      phrase: 'Hooked',
      recap:
        'added an add-on, set up a space and a schedule, and opened Statistics',
    },
    [
      {
        id: 'addonInstalled',
        label: 'Install an add-on from the Marketplace',
        hint: 'Marketplace, under Add-ons.',
        href: '#marketplace',
        openLabel: 'Open Marketplace',
      },
      {
        id: 'spaceSetUp',
        label: 'Set up and organise a space',
        hint: 'Workspaces, under Manage.',
        href: '#workspaces',
        openLabel: 'Open Workspaces',
      },
      {
        id: 'scheduleCreated',
        label: 'Set up a schedule',
        hint: SCHEDULES_HINT,
        href: '#schedules',
        openLabel: 'Open Schedules',
      },
      {
        id: 'statsViewed',
        label: 'Look at Statistics',
        hint: 'Statistics shows how your builds are going.',
        href: '#stats',
        openLabel: 'Open Statistics',
      },
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
      description:
        'Orchestrates the whole pod: parallel features, several add-ons, repeating schedules, Team metrics.',
      hat: 'black W cap',
      phrase: 'a WorcaHolic',
      recap:
        'ran 2 features at once, added 2 add-ons, set up a repeating schedule and saw 10 runs in Team metrics',
    },
    [
      {
        id: 'parallelFeatures',
        label: `Run ${WORCA_THRESHOLDS.parallelFeatures} features at the same time`,
        hint: 'Both have to finish successfully.',
        href: '#new',
        openLabel: 'Open New pipeline',
        threshold: WORCA_THRESHOLDS.parallelFeatures,
      },
      {
        id: 'addonsAtOnce',
        label: `Add ${WORCA_THRESHOLDS.addonsAtOnce} or more add-ons`,
        hint: `Have ${WORCA_THRESHOLDS.addonsAtOnce} or more installed at the same time.`,
        href: '#marketplace',
        openLabel: 'Open Marketplace',
        threshold: WORCA_THRESHOLDS.addonsAtOnce,
      },
      {
        id: 'repeatingSchedule',
        label: 'Set up a repeating schedule',
        hint: SCHEDULES_HINT,
        href: '#schedules',
        openLabel: 'Open Schedules',
      },
      {
        id: 'teamMetrics',
        label: `See ${WORCA_THRESHOLDS.teamMetricsRuns} of your runs in Team metrics`,
        hint: `Install Team policy (you or anyone on your team), get ${WORCA_THRESHOLDS.teamMetricsRuns} of your finished runs into Team metrics, then open Team metrics. Part of Expert mode; the button opens it.`,
        href: '#team-metrics',
        openLabel: 'Open Team metrics',
        threshold: WORCA_THRESHOLDS.teamMetricsRuns,
      },
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
      description: 'Finishes 2 or more workflows a day, 30 days in a row.',
      hat: 'graduation cap',
      phrase: "part of Worca's Council",
      recap: 'finished 2 or more workflows a day for 30 days in a row',
    },
    [
      {
        id: 'councilStreak',
        label: `Finish ${WORCA_THRESHOLDS.councilDailyRuns} workflows a day, ${WORCA_THRESHOLDS.councilDays} days in a row`,
        hint: `Weekends count too. A day with fewer than ${WORCA_THRESHOLDS.councilDailyRuns} finished successfully starts the count again.`,
        href: '#new',
        openLabel: 'Open New pipeline',
        threshold: WORCA_THRESHOLDS.councilDays,
      },
    ],
  ),
]);
