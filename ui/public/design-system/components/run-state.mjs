// The states of a run, and what each one offers (docs/rail/logic.md). The one source of a state's word, colour and one
// action, so a page (the run page, a group, Pulse's Now, Chat's list later) cannot turn Paused into Ready by drawing its
// own. Pure: no DOM, no mock data. Names in the words (`{pr}`, `{base}`, `{branch}`…) come from the run through `ctx`.

/** Fills a text's {names} from the run's facts. */
export const fill = (text, ctx = {}) => String(text).replace(/\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined ? ctx[k] : m));

/** The statuses a run can move its ticket to, in each tracker's own words. */
export const TRACKER_MOVES = { jira: ['In review', 'Resolved', 'Done'], azure: ['Resolved', 'Closed'], github: ['closed'] };

const STATES = {
  starting: {
    word: "Starting",
    dot: "is-peach is-pulse"
  },
  working: {
    word: "Working",
    dot: "is-peach is-pulse"
  },
  question: {
    word: "Needs you",
    sym: "q",
    action: {
      label: "Send answer",
      icon: "check",
      primary: true,
      items: [
        "Use the default answer"
      ]
    }
  },
  paused: {
    word: "Paused",
    dot: "is-grey",
    action: {
      label: "Resume now",
      icon: "play",
      primary: false,
      items: [
        "Don’t resume at 14:00",
        "Resume on Codex",
        "Switch model…",
        "Resume at…"
      ]
    }
  },
  failed: {
    word: "Failed",
    sym: "x",
    action: {
      label: "Restart Build",
      icon: "refresh",
      primary: true,
      items: [
        "Report this run",
        "Start a new run"
      ]
    }
  },
  ready: {
    word: "Ready",
    dot: "is-green",
    action: {
      label: "Create PR",
      icon: "prc",
      primary: true,
      items: [
        "Publish branch",
        "How to merge",
        "Push main",
        "Discard"
      ]
    }
  },
  checks: {
    word: "In review",
    dot: "is-peach is-pulse",
    action: {
      label: "View PR",
      icon: "pr",
      primary: false,
      items: [
        "Watch",
        "Copy PR link"
      ]
    }
  },
  failing: {
    word: "Needs you",
    dot: "is-amber",
    action: {
      label: "Fix checks",
      icon: "refresh",
      primary: true,
      items: [
        "Re-run checks",
        "View PR",
        "Copy PR link"
      ]
    }
  },
  conflicts: {
    word: "Needs you",
    dot: "is-amber",
    action: {
      label: "Fix conflicts",
      icon: "refresh",
      primary: true,
      items: [
        "Update branch",
        "Resolve in a terminal",
        "Re-check",
        "View PR",
        "Copy PR link"
      ]
    }
  },
  approved: {
    word: "Ready to merge",
    dot: "is-green",
    action: {
      label: "Merge PR",
      icon: "merge",
      primary: true,
      items: [
        "View PR",
        "Watch",
        "Copy PR link"
      ]
    }
  },
  labelled: {
    word: "Ready",
    dot: "is-green",
    action: {
      label: "Create PR",
      icon: "prc",
      primary: true,
      items: [
        "Publish branch",
        "How to merge",
        "Push main",
        "Discard"
      ]
    }
  },
  merged: {
    word: "Merged",
    dot: "is-violet",
    action: {
      label: "View PR",
      icon: "merge",
      primary: false,
      items: []
    }
  },
  scheduled: {
    word: "Waiting",
    dot: "is-grey-ring",
    action: {
      label: "Start now",
      icon: "play",
      primary: false,
      items: [
        "Cancel"
      ]
    }
  },
  gate: {
    word: "Needs you",
    sym: "q",
    action: {
      label: "Accept as is",
      icon: "check",
      primary: true,
      items: [
        "Run another cycle",
        "Stop"
      ]
    }
  },
  capped: {
    word: "Paused",
    dot: "is-grey",
    action: {
      label: "Continue without cap",
      icon: "play",
      primary: false,
      items: [
        "Raise the cap",
        "Open budget settings"
      ]
    }
  },
  kept: {
    word: "Needs you",
    dot: "is-amber",
    action: {
      label: "Apply to branch",
      icon: "check",
      primary: true,
      items: [
        "Download patch",
        "Commit it yourself",
        "Discard"
      ]
    }
  },
  archived: {
    word: "Archived",
    dot: "is-grey"
  },
  stopped: {
    word: "Stopped",
    dot: "is-grey",
    action: {
      label: "Start a new run",
      icon: "play",
      primary: false,
      items: [
        "Restart Build"
      ]
    }
  },
  discarded: {
    word: "Discarded",
    dot: "is-grey",
    action: {
      label: "Start a new run",
      icon: "play",
      primary: false,
      items: []
    }
  },
  push: {
    word: "Ready",
    dot: "is-green",
    action: {
      label: "Push main",
      icon: "up",
      primary: true,
      items: [
        "Create PR instead",
        "Discard"
      ]
    }
  },
  source: {
    word: "Working",
    dot: "is-peach is-pulse"
  },
  "source-ready": {
    word: "Ready",
    dot: "is-green",
    action: {
      label: "Push",
      icon: "up",
      primary: true,
      items: [
        "Discard"
      ]
    }
  },
  "source-unmerged": {
    word: "Needs you",
    dot: "is-amber",
    action: {
      label: "How to merge",
      icon: "merge",
      primary: true,
      items: [
        "Create PR instead",
        "Discard"
      ]
    }
  },
  folder: {
    word: "Ready",
    dot: "is-green",
    action: {
      label: "Apply to folder",
      icon: "folder",
      primary: true,
      items: [
        "Open the copy",
        "Discard"
      ]
    }
  },
  applied: {
    word: "Applied",
    dot: "is-violet",
    action: {
      label: "Open the folder",
      icon: "folder",
      primary: false,
      items: []
    }
  },
  workspace: {
    word: "Needs you",
    dot: "is-amber",
    action: {
      label: "Fix conflicts",
      icon: "refresh",
      primary: true,
      items: [
        "Copy PR links"
      ]
    }
  },
  noproject: {
    word: "Finished",
    dot: "is-green"
  },
  clarify: {
    word: "Needs you",
    sym: "q",
    action: {
      label: "Send answer",
      icon: "check",
      primary: true,
      items: [
        "Use defaults"
      ]
    }
  },
  plan: {
    word: "Needs you",
    sym: "q",
    action: {
      label: "Approve and build",
      icon: "check",
      primary: true,
      items: [
        "Ask for changes",
        "Full plan"
      ]
    }
  },
  outline: {
    word: "Needs you",
    sym: "q",
    action: {
      label: "Approve {n} runs",
      icon: "check",
      primary: true,
      items: [
        "Ask me before each run",
        "Don’t split",
        "Ask for changes"
      ]
    }
  },
  slice: {
    word: "Working",
    dot: "is-peach is-pulse"
  },
  feature: {
    word: "Working",
    dot: "is-peach is-pulse"
  },
  featureready: {
    word: "Ready",
    dot: "is-green",
    action: {
      label: "Create {n} PRs",
      icon: "prc",
      primary: true,
      items: [
        "Check out the whole feature",
        "Discard"
      ]
    }
  },
  featureone: {
    word: "Ready",
    dot: "is-green",
    action: {
      label: "Create PR",
      icon: "prc",
      primary: true,
      items: [
        "Check out the whole feature",
        "Discard"
      ]
    }
  },
  featureblocked: {
    word: "Ready",
    dot: "is-green",
    action: {
      label: "Create {n} PRs",
      icon: "prc",
      primary: true,
      items: [
        "Check out the whole feature",
        "Discard"
      ]
    }
  },
  chain: {
    word: "Needs you",
    dot: "is-amber",
    action: {
      label: "Fix checks on {pr3}",
      icon: "refresh",
      primary: true,
      items: [
        "Merge {pr}",
        "View PRs",
        "Watch PRs",
        "Copy PR links"
      ]
    }
  }
};

