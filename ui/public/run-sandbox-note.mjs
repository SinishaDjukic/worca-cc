// ui/public/run-sandbox-note.mjs — where a run's agents execute, said plainly (docs/choose-a-setup.md): the run page
// header's execution-environment segment (a remote backend's label, "waiting for … slot", "building the sandbox image",
// or, for a Local run on a native install, a quiet "not sandboxed" link) and New run's note under "Runs in".
import { docsLink, docsUrl } from './docs-links.mjs';

export const NOT_SANDBOXED_TEXT = 'not sandboxed';
export const NOT_SANDBOXED_TITLE = "This run's agents and scripts run directly on this machine, as your user: they can read and change what you can. A Local sandbox (Docker) or E2B run keeps them in a container. Opens Choose a setup.";
export const LOCAL_NOTE_TEXT = 'Local runs are not sandboxed: agents work on this machine, as your user.';
/** The run state's `execEnvPreparing` value while a backend builds its default image on first use. */
export const PREPARING_IMAGE_BUILD = 'image-build';

/**
 * The run page header's segment, or null for none: [className, text, strong, { title?, href? }].
 * @param {object} r  the run (execEnv, execEnvWaiting, execEnvPreparing)
 * @param {{box?: string, label: (n: string) => string, titleWithArticle: (n: string) => string}} o
 */
export function runExecEnvSeg(r, { box = 'native', label, titleWithArticle }) {
  if (r?.execEnv && r.execEnv !== 'local') {
    if (r.execEnvPreparing === PREPARING_IMAGE_BUILD) {
      return ['rd-exec-env', 'building the sandbox image, first use…', false,
        { title: `${label(r.execEnv)}: Worca builds its sandbox image on this machine once per Worca upgrade. It takes a few minutes; the run starts when it is done. The Logs tab shows the build steps.` }];
    }
    if (r.execEnvWaiting) return ['rd-exec-env', `waiting for ${titleWithArticle(r.execEnv)} slot`, false, {}];
    return ['rd-exec-env', label(r.execEnv), false, {}];
  }
  if (box !== 'native' || !r) return null;
  return ['rd-exec-env rd-not-sandboxed', NOT_SANDBOXED_TEXT, false, { title: NOT_SANDBOXED_TITLE, href: docsUrl('choose-a-setup') }];
}

/** One segment node (a link when it has an href: it opens the guide in a new tab). */
export function execEnvSegNode(doc, [cls, text, strong, extra = {}]) {
  const node = doc.createElement(extra.href ? 'a' : 'span');
  node.className = cls + (strong ? ' strong' : '');
  node.textContent = text;
  if (extra.title) node.title = extra.title;
  if (extra.href) { node.href = extra.href; node.target = '_blank'; node.rel = 'noopener noreferrer'; }
  return node;
}

/** The run card's execution-environment line, under its status block (`.rd-sheet .run-status`): the header's segment
 *  sits in a header the one-level run page hides, so the card says it where the status is read. `seg` from
 *  runExecEnvSeg (null hides the line). Rebuilt only when what it says changes. */
export function paintRunExecLine(block, seg) {
  if (!block || !block.parentNode) return;
  const doc = block.ownerDocument;
  let line = block.parentNode.querySelector(':scope > .rd-exec-line');
  if (!seg) { if (line) line.hidden = true; return; }
  if (!line) { line = doc.createElement('p'); line.className = 'rd-exec-line'; block.after(line); }
  line.hidden = false;
  const sig = JSON.stringify(seg);
  if (line.dataset.sig === sig) return;
  line.dataset.sig = sig;
  const [cls, text, , extra = {}] = seg;
  line.title = extra.title || '';
  // Plain sentence-case words in the card's meta style; a Local run's line links its guide (a blue docs link).
  if (cls.includes('rd-not-sandboxed')) line.replaceChildren(doc.createTextNode('Not sandboxed · '), docsLink(doc, 'choose-a-setup', 'Choose a setup'));
  else line.replaceChildren(doc.createTextNode(cls === 'rd-exec-env' && !/^(waiting|building)/.test(text) ? `Runs in ${text}` : text.charAt(0).toUpperCase() + text.slice(1)));
}

/** New run's note under "Runs in": shown for a Local run on a native install. */
export function paintLocalRunNote(node, { show }) {
  if (!node) return;
  node.hidden = !show;
  if (!show || node.dataset.painted) return;
  const doc = node.ownerDocument;
  node.replaceChildren(doc.createTextNode(`${LOCAL_NOTE_TEXT} `), docsLink(doc, 'choose-a-setup', 'Choose a setup'));
  node.dataset.painted = '1';
}
