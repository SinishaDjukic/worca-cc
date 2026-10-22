// ui/public/project-git.mjs — Use git (a Folder project → Git in place) and Link remote (a Git project without
// origin): which one a project offers, and the dialog's words. Pure; POST /api/projects/:key/git-init does the work.

/** 'init' for a Folder project, 'link' for a Git project whose loaded sync block has no remote, else null. */
export function gitActionFor(p, block, loaded) {
  if (!p || !p.key || !p.exists) return null;
  if (p.vcs === 'none') return 'init';
  if (p.vcs === 'git' && loaded && block && !block.remote) return 'link';
  return null;
}

export const GIT_DIALOG = Object.freeze({
  init: Object.freeze({
    button: 'Use git', title: 'Use git for this project', save: 'Use git', busy: 'Setting up git…', optional: true,
    lead: 'Runs git init in the folder. Your files stay as they are; the first run commits them.',
  }),
  link: Object.freeze({
    button: 'Link remote', title: 'Link a remote', save: 'Link remote', busy: 'Linking…', optional: false,
    lead: 'Adds the repository as origin. Nothing is pushed.',
  }),
});

/** The Projects list's message after a successful Use git / Link remote. */
export function gitDoneMessage(action, name, remote) {
  if (action === 'link') return `Linked “${name}” to ${remote}.`;
  return remote ? `“${name}” now uses git, linked to ${remote}.` : `“${name}” now uses git.`;
}
