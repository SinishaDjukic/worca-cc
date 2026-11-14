// Invitation (docs/rail/components.md, docs/rail/navigation.md `nav.stillhet-ask`): the one question that asks, once for the
// whole install, whether to try Stillhet. It is a ConfirmStrip with Stillhet's words and no markup of its own.
import { confirmStrip } from './confirm-strip.mjs';

const TEXT = "Stillhet is an evolution of Worca's design system, in beta: calm, only what needs you is lit, and Chat comes first. Try it while it is shaped, and";

/**
 * @param {object} o
 * @param {string} o.bugsUrl                     the GitHub issues page (https:)
 * @param {'yes'|'no'|false} [o.busy]            which answer is being saved
 * @param {{title:string, detail:string, from:'yes'|'no'}|null} [o.err]  what failed, and which answer it was
 */
export function stillhetInvitation({ bugsUrl, busy = false, err = null }) {
  return confirmStrip({
    text: TEXT,
    yes: 'Try Stillhet',
    no: err && err.from === 'no' ? 'Not now' : 'No thanks',
    busy: busy === 'yes' ? 'Turning on…' : '',
    noBusy: busy === 'no' ? 'Saving…' : '',
    err,
    back: true,
    link: { label: 'Report bugs on GitHub', href: bugsUrl },
    id: 'stillhet-strip-t',
    attrs: { 'data-stillhet': 'invitation' },
  });
}
