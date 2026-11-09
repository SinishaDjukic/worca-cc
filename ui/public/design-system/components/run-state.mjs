// The states of a run, and what each one offers (docs/rail/logic.md). The one source of a state's word, colour and one
// action, so a page (the task page, a group, Pulse's Vitals, Chat's list later) cannot turn Paused into Ready by drawing its
// own. Pure: no DOM, no mock data. Names in the words (`{pr}`, `{base}`, `{branch}`…) come from the task through `ctx`.
import { CREATE_PR_LABEL, VIEW_PR_LABEL, VIEW_PRS_LABEL } from '../../ship-words.mjs';

/** Fills a text's {names} from the task's facts. */
export const fill = (text, ctx = {}) => String(text).replace(/\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined ? ctx[k] : m));

/** The statuses a task can move its ticket to, in each tracker's own words. */
export const TRACKER_MOVES = { jira: ['In review', 'Resolved', 'Done'], azure: ['Resolved', 'Closed'], github: ['closed'] };

const STATES = {
  'no-remote': { word: 'Ready', dot: 'is-green', action: { label: 'Link remote', icon: 'up', primary: true, items: ['How to merge', 'Discard'] } },
  'mock-run': { word: 'Mock run', dot: 'is-grey' },
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
      label: "Cancel {at}",
      icon: "x",
      primary: false,
      items: [
        "Resume now",
        "Resume on Codex",
        "Switch model…",
        "Resume at…"
      ],
      off: { "Resume now": "The limit has not reset yet; Resume on Codex goes on now" }
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
        "Start a new task"
      ]
    }
  },
  ready: {
    word: "Ready",
    dot: "is-green",
    action: {
      label: CREATE_PR_LABEL,
      icon: "prc",
      primary: true,
      items: [
        "Publish branch",
        "How to merge",
        "Discard"
      ]
    }
  },
  checks: {
    word: "In review",
    dot: "is-peach is-pulse",
    action: {
      label: VIEW_PR_LABEL,
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
        "Resolve in a terminal",
        "Re-check",
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
        "Watch",
        "Copy PR link"
      ]
    }
  },
  labelled: {
    word: "Ready",
    dot: "is-green",
    action: {
      label: CREATE_PR_LABEL,
      icon: "prc",
      primary: true,
      items: [
        "Publish branch",
        "How to merge",
        "Discard"
      ]
    }
  },
  merged: {
    word: "Merged",
    dot: "is-violet",
    action: {
      label: VIEW_PR_LABEL,
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
        "Delete task"
      ]
    }
  },
  'waiting-interrupted': {
    word: "Waiting",
    dot: "is-grey-ring",
    action: {
      label: "Start now",
      icon: "play",
      primary: false,
      items: [
        "Delete task"
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
      label: "Start a new task",
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
      label: "Start a new task",
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
      label: "Approve {n} tasks",
      icon: "check",
      primary: true,
      items: [
        "Ask me before each task",
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
      label: CREATE_PR_LABEL,
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
        VIEW_PRS_LABEL,
        "Watch PRs",
        "Copy PR links"
      ]
    }
  }
};

