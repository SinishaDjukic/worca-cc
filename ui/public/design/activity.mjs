// ui/public/design/activity.mjs — the open Design builds the top bar's Activity lists (activity-model.mjs turns
// them into rows). hello's list (C-5 hello.design) replaces them, a design-build frame moves one, and a terminal
// status removes it. Unlike view.mjs createDesignLive it keeps a paused build (it needs you), the number of
// questions waiting and the title. A design-build frame carries no title, so a build this tab first meets in a
// frame reads "Design" until loadTitle(id) answers a non-empty string. A title is asked for once per design,
// and never for one hello named; a later build of the same design keeps the title already known.
//
//   const activity = createDesignActivity({ loadTitle, onChange });
//   activity.hello(list)   replace the builds (an older server's hello has no list: none)
//   activity.frame(f)      true when the list changed, so the caller repaints the badge
//   activity.items()       [{ designId, title, status, waiting }], in the order first seen
//
// loadTitle(designId) → a Promise of the title (anything but a non-empty string, or a rejection, keeps
// "Design"); onChange() runs when a loaded title lands on a row still listed.

const OPEN_BUILD = ['planning', 'building', 'integrating', 'paused'];
const PLAIN_TITLE = 'Design';

const realTitle = (t) => typeof t === 'string' && t.trim() !== '';
const waitingOf = (n) => (Number(n) > 0 ? Math.floor(Number(n)) : 0);

export function createDesignActivity({ loadTitle, onChange }) {
  const rows = new Map();     // designId -> { designId, title, status, waiting }
  const titles = new Map();   // designId -> the last real title seen, from hello or a load
  const asked = new Set();    // designIds whose title was asked for

  const titleOf = (designId) => titles.get(designId) ?? PLAIN_TITLE;
  const learn = (designId, title) => {
    if (!realTitle(title)) return;
    titles.set(designId, title);
    const row = rows.get(designId);
    if (!row) return;                                // a late title never brings a row back
    row.title = title;
    onChange();
  };

  return {
    hello(list) {
      rows.clear();
      for (const d of Array.isArray(list) ? list : []) {
        if (!d || typeof d.designId !== 'string' || !d.designId) continue;
        if (realTitle(d.title)) titles.set(d.designId, d.title);
        rows.set(d.designId, { designId: d.designId, title: titleOf(d.designId), status: d.status, waiting: waitingOf(d.waiting) });
      }
    },
    frame(f) {
      if (f?.type !== 'design-build' || typeof f.designId !== 'string' || !f.designId) return false;
      const id = f.designId;
      if (!OPEN_BUILD.includes(f.status)) return rows.delete(id);   // it finished; an unknown id loads nothing
      const waiting = waitingOf(f.waiting);
      const row = rows.get(id);
      if (row) {
        if (row.status === f.status && row.waiting === waiting) return false;
        row.status = f.status;
        row.waiting = waiting;
        return true;
      }
      rows.set(id, { designId: id, title: titleOf(id), status: f.status, waiting });
      if (!titles.has(id) && !asked.has(id)) {
        asked.add(id);
        loadTitle(id).then((title) => learn(id, title), () => {});
      }
      return true;
    },
    items() {
      return [...rows.values()].map(({ designId, title, status, waiting }) => ({ designId, title, status, waiting }));
    },
  };
}
