// extension/src/build-flags.mjs — esbuild `define` targets. KEEP THIS MODULE TO THESE CONSTANTS: any other
// (non-constant) export stops esbuild inlining them, and the production build's test-hook check then throws.
export const BROWSER = typeof __WORCA_EXT_BROWSER__ === 'string' ? __WORCA_EXT_BROWSER__ : 'chrome';
export const TEST_BUILD = typeof __WORCA_EXT_TEST__ === 'boolean' ? __WORCA_EXT_TEST__ : false;
// The build's default Worca address ('' = none): WORCA_EXT_PORT / WORCA_EXT_BASE_URL at build time, testing only.
export const BUILD_BASE_URL = typeof __WORCA_EXT_DEFAULT_BASE_URL__ === 'string' ? __WORCA_EXT_DEFAULT_BASE_URL__ : '';
// The demo-video build (tools/demo/extension-video): a test build plus the demo stage's needs. Never in a release.
export const DEMO_BUILD = typeof __WORCA_EXT_DEMO__ === 'boolean' ? __WORCA_EXT_DEMO__ : false;
