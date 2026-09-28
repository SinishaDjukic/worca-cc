// pkg-dotnet: *.csproj / *.fsproj / *.vbproj, Directory.Build.props, packages.config.
//   provides  nuget:<PackageId>, else nuget:<AssemblyName>, else nuget:<project file name>
//             (the MSBuild default; confidence heuristic)
//   consumes  <PackageReference Include=…> (attribute order free, Update= ignored),
//             packages.config <package id=…>, and <ProjectReference Include=…> that
//             resolves into ANOTHER member (key = referenced project file name, target =
//             that member). Intra-member project references are not facts.
// MSBuild properties ($(Foo)) in a name → unresolved. A test project (`tests/X.Tests/…`) keeps its
// facts (marked test by extract) but sets no stack.
import { basename } from 'node:path';
import { scanXml } from './lib/xml.mjs';
import { splitLines, fact, memberForPath, onePerKey, cleanUnresolved, isSampleManifest } from './lib/text.mjs';
import { isTestPath } from '../files.mjs';

const PROJECT_RE = /\.(cs|fs|vb)proj$/i;
const stem = (p) => basename(String(p).replace(/\\/g, '/')).replace(/\.(cs|fs|vb)proj$/i, '');

function detect({ rel, text }, ctx) {
  const lines = splitLines(text);
  const { leaves, elements } = scanXml(text);
  const facts = [];
  const unresolved = [];
  if (PROJECT_RE.test(rel)) {
    const pick = (name) => leaves.find((l) => l.name === name && l.path.endsWith(`PropertyGroup/${name}`));
    const id = pick('PackageId') || pick('AssemblyName');
    if (id && id.text && !id.text.includes('$(')) {
      facts.push(fact({ kind: 'pkg', dir: 'provides', key: `nuget:${id.text}`, rel, lines, line: id.line, needle: id.text, detail: `.NET ${id.name}`, confidence: 'exact' }));
    } else {
      const name = stem(rel);
      const root = elements.find((e) => e.name === 'Project');
      facts.push(fact({ kind: 'pkg', dir: 'provides', key: `nuget:${name}`, rel, lines, line: root?.line || 1, needle: '<Project', detail: '.NET project (file name)', confidence: 'heuristic' }));
    }
  }
  for (const el of elements) {
    if (el.name === 'PackageReference' || (el.name === 'package' && /(^|\/)packages\.config$/i.test(rel))) {
      const name = el.attrs.Include ?? el.attrs.id;
      if (!name) continue;
      if (name.includes('$(')) { unresolved.push({ kind: 'pkg', raw: name, file: rel, line: el.line, reason: 'msbuild property' }); continue; }
      const line = el.attrLines.Include ?? el.attrLines.id ?? el.line;
      facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `nuget:${name}`, rel, lines, line, needle: name, confidence: 'exact' }));
    } else if (el.name === 'ProjectReference' && el.attrs.Include) {
      const inc = el.attrs.Include;
      if (inc.includes('$(')) { unresolved.push({ kind: 'pkg', raw: inc, file: rel, line: el.line, reason: 'msbuild property' }); continue; }
      const m = memberForPath(ctx, rel, inc);
      if (!m || m.key === ctx.member.key) continue;
      facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `nuget:${stem(inc)}`, rel, lines, line: el.attrLines.Include ?? el.line, needle: inc, detail: 'project reference', target: m.key, confidence: 'exact' }));
    }
  }
  return { facts: onePerKey(facts), unresolved: cleanUnresolved(ctx.state, rel, unresolved), stack: isTestPath(rel) ? [] : ['dotnet'] };
}

export default Object.freeze({
  id: 'pkg-dotnet',
  claims: (rel) => (PROJECT_RE.test(rel) || /(^|\/)(Directory\.Build\.props|packages\.config)$/i.test(rel)) && !isSampleManifest(rel),
  detect,
});