// The rest of a task's states (docs/rail/thing-page.md: The task page's cases). `off` names a step that is shown but
// cannot be taken now, with why; a word a git host renames sits in HOST_WORD.
const off = (label, icon, primary, items, offs) => ({ label, icon, primary, items, off: offs });
const act = (label, icon, primary, items = []) => ({ label, icon, primary, items });
const CAP_OFF = { 'Resume at…': 'A cost cap does not lift with time: raise it or go on without it' };
const LIMIT_OFF = { 'Resume now': 'The limit has not reset yet; Resume on Codex goes on now' };
const VIEW_ITEMS = ['Watch', 'Copy PR link'];
Object.assign(STATES, {
  // Paused, and why. A usage limit offers the other engine; nothing else does.
  'paused-limit': { word: 'Paused', dot: 'is-grey', action: off('Resume at 14:00', 'play', true, ['Resume now', 'Resume on Codex', 'Switch model…', 'Resume at…'], LIMIT_OFF) },
  'paused-reset': { word: 'Paused', dot: 'is-grey', action: act('Resume now', 'play', true, ['Resume on Codex', 'Switch model…', 'Resume at…']) },
  'paused-missed': { word: 'Paused', dot: 'is-grey', action: act('Resume now', 'play', true, ['Resume on Codex', 'Switch model…', 'Resume at…']) },
  'paused-budget': { word: 'Paused', dot: 'is-grey', action: off('Open Settings', 'gear', false, ['Resume now'], { 'Resume now': 'No room in the total budget yet: raise it in Settings first' }) },
  'paused-team': { word: 'Paused', dot: 'is-grey', action: act('Continue past team cap', 'play', false, ['Open Team policy']) },
  'paused-reason': { word: 'Paused', dot: 'is-grey', action: act('Resume now', 'play', true, ['Switch model…', 'Resume at…']) },
  // Paused by you, and a time you set: nothing else holds the run
  'paused-you': { word: 'Paused', dot: 'is-grey', action: act('Resume now', 'play', true, ['Switch model…', 'Resume at…']) },
  'paused-at': { word: 'Paused', dot: 'is-grey', action: act('Cancel {at}', 'x', false, ['Resume now', 'Switch model…', 'Resume at…']) },
  interrupted: { word: 'Paused', dot: 'is-grey', action: act('Resume now', 'play', true, ['Archive']) },
  'interrupted-dead': { word: 'Paused', dot: 'is-grey', action: act('Start a new task', 'play', false) },
  // Live, and in trouble
  network: { word: 'Working', dot: 'is-peach is-pulse' },
  recovery: { word: 'Needs you', sym: 'q', action: act('Retry', 'refresh', true, ['Pause', 'Stop']) },
  // Tickets: a scheduled run before it is a run
  'ticket-missed': { word: 'Waiting', dot: 'is-grey-ring', action: act('Start now', 'play', false, ['Delete task']) },
  'ticket-firing': { word: 'Starting', dot: 'is-peach is-pulse' },
  'ticket-failed': { word: 'Failed', sym: 'x', action: off('Open project', 'folder', true, ['Start now'], { 'Start now': 'The project folder is gone: point the project at it first' }) },
  'ticket-ended': { word: 'Stopped', dot: 'is-grey', action: act('Start a new task', 'play', false) },
  cancelled: { word: 'Cancelled', dot: 'is-grey', action: act('Start a new task', 'play', false) },
  // A pull request's own states
  'pr-draft': { word: 'In review', dot: 'is-grey', action: act('Mark ready for review', 'pr', true, VIEW_ITEMS) },
  'pr-changes': { word: 'Needs you', dot: 'is-amber', action: act('Fix requested changes', 'refresh', true, VIEW_ITEMS) },
  'pr-fixing': { word: 'In review', dot: 'is-peach is-pulse', action: act(VIEW_PR_LABEL, 'pr', false, ['View fix task', ...VIEW_ITEMS]) },
  'pr-closed': { word: 'Closed', dot: 'is-grey', hostWord: true, action: act('Create PR again', 'prc', true, ['Discard']) },
  'pr-behind': { word: 'In review', dot: 'is-amber', action: act('Update branch', 'refresh', true, VIEW_ITEMS) },
  'pr-blocked': { word: 'In review', dot: 'is-amber', action: act(VIEW_PR_LABEL, 'pr', false, VIEW_ITEMS) },
  'watch-stopped': { word: 'Needs you', dot: 'is-amber', action: off('Fix conflicts', 'refresh', true, ['Ask for changes', 'Copy PR link'], { 'Ask for changes': 'Ask for changes from the task’s chat' }) },
  round: { word: 'In review', dot: 'is-peach is-pulse', action: act(VIEW_PR_LABEL, 'pr', false, ['Copy PR link']) },
  'in-base': { word: 'Merged', dot: 'is-violet' },
  pushed: { word: 'Merged', dot: 'is-violet' },
  diverged: { word: 'Needs you', dot: 'is-amber', action: off('Re-check', 'refresh', true, ['Push', 'How to pull', 'Discard'], { Push: 'The branch and its remote have diverged: pull or rebase, then Re-check' }) },
  // A failed or stopped run that still holds work
  'failed-kept': { word: 'Failed', sym: 'x', action: act('Restart Build', 'refresh', true, ['Apply to branch', 'Download patch', 'Commit it yourself', 'Discard']) },
  'failed-kept-wait': { word: 'Failed', sym: 'x' },
  'failed-folder': { word: 'Failed', sym: 'x', action: act('Apply to folder', 'folder', true, ['Open the copy', 'Discard']) },
  'stopped-folder': { word: 'Stopped', dot: 'is-grey', action: act('Apply to folder', 'folder', true, ['Open the copy', 'Discard']) },
  deleted: { word: 'Deleted', dot: 'is-grey' },
  // Before Build: what the plan answers to, and a workflow Worca proposes
  requirements: { word: 'Needs you', sym: 'q', action: act('Agree and plan', 'check', true, ['Ask for changes']) },
  auto: { word: 'Needs you', sym: 'q', action: act('Accept', 'check', true, ['Revise']) },
  // Ready, with its requirements still to mark
  reqs: { word: 'Ready', dot: 'is-green', action: act(CREATE_PR_LABEL, 'prc', true, ['Publish branch', 'How to merge', 'Discard']) },
  // Ready, but something has to happen before a PR can open
  'ready-moved': { word: 'Ready', dot: 'is-green', action: act('Update branch', 'refresh', true, [CREATE_PR_LABEL, 'Publish branch', 'How to merge', 'Discard']) },
  'auto-failed': { word: 'Ready', dot: 'is-green', action: act('Sign in', 'up', true, ['How to merge', 'Discard']) },
  // Worca is fixing what was asked: live until it is done
  'plan-fixing': { word: 'Working', dot: 'is-peach is-pulse' },
  'outline-fixing': { word: 'Working', dot: 'is-peach is-pulse' },
  'workspace-fixing': { word: 'In review', dot: 'is-peach is-pulse', action: act(VIEW_PRS_LABEL, 'pr', false, ['View fix task', 'Copy PR links']) },
  // A group, read from the task that holds it up
  'group-failed': { word: 'Failed', sym: 'x', action: act('Open task {k}', 'alert', true, ['Re-plan the rest', 'Cancel the rest']) },
  'group-paused': { word: 'Paused', dot: 'is-grey', action: act('Resume', 'play', true, ['Re-plan the rest', 'Cancel the rest']) },
  'group-needs': { word: 'Needs you', sym: 'q', action: act('Open task {k}', 'question', true, ['Re-plan the rest', 'Cancel the rest']) },
  'group-stopped': { word: 'Stopped', dot: 'is-grey', action: act('Restart task {k}', 'refresh', true, ['Re-plan the rest', 'Cancel the rest']) },
  'group-asks': { word: 'Needs you', sym: 'q', action: act('Start task {k}', 'play', true, ['Re-plan the rest', 'Cancel the rest']) },
  'ship-declined': { word: 'Ready', dot: 'is-green', action: act('Create {n} PRs', 'prc', true, ['Check out the whole feature', 'Discard']) },
  'ship-applied': { word: 'Applied', dot: 'is-violet', action: act(VIEW_PR_LABEL, 'merge', false, ['Ask for changes', 'Copy PR link']) },
  'workspace-partly': { word: 'Ready', dot: 'is-green', action: act(CREATE_PR_LABEL, 'prc', true, [VIEW_PRS_LABEL, 'Copy PR links']) },
});
STATES.capped.action = off('Raise the cap', 'play', true, ['Continue without cap', 'Open budget settings', 'Resume at…'], CAP_OFF);
STATES.plan.action.items = ['Ask for changes', 'Full plan', 'Fix all', 'Save to plans/', 'Open in New run', 'Stop'];
STATES.outline.action.items = ['Ask me before each task', 'Don’t split', 'Ask for changes', 'Fix all', 'Stop'];
STATES.featureready.action.items = ['Check out the whole feature', 'Not now', 'Ask for changes', 'Discard'];