// The rest of a run's states (docs/rail/thing-page.md: The run page's cases). `off` names a step that is shown but
// cannot be taken now, with why; a word a git host renames sits in HOST_WORD.
const off = (label, icon, primary, items, offs) => ({ label, icon, primary, items, off: offs });
const act = (label, icon, primary, items = []) => ({ label, icon, primary, items });
const CAP_OFF = { 'Resume at…': 'A cost cap does not lift with time: raise it or go on without it' };
const VIEW_ITEMS = ['Watch', 'Copy PR link'];
Object.assign(STATES, {
  // Paused, and why. A usage limit offers the other engine; nothing else does.
  'paused-limit': { word: 'Paused', dot: 'is-grey', action: act('Resume at 14:00', 'play', true, ['Resume now', 'Resume on Codex', 'Switch model…', 'Resume at…']) },
  'paused-reset': { word: 'Paused', dot: 'is-grey', action: act('Resume now', 'play', true, ['Resume on Codex', 'Switch model…', 'Resume at…']) },
  'paused-missed': { word: 'Paused', dot: 'is-grey', action: act('Resume now', 'play', true, ['Don’t resume at 14:00', 'Resume on Codex', 'Switch model…', 'Resume at…']) },
  'paused-budget': { word: 'Paused', dot: 'is-grey', action: act('Open Settings', 'play', false) },
  'paused-team': { word: 'Paused', dot: 'is-grey', action: act('Continue past team cap', 'play', false, ['Open Team policy']) },
  'paused-reason': { word: 'Paused', dot: 'is-grey', action: act('Resume now', 'play', false, ['Switch model…', 'Resume at…']) },
  interrupted: { word: 'Paused', dot: 'is-grey', action: act('Resume now', 'play', true, ['Archive']) },
  'interrupted-dead': { word: 'Paused', dot: 'is-grey', action: act('Start a new run', 'play', false, ['Archive']) },
  // Live, and in trouble
  network: { word: 'Working', dot: 'is-peach is-pulse' },
  recovery: { word: 'Needs you', sym: 'q', action: act('Retry', 'refresh', true, ['Pause', 'Stop']) },
  // Tickets: a scheduled run before it is a run
  'ticket-missed': { word: 'Waiting', dot: 'is-grey-ring', action: act('Start now', 'play', true, ['Cancel']) },
  'ticket-firing': { word: 'Starting', dot: 'is-peach is-pulse' },
  'ticket-failed': { word: 'Failed', sym: 'x', action: act('Start now', 'play', true, ['Cancel']) },
  'ticket-ended': { word: 'Stopped', dot: 'is-grey', action: act('Start a new run', 'play', false) },
  // A pull request's own states
  'pr-draft': { word: 'In review', dot: 'is-grey', action: act('Mark ready for review', 'pr', true, ['View PR', ...VIEW_ITEMS]) },
  'pr-changes': { word: 'Needs you', dot: 'is-amber', action: act('View PR', 'pr', true, ['Ask for changes', ...VIEW_ITEMS]) },
  'pr-fixing': { word: 'In review', dot: 'is-peach is-pulse', action: act('View PR', 'pr', false, ['View fix run', ...VIEW_ITEMS]) },
  'pr-closed': { word: 'Closed', dot: 'is-grey', hostWord: true, action: act('Create PR again', 'prc', true, ['View PR', 'Discard']) },
  'pr-behind': { word: 'In review', dot: 'is-amber', action: act('Update branch', 'refresh', true, ['View PR', ...VIEW_ITEMS]) },
  'pr-blocked': { word: 'In review', dot: 'is-amber', action: act('View PR', 'pr', false, VIEW_ITEMS) },
  'watch-stopped': { word: 'Needs you', dot: 'is-amber', action: off('Fix conflicts', 'refresh', true, ['Ask for changes', 'View PR', 'Copy PR link'], { 'Ask for changes': 'Ask for changes from the run’s chat' }) },
  round: { word: 'In review', dot: 'is-peach is-pulse', action: act('View PR', 'pr', false, ['Copy PR link']) },
  'in-base': { word: 'Merged', dot: 'is-violet' },
  pushed: { word: 'Merged', dot: 'is-violet' },
  diverged: { word: 'Needs you', dot: 'is-amber', action: off('Push', 'up', true, ['Re-check', 'How to merge', 'Discard'], { Push: 'The branch and its remote have diverged: pull or rebase, then push' }) },
  // A failed or stopped run that still holds work
  'failed-kept': { word: 'Failed', sym: 'x', action: act('Apply to branch', 'check', true, ['Report this run', 'Download patch', 'Commit it yourself', 'Discard']) },
  'failed-kept-wait': { word: 'Failed', sym: 'x', action: act('Report this run', 'alert', false, ['Start a new run']) },
  'failed-folder': { word: 'Failed', sym: 'x', action: act('Apply to folder', 'folder', true, ['Report this run', 'Open the copy', 'Discard']) },
  'stopped-folder': { word: 'Stopped', dot: 'is-grey', action: act('Apply to folder', 'folder', true, ['Open the copy', 'Discard']) },
  deleted: { word: 'Deleted', dot: 'is-grey' },
  // Before Build: what the plan answers to, and a workflow Worca proposes
  requirements: { word: 'Needs you', sym: 'q', action: act('Agree and plan', 'check', true, ['Ask for changes']) },
  auto: { word: 'Needs you', sym: 'q', action: act('Accept', 'check', true, ['Review the workflow', 'Revise']) },
  // Ready, with its requirements still to mark
  reqs: { word: 'Ready', dot: 'is-green', action: act('Create PR', 'prc', true, ['Publish branch', 'How to merge', 'Discard']) },
  // A group, read from the run that holds it up
  'group-failed': { word: 'Failed', sym: 'x', action: act('Open run {k}', 'alert', true, ['Re-plan the rest', 'Cancel the rest']) },
  'group-paused': { word: 'Paused', dot: 'is-grey', action: act('Resume', 'play', true, ['Open run {k}', 'Re-plan the rest', 'Cancel the rest']) },
  'group-needs': { word: 'Needs you', sym: 'q', action: act('Open run {k}', 'question', true, ['Re-plan the rest', 'Cancel the rest']) },
  'group-stopped': { word: 'Stopped', dot: 'is-grey', action: act('Resume', 'play', true, ['Open run {k}', 'Re-plan the rest', 'Cancel the rest']) },
  'group-asks': { word: 'Needs you', sym: 'q', action: act('Start run {k}', 'play', true, ['Re-plan the rest', 'Cancel the rest']) },
  'ship-declined': { word: 'Ready', dot: 'is-green', action: act('Create {n} PRs', 'prc', true, ['Check out the whole feature', 'Discard']) },
  'ship-applied': { word: 'Applied', dot: 'is-violet', action: act('View PR', 'merge', false, ['Ask for changes', 'Copy PR link']) },
  'workspace-partly': { word: 'In review', dot: 'is-peach is-pulse', action: act('Create PR', 'prc', true, ['View PRs', 'Copy PR links']) },
});
STATES.capped.action = off('Continue without cap', 'play', false, ['Raise the cap', 'Open budget settings', 'Resume at…'], CAP_OFF);
STATES.plan.action.items = ['Ask for changes', 'Full plan', 'Fix all', 'Save to plans/', 'Open in New run', 'Stop'];
STATES.outline.action.items = ['Ask me before each run', 'Don’t split', 'Ask for changes', 'Fix all', 'Stop'];
STATES.featureready.action.items = ['Check out the whole feature', 'Not now', 'Ask for changes', 'Discard'];

