// ui/public/action-errors.mjs — runs redesign §5a.2: a failed action says what failed and what to do. One wording for
// the Runs list, groups, schedules, the chat card and the run / group pages.
export const UNREACHABLE_DETAIL = "Worca's server could not be reached. Nothing was changed. Try again once the connection is back.";
const NEXT = {
  404: 'Reload the list to see what is there now.',
  409: 'Reload the list, then try again.',
  403: 'Ask an admin for access.',
};

/** An Error that keeps the HTTP status, from a non-ok response and its parsed JSON body. */
export function httpError(res, body = {}) {
  const e = new Error((body && body.error) || `HTTP ${res.status}`);
  e.status = res.status;
  return e;
}

const isNetwork = (err) => err instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed/i.test(String(err && err.message));

/** `what` completes "Could not …" ("archive the selected runs"); `err` an Error, a string reason, or anything else.
 *  `next` replaces the next step where "Nothing was changed" would be false (the archive Undo). */
export function actionError(what, err, { next = '' } = {}) {
  const title = `Could not ${what}`;
  if (isNetwork(err)) return { tone: 'err', title, detail: next ? `Worca's server could not be reached. ${next}` : UNREACHABLE_DETAIL };
  const msg = String((err && err.message) || err || '').trim().replace(/\.+$/, '');
  const status = err && typeof err === 'object' ? err.status : undefined;
  return { tone: 'err', title, detail: `${msg || 'Unknown error'}. ${next || NEXT[status] || 'Nothing was changed; try again.'}` };
}
