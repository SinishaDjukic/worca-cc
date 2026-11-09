// The Tasks center, Marketplace-style: a card per project, from the prototype's 51 tasks. Needs 4 + Running 5 + Waiting 8 + Finished 34 = 51;
// merged this week 5; cost $138.52 (54.22 + 44.10 + 37.50 + 1.90 + 0.80). Mock today is Thu Nov 12.
window.tasksCenter = function (simple) {
  const { R, card, sent, figs } = window.centerMock;
  const P = [
    ['web-app', 'failed', 'Update Node to 24 failed at Build', 1, 2, 2, 9, 0, '$44.10', 'active now'],
    ['billing-api', 'question', 'Add CSV export: Review asks which date format', 1, 0, 2, 9, 1, '$37.50', 'last activity 14:32'],
    ['worca-cc', 'gate', 'Migrate cron parser waits for your OK; Add pager is ready to merge', 2, 3, 3, 14, 4, '$54.22', 'active now'],
    ['docs-site', 'scheduled', 'Nothing needs you', 0, 0, 1, 0, 0, '$0.00', 'last activity Nov 3'],
    ['marketing-site', 'scheduled', 'Nothing needs you', 0, 0, 0, 1, 0, '$1.90', 'last activity Nov 11'],
    ['No project', 'scheduled', 'Nothing needs you', 0, 0, 0, 1, 0, '$0.80', 'last activity Nov 11']];
  const cards = P.map(([t, st, what, n, r, w, f, m, c, last]) => card({ kind: 'project', st, breathe: !!n && st !== 'scheduled', kicker: n ? `${n} need${n === 1 ? 's' : ''} you` : 'Nothing needs you', title: t, what: n ? what : 'All in hand', extra: figs([['Needs you', n], ['Running', r], ['Waiting', w], ['Finished', f]]), facts: `${m} merged this week · ${c} · ${last}`, action: `Open ${t === 'No project' ? 'these' : t} tasks` })).join('');
  return `${R.placeHead({ title: 'Your tasks', facts: '51 tasks · 5 merged this week · $138.52' })}
    ${figs([['Needs you', 4], ['Running', 5], ['Waiting', 8], ['Finished', 34]])}
    ${sent([['Showing', 'most urgent'], ['by', 'project']])}
    ${simple ? '<p class="way">New work starts in Chat. <a class="dc-link" href="#chat">Go to Chat</a></p>' : ''}
    <div class="pg-grid">${cards}</div>
    <p class="note">Mock, ${simple ? 'Simple' : 'Advanced'}. Each number opens what it counts; each card opens Tasks narrowed to it. By switches project and workflow.${simple ? ' Nothing is created from this page: no +, no form, no Legacy approach.' : ' Legacy creation appears from Advanced up.'}</p>`;
};