// What a git host calls a pull request closed without merging.
const HOST_WORD = { github: 'Closed', azure: 'Abandoned', bitbucket: 'Declined' };

// An action a mode holds back (docs/ui-levels.md); a label not here shows in every mode.
const ACTION_LEVEL = { 'Open in New run': 'advanced', Revise: 'advanced', Watch: 'advanced', Terminal: 'advanced' };
/** The interface mode an action needs. */
export const actionLevel = (label) => ACTION_LEVEL[label] || 'simple';

const HELP = {
  'Link remote': 'Adds the git remote this project needs before it can have a PR',
  "Send answer": "Sends the answer you picked or wrote; the task goes on",
  "Use the default answer": "Goes on with what Worca would pick",
  "Use defaults": "Skips the questions; the planner picks sensible answers",
  Resume: "Goes on from the step it paused in",
  "Resume when the limit resets": "Waits for the limit, then goes on by itself",
  Stop: "Ends the task; the branch and changes stay",
  "Restart Build": "Build runs again with what Plan already made",
  "Report this task": "Asks for a note, then sends it with the logs to the Worca team",
  "Start a new task": "Starts again from what you asked, as a new task",
  [CREATE_PR_LABEL]: "Creates a PR from this task’s branch into {base}",
  "Create 3 PRs": "Creates one PR per task, each into the one before",
  "Create 2 PRs": "Creates one PR per task, the second into the first",
  "Try it": "Checks the branch out locally so you can run it; in a stack, each task’s branch holds the tasks before it",
  "Check out the whole feature": "Checks out the top of the stack, which holds every run",
  "Open the copy": "Opens a terminal in the copy the task changed",
  "Push main": "Pushes the commits straight to origin/main, no PR",
  Push: "Pushes the source branch, with the task’s work merged back, to origin; no PR",
  Discard: "Throws the changes away; the task stays in history",
  [VIEW_PR_LABEL]: "Shows the PR on GitHub",
  Watch: "Worca follows the PR and fixes failing checks for you",
  "Copy PR link": "Copies the PR’s address",
  "Fix checks": "Starts a short task that fixes the failing checks",
  "Re-run checks": "Runs the checks on {pr} again; nothing in the code changes",
  "Fix conflicts": "Starts a short task that merges {base} in and resolves the conflicts",
  "Merge PR": "Merges the PR into {base} on GitHub",
  "Merge {pr}": "Merges {pr} into {base}; {pr2} then points at {base}",
  "Fix checks on {pr3}": "Starts a short task that fixes {pr3}’s failing unit and e2e checks",
  "Resume now": "Goes on now instead of waiting for the limit to reset",
  Pause: "Stops at once; Resume starts the current step again",
  "Pause after this step": "Lets the current step finish, then pauses",
  "Stop the task": "Ends it; the branch and changes stay",
  "Open the folder": "Opens {folder} in your file manager",
  "Resume on Codex": "Goes on now on another engine, from the same step",
  "Switch model…": "Pick another model, then resume",
  "Resume at…": "Pick a time to resume",
  "Publish branch": "Pushes the branch to origin without creating a PR",
  "How to merge": "Shows the git commands to merge it yourself, with a copy button",
  "Update branch": "Merges {base} into the branch",
  "Resolve in a terminal": "Opens a terminal in the worktree with the conflicts",
  "Re-check": "Checks again whether the branch is up to date with {base}",
  "Start now": "Starts it now instead of waiting",
  "Delete task": "Deletes the waiting task; it never starts",
  "Cancel {at}": "Cancels the resume at {at}; the task stays paused",
  "How to pull": "Shows the git command to bring in the remote’s commits",
  "Open project": "Goes to the project, to point it at its folder",
  "Fix requested changes": "Starts a short task on what the reviewer asked",
  "Sign in": "Signs in to GitHub, so Worca can create the PR",
  "Accept as is": "Takes the review as it is and goes on to the manual tests",
  "Run another cycle": "One more Build and Review round",
  "Continue without cap": "Goes on with no cost cap for this task",
  "Raise the cap": "Sets a new cap for this task, then goes on",
  "Open budget settings": "Opens Settings › Runs › Budget",
  "Apply to branch": "Commits the kept work to the branch, skipping the hook that failed",
  "Download patch": "Saves the kept work as a .patch file",
  "Commit it yourself": "Shows the commands to commit it by hand, with a copy button",
  [VIEW_PRS_LABEL]: "Shows the PRs on GitHub",
  "Watch PRs": "Worca follows all three PRs",
  "Copy PR links": "Copies every PR’s address",
  "Create PR instead": "Creates a PR rather than pushing to main",
  "Apply to folder": "Copies the changed files into the folder",
  "Approve and build": "Accepts the plan and starts Build",
  "Ask for changes": "Tells the planner what to change, then it plans again",
  "Full plan": "Opens the whole plan to read",
  "Approve 3 tasks": "Creates the feature: three tasks that build one after another",
  "Ask me before each task": "Stops for your OK before each later task starts",
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
  'View fix task': 'Opens the short task that is fixing {pr}',
  'Create PR again': 'Opens a new pull request from this task’s branch into {base}',
  'Agree and plan': 'Agrees the requirements, with your answer, and starts the plan',
  Accept: 'Runs the workflow Worca proposes',
  'Review the workflow': 'Shows the proposed workflow at full size',
  Revise: 'Tells Worca what to change in the workflow',
  'Fix all': 'Worca fixes every open issue in the plan or the split, then shows it again',
  'Save to plans/': 'Writes this plan to plans/ in the project',
  'Open in New run': 'Starts a New run with this plan already in it',
  'Not now': 'Leaves it unshipped; you can ship it from here later',
  'Re-plan the rest': 'Cancels the waiting tasks and plans what is left from the last finished task',
  'Cancel the rest': 'Cancels the tasks that have not started; a running task keeps running',
  'Open task {k}': 'Opens the task that holds up the rest',
  'Restart task {k}': 'Runs its Build again; the tasks after it follow',
  'Start task {k}': 'Your OK: the next task starts',
  'Create {n} PRs': 'Creates one PR per task, each into the one before',
  'Approve {n} tasks': 'Creates the feature: these tasks build one after another',
});

