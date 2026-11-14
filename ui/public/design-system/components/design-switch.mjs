// DesignSwitch (docs/rail/navigation.md `nav.design-switch`): turns Stillhet on or off from the top bar. A Switch with the
// label "Stillhet UI" and a beta chip. Locked by WORCA_FLAGS, it is disabled and says why.
import { attrs } from './html.mjs';
import { chip } from './chip.mjs';
import { switchButton } from './settings-row.mjs';

const LOCKED = 'Locked by WORCA_FLAGS';

/** @param {{on:boolean, locked?:boolean, busy?:boolean}} o */
export function designSwitch({ on, locked = false, busy = false }) {
  const sw = switchButton({
    on, label: 'Stillhet UI', why: locked ? LOCKED : '', disabled: locked || busy,
    attrs: { 'data-design-switch': '', 'aria-busy': busy ? 'true' : null, 'aria-describedby': locked ? 'stillhet-switch-why' : null },
  });
  const why = locked ? `<span class="rl-design-switch-why" id="stillhet-switch-why" hidden>${LOCKED}</span>` : '';
  return `<span class="rl-design-switch"${attrs({ 'data-stillhet': 'design-switch' })}>${sw}<span class="rl-design-switch-l">Stillhet UI</span>${chip({ text: 'beta' })}${why}</span>`;
}