// What a git host calls a pull request closed without merging.
const HOST_WORD = { github: 'Closed', azure: 'Abandoned', bitbucket: 'Declined' };

// An action a mode holds back (docs/ui-levels.md); a label not here shows in every mode.
const ACTION_LEVEL = { 'Open in New run': 'advanced', Revise: 'advanced', Watch: 'advanced' };
/** The interface mode an action needs. */
export const actionLevel = (label) => ACTION_LEVEL[label] || 'simple';

const HELP = {
  "Send answer": "Sends the answer you picked or wrote; the run goes on",
  "Use the default answer": "Goes on with what Worca would pick",
  "Use defaults": "Skips the questions; the planner picks sensible answers",
  Resume: "Starts again from the step it paused in",
  "Resume when the limit resets": "Waits for the limit, then goes on by itself",
  Stop: "Ends the run; the branch and changes stay",
  "Restart Build": "Runs Build again with what Plan already made",
  "Report this run": "Sends the logs and a note to the Worca team",
  "Start a new run": "A fresh run with the same task",
  "Create PR": "Opens a pull request from this run’s branch into {base}",
  "Create 3 PRs": "Opens one PR per run, each into the one before",
  "Create 2 PRs": "Opens one PR per run, the second into the first",
  "Try it": "Checks the branch out locally so you can run it; in a stack, each run’s branch holds the runs before it",
  "Check out the whole feature": "Checks out the top of the stack, which holds every run",
  "Open the copy": "Opens a terminal in the copy the run changed",
  "Push main": "Pushes the commits straight to origin/main, no PR",
  Push: "Pushes the source branch, with the run’s work merged back, to origin; no PR",
  Discard: "Throws the changes away; the run stays in history",
  "View PR": "Opens the pull request on GitHub",
  Watch: "Worca follows the PR and fixes failing checks for you",
  "Copy PR link": "Copies the PR’s address",
  "Fix checks": "Starts a short run that fixes the failing checks",
  "Re-run checks": "Runs the checks on {pr} again; nothing in the code changes",
  "Fix conflicts": "Starts a short run that merges {base} in and resolves the conflicts",
  "Merge PR": "Merges the PR into {base} on GitHub",
  "Merge {pr}": "Merges {pr} into {base}; {pr2} then points at {base}",
  "Fix checks on {pr3}": "Starts a short run that fixes {pr3}’s failing unit and e2e checks",
  "Resume now": "Goes on now instead of waiting for the limit to reset",
  Pause: "Stops at once; Resume starts the current step again",
  "Pause after this step": "Lets the current step finish, then pauses",
  "Stop the run": "Ends it; the branch and changes stay",
  "Open the folder": "Opens {folder} in your file manager",
  "Don’t resume at 14:00": "Cancels the scheduled resume; Resume stays here",
  "Resume on Codex": "Goes on now on another engine, from the same step",
  "Switch model…": "Pick another model, then resume",
  "Resume at…": "Pick a time to resume",
  "Publish branch": "Pushes the branch to origin without opening a PR",
  "How to merge": "Shows the git commands to merge it yourself",
  "Update branch": "Merges {base} into the branch; it merges cleanly",
  "Resolve in a terminal": "Opens a terminal in the worktree with the conflicts",
  "Re-check": "Checks again whether the branch is up to date with {base}",
  "Start now": "Starts it now instead of waiting",
  Cancel: "Deletes the scheduled run",
  "Accept as is": "Takes the review as it is and goes on to the manual tests",
  "Run another cycle": "One more Build and Review round",
  "Continue without cap": "Goes on with no cost cap for this run",
  "Raise the cap": "Sets a new cap for this run, then goes on",
  "Open budget settings": "Opens Settings › Runs › Budget",
  "Apply to branch": "Commits the kept work to the branch, skipping the failed hook",
  "Download patch": "Saves the kept work as a .patch file",
  "Commit it yourself": "Shows the commands to commit it by hand",
  "View PRs": "Opens the pull requests on GitHub",
  "Watch PRs": "Worca follows all three PRs",
  "Copy PR links": "Copies every PR’s address",
  "Create PR instead": "Opens a PR rather than pushing to main",
  "Apply to folder": "Copies the changed files into the folder",
  "Approve and build": "Accepts the plan and starts Build",
  "Ask for changes": "Tells the planner what to change, then it plans again",
  "Full plan": "Opens the whole plan to read",
  "Approve 3 runs": "Creates the feature: three runs that build one after another",
  "Ask me before each run": "Stops for your OK before each later run starts",
  "Don’t split": "Builds it as one run and one PR"
};

