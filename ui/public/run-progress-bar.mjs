// ui/public/run-progress-bar.mjs — the run progress bar (spec 2026-10-14 P2/P4/P8/P11).
// Idempotent painters over a host element: the skeleton is built once per mode, so the
// fill element survives every repaint and its width transitions (P2 "glides").
import { STAGE_LABEL, progressWidth } from '../../src/shared/run-progress.mjs';

const TICKS = [0.25, 0.5, 0.75];
const MARKS = ['plan', 'build', 'review', 'ready'];
const STATE_WORD = { done: 'done', current: 'now', waiting: 'waiting', skipped: 'not in this workflow' };

function el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** The bar for one run. `prog` is runProgress's result, or null to hide it. */
export function paintProgressBar(host, prog) {
  if (!host) return;
  host.hidden = !prog;
  if (!prog) return;
  const doc = host.ownerDocument;
  const staged = prog.mode === 'stages';
  if (host.dataset.mode !== prog.mode) {
    host.dataset.mode = prog.mode;
    const track = el(doc, 'div', 'run-prog-track');
    track.setAttribute('aria-hidden', 'true');
    track.appendChild(el(doc, 'div', 'run-prog-fill'));
    if (staged) {
      for (const t of TICKS) {
        const k = el(doc, 'span', 'run-prog-tick');
        k.style.left = progressWidth(t);
        track.appendChild(k);
      }
    }
    const kids = [track];
    if (staged) {
      const marks = el(doc, 'div', 'run-prog-marks');
      marks.setAttribute('aria-hidden', 'true');
      for (const id of MARKS) {
        const m = el(doc, 'span', 'run-prog-mark', STAGE_LABEL[id]);
        m.dataset.stage = id;
        marks.appendChild(m);
      }
      kids.push(marks);
      // P11: the breakdown, Advanced and up (the CSS level gate hides it in Simple, hover or not).
      const detail = el(doc, 'div', 'run-prog-detail');
      detail.dataset.minLevel = 'advanced';
      detail.setAttribute('role', 'tooltip');
      kids.push(detail);
    }
    host.replaceChildren(...kids);
  }
  host.dataset.tone = prog.tone;
  host.querySelector('.run-prog-fill').style.width = progressWidth(prog.fraction);
  if (!staged) return;
  for (const m of host.querySelectorAll('.run-prog-mark')) {
    const s = prog.stages.find((x) => x.id === m.dataset.stage);
    m.dataset.state = s ? s.state : 'waiting';
  }
  paintDetail(host.querySelector('.run-prog-detail'), prog);
}

/** P11: stages with their agents and states, plus the review pass count. No times. */
function paintDetail(detail, prog) {
  const sig = JSON.stringify([prog.stages, prog.passes]);
  if (!detail || detail.dataset.sig === sig) return;
  detail.dataset.sig = sig;
  const doc = detail.ownerDocument;
  const list = el(doc, 'ul', 'run-prog-stages');
  for (const s of prog.stages) {
    if (s.id === 'ready') continue;
    const li = el(doc, 'li', `run-prog-stage is-${s.state}`);
    const head = el(doc, 'span', 'run-prog-stage-name', `${s.label} · ${STATE_WORD[s.state] || s.state}`);
    li.appendChild(head);
    if (s.id === 'review' && prog.passes) li.appendChild(el(doc, 'span', 'run-prog-passes', ` · ${prog.passes} pass${prog.passes === 1 ? '' : 'es'}`));
    if (s.agents.length) {
      const agents = el(doc, 'ul', 'run-prog-agents');
      for (const a of s.agents) agents.appendChild(el(doc, 'li', `run-prog-agent is-${a.state}`, `${a.label} · ${STATE_WORD[a.state] || a.state}`));
      li.appendChild(agents);
    }
    list.appendChild(li);
  }
  detail.replaceChildren(list);
}

/** P8: the chain's overall bar, one equal part per run. `chain` is a runsChainItem (or null / a single run: hidden). */
export function paintChainBar(host, chain) {
  if (!host) return;
  host.hidden = !chain || !(chain.total >= 2);
  if (host.hidden) return;
  const doc = host.ownerDocument;
  if (Number(host.dataset.parts) !== chain.total) {
    host.dataset.parts = String(chain.total);
    const track = el(doc, 'div', 'run-chain-track');
    track.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < chain.total; i++) {
      const part = el(doc, 'div', 'run-chain-part');
      part.appendChild(el(doc, 'div', 'run-prog-fill'));
      track.appendChild(part);
    }
    host.replaceChildren(el(doc, 'div', 'run-chain-label'), track);
  }
  host.querySelector('.run-chain-label').textContent = chain.text;
  host.querySelectorAll('.run-chain-part').forEach((part, i) => {
    const p = chain.parts[i] || { state: 'waiting', fraction: 0, tone: 'blue' };
    part.dataset.state = p.state;
    part.dataset.tone = p.tone;
    part.firstElementChild.style.width = progressWidth(p.fraction);
  });
}

/**
 * P7: the Runs list's 3px line (the row builder calls it; paintRunsProgress patches it in place).
 * `from` is the width the row's previous line had before a rebuild ("37.50%"). The new line starts there,
 * and paintRunsProgress then moves it to the target, so a rebuilt row still glides (P2).
 */
export function renderRowLine(doc, p, from = '') {
  const line = el(doc, 'span', 'runs-row-prog');
  line.setAttribute('aria-hidden', 'true');
  line.dataset.tone = (p && p.tone) || 'blue';
  const fill = doc.createElement('i');
  fill.style.width = from || progressWidth(p ? p.fraction : 0);
  line.appendChild(fill);
  return line;
}
