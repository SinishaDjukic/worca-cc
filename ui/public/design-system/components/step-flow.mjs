// How a step runs (docs/rail/actions.md): it opens its Dialog if it needs fields, asks in the strip if others will see it
// or it cannot be taken back, then its button says what is happening, and either the thing moves on or the place you
// acted says what failed and why. One flow on every page. Pure: a page gives it hooks and draws what they set.

const WORKING = { Fix: 'Fixing…', Merge: 'Merging…', Create: 'Creating…', Stop: 'Stopping…', Discard: 'Discarding…', Archive: 'Archiving…', Cancel: 'Cancelling…', 'Re-plan': 'Re-planning…', Continue: 'Continuing…', Delete: 'Deleting…', Remove: 'Removing…', Reset: 'Resetting…', Push: 'Pushing…', Publish: 'Pushing…', Apply: 'Applying…', Link: 'Linking…', Update: 'Updating…', Report: 'Sending…' };

/** What a step's button says while it works. */
export const workingWord = (label) => WORKING[String(label).split(' ')[0]] || 'Working…';

const DANGER = /^(Stop|Discard|Cancel|Delete|Remove|Reset)/;
/** The strip's words for a step that asks first. */
export const confirmOf = (f, label) => ({ text: f.confirm, yes: label.replace(/ the run$/, '') || 'Confirm', no: f.no || 'Cancel', danger: DANGER.test(label) });

/** A failure in the design system's words: Could not …, the reason, Nothing changed. */
export function failureOf(label, why, { odd = false } = {}) {
  const reason = odd || !why ? 'something went wrong on Worca’s side' : why;
  return { title: `Could not ${label.charAt(0).toLowerCase()}${label.slice(1)}`, detail: `${reason[0].toUpperCase()}${reason.slice(1)}. Nothing changed.`, reason, odd };
}

/**
 * The flow itself.
 * @param {object} h
 * @param {(f:object, label:string)=>boolean} h.dialogShown  the step's Dialog is already open
 * @param {(f:object, label:string)=>void} h.openDialog
 * @param {()=>boolean} h.confirmed      the person said yes in the strip
 * @param {(f:object, label:string)=>void} h.askConfirm
 * @param {(label:string)=>void} h.working
 * @param {(f:object, label:string)=>{ok:boolean, why?:string, odd?:boolean}} h.perform  decides how it ended
 * @param {(f:object, label:string)=>void} h.done
 * @param {(label:string, failure:object)=>void} h.failed
 * @param {(fn:()=>void)=>void} h.after  runs fn once the step has taken its time
 * @returns {(f:object, label:string)=>void}
 */
export function stepFlow(h) {
  return function follow(f, label) {
    if (f.dialog && !h.dialogShown(f, label)) { h.openDialog(f, label); return; }
    if (f.confirm && !h.confirmed()) { h.askConfirm(f, label); return; }
    if (f.confirm || f.dialog || f.fromDialog) {
      h.working(label);
      h.after(() => {
        const end = h.perform(f, label);
        if (end.ok) h.done(f, label); else h.failed(label, failureOf(label, end.why, { odd: end.odd }));
      });
      return;
    }
    h.done(f, label);
  };
}