Object.assign(HELP, {
  'Resume at 14:00': 'Waits for the limit to reset, then goes on by itself; you can cancel it',
  'Resume now': 'Goes on now from the step it paused in',
  'Open Settings': 'The total budget is a setting: opens Settings › Runs › Budget',
  'Continue past team cap': 'Goes on over your team’s cap; the reason you give is recorded',
  'Open Team policy': 'Opens Settings › Team › Policy, where the cap is set',
  Archive: 'Removes the branch, worktree and logs; the remote branch and PR stay',
  Retry: 'Tries the step again now',
  'Mark ready for review': 'Takes {pr} out of draft; reviewers are asked',
  'View fix run': 'Opens the short run that is fixing {pr}',
  'Create PR again': 'Opens a new pull request from this run’s branch into {base}',
  'Agree and plan': 'Agrees the requirements, with your answer, and starts the plan',
  Accept: 'Runs the workflow Worca proposes',
  'Review the workflow': 'Shows the proposed workflow at full size',
  Revise: 'Tells Worca what to change in the workflow',
  'Fix all': 'Worca fixes every open issue in the plan or the cut, then shows it again',
  'Save to plans/': 'Writes this plan to plans/ in the project',
  'Open in New run': 'Starts a New run with this plan already in it',
  'Not now': 'Leaves it unshipped; you can ship it from here later',
  'Re-plan the rest': 'Cancels the waiting runs and plans what is left from the last finished run',
  'Cancel the rest': 'Cancels the runs that have not started; a running run keeps running',
  'Open run {k}': 'Opens the run that holds up the rest',
  'Start run {k}': 'Your OK: the next run starts',
  'Create {n} PRs': 'Opens one PR per run, each into the one before',
  'Approve {n} runs': 'Creates the feature: these runs build one after another',
});

