// Labels issues and pull requests by who opened them. Used by .github/workflows/label-by-author.yml.
//
//   from:team        the author has write access or more to this repository
//   from:first-timer not on the team, and this is their first issue or PR here
//   from:community   everyone else
//
// Bots get no label. An item that already has a from:* label is left alone, so the
// backfill can be run again safely and a label set by hand is never overwritten.
'use strict';

const LABELS = [
  { name: 'from:team', color: '1D76DB', description: 'Opened by someone with write access' },
  { name: 'from:first-timer', color: 'FBCA04', description: 'Opened by a first-time contributor' },
  { name: 'from:community', color: '0E8A16', description: 'Opened by a community member' },
];
const PREFIX = 'from:';
// The legacy `permission` field folds maintain into write and triage into read.
const TEAM_PERMISSIONS = new Set(['admin', 'write']);
const FIRST_TIMER_ASSOCIATIONS = new Set(['FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR']);

/** The label for one author, or null when none should be set. Pure. */
function pickLabel({ permission, association, userType }) {
  if (userType === 'Bot') return null;
  if (TEAM_PERMISSIONS.has(permission)) return 'from:team';
  if (FIRST_TIMER_ASSOCIATIONS.has(association)) return 'from:first-timer';
  return 'from:community';
}

const hasAuthorLabel = (labels) =>
  (labels || []).some((l) => String(typeof l === 'string' ? l : l && l.name).startsWith(PREFIX));

async function ensureLabels({ github, context, core }) {
  for (const label of LABELS) {
    try {
      await github.rest.issues.getLabel({ ...context.repo, name: label.name });
    } catch (e) {
      if (e.status !== 404) throw e;
      await github.rest.issues.createLabel({ ...context.repo, ...label });
      core.info(`Created label ${label.name}`);
    }
  }
}

function permissionLookup({ github, context }) {
  const cache = new Map();
  return async (username) => {
    if (!cache.has(username)) {
      const { data } = await github.rest.repos.getCollaboratorPermissionLevel({ ...context.repo, username });
      cache.set(username, data.permission);
    }
    return cache.get(username);
  };
}

/** Labels one issue or PR (the REST "issue" shape: user, author_association, labels, number). */
async function labelItem(item, { github, context, core, permissionOf }) {
  const user = item.user || {};
  if (user.type === 'Bot' || hasAuthorLabel(item.labels)) return null;
  const label = pickLabel({
    permission: await permissionOf(user.login),
    association: item.author_association,
    userType: user.type,
  });
  if (!label) return null;
  await github.rest.issues.addLabels({ ...context.repo, issue_number: item.number, labels: [label] });
  core.info(`#${item.number} (${user.login}) → ${label}`);
  return label;
}

async function run({ github, context, core }) {
  await ensureLabels({ github, context, core });
  const permissionOf = permissionLookup({ github, context });
  const deps = { github, context, core, permissionOf };

  if (context.eventName === 'workflow_dispatch') {
    const state = (context.payload.inputs && context.payload.inputs.state) || 'open';
    const items = await github.paginate(github.rest.issues.listForRepo, { ...context.repo, state, per_page: 100 });
    let labelled = 0;
    for (const item of items) if (await labelItem(item, deps)) labelled++;
    core.notice(`Backfill: labelled ${labelled} of ${items.length} ${state} issues and pull requests.`);
    return;
  }

  const item = context.payload.issue || context.payload.pull_request;
  if (!item) { core.info(`Nothing to label for ${context.eventName}.`); return; }
  await labelItem(item, deps);
}

module.exports = { LABELS, pickLabel, hasAuthorLabel, labelItem, run };
