// The "How it works" controller: places the button (global top bar, and the Workflows editor
// bar where the top bar is not shown), shows it per route, opens an area's explainer, records
// "seen" the moment it opens and starts the matching tour. It builds no markup of its own:
// the button comes from howto-button.mjs and the dialog from guide-dialog.mjs.
import { openGuideDialog } from './guide-dialog.mjs';
import { guideFor, areaOfRoute } from './area-guides.mjs';
import { howtoButtonElement, paintHowtoMark } from './howto-button.mjs';
import { isGuideSeen } from '../../../src/shared/how-it-works/areas.mjs';

const MODAL_ID = 'how-it-works-modal';
const TOUR_LABEL = 'Show me in the product';
const TOP_ID = 'howto-btn';
const WORKFLOWS_ID = 'wfv-howto-btn';
const WORKSPACES_BTN_ID = 'ws-howto-btn';

// The patch POST /api/onboarding takes: the legacy flag for Workspaces, the map for the rest.
function seenPatch(areaId) {
  return areaId === 'workspaces' ? { workspaceGuideSeen: true } : { guidesSeen: { [areaId]: true } };
}

// The status with the area marked seen, as a new object.
function withSeen(status, areaId) {
  if (areaId === 'workspaces') return { ...status, workspaceGuideSeen: true };
  return { ...status, guidesSeen: { ...status.guidesSeen, [areaId]: true } };
}

// A sample figure: made-up items under a caption. The shell asks for art through this builder.
function buildArt(doc, art) {
  if (!art || art.kind !== 'sample') return [];
  const fig = doc.createElement('figure');
  fig.className = 'wg-art';
  const ul = doc.createElement('ul');
  for (const text of art.items) {
    const li = doc.createElement('li');
    li.textContent = text;
    ul.append(li);
  }
  const cap = doc.createElement('figcaption');
  cap.className = 'wg-caption';
  cap.textContent = art.caption;
  fig.append(ul, cap);
  return [fig];
}

export function createHowItWorks({ doc, getStatus, setStatus, postPrefs, startTour, log = console.error }) {
  let route = null;
  let handle = null;
  let top = null;
  let workflows = null;

  const currentArea = () => areaOfRoute(route);
  const byId = (id) => doc.getElementById(id);

  function place(id, cls, host, before, icon = false) {
    const existing = byId(id);
    if (existing) return existing;
    if (!host) return null;
    const el = howtoButtonElement(doc, { id, cls, icon });
    el.hidden = true;
    el.addEventListener('click', () => { const a = currentArea(); if (a) open(a); });
    host.insertBefore(el, before);
    return el;
  }

  function mount() {
    const right = doc.querySelector('.topnav-r');
    top = place(TOP_ID, 'topnav-howto', right, right?.firstChild ?? null);
    const lib = byId('wfv-lib-toggle');
    workflows = place(WORKFLOWS_ID, 'wfv-howto', lib?.parentNode ?? null, lib, true);   // an icon, like the Library toggle beside it
  }

  function titleFor(guide) {
    const page = doc.getElementById('topnav-title')?.textContent.trim();
    return page ? `How ${page} works` : guide.title;
  }

  function paintMarks() {
    const mark = (btn, area) => { if (btn) paintHowtoMark(btn, !!area && isGuideSeen(getStatus(), area) === false); };
    const area = currentArea();
    mark(top, area && area !== 'workspaces' && area !== 'workflows' ? area : null);
    mark(workflows, 'workflows');
    mark(byId(WORKSPACES_BTN_ID), 'workspaces');
  }

  function syncRoute(name) {
    if (name !== route && handle) handle.close('close');
    route = name;
    const area = currentArea();
    const guide = area ? guideFor(area) : null;
    if (top) {
      top.hidden = !(guide && area !== 'workspaces' && area !== 'workflows');
      if (guide) top.title = titleFor(guide);
    }
    if (workflows) workflows.hidden = area !== 'workflows';
    paintMarks();
  }

  async function markSeen(areaId) {
    const status = getStatus();
    if (status) setStatus(withSeen(status, areaId));
    try {
      const result = await postPrefs(seenPatch(areaId));
      if (result == null) log(`how-it-works: could not record "${areaId}" as seen`);
    } catch (err) {
      log(`how-it-works: could not record "${areaId}" as seen`, err);
    }
  }

  function open(areaId) {
    const guide = guideFor(areaId);
    if (!guide || handle) return;
    handle = openGuideDialog({
      doc,
      id: MODAL_ID,
      steps: guide.steps,
      buildArt,
      tour: guide.tour ? { label: TOUR_LABEL } : null,
      dataset: { area: areaId },
      onClose: (how) => {
        handle = null;
        if (how === 'tour' && guide.tour) {
          Promise.resolve(startTour(guide.tour)).catch((err) => log(`how-it-works: could not start the "${guide.tour}" tour`, err));
        }
      },
    });
    markSeen(areaId);
    paintMarks();
  }

  return { mount, syncRoute, paintMarks, open, markSeen };
}