const FLOW = {
  starting: {
    next: "working"
  },
  working: {
    next: "ready"
  },
  question: {
    "Send answer": {
      to: "working",
      say: "Answer sent; Review goes on"
    },
    "Use the default answer": {
      to: "working",
      say: "Worca’s pick sent; Review goes on"
    }
  },
  paused: {
    "Resume now": {
      to: "working",
      say: "Resumed from Implementation"
    },
    "Don’t resume at 14:00": {
      say: "The 14:00 resume is cancelled"
    },
    "Resume on Codex": {
      to: "working",
      say: "Resumed on Codex"
    },
    "Switch model…": {
      say: "Model picker: Opus 5.5, Sonnet 5.5, Haiku 5.5"
    },
    "Resume at…": {
      say: "Time picker: resume at a time you choose"
    }
  },
  scheduled: {
    "Start now": {
      to: "starting",
      say: "Started now; it no longer waits"
    },
    Cancel: {
      to: "discarded",
      confirm: "Delete this scheduled run?"
    }
  },
  gate: {
    "Accept as is": {
      to: "working",
      say: "Review accepted; manual tests start"
    },
    "Run another cycle": {
      to: "working",
      say: "One more Build and Review round"
    },
    Stop: {
      to: "stopped",
      confirm: "Stop the run? The branch and changes stay."
    }
  },
  capped: {
    "Continue without cap": {
      to: "working",
      confirm: "Go on with no cost cap for this run?"
    },
    "Raise the cap": {
      say: "Cap raised to $180; the run goes on"
    },
    "Open budget settings": {
      say: "Opens Settings › Runs › Budget"
    }
  },
  kept: {
    "Apply to branch": {
      to: "ready",
      say: "Committed to the branch"
    },
    "Download patch": {
      say: "Downloading run.patch"
    },
    "Commit it yourself": {
      say: "Commands: cd the worktree, git add -A, git commit --no-verify"
    },
    Discard: {
      to: "discarded",
      confirm: "Discard the kept work? A patch is saved first."
    }
  },
  archived: {},
  failed: {
    "Restart Build": {
      to: "working",
      say: "Build runs again with what Plan made"
    },
    "Report this run": {
      say: "Logs and a note sent to the Worca team"
    },
    "Start a new run": {
      to: "starting",
      say: "A new run with the same task"
    }
  },
  ready: {
    "Create PR": {
      to: "checks",
      say: "Opened {pr} into {base}",
      dialog: "pr"
    },
    "Publish branch": {
      say: "Pushed the branch to origin; no PR"
    },
    "How to merge": {
      say: "git switch {base} && git merge {branch}"
    },
    "Try it": {
      say: "Copied: git switch {branch}"
    },
    "Push main": {
      to: "merged",
      say: "Pushed to origin/main"
    },
    Discard: {
      to: "discarded",
      confirm: "Discard the changes? The run stays in history."
    }
  },
  labelled: {
    "Create PR": {
      to: "checks",
      say: "Opened {pr} into {base}",
      dialog: "pr"
    },
    "Publish branch": {
      say: "Pushed the branch to origin; no PR"
    },
    "How to merge": {
      say: "git switch {base} && git merge {branch}"
    },
    "Try it": {
      say: "Copied: git switch {branch}"
    },
    "Push main": {
      to: "merged",
      say: "Pushed to origin/main"
    },
    Discard: {
      to: "discarded",
      confirm: "Discard the changes? The run stays in history."
    }
  },
  checks: {
    "View PR": {
      say: "Opens {pr} on GitHub"
    },
    Watch: {
      say: "Worca watches {pr} and fixes failing checks"
    },
    "Copy PR link": {
      say: "Copied the link to {pr}"
    },
    next: "failing"
  },
  failing: {
    "Fix checks": {
      to: "checks",
      say: "A short run fixed unit and e2e; checks run again",
      confirm: "Fix the 2 failing checks on {pr}? Worca pushes the fix to the PR."
    },
    "Re-run checks": {
      to: "checks",
      say: "Checks on {pr} run again"
    },
    "View PR": {
      say: "Opens {pr} on GitHub"
    },
    "Copy PR link": {
      say: "Copied the link to {pr}"
    },
    next: "conflicts"
  },
  conflicts: {
    "Fix conflicts": {
      to: "checks",
      say: "{base} merged in, 2 conflicts resolved; checks run again"
    },
    "Update branch": {
      say: "{base} does not merge cleanly: 2 files conflict. Use Fix conflicts"
    },
    "Resolve in a terminal": {
      say: "Opens a terminal in the worktree"
    },
    "Re-check": {
      say: "Still 2 conflicts with {base}"
    },
    "View PR": {
      say: "Opens {pr} on GitHub"
    },
    "Copy PR link": {
      say: "Copied the link to {pr}"
    },
    next: "approved"
  },
  approved: {
    "Merge PR": {
      to: "merged",
      confirm: "Merge {pr} into {base}?"
    },
    "View PR": {
      say: "Opens {pr} on GitHub"
    },
    Watch: {
      say: "Worca watches {pr}"
    },
    "Copy PR link": {
      say: "Copied the link to {pr}"
    }
  },
  merged: {
    "View PR": {
      say: "Opens the merged {pr} on GitHub"
    }
  },
  stopped: {
    "Start a new run": {
      to: "starting",
      say: "A new run with the same task"
    },
    "Restart Build": {
      to: "working",
      say: "Build runs again from where it stopped"
    }
  },
  discarded: {
    "Start a new run": {
      to: "starting",
      say: "A new run with the same task"
    }
  },
  push: {
    "Push main": {
      to: "merged",
      say: "Pushed to origin/main"
    },
    "Create PR instead": {
      to: "checks",
      say: "Opened {pr} into {base}",
      dialog: "pr"
    },
    Discard: {
      to: "discarded",
      confirm: "Discard the changes? The run stays in history."
    }
  },
  "source-ready": {
    Push: {
      to: "merged",
      say: "Pushed to origin/{source}"
    },
    Discard: {
      to: "discarded",
      confirm: "Discard the changes? The run stays in history."
    }
  },
  "source-unmerged": {
    "How to merge": {
      say: "git switch {source} && git merge {hidden}"
    },
    "Create PR instead": {
      to: "checks",
      say: "Opened {pr} into {source}",
      dialog: "pr"
    },
    Discard: {
      to: "discarded",
      confirm: "Discard the changes? The run stays in history."
    }
  },
  folder: {
    "Apply to folder": {
      to: "applied",
      confirm: "Write 5 files into {folder}?"
    },
    "Open the copy": {
      say: "Opened the copy in a terminal"
    },
    Discard: {
      to: "discarded",
      confirm: "Discard the changes? The run stays in history."
    }
  },
  applied: {
    "Open the folder": {
      say: "Opens {folder}"
    }
  },
  workspace: {
    "Fix conflicts": {
      say: "A short run is fixing worca-docs #31"
    },
    "Copy PR links": {
      say: "Copied 3 PR links"
    }
  },
  clarify: {
    "Send answer": {
      to: "plan",
      say: "Answers sent; the planner writes the plan"
    },
    "Use defaults": {
      to: "plan",
      say: "Defaults used; the planner writes the plan"
    }
  },
  plan: {
    "Approve and build": {
      to: "working",
      say: "Plan approved; Build starts"
    },
    "Ask for changes": {
      say: "Sent to the planner; it plans again"
    },
    "Full plan": {
      say: "Opens plan.md"
    }
  },
  outline: {
    "Approve 3 runs": {
      to: "feature",
      say: "The feature has 3 runs; run 1 starts"
    },
    "Ask me before each run": {
      say: "Worca asks before runs 2 and 3 start"
    },
    "Don’t split": {
      to: "plan",
      say: "One run, one PR"
    },
    "Ask for changes": {
      say: "Sent to the planner; it cuts again"
    }
  },
  feature: {
    next: "featureready"
  },
  featureready: {
    "Create 3 PRs": {
      to: "chain",
      say: "Opened {pr}, {pr2} and {pr3}, each into the one before",
      dialog: "pr"
    },
    "Create PR": {
      to: "checks",
      say: "Opened {pr} for all 3 runs",
      dialog: "pr"
    },
    "Try it": {
      say: "Copied: git switch {groupBranch}"
    },
    Discard: {
      to: "discarded",
      confirm: "Discard all 3 runs’ changes?"
    }
  },
  featureone: {
    "Create PR": {
      to: "checks",
      say: "Opened {pr} for both runs",
      dialog: "pr"
    },
    "Create 2 PRs": {
      to: "chain",
      say: "Opened {pr} and {pr2}",
      dialog: "pr"
    },
    "Try it": {
      say: "Copied: git switch {groupBranch}"
    },
    Discard: {
      to: "discarded",
      confirm: "Discard both runs’ changes?"
    }
  },
  featureblocked: {
    "Create 3 PRs": {
      to: "chain",
      say: "Opened {pr}, {pr2} and {pr3}, each into the one before",
      dialog: "pr"
    },
    "Try it": {
      say: "Copied: git switch {groupBranch}"
    },
    Discard: {
      to: "discarded",
      confirm: "Discard all 3 runs’ changes?"
    }
  },
  chain: {
    "Fix checks on {pr3}": {
      say: "A short run is fixing {pr3}’s checks",
      confirm: "Fix the failing checks on {pr3}? Worca pushes the fix to the PR."
    },
    "Merge {pr}": {
      say: "Merged {pr} into {base}; {pr2} now points at {base}",
      confirm: "Merge {pr} into {base}?"
    },
    "View PRs": {
      say: "Opens {pr}, {pr2} and {pr3} on GitHub"
    },
    "Watch PRs": {
      say: "Worca watches all three PRs"
    },
    "Copy PR links": {
      say: "Copied 3 PR links"
    }
  }
};