// Where each action leads (docs/rail/actions.md). `to` moves this task to another state; `say` is what happened, and the
// toast's words; `confirm` asks in the strip, `no` names its safe side; `dialog` opens a form; `commands` opens the panel
// with a copy button; `step` says what happens to the task's own steps when the state alone does not (`restart:build`, the
// stage it starts again from; `advance:build`, the stage it goes on to; `fresh`, a new run; `land`, its work is on the
// remote). `next` and `event` are what happens from outside. test/design-system-logic.test.mjs holds act.confirm and act.flow.
const GONE_OK = 'The task stays in history';
const DISCARD = { to: 'discarded', confirm: 'Discard the changes? The task stays in history.', say: `Discarded. ${GONE_OK}` };
const DISCARD_ALL = (who) => ({ to: 'discarded', confirm: `Discard ${who}’ changes?`, say: 'Discarded. It stays in history' });
const STOP = { to: 'stopped', confirm: 'Stop the task? The branch and changes stay.', say: 'Stopped. The branch and changes stay' };
const NEW_RUN = { to: 'starting', step: 'fresh', say: 'Started again as a new task' };
const RESUMED = { to: 'working', say: 'Resumed from {step}' };
const ON_CODEX = { to: 'working', say: 'Resumed on Codex; every remaining step runs there' };
const SWITCH = { dialog: 'model', to: 'working', say: 'Resumed on {value}; every remaining step runs there' };
const RESUME_AT = { dialog: 'resume-at', to: 'paused-at', say: 'Resumes at {value}' };
const RESTART = (say) => ({ to: 'working', step: 'restart:build', say });
const ARCHIVE = { to: 'archived', confirm: 'Archive this task? It cannot be resumed after this. The local branch, worktree and logs are removed; the remote branch and any PR stay.', say: 'Archived. The remote branch and any PR stay' };
const REPORT = { dialog: 'report', say: 'Sent to the Worca team, with the logs and your note' };
const REPLAN = { to: 'outline', confirm: 'Re-plan the rest? The waiting tasks are cancelled and Worca plans what is left from the last finished task.', say: 'The waiting tasks are cancelled; Worca planned what is left' };
const CANCEL_REST = { say: 'The tasks that had not started are cancelled; a running task keeps running', confirm: 'Cancel the rest? The tasks that have not started are cancelled. A running task keeps running.' };
const RESUME_MEMBER = { member: 'slice', say: 'Resumed; task {k} goes on' };
const OPEN_MEMBER = { openMember: true, say: 'Opens task {k}' };
const DELETE_RUN = { to: 'ticket-canceled', confirm: 'Delete this waiting task? It never starts.', no: 'Keep', say: 'Deleted; it will not start' };
const VIEW = { say: 'Would open {pr} on GitHub' };
const COPY_LINK = { say: 'Would copy the link to {pr}' };
const WATCH = { say: 'Worca watches {pr} and fixes failing checks' };
const OPEN_PR = { [VIEW_PR_LABEL]: VIEW, 'Copy PR link': COPY_LINK, Watch: WATCH };
const CREATE = (to, say) => ({ to, say, dialog: 'pr' });
const CREATE_ONE = CREATE('checks', 'Created {pr} into {base}');
const GROUP_ONE = (who) => CREATE('ship-applied', `Created {pr} for ${who}`);
const STACK3 = CREATE('chain', 'Created {pr}, {pr2} and {pr3}, each into the one before');
const PUBLISH = { fix: 'published', confirm: 'Push {branch} to origin? No PR opens.', say: 'Pushed the branch to origin; no PR' };
const HOW_TO_MERGE = { commands: 'git switch {base}\ngit merge {branch}' };
const COMMIT_BY_HAND = { commands: 'cd {worktree}\ngit add -A\ngit commit --no-verify' };
const PATCH = { say: 'Would download the patch' };
const OPEN_COPY = { say: 'Would open the copy in a terminal' };
const FIX_CHECKS = { to: 'fixing-checks', confirm: 'Fix the 2 failing checks on {pr}? Worca pushes the fix to the PR.', say: 'A short task is fixing the checks' };
const FIX_CONFLICTS = { to: 'fixing-conflicts', confirm: 'Merge {base} into {pr} and fix the 2 conflicts? Worca pushes the fix to the PR.', say: 'A short task is fixing the conflicts' };
const APPLY_FOLDER = (why) => ({ to: 'applied', confirm: `Write 5 files into {folder}?${why}`, say: 'Wrote 5 files into {folder}' });
const READY_FLOW = { [CREATE_PR_LABEL]: CREATE_ONE, 'Publish branch': PUBLISH, 'How to merge': HOW_TO_MERGE, Discard: DISCARD };
const LIMITED = { 'Resume now': RESUMED, 'Resume on Codex': ON_CODEX, 'Switch model…': SWITCH, 'Resume at…': RESUME_AT };
const WAITING = { 'Start now': { to: 'starting', say: 'Started now; it no longer waits' }, 'Delete task': DELETE_RUN };
const REST = { 'Re-plan the rest': REPLAN, 'Cancel the rest': CANCEL_REST };

