// Makes it clear what a pull request is for. Used by .github/workflows/pr-context.yml.
//
//   area:* labels  added from the feature folders the pull request touches (see AREAS)
//   linked issue   the description must name an issue: "Closes #123", or "Refs #123"
//                  when the issue should stay open. The check fails without one.
//
// Bots are skipped. A maintainer adds the no-issue label to skip the check for a pull
// request that needs no issue. Area labels are only ever added, never removed.
'use strict';

// A feature area is the same folder name under each of these roots.
const FEATURE_ROOTS = ['src/core/', 'ui/public/', 'ui/routes/'];
const feature = (...folders) => folders.flatMap((f) => FEATURE_ROOTS.map((root) => `${root}${f}/`));

const AREAS = [
  { name: 'area:chat', color: '1d76db', description: 'Chat and Ask Worca', paths: feature('chat', 'ask') },
  { name: 'area:runs', color: '0e8a16', description: 'Runs, presets, schedules and history', paths: feature('runs', 'new-run', 'run-presets', 'scheduled-runs', 'history') },
  { name: 'area:shaper', color: '5319e7', description: 'Shaper and requirements', paths: feature('shape', 'requirements', 'requirements-attach') },
  { name: 'area:workflows', color: 'd93f0b', description: 'Workflows, the graph composer and scripts', paths: feature('workflows', 'graph', 'scripts', 'workflow-tests') },
  { name: 'area:models', color: 'fbca04', description: 'Models and engines', paths: feature('models', 'engines') },
  { name: 'area:settings', color: 'c5def5', description: 'Settings', paths: feature('settings') },
  { name: 'area:terminal', color: '000000', description: 'Terminal', paths: feature('terminal') },
  { name: 'area:mcp', color: 'd876e3', description: 'MCP servers and Marketplace', paths: feature('mcp', 'mcp-servers', 'marketplace') },
  { name: 'area:team', color: '008672', description: 'Team metrics and policy', paths: feature('team-metrics', 'team-policy', 'policy') },
  { name: 'area:design-system', color: 'e4e669', description: 'Design system', paths: feature('design-system') },
  { name: 'area:cli', color: '0e8a16', description: 'Command line', paths: ['src/cli/'] },
  { name: 'area:broker', color: 'd93f0b', description: 'Broker', paths: ['src/broker/'] },
  { name: 'area:plugins', color: 'fbca04', description: 'Plugins', paths: ['plugins/'] },
  { name: 'area:extension', color: 'c5def5', description: 'Browser extension', paths: ['extension/', 'e2e/extension/', ...feature('browser-extension')] },
  { name: 'area:ci', color: '000000', description: 'CI, workflows and images', paths: ['.github/', 'docker/'] },
];
const NO_ISSUE = { name: 'no-issue', color: 'BFD4F2', description: 'PR needs no linked issue; skips the Linked issue check' };

const ISSUE_REF = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|part of|related to):?\s+(?:(?:[\w.-]+\/[\w.-]+)?#\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)/i;

/** The area labels for a list of changed file paths. Pure. */
function areasFor(files) {
  return AREAS.filter((a) => files.some((f) => a.paths.some((p) => f.startsWith(p)))).map((a) => a.name);
}

/** True when the description names an issue. HTML comments (the template's hints) do not count. Pure. */
function hasLinkedIssue(body) {
  return ISSUE_REF.test(String(body || '').replace(/<!--[\s\S]*?-->/g, ''));
}

const labelNames = (labels) => (labels || []).map((l) => (typeof l === 'string' ? l : l && l.name));

async function ensureLabels({ github, context, core }) {
  for (const { name, color, description } of [...AREAS, NO_ISSUE]) {
    try {
      await github.rest.issues.getLabel({ ...context.repo, name });
    } catch (e) {
      if (e.status !== 404) throw e;
      await github.rest.issues.createLabel({ ...context.repo, name, color, description });
      core.info(`Created label ${name}`);
    }
  }
}

async function run({ github, context, core }) {
  const pr = context.payload.pull_request;
  if (!pr || (pr.user && pr.user.type === 'Bot')) return;
  await ensureLabels({ github, context, core });
  const current = labelNames(pr.labels);

  const files = await github.paginate(github.rest.pulls.listFiles, { ...context.repo, pull_number: pr.number, per_page: 100 });
  const missing = areasFor(files.map((f) => f.filename)).filter((name) => !current.includes(name));
  if (missing.length) {
    await github.rest.issues.addLabels({ ...context.repo, issue_number: pr.number, labels: missing });
    core.info(`#${pr.number} → ${missing.join(', ')}`);
  }

  if (current.includes(NO_ISSUE.name) || hasLinkedIssue(pr.body)) return;
  core.setFailed(
    `This pull request does not say which issue it belongs to. Add a line such as "Closes #123" to the description ` +
    `(or "Refs #123" when the issue should stay open). No issue yet? Open one first: ` +
    `https://github.com/${context.repo.owner}/${context.repo.repo}/issues/new/choose. ` +
    `Maintainers can add the ${NO_ISSUE.name} label when no issue is needed.`
  );
}

module.exports = { AREAS, NO_ISSUE, areasFor, hasLinkedIssue, run };