const STOP = { to: 'stopped', confirm: 'Stop the run? The branch and changes stay.' };
const OPEN_PR = { 'View PR': { say: 'Opens {pr} on GitHub' }, 'Copy PR link': { say: 'Copied the link to {pr}' }, Watch: { say: 'Worca watches {pr} and fixes failing checks' } };
const DISCARD = { to: 'discarded', confirm: 'Discard the changes? The run stays in history.' };
const SWITCH = { dialog: 'model', to: 'working', say: 'Resumed on {value}; every remaining step runs there' };
const RESUME_AT = { dialog: 'resume-at', to: 'paused', say: 'Resumes at {value}' };
const ON_CODEX = { to: 'working', say: 'Resumed on Codex; every remaining step runs there' };
const RESUMED = { to: 'working', say: 'Resumed from Implementation' };
const ARCHIVE = { to: 'archived', confirm: 'Archive this run? It cannot be resumed after this. The local branch, worktree and logs are removed; the remote branch and any PR stay.' };
const NEW_RUN = { to: 'starting', say: 'A new run with the same task' };
const REPORT = { say: 'Logs and a note sent to the Worca team' };
const REPLAN = { to: 'outline', confirm: 'Re-plan the rest? The waiting runs are cancelled and Worca plans what is left from the last finished run.', say: 'The waiting runs are cancelled; Worca planned what is left' };
const CANCEL_REST = { say: 'The runs that had not started are cancelled; a running run keeps running', confirm: 'Cancel the rest? The runs that have not started are cancelled. A running run keeps running.' };
const RESUME_MEMBER = { member: 'slice', say: 'Resumed; run {k} goes on' };
const OPEN_MEMBER = { openMember: true, say: 'Opens run {k}' };
Object.assign(FLOW, {
  'paused-limit': { 'Resume at 14:00': { to: 'paused', say: 'Resumes at 14:00, when the limit has reset' }, 'Resume now': RESUMED, 'Resume on Codex': ON_CODEX, 'Switch model…': SWITCH, 'Resume at…': RESUME_AT },
  'paused-reset': { 'Resume now': RESUMED, 'Resume on Codex': ON_CODEX, 'Switch model…': SWITCH, 'Resume at…': RESUME_AT },
  'paused-missed': { 'Resume now': RESUMED, 'Don’t resume at 14:00': { to: 'paused-reset', say: 'The 14:00 resume is cancelled' }, 'Resume on Codex': ON_CODEX, 'Switch model…': SWITCH, 'Resume at…': RESUME_AT },
  'paused-budget': { 'Open Settings': { say: 'Goes to Settings › Runs › Budget; raise it there, then Resume' } },
  'paused-team': { 'Continue past team cap': { dialog: 'team-cap', to: 'working', say: 'Going on past the team cap; your reason is recorded' }, 'Open Team policy': { say: 'Goes to Settings › Team › Policy' } },
  'paused-reason': { 'Resume now': RESUMED, 'Switch model…': SWITCH, 'Resume at…': RESUME_AT },
  interrupted: { 'Resume now': RESUMED, Archive: ARCHIVE },
  'interrupted-dead': { 'Start a new run': NEW_RUN, Archive: ARCHIVE },
  network: { next: 'working', event: 'The network is back; the step retries' },
  recovery: { Retry: { to: 'working', say: 'Retrying Implementation' }, Pause: { to: 'paused-reason', say: 'Paused; Resume tries the step again' }, Stop: { to: 'stopped', confirm: 'Abort the run? The branch and changes stay.' } },
  'ticket-missed': { 'Start now': { to: 'starting', say: 'Started now' }, Cancel: { to: 'discarded', confirm: 'Delete this scheduled run?' } },
  'ticket-firing': { next: 'starting', event: 'The schedule fired; the run starts' },
  'ticket-failed': { 'Start now': { to: 'starting', say: 'Started now' }, Cancel: { to: 'discarded', confirm: 'Delete this scheduled run?' } },
  'ticket-ended': { 'Start a new run': NEW_RUN },
  'pr-draft': { 'Mark ready for review': { to: 'checks', confirm: 'Mark {pr} ready for review? Reviewers are asked.', say: '{pr} is ready for review' }, ...OPEN_PR },
  'pr-changes': { ...OPEN_PR, 'Ask for changes': { to: 'pr-fixing', say: 'A short run starts on what you asked' } },
  'pr-fixing': { ...OPEN_PR, 'View fix run': { say: 'Opens the fix run: Runs › this run’s rounds' }, next: 'checks', event: 'The fix is pushed; checks run again' },
  'pr-closed': { 'Create PR again': { to: 'checks', say: 'Opened {pr} into {base}', dialog: 'pr' }, 'View PR': { say: 'Opens the closed {pr} on GitHub' }, Discard: DISCARD },
  'pr-behind': { 'Update branch': { to: 'checks', say: '{base} merged in; checks run again' }, ...OPEN_PR },
  'pr-blocked': { ...OPEN_PR },
  'watch-stopped': { 'Fix conflicts': { to: 'checks', say: '{base} merged in, 2 conflicts resolved; checks run again' }, 'Ask for changes': { say: 'Ask for changes from the run’s chat' }, 'View PR': OPEN_PR['View PR'], 'Copy PR link': OPEN_PR['Copy PR link'] },
  round: { 'View PR': OPEN_PR['View PR'], 'Copy PR link': OPEN_PR['Copy PR link'], next: 'checks', event: 'The round pushed its fix; checks run again' },
  diverged: { Push: { to: 'merged', say: 'Pushed to origin' }, 'Re-check': { to: 'source-ready', say: 'In step with the remote again; Push is back' }, 'How to merge': { say: 'git pull --rebase origin {source}' }, Discard: DISCARD },
  'failed-kept': { 'Apply to branch': { to: 'failed', say: 'Committed to the branch; the failure stays' }, 'Report this run': REPORT, 'Download patch': { say: 'Downloading run.patch' }, 'Commit it yourself': { say: 'Commands: cd the worktree, git add -A, git commit --no-verify' }, Discard: { to: 'failed', confirm: 'Discard the kept work? A patch is saved first.', say: 'The kept work is gone; a patch was saved' } },
  'failed-kept-wait': { 'Report this run': REPORT, 'Start a new run': NEW_RUN },
  'failed-folder': { 'Apply to folder': { to: 'applied', confirm: 'Write 5 files into {folder}? The run failed, so check them first.' }, 'Report this run': REPORT, 'Open the copy': { say: 'Opened the copy in a terminal' }, Discard: DISCARD },
  'stopped-folder': { 'Apply to folder': { to: 'applied', confirm: 'Write 5 files into {folder}? The run stopped early, so check them first.' }, 'Open the copy': { say: 'Opened the copy in a terminal' }, Discard: DISCARD },
  requirements: { 'Agree and plan': { to: 'plan', say: 'Requirements agreed; the planner writes the plan' }, 'Ask for changes': { say: 'Sent; the requirements come back' } },
  auto: { Accept: { to: 'starting', say: 'Workflow accepted; the run starts' }, 'Review the workflow': { say: 'Opens the workflow' }, Revise: { say: 'Sent; Worca proposes again' } },
  reqs: { 'Create PR': { to: 'checks', say: 'Opened {pr} into {base}', dialog: 'pr' }, 'Publish branch': { say: 'Pushed the branch to origin; no PR' }, 'How to merge': { say: 'git switch {base} && git merge {branch}' }, Discard: DISCARD },
  'group-failed': { 'Open run {k}': OPEN_MEMBER, 'Re-plan the rest': REPLAN, 'Cancel the rest': CANCEL_REST },
  'group-paused': { Resume: RESUME_MEMBER, 'Open run {k}': OPEN_MEMBER, 'Re-plan the rest': REPLAN, 'Cancel the rest': CANCEL_REST },
  'group-needs': { 'Open run {k}': OPEN_MEMBER, 'Re-plan the rest': REPLAN, 'Cancel the rest': CANCEL_REST },
  'group-stopped': { Resume: RESUME_MEMBER, 'Open run {k}': OPEN_MEMBER, 'Re-plan the rest': REPLAN, 'Cancel the rest': CANCEL_REST },
  'group-asks': { 'Start run {k}': { to: 'feature', say: 'Run {k} starts' }, 'Re-plan the rest': REPLAN, 'Cancel the rest': CANCEL_REST },
  'ship-declined': { 'Create {n} PRs': { to: 'chain', say: 'Opened {pr}, {pr2} and {pr3}, each into the one before', dialog: 'pr' }, 'Create PR': { to: 'checks', say: 'Opened {pr} for all 3 runs', dialog: 'pr' }, 'Check out the whole feature': { say: 'Copied: git switch {groupBranch}' }, 'Try it': { say: 'Copied: git switch {groupBranch}' }, Discard: { to: 'discarded', confirm: 'Discard all 3 runs’ changes?' } },
  'ship-applied': { 'View PR': OPEN_PR['View PR'], 'Ask for changes': { say: 'Sent; a run takes on what you asked' }, 'Copy PR link': OPEN_PR['Copy PR link'] },
  'workspace-partly': { 'Create PR': { to: 'workspace', say: 'Opened worca-docs #31 into main', dialog: 'pr' }, 'View PRs': { say: 'Opens worca-api #212 on GitHub' }, 'Copy PR links': { say: 'Copied 1 PR link' } },
});
Object.assign(FLOW.paused, { 'Don’t resume at 14:00': { to: 'paused-limit', say: 'The 14:00 resume is cancelled' }, 'Switch model…': SWITCH, 'Resume at…': RESUME_AT });
Object.assign(FLOW.capped, { 'Raise the cap': { dialog: 'cap', to: 'working', say: 'Cap raised to {value}; the run goes on' }, 'Open budget settings': { say: 'Goes to Settings › Runs › Budget' }, 'Resume at…': { say: 'A cost cap does not lift with time' } });
Object.assign(FLOW.plan, { 'Full plan': { say: 'Opens plan.md' }, 'Fix all': { fix: 'plan', say: 'Worca fixed the 2 open issues' }, 'Save to plans/': { say: 'Saved plans/unified-page-navigation.md' }, 'Open in New run': { say: 'Goes to Runs › New run, with this plan in it' }, Stop: STOP });
Object.assign(FLOW.outline, { 'Approve {n} runs': { to: 'feature', say: 'The feature has {n} runs; run 1 starts' }, 'Fix all': { fix: 'outline', say: 'Worca fixed the cut’s 1 open issue' }, Stop: STOP });
Object.assign(FLOW.featureready, { 'Not now': { to: 'ship-declined', say: 'Not shipped yet; ship it from here when you want' }, 'Ask for changes': { say: 'Sent; a run takes on what you asked' } });