const FLOW = {
  'no-remote': { 'Link remote': { to: 'ready', confirm: 'Add origin as this project’s remote? Worca pushes there from now on.', say: 'Linked origin; Create PR is now the next step' }, 'How to merge': HOW_TO_MERGE, Discard: DISCARD },
  'mock-run': {},
  starting: { next: 'working' },
  working: { next: 'ready' },
  question: { 'Send answer': { to: 'working', say: 'Answer sent; the next step starts' }, 'Use the default answer': { to: 'working', say: 'Worca’s pick sent; the next step starts' } },
  // A resume you set: its main takes it back; nothing can go on until the limit resets, or on the other engine
  paused: { 'Cancel {at}': { to: 'paused-limit', say: 'The {at} resume is cancelled' }, ...LIMITED },
  'paused-at': { 'Cancel {at}': { to: 'paused-you', say: 'The {at} resume is cancelled' }, 'Resume now': RESUMED, 'Switch model…': SWITCH, 'Resume at…': RESUME_AT },
  'paused-you': { 'Resume now': RESUMED, 'Switch model…': SWITCH, 'Resume at…': RESUME_AT },
  'paused-limit': { 'Resume at 14:00': { to: 'paused', say: 'Resumes at 14:00, when the limit has reset' }, ...LIMITED },
  'paused-reset': { ...LIMITED },
  'paused-missed': { ...LIMITED },
  'paused-budget': { 'Open Settings': { say: 'Goes to Settings › Runs › Budget; Resume opens once there is room' }, 'Resume now': RESUMED },
  'paused-team': { 'Continue past team cap': { dialog: 'team-cap', to: 'working', say: 'Going on past the team cap; your reason is recorded' }, 'Open Team policy': { say: 'Goes to Settings › Team › Policy' } },
  'paused-reason': { 'Resume now': RESUMED, 'Switch model…': SWITCH, 'Resume at…': RESUME_AT },
  interrupted: { 'Resume now': RESUMED, Archive: ARCHIVE },
  'interrupted-dead': { 'Start a new task': NEW_RUN },
  capped: { 'Raise the cap': { dialog: 'cap', to: 'working', say: 'Cap raised to {value}; the task goes on' }, 'Continue without cap': { to: 'working', confirm: 'Go on with no cost cap for this task?', say: 'Going on with no cost cap' }, 'Open budget settings': { say: 'Goes to Settings › Runs › Budget' }, 'Resume at…': { say: 'A cost cap does not lift with time' } },
  scheduled: WAITING,
  'waiting-interrupted': WAITING,
  'ticket-missed': WAITING,
  'ticket-firing': { next: 'starting', event: 'The schedule fired; the task starts' },
  'ticket-failed': { 'Open project': { say: 'Goes to Settings › Projects; point it at the folder, then Start now' }, 'Start now': { to: 'starting', say: 'Started now' } },
  'ticket-ended': { 'Start a new task': NEW_RUN },
  cancelled: { 'Start a new task': NEW_RUN },
  gate: { 'Accept as is': { to: 'working', say: 'Review accepted; manual tests start' }, 'Run another cycle': RESTART('One more Build and Review round'), Stop: STOP },
  kept: { 'Apply to branch': { to: 'ready', confirm: 'Commit the kept work to {branch}? It skips the hook that failed.', say: 'Committed to the branch' }, 'Download patch': PATCH, 'Commit it yourself': COMMIT_BY_HAND, Discard: { ...DISCARD, confirm: 'Discard the kept work? A patch is saved first.' } },
  archived: {},
  failed: { 'Restart Build': RESTART('Build runs again with what Plan made'), 'Start a new task': NEW_RUN },
  'failed-kept': { 'Restart Build': RESTART('Build runs again with what Plan made'), 'Apply to branch': { to: 'failed', confirm: 'Commit the kept work to {branch}? It skips the hook, and the tests still fail.', say: 'Committed to the branch; the failure stays' }, 'Download patch': PATCH, 'Commit it yourself': COMMIT_BY_HAND, Discard: { to: 'failed', confirm: 'Discard the kept work? A patch is saved first.', say: 'The kept work is gone; a patch was saved' } },
  'failed-kept-wait': { next: 'failed-kept', event: 'The kept work is saved' },
  'failed-folder': { 'Apply to folder': APPLY_FOLDER(' The task failed, so check them first.'), 'Open the copy': OPEN_COPY, Discard: DISCARD },
  'stopped-folder': { 'Apply to folder': APPLY_FOLDER(' The task stopped early, so check them first.'), 'Open the copy': OPEN_COPY, Discard: DISCARD },
  ready: READY_FLOW,
  labelled: READY_FLOW,
  reqs: READY_FLOW,
  'ready-moved': { 'Update branch': { to: 'ready', say: '{base} merged in; the branch is up to date' }, ...READY_FLOW },
  'auto-failed': { 'Sign in': { to: 'ready', say: 'Signed in to GitHub; Create PR is next' }, 'How to merge': HOW_TO_MERGE, Discard: DISCARD },
  checks: { ...OPEN_PR, next: 'failing' },
  failing: { 'Fix checks': FIX_CHECKS, 'Re-run checks': { to: 'checks', say: 'Checks on {pr} run again' }, [VIEW_PR_LABEL]: VIEW, 'Copy PR link': COPY_LINK, next: 'conflicts' },
  conflicts: { 'Fix conflicts': FIX_CONFLICTS, 'Resolve in a terminal': { say: 'Opens a terminal in the worktree' }, 'Re-check': { say: 'Still 2 conflicts with {base}' }, [VIEW_PR_LABEL]: VIEW, 'Copy PR link': COPY_LINK, next: 'approved' },
  approved: { 'Merge PR': { to: 'merged', confirm: 'Merge {pr} into {base}?', say: 'Merged {pr} into {base}' }, [VIEW_PR_LABEL]: VIEW, Watch: { say: 'Worca watches {pr}' }, 'Copy PR link': COPY_LINK },
  merged: { [VIEW_PR_LABEL]: { say: 'Would open the merged {pr} on GitHub' } },
  stopped: { 'Start a new task': NEW_RUN, 'Restart Build': RESTART('Build runs again from where it stopped') },
  discarded: { 'Start a new task': NEW_RUN },
  push: { 'Push main': { to: 'pushed', step: 'land', confirm: 'Push the commits straight to origin/main? No PR opens.', say: 'Pushed to origin/main' }, 'Create PR instead': CREATE_ONE, Discard: DISCARD },
  'source-ready': { Push: { to: 'pushed', step: 'land', confirm: 'Push {source} to origin? No PR opens.', say: 'Pushed to origin/{source}' }, Discard: DISCARD },
  'source-unmerged': { 'How to merge': { commands: 'git switch {source}\ngit merge {hidden}' }, 'Create PR instead': CREATE('checks', 'Created {pr} into {source}'), Discard: DISCARD },
  diverged: { 'Re-check': { to: 'source-ready', say: 'In step with the remote again; Push is back' }, Push: { to: 'pushed', step: 'land', confirm: 'Push {source} to origin? No PR opens.', say: 'Pushed to origin/{source}' }, 'How to pull': { commands: 'git switch {source}\ngit pull --rebase origin {source}' }, Discard: DISCARD },
  folder: { 'Apply to folder': APPLY_FOLDER(''), 'Open the copy': OPEN_COPY, Discard: DISCARD },
  applied: { 'Open the folder': { say: 'Opens {folder}' } },
  workspace: { 'Fix conflicts': { to: 'workspace-fixing', confirm: 'Fix the conflicts on worca-docs #31? Worca pushes the fix to the PR.', say: 'A short task is fixing worca-docs #31' }, 'Copy PR links': { say: 'Would copy 3 PR links' } },
  'workspace-fixing': { [VIEW_PRS_LABEL]: { say: 'Would open worca-api #212, worca-web #88 and worca-docs #31 on GitHub' }, 'View fix task': { say: 'Opens the fix task: Runs › this task’s rounds' }, 'Copy PR links': { say: 'Would copy 3 PR links' } },
  'workspace-partly': { [CREATE_PR_LABEL]: CREATE('workspace', 'Opened worca-docs #31 into main'), [VIEW_PRS_LABEL]: { say: 'Would open worca-api #212 on GitHub' }, 'Copy PR links': { say: 'Would copy 1 PR link' } },
  clarify: { 'Next question': { nextQuestion: true }, 'Send answer': { to: 'plan', say: 'Answers sent; the planner writes the plan' }, 'Use defaults': { to: 'plan', say: 'Defaults used; the planner writes the plan' } },
  requirements: { 'Agree and plan': { to: 'plan', say: 'Requirements agreed; the planner writes the plan' }, 'Ask for changes': { say: 'Sent; the requirements come back' } },
  auto: { Accept: { to: 'starting', say: 'Workflow accepted; the task starts' }, 'Review the workflow': { say: 'Opens the workflow' }, Revise: { say: 'Sent; Worca proposes again' } },
  plan: { 'Approve and build': { to: 'working', step: 'advance:build', say: 'Plan approved; Build starts' }, 'Ask for changes': { say: 'Sent to the planner; it plans again' }, 'Full plan': { say: 'Opens plan.md' }, 'Fix all': { to: 'plan-fixing', say: 'Worca is fixing the 2 open issues' }, 'Save to plans/': { say: 'Would save plans/unified-page-navigation.md' }, 'Open in New run': { say: 'Goes to Runs › New run, with this plan in it' }, Stop: STOP },
  'plan-fixing': { next: 'plan', fixed: 'plan', event: 'The 2 open issues are fixed' },
  outline: { 'Approve {n} tasks': { to: 'feature', say: 'The feature has {n} tasks; task 1 starts' }, 'Ask me before each task': { say: 'Worca asks before each later task starts' }, 'Don’t split': { to: 'plan', say: 'One task, one PR' }, 'Ask for changes': { say: 'Sent to the planner; it splits again' }, 'Fix all': { to: 'outline-fixing', say: 'Worca is fixing the 1 open issue' }, Stop: STOP },
  'outline-fixing': { next: 'outline', fixed: 'outline', event: 'The 1 open issue is fixed' },
  feature: { next: 'featureready' },
  featureready: { 'Create {n} PRs': STACK3, [CREATE_PR_LABEL]: GROUP_ONE('all 3 tasks'), 'Check out the whole feature': { say: 'Would copy: git switch {groupBranch}' }, 'Not now': { to: 'ship-declined', say: 'Not shipped yet; ship it from here when you want' }, 'Ask for changes': { say: 'Sent; a task takes on what you asked' }, Discard: DISCARD_ALL('all 3 tasks') },
  featureone: { [CREATE_PR_LABEL]: GROUP_ONE('both tasks'), 'Create 2 PRs': CREATE('group-shipped', 'Created {pr} and {pr2}'), 'Check out the whole feature': { say: 'Would copy: git switch {groupBranch}' }, Discard: DISCARD_ALL('both tasks') },
  featureblocked: { 'Create {n} PRs': STACK3, [CREATE_PR_LABEL]: GROUP_ONE('all 3 tasks'), 'Check out the whole feature': { say: 'Would copy: git switch {groupBranch}' }, Discard: DISCARD_ALL('all 3 tasks') },
  chain: { 'Fix checks on {pr3}': { say: 'A short task is fixing {pr3}’s checks', confirm: 'Fix the failing checks on {pr3}? Worca pushes the fix to the PR.' }, 'Merge {pr}': { say: 'Merged {pr} into {base}; {pr2} now points at {base}', confirm: 'Merge {pr} into {base}?' }, [VIEW_PRS_LABEL]: { say: 'Would open {pr}, {pr2} and {pr3} on GitHub' }, 'Watch PRs': { say: 'Worca watches all three PRs' }, 'Copy PR links': { say: 'Would copy 3 PR links' } },
  network: { next: 'working', event: 'The network is back; the step retries' },
  recovery: { Retry: { to: 'working', say: 'Retrying {step}' }, Pause: { to: 'paused-you', say: 'Paused; Resume tries {step} again' }, Stop: STOP },
  'pr-draft': { 'Mark ready for review': { to: 'checks', confirm: 'Mark {pr} ready for review? Reviewers are asked.', say: '{pr} is ready for review' }, ...OPEN_PR },
  'pr-changes': { 'Fix requested changes': { to: 'fixing-changes', confirm: 'Fix what the reviewer asked on {pr}? Worca pushes the fix to the PR.', say: 'A short task is fixing what was asked' }, ...OPEN_PR },
  'pr-fixing': { ...OPEN_PR, 'View fix task': { say: 'Opens the fix task: Runs › this task’s rounds' }, next: 'checks', event: 'The fix is pushed; checks run again' },
  'pr-closed': { 'Create PR again': CREATE_ONE, [VIEW_PR_LABEL]: { say: 'Would open the closed {pr} on GitHub' }, Discard: DISCARD },
  'pr-behind': { 'Update branch': { to: 'checks', confirm: 'Merge {base} into {pr}? Checks run again.', say: '{base} merged in; checks run again' }, ...OPEN_PR },
  'pr-blocked': { ...OPEN_PR },
  'watch-stopped': { 'Fix conflicts': FIX_CONFLICTS, 'Ask for changes': { say: 'Ask for changes from the task’s chat' }, [VIEW_PR_LABEL]: VIEW, 'Copy PR link': COPY_LINK },
  round: { [VIEW_PR_LABEL]: VIEW, 'Copy PR link': COPY_LINK, next: 'checks', event: 'The round pushed its fix; checks run again' },
  'group-failed': { 'Open task {k}': OPEN_MEMBER, ...REST },
  'group-paused': { Resume: RESUME_MEMBER, ...REST },
  'group-needs': { 'Open task {k}': OPEN_MEMBER, ...REST },
  'group-stopped': { 'Restart task {k}': { member: 'slice', step: 'restart:build', say: 'Task {k} runs its Build again' }, ...REST },
  'group-asks': { 'Start task {k}': { to: 'feature', startsRun: true, say: 'Task {k} starts' }, ...REST },
  'ship-declined': { 'Create {n} PRs': STACK3, [CREATE_PR_LABEL]: GROUP_ONE('all 3 tasks'), 'Check out the whole feature': { say: 'Would copy: git switch {groupBranch}' }, Discard: DISCARD_ALL('all 3 tasks') },
  'ship-applied': { [VIEW_PR_LABEL]: VIEW, 'Ask for changes': { say: 'Sent; a task takes on what you asked' }, 'Copy PR link': COPY_LINK },
};

