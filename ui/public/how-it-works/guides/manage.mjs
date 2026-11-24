// "How it works" copy for the manage areas: Projects, Team policy and Settings. Static data only:
// no imports, no state, no DOM. area-guides.mjs freezes and serves it.

export const MANAGE_GUIDES = {
  projects: {
    title: 'How Projects work',
    tour: 'project',
    steps: [
      { id: 'what', title: 'Registered folders', paras: [
        'A project is a folder Worca knows about. Removing one keeps its run history. A project Worca created without git in its own projects folder is deleted with that folder, after you confirm.',
      ] },
      { id: 'add', title: 'Add a project', paras: [
        'Press Add project. The New tab starts a fresh project. The Folder tab picks one you already have.',
      ] },
      { id: 'page', title: 'A project’s page', paras: [
        'Open a project for its details and memory. Its tabs hold the settings that belong to that project alone.',
      ] },
    ],
    controls: [
      { label: 'Add project', file: 'ui/public/projects/projects.html' },
      { label: 'New', file: 'ui/public/projects/project-add.html' },
      { label: 'Folder', file: 'ui/public/projects/project-add.html', find: '>Folder</button>' },
    ],
  },

  'team-policy': {
    title: 'How Team policy works',
    tour: 'teamPolicy',
    steps: [
      { id: 'what', title: 'Shared expectations', paras: [
        'A team policy writes your team’s expectations on a git branch. It is soft by design: it guides runs and does not lock anyone out.',
        'It shows at the Expert level.',
      ] },
      { id: 'page', title: 'The policy page', paras: [
        'The sync chip says whether you hold the latest policy. Refresh checks again. Edit policy opens it for changes.',
      ] },
      { id: 'setup', title: 'Set it up from a project', paras: [
        'Open a project, go to its Team tab and choose Set up policy…. Nothing is shared until you do.',
      ] },
    ],
    controls: [
      { label: 'Refresh', file: 'ui/public/team-policy-view.mjs' },
      { label: 'Edit policy', file: 'ui/public/team-policy-view.mjs' },
      { label: 'Set up policy…', file: 'ui/public/team-policy-view.mjs' },
    ],
  },

  settings: {
    title: 'How Settings work',
    tour: null,
    steps: [
      { id: 'tabs', title: 'The tabs', paras: [
        'General holds the look, alerts, folders and the interface mode. Runs holds how runs behave. Chat, Guardrails and Memory shape what the agents do.',
        'Some tabs show only at higher levels.',
      ] },
      { id: 'labs', title: 'Labs', paras: [
        'Labs holds experimental switches. They can change or go away, so leave them off unless you want to try one.',
      ] },
      { id: 'again', title: 'Bring the guides back', paras: [
        'The Getting started card’s button (Show again, or Open checklist) also brings the How it works marks back, so guides you have read show as new again. You can open any guide whenever you like.',
      ] },
    ],
    controls: [
      { label: 'Labs', file: 'ui/public/settings/settings.html' },
      { label: 'Show again', file: 'ui/public/settings/settings.html' },
    ],
  },
};
