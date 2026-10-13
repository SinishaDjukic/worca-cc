// extension/src/build-flags.mjs — esbuild `define` targets. KEEP THIS MODULE TO THESE TWO CONSTANTS: any other
// (non-constant) export stops esbuild inlining them, and the production build's test-hook check then throws.
export const BROWSER = typeof __WORCA_EXT_BROWSER__ === 'string' ? __WORCA_EXT_BROWSER__ : 'chrome';
export const TEST_BUILD = typeof __WORCA_EXT_TEST__ === 'boolean' ? __WORCA_EXT_TEST__ : false;