// What a live run's own controls lead to, from any state.
const RUN_FLOW = {
  pauseNow: { to: 'paused-you', say: 'Paused; Resume goes on from {step}' },
  pauseAfter: { pauseAfter: true, say: 'Pauses after {step} finishes' },
  stop: STOP,
  report: REPORT,
  archive: { ...ARCHIVE, confirm: 'Archive this task? The local branch, worktree and logs are removed; the remote branch and any PR stay.' },
};
const filled = (v, ctx) => Object.fromEntries(Object.entries(v).map(([a, b]) => [a, typeof b === 'string' ? fill(b, ctx) : b]));

/** Every state's id. */
export const stateIds = () => Object.keys(STATES);

/** A state's word, dot, symbol and one action, with its names filled in. An unknown id throws: a state is never guessed. */
/** Why a task is under Needs you, in a word or two: a row's one end (list.bar-model). */
const NEEDS_REASON = { question: 'Question', gate: 'Your OK', failed: 'Failed', approved: 'Ready to merge' };
export const needsReason = (id) => NEEDS_REASON[id] || runState(id).word;

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
  for (const [k, v] of Object.entries(FLOW[id] || {})) out[fill(k, ctx)] = typeof v === 'object' && v ? filled(v, ctx) : v;
  return out;
}

