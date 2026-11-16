// The Tasks center, a card per project. A schedule's run that started is a task; a missed time never started, so it needs you but is not a task.
// 55 tasks = 51 + Changelog digest's running run and 3 finished. This week $39.50 = 11.60 + 6.20 + 18.40 + 0.60 + 2.70. Mock today is Thu Nov 12.
window.tasksCenter = function (simple) {
  const { R, card, sent, count } = window.centerMock;
  const P = [
    ['web-app', 'failed', 'Failed', '[Update Node to 24] failed at Build', '2 running · 2 waiting · $11.60 this week'],
    ['billing-api', 'question', 'Question', '[Add CSV export to billing]: Review asks which date format', '2 waiting · 1 merged · $6.20 this week'],
    ['worca-cc', 'gate', 'Needs approval', '[Migrate cron parser] waits for your OK; [Add pager] is ready to merge', '3 running · 3 waiting · 4 merged · $18.40 this week'],
    ['docs-site', 'diverged', 'Schedule missed', '[Docs sync] missed Nov 10; [Changelog digest] is running', '1 running · 1 waiting · 3 finished · $0.60 this week']];
  const cards = P.map(([title, st, kicker, what, facts]) => card({ kind: 'project', st, breathe: true, kicker, title, what, extra: '', facts, action: 'Open', button: '' })).join('');
  return `${R.placeHead({ title: 'Your tasks', facts: '55 tasks · $39.50 this week' })}
    ${sent([['Showing', 'most urgent'], ['by', 'project']])}
    ${simple ? '<p class="way">New work starts in Chat. <a class="dc-link" href="#chat">Go to Chat</a></p>' : ''}
    <div class="pg-grid">${cards}</div>
    ${R.list({ groups: [{ title: '', rows: [count('2 quiet projects', 'marketing-site, No project · 2 finished · $2.70 this week', '')] }] })}
    <p class="note">Mock, ${simple ? 'Simple' : 'Advanced'}. A schedule's run is a task once it starts. A row's branch icon names its state on hover.${simple ? ' Nothing is created from this page.' : ''}</p>`;
};
