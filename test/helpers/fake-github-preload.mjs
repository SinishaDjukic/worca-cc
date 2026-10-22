// test/helpers/fake-github-preload.mjs — `node --import` it into a spawned CLI: the CHILD answers GitHub from its own fake
// (a parent's ghTesting.setFetch never reaches a child), so the child never touches the network.
// WORCA_TEST_FAKE_GH = JSON { "<owner/repo>": { "<branch>": { "<path>": "<text>" } } } — each branch an orphan commit.
import { fakeGithub } from './fake-github.mjs';
import { _testing } from '../../src/core/git-free/github.mjs';

const gh = await fakeGithub();
for (const [slug, branches] of Object.entries(JSON.parse(process.env.WORCA_TEST_FAKE_GH || '{}'))) {
  gh.repo(slug, { files: { a: '1' } });
  for (const [branch, files] of Object.entries(branches)) gh.commit(slug, { branch, orphan: true, files });
}
_testing.setFetch(gh.fetch);
process.on('exit', () => gh.close());