// What a live run's own controls lead to, from any state.
const RUN_FLOW = {
  pauseNow: {
    to: "paused",
    say: "Paused; Resume goes on from Implementation"
  },
  pauseAfter: {
    to: "paused",
    say: "Pauses after the current step finishes"
  },
  stop: {
    to: "stopped",
    confirm: "Stop the run? The branch and changes stay."
  }
};

/** Every state's id. */
export const stateIds = () => Object.keys(STATES);

/** A state's word, dot, symbol and one action, with its names filled in. An unknown id throws: a state is never guessed. */
export function runState(id, ctx = {}) {
  const s = STATES[id];
  if (!s) throw new Error(`runState: unknown state ${id}`);
  const action = s.action ? { ...s.action, label: fill(s.action.label, ctx), items: [...(ctx.extraItems || []), ...s.action.items.map((x) => fill(x, ctx))], off: s.action.off || {} } : null;
  return { word: (s.hostWord && HOST_WORD[ctx.host]) || s.word, dot: s.dot || '', sym: s.sym || '', action };
}

/** One line on what an action does: the main button's tooltip, and each menu item's help. */
export function actionHelp(label, ctx = {}) {
  for (const [k, v] of Object.entries(HELP)) if (fill(k, ctx) === label) return fill(v, ctx);
  return '';
}

