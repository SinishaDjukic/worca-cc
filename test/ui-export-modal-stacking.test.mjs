import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The export modal invokes the shared folder browser (Browse…). Both are
// `.viewer-modal` elements (base z-index 50) and `#export-modal` is declared
// AFTER `#folder-browser` in the DOM, so at equal z-index the export modal
// paints on top and the picker renders behind it (unusable). The folder
// browser is a leaf picker always opened FROM another modal, so it must stack
// above the export modal.
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments so their prose is not read as selectors
const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');

/** Highest z-index among CSS rules whose selector satisfies `match(selector)`. */
function maxZIndex(match) {
  let max = -Infinity;
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (!match(m[1].trim())) continue;
    const z = m[2].match(/z-index\s*:\s*(-?\d+)/);
    if (z) max = Math.max(max, Number(z[1]));
  }
  return max;
}

test('folder browser stacks above the export modal (Browse… picker is usable)', () => {
  // Both are viewer modals, and the export modal is later in the DOM.
  assert.match(html, /id="folder-browser"[^>]*class="[^"]*viewer-modal/);
  assert.match(html, /id="export-modal"[^>]*class="[^"]*viewer-modal/);
  assert.ok(html.indexOf('id="export-modal"') > html.indexOf('id="folder-browser"'),
    'export modal must come after the folder browser in the DOM (the reason for the collision)');

  const folderZ = maxZIndex((sel) => sel.includes('#folder-browser'));
  // The export modal has no id-specific override, so its effective z-index is
  // the base `.viewer-modal` rule (not the confirm-/folder-specific overrides).
  const exportZ = maxZIndex((sel) => sel === '.viewer-modal' || sel.includes('#export-modal'));
  assert.ok(folderZ > exportZ,
    `folder browser (z-index ${folderZ}) must stack above the export modal (z-index ${exportZ})`);
});