/** What Pause, Stop and the like lead to on a live run. */
export const runFlow = (ctx = {}) => Object.fromEntries(Object.entries(RUN_FLOW).map(([k, v]) => [k, filled(v, ctx)]));

/** An action as a state offers it. */
export const makeAction = (label, icon, primary, items) => ({ label, icon, primary: !!primary, items: items || [] });

// A run inside a group ships with its group, so creating, merging and opening PRs are the group page's; the steps that
// get the task itself moving again stay on its page.
const GROUP_OWNS = /^(Create|Merge|Push|Publish|Discard|Try it|View|Watch|Copy|How to merge|Apply to folder|Open the|Start a new task)/;
export const memberKeeps = (label) => !GROUP_OWNS.test(label);

// A state's section in a list of things that wait on you (Pulse's Vitals; Chat's list later): waiting on a person first,
// then working, then the rest. Paused and Stopped are never Ready.
const SECTION = { 'Needs you': 'needs', Working: 'running', Starting: 'running', 'In review': 'running', Waiting: 'scheduled', Paused: 'needs', 'Ready to merge': 'needs', Ready: 'needs', Failed: 'needs' };
export const sectionOf = (word) => SECTION[word] || 'recent';

// A chat's states and kinds (docs/rail/lists.md): a chat is not a run, but its dot and word come from here too. `section`:
// where it sorts in the Chats column. Busy chats pulse; an idle chat shows what it did, its kind's icon in the dot's place.
const CHAT_STATES = {
  'needs-you': { word: STATES.question.word, line: 'Run needs you', dot: STATES.question.dot, sym: STATES.question.sym, section: 'needs' },
  replying: { word: 'Replying', line: 'Replying', dot: 'is-peach is-pulse', sym: '', section: 'running', busy: 'It is replying' },
  command: { word: 'Running a command', line: 'Running a command', dot: 'is-peach is-pulse', sym: '', section: 'running', busy: 'A command is still running' },
  following: { word: 'Following a task', line: 'Following a task', dot: 'is-peach is-pulse', sym: '', section: 'running', busy: 'It follows a task that is still going' },
  idle: { word: 'Idle', line: '', dot: '', sym: '', section: 'recent' },
};
export function chatState(id) {
  const s = CHAT_STATES[id];
  if (!s) throw new Error(`chatState: unknown state ${id}`);
  return s;
}
export const CHAT_KINDS = Object.freeze({
  started: { label: 'Started a run', icon: 'runs' }, tracks: { label: 'Follows a run', icon: 'track' },
  workflow: { label: 'Proposed a workflow', icon: 'workflow' }, chat: { label: 'Chat', icon: 'chat' },
});

