// The states of a run, and what each one offers (docs/rail/logic.md). The one source of a state's word, colour and one
// action, so a page (the run page, a group, Pulse's Now, Chat's list later) cannot turn Paused into Ready by drawing its
// own. Pure: no DOM, no mock data. Names in the words (`{pr}`, `{base}`, `{branch}`…) come from the run through `ctx`.

/** Fills a text's {names} from the run's facts. */
export const fill = (text, ctx = {}) => String(text).replace(/\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined ? ctx[k] : m));

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
  const action = s.action ? { ...s.action, label: fill(s.action.label, ctx), items: [...(ctx.extraItems || []), ...s.action.items.map((x) => fill(x, ctx))] } : null;
  return { word: s.word, dot: s.dot || '', sym: s.sym || '', action };
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
