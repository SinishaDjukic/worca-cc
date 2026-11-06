// Worca levels ladder: the four usage levels and the actions that move a person
// up. Pure constants, no Node-only imports (served to the browser at /src/shared).

export const WORCA_THRESHOLDS = Object.freeze({
  parallelFeatures: 2,
  addonsInUse: 2,
  scheduledRuns: 5,
  metricsDays: 3,
});

const SIMPLE_HIDDEN_NOTE = 'Not in your sidebar in Simple mode; this link opens it.';

function action(id, label, hint, href, threshold = null) {
  return Object.freeze({ id, label, hint, href, threshold });
}

function level(index, key, name, description, actions) {
  return Object.freeze({
    index,
    key,
    name,
    description,
    avatar: `/assets/worca-levels/${key}.svg`,
    actions: Object.freeze(actions),
  });
}

export const WORCA_LEVELS = Object.freeze([
  level(1, 'calf', 'Calf', 'You are just looking around Worca.', []),
  level(
    2,
    'swimmer',
    'Swimmer',
    'You have started setting up and sending work through Worca.',
    [
      action(
        'gettingStarted',
        'Finish Getting started',
        'Getting started. Walks you through your first setup.',
        '#getting-started',
      ),
      action(
        'firstRequirement',
        'Write your first requirement',
        'Requirements. Describe what you want built.',
        '#requirements',
      ),
      action(
        'firstFeatureDone',
        'Get your first feature done',
        'Requirements. Start a requirement and let it finish.',
        '#requirements',
      ),
    ],
  ),
  level(
    3,
    'hunter',
    'Hunter',
    'You are using the parts of Worca that save you repeat work.',
    [
      action(
        'addonInstalled',
        'Install an add-on',
        `Marketplace. ${SIMPLE_HIDDEN_NOTE}`,
        '#marketplace',
      ),
      action(
        'spaceSetUp',
        'Set up a space',
        `Workspaces. ${SIMPLE_HIDDEN_NOTE}`,
        '#workspaces',
      ),
      action(
        'scheduleCreated',
        'Create a schedule',
        `Schedules. ${SIMPLE_HIDDEN_NOTE}`,
        '#schedules',
      ),
      action(
        'statsViewed',
        'Look at your stats',
        `Stats. ${SIMPLE_HIDDEN_NOTE}`,
        '#stats',
      ),
    ],
  ),
  level(
    4,
    'pod-leader',
    'Pod Leader',
    'Worca runs a lot of your work in parallel, on a schedule, and you track it.',
    [
      action(
        'parallelFeatures',
        'Run features in parallel',
        `Runs. Have ${WORCA_THRESHOLDS.parallelFeatures} or more running at once.`,
        '#runs',
        WORCA_THRESHOLDS.parallelFeatures,
      ),
      action(
        'addonsInUse',
        'Use several add-ons',
        `Marketplace. ${SIMPLE_HIDDEN_NOTE}`,
        '#marketplace',
        WORCA_THRESHOLDS.addonsInUse,
      ),
      action(
        'scheduledRuns',
        'Let schedules do the work',
        `Schedules. ${SIMPLE_HIDDEN_NOTE}`,
        '#schedules',
        WORCA_THRESHOLDS.scheduledRuns,
      ),
      action(
        'metricsRegular',
        'Check your stats regularly',
        `Stats. ${SIMPLE_HIDDEN_NOTE}`,
        '#stats',
        WORCA_THRESHOLDS.metricsDays,
      ),
    ],
  ),
]);
