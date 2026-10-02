// VitePress config for docs.worca.dev.
//
// The pages are the repo's own docs/*.md (srcDir), so the docs stay one set of
// files that reads the same on GitHub and on the site. Only the top level of
// docs/ is the site: plans, specs, the changelog sources and the deck folder
// are excluded here and built (or not) by build.mjs.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..');
const repo = path.resolve(site, '..');

const REPO_URL = 'https://github.com/SinishaDjukic/worca-cc';
const version = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version;

// docs/ folders that are not pages on the site. why-worca/ is served by
// build.mjs as the deck at /why-worca/, the rest only exist on GitHub.
const EXCLUDED_DIRS = ['superpowers', 'plans', 'changelog', 'why-worca', 'ui-primitives'];
const SITE_PAGES = { 'why-worca/': '/why-worca/' };

// A relative link that leaves the rendered pages (../docker/.env.example,
// ../CONTRIBUTING.md, plans/…) goes to the file on GitHub instead of failing
// the dead-link check, so the markdown keeps links that work on GitHub.
function outsideLinks(md) {
  md.core.ruler.push('worca-outside-links', (state) => {
    const from = path.posix.join('docs', path.posix.dirname(state.env.relativePath ?? ''));
    for (const block of state.tokens) {
      for (const token of block.children ?? []) {
        if (token.type !== 'link_open') continue;
        const href = token.attrGet('href');
        if (!href || /^([a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) continue;
        const [target, hash = ''] = href.split('#');
        const resolved = path.posix.join(from, target);
        const inDocs = resolved.startsWith('docs/') ? resolved.slice('docs/'.length) : null;
        if (inDocs !== null && SITE_PAGES[inDocs]) {
          token.attrSet('href', SITE_PAGES[inDocs]);
          token.attrSet('target', '_self');
          continue;
        }
        const leavesSite = inDocs === null || EXCLUDED_DIRS.some((d) => inDocs.startsWith(`${d}/`));
        if (!leavesSite) continue;
        const kind = resolved.endsWith('/') ? 'tree' : 'blob';
        token.attrSet('href', `${REPO_URL}/${kind}/dev/${resolved.replace(/\/$/, '')}${hash ? `#${hash}` : ''}`);
      }
    }
  });
}

// Pages are Vue templates, so `{{ … }}` in inline code (a docker --format
// string, say) would be evaluated. Fenced blocks are already v-pre.
function literalInlineCode(md) {
  const render = md.renderer.rules.code_inline;
  md.renderer.rules.code_inline = (...args) => render(...args).replace(/^<code/, '<code v-pre');
}

// The compiled pages live in ../docs, outside this package, so their imports
// (vue, vue/server-renderer) would be looked up from docs/: no node_modules
// there, and none at the repo root on Workers Builds. Look them up from here.
function resolveFromSite() {
  const docs = path.join(repo, 'docs') + path.sep;
  const anchor = path.join(here, 'config.mjs');
  return {
    name: 'worca-resolve-from-site',
    enforce: 'pre',
    async resolveId(id, importer, options) {
      if (!importer?.startsWith(docs) || /^[./\0]|^[a-z]+:/i.test(id)) return null;
      const resolved = await this.resolve(id, anchor, { ...options, skipSelf: true });
      // The server bundle runs from .vitepress/.temp, where Node finds the
      // package itself; bundling it would inline vue's CommonJS build.
      if (options?.ssr && resolved?.id.includes('/node_modules/')) return { id, external: true };
      return resolved;
    },
  };
}

export default defineConfig({
  title: 'Worca',
  titleTemplate: ':title · Worca docs',
  description: 'Documentation for Worca, a deterministic multi-agent pipeline that drives Claude Code.',
  lang: 'en-US',
  srcDir: '../docs',
  srcExclude: [...EXCLUDED_DIRS.map((d) => `${d}/**`), 'README.md'],
  outDir: 'dist',
  cleanUrls: true,
  // Upper-case file names read well in a repo, not in a URL; /why-worca/ is the deck.
  rewrites: {
    'ARCHITECTURE.md': 'architecture.md',
    'RELEASING.md': 'releasing.md',
    'why-worca.md': 'differentiators.md',
  },
  sitemap: { hostname: 'https://docs.worca.dev' },
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/worca-favicon.png' }],
  ],
  markdown: {
    config: (md) => {
      outsideLinks(md);
      literalInlineCode(md);
    },
  },
  vite: {
    // srcDir is ../docs, which would make docs/public the public folder.
    publicDir: path.join(site, 'public'),
    plugins: [resolveFromSite()],
    // Vite picks SSR externals by resolving them from its root, which VitePress
    // sets to srcDir (../docs), where nothing resolves; it would then bundle
    // vue's CommonJS build into the server bundle, which fails to load.
    ssr: { external: ['vue', 'vue/server-renderer', '@vue/server-renderer', '@vue/shared'] },
  },
  themeConfig: {
    // The wordmark is painted by custom.css (a mask, as in the app).
    siteTitle: 'Docs',
    nav: [
      { text: 'Guide', link: '/architecture', activeMatch: '^/(?!$)' },
      { text: 'Changelog', link: '/changelog/', target: '_self' },
      { text: 'Why Worca', link: '/why-worca/', target: '_self' },
      {
        text: version,
        items: [
          { text: 'Release notes', link: `${REPO_URL}/releases/tag/worca-app-v${version}` },
          { text: 'npm', link: 'https://www.npmjs.com/package/@worca/app' },
          { text: 'worca.dev', link: 'https://worca.dev' },
        ],
      },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'Differentiators', link: '/differentiators' },
          { text: 'Getting started', link: '/getting-started' },
          { text: 'UI levels', link: '/ui-levels' },
        ],
      },
      {
        text: 'Running work',
        items: [
          { text: 'Guardrails', link: '/guardrails' },
          { text: 'Actions', link: '/actions' },
          { text: 'Scheduled runs', link: '/scheduled-runs' },
          { text: 'Scripts', link: '/scripts' },
          { text: 'Workspace map', link: '/workspace-map' },
        ],
      },
      {
        text: 'Models and tools',
        items: [
          { text: 'Models', link: '/models' },
          { text: 'MCP servers', link: '/mcp-servers' },
          { text: 'Credential broker', link: '/credential-broker' },
        ],
      },
      {
        text: 'Voice',
        items: [
          { text: 'Voice mode', link: '/speech' },
          { text: 'Voice languages', link: '/speech-languages' },
        ],
      },
      {
        text: 'Teams',
        items: [
          { text: 'Team metrics', link: '/team-metrics' },
          { text: 'RunRecord v1', link: '/team-metrics-record-v1' },
          { text: 'Team policy', link: '/team-policy' },
        ],
      },
      {
        text: 'Deploy and operate',
        items: [
          { text: 'Storage', link: '/storage' },
          { text: 'Docker', link: '/docker' },
          { text: 'Deploy on Railway', link: '/deploy-railway' },
          { text: 'Remote access', link: '/remote-access' },
        ],
      },
      {
        text: 'Contributing',
        items: [
          { text: 'Contributing', link: `${REPO_URL}/blob/dev/CONTRIBUTING.md` },
          { text: 'Releasing', link: '/releasing' },
          { text: 'Screenshots', link: '/screenshots' },
        ],
      },
    ],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    editLink: {
      pattern: `${REPO_URL}/edit/dev/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    socialLinks: [{ icon: 'github', link: REPO_URL }],
    footer: {
      message: `@worca/app ${version}`,
    },
  },
});
