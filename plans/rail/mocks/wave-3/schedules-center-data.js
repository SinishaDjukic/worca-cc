// The Schedules center, Marketplace-style: a card per schedule. 1 + 1 + 2 + 1 = 5. Last 7 days, 11 finished runs (Nightly 7, Changelog digest 3, Weekly deps 1): 10 succeeded + 1 failed. Mock today is Thu Nov 12.
window.schedulesCenter = function () {
  const { R, card, sent, figs, dots } = window.centerMock;
  const S = [
    ['diverged', 'Docs sync', 'Missed Nov 10, 06:00', 'Keeps the docs in step with the code.', ['miss'], 'Worca was off 05:10 to 07:40', 'docs-site · Every Tuesday at 06:00 · Next Nov 17, 06:00', 'Run now'],
    ['working', 'Changelog digest', 'Running for 6 min', 'Writes the week\'s changes for the team.', ['ok', 'ok', 'ok', 'run'], '3 of 3 finished succeeded', 'docs-site · Every weekday at 14:30 · Next Nov 13, 14:30', 'Stop'],
    ['scheduled', 'Nightly export check', 'Next up', 'Checks the billing export still runs in time.', ['ok', 'ok', 'ok', 'ok', 'ok', 'fail', 'ok'], '6 of 7 succeeded · failed Nov 11 at Review', 'billing-api · Every day at 02:00 · Next Nov 13, 02:00', 'Run now'],
    ['scheduled', 'Weekly deps update', 'Next up', 'Bumps dependencies and opens a PR.', ['ok'], '1 of 1 succeeded · merged #108', 'worca-cc · Every Monday at 09:00 · Next Nov 16, 09:00', 'Run now'],
    ['paused', 'Cost report', 'Paused by you', 'Sums the week\'s AI spend.', [], 'No runs in 7 days', 'No project · Every Friday at 17:00 · Would run Nov 13, 17:00', 'Resume']];
  const cards = S.map(([st, title, kicker, what, runs, says, facts, action]) => card({ kind: 'schedule', st, breathe: st === 'diverged', kicker, title, what, extra: dots(runs, says), facts, action })).join('');
  return `${R.placeHead({ title: 'Your schedules', facts: '5 schedules · 10 of 11 runs succeeded in 7 days · times in Europe/Sofia' })}
    ${figs([['Needs you', 1], ['Running', 1], ['Next up', 2], ['Paused', 1]])}
    ${sent([['Showing', 'most urgent'], ['from', 'every project']])}
    <div class="pg-grid">${cards}</div>
    <p class="note">Mock, Advanced. Each number opens what it counts. Schedules needs Advanced, so it has no Simple form.</p>`;
};