// What a task's word is to the bulk table (src/shared/run-bulk.mjs): which run a Stop or an Archive applies to.
const BULK_STATE = { Starting: 'starting', Working: 'working', Waiting: 'waiting', Paused: 'paused', Failed: 'failed', Stopped: 'stopped', Cancelled: 'stopped', Ready: 'ready', 'Ready to merge': 'in-review', 'In review': 'in-review', 'Needs you': 'needs-you' };
export const bulkStateOf = (word) => BULK_STATE[word] || 'merged';

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

/**
 * Try it never goes dead-ended: it says what is happening, then offers the next step (docs/rail/thing-page.md).
 * @param {object} f  { checkingOut, settingUp, setupFailed, service: { name, port, running } | null }
 * @returns {{id:string, text:string, off?:boolean, help:string}[]}  items for the thing's ⋯
 */
export function tryStep({ checkingOut = false, settingUp = false, setupFailed = '', service = null }) {
  if (checkingOut) return [{ id: 'busy', text: 'Checking out…', off: true, help: 'Worca is checking the branch out on this machine' }];
  if (settingUp) return [{ id: 'busy', text: 'Setting up…', off: true, help: 'The project’s setup is running' }];
  if (setupFailed) return [{ id: 'setup-again', text: 'Set up again', help: setupFailed }];
  if (!service) return [{ id: 'actions', text: 'Open Actions', help: 'This project has no service to start; Actions lists what it can do' }];
  if (service.running) return [{ id: 'open', text: `Open :${service.port}`, help: `Opens localhost:${service.port}` }, { id: 'stop', text: `Stop ${service.name}`, help: `Stops ${service.name}` }];
  return [{ id: 'start', text: `Start ${service.name}`, help: `Starts ${service.name} on port ${service.port}` }];
}
