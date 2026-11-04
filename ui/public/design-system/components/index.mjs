// The Worca Rail components (docs/design-system.md › Worca Rail; docs/design-system-catalog.json names each one's
// module). Build a page from these: a component brings its look, so a page sets no size, colour, corner or shadow.
export { esc, attrs, cls, toElement } from './html.mjs';
export { button, splitButton } from './button.mjs';
export { compactMenu } from './compact-menu.mjs';
export { statusDot, statusLine } from './status-line.mjs';
export { confirmStrip, confirmActions } from './confirm-strip.mjs';
export { tabs } from './tabs.mjs';
export { segmented } from './segmented.mjs';
export { figure, figures } from './figures.mjs';
export { toast, errorToast } from './toast.mjs';
export { emptyState } from './empty-state.mjs';
export { textLink } from './text-link.mjs';
export { morph } from './motion.mjs';
export { sentencePicker, switchButton, settingsRow, settingsSection } from './settings-row.mjs';