/** Where a state's actions lead: { label: { to, say, confirm, dialog } }, and `next` for what happens from outside. */
export function actionFlow(id, ctx = {}) {
  const out = {};
  for (const [k, v] of Object.entries(FLOW[id] || {})) out[fill(k, ctx)] = typeof v === 'string' ? v : Object.fromEntries(Object.entries(v).map(([a, b]) => [a, fill(b, ctx)]));
  return out;
}

/** What Pause, Stop and the like lead to on a live run. */
export const runFlow = () => RUN_FLOW;

/** An action as a state offers it. */
export const makeAction = (label, icon, primary, items) => ({ label, icon, primary: !!primary, items: items || [] });

// A run inside a group ships with its group, so creating, merging and opening PRs are the group page's; the steps that
// get the run itself moving again stay on its page.
const GROUP_OWNS = /^(Create|Merge|Push|Publish|Discard|Try it|View|Watch|Copy|How to merge|Apply to folder|Open the)/;
export const memberKeeps = (label) => !GROUP_OWNS.test(label);

// A state's section in a list of things that wait on you (Pulse's Now; Chat's list later): waiting on a person first,
// then working, then the rest. Paused and Stopped are never Ready.
const SECTION = { 'Needs you': 'needs', Working: 'running', Starting: 'running', 'In review': 'running', Waiting: 'scheduled', Paused: 'needs', 'Ready to merge': 'needs', Ready: 'needs', Failed: 'needs' };
export const sectionOf = (word) => SECTION[word] || 'recent';

// A step's look: its mark on the rail, its icon, the word a screen reader hears, and its cell in the stepper.
const STEP = { done: ['is-done', 'check', 'Done'], now: ['is-working is-pulse', 'now', 'In progress'], ask: ['is-problem', 'question', 'Needs you'],
  problem: ['is-problem', 'alert', 'Needs attention'], failed: ['is-failed', 'alert', 'Failed'], paused: ['is-closed', 'pause', 'Paused'], review: ['is-review', 'pr', 'In review'], next: ['is-future', '', 'Not yet'], merged: ['is-merged', 'merge', 'Merged'] };
const LIVE_STEP = { now: 1, ask: 1, problem: 1, failed: 1, paused: 1, review: 1 };
export const isDone = (x) => x.state === 'done' || x.state === 'merged';
/** A stage's state from its steps: live, done or next. */
export const stageState = (subs) => (subs.some((x) => LIVE_STEP[x.state]) ? 'live' : subs.every(isDone) ? 'done' : 'next');
/** The one state that speaks for a stage's steps. */
export const subState = (subs) => { const lv = subs.find((x) => LIVE_STEP[x.state]); return lv ? lv.state : subs.every(isDone) ? 'done' : 'next'; };
export const isLiveStep = (x) => !!LIVE_STEP[x.state];
export const STAGE_WORD = { live: 'in progress', done: 'done', next: 'not started' };
/** A step as StepRow draws it. */
export function stepLook(x, nextX) {
  const d = STEP[x.state] || STEP.next;
  return { name: x.name, live: x.live, when: x.when, time: x.time, loops: x.loops, dotCls: d[0], icon: d[1], word: d[2],
    rowCls: `is-${x.state}${nextX && isDone(x) && isDone(nextX) ? ' is-linked' : ''}` };
}
/** The stage a thing opens on: the live one, else the stack's, else the last with something done. */
export function defaultStage(stages, stackMode = '') {
  const live = stages.find((st) => stageState(st.subs) === 'live');
  if (live) return live.key;
  if (stackMode && stackMode !== 'outline') return 'pr';
  const last = stages.slice().reverse().find((st) => st.subs.some(isDone));
  return (last || stages[0]).key;
}
const toMin = (t) => { let m = 0; String(t).replace(/(\d+)\s*([hms])/g, (_, n, u) => { m += u === 'h' ? +n * 60 : u === 'm' ? +n : +n / 60; return ''; }); return m; };
export { toMin };
export function fmtMin(m) {
  if (m < 1) return `${Math.round(m * 60)}s`;
  const r = Math.round(m);   // round first, so 59.8 minutes reads 1h, not 60m
  return r >= 60 ? `${Math.floor(r / 60)}h${r % 60 ? ` ${r % 60}m` : ''}` : `${r}m`;
}
/** What a stage's label says under its segment: how long, so far for the live one, nothing for one to come. */
export function stageMeta(st) {
  if (stageState(st.subs) === 'next') return '';
  const m = st.subs.reduce((a, x) => a + (x.time ? toMin(x.time) : 0), 0);
  return m ? fmtMin(m) : '';
}
