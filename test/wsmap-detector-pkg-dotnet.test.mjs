import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, keysOf, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/pkg-dotnet.mjs';

const WEB = `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <AssemblyName>Acme.Web</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Version="1.0.0"
                      Include="Acme.Money" />
    <PackageReference Include="Serilog">
      <Version>3.1.1</Version>
    </PackageReference>
    <PackageReference Update="Serilog" Version="4.0" />
    <PackageReference Include="$(SharedPackage)" />
    <!-- <PackageReference Include="Commented.Out" Version="1" /> -->
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\\..\\..\\billing\\src\\Billing.Client\\Billing.Client.csproj" />
    <ProjectReference Include="..\\Acme.Web.Core\\Acme.Web.Core.csproj" />
  </ItemGroup>
</Project>
`;
const CLIENT = `<Project Sdk="Microsoft.NET.Sdk">\r\n  <PropertyGroup>\r\n    <PackageId>Acme.Billing.Client</PackageId>\r\n    <AssemblyName>Billing.Client</AssemblyName>\r\n  </PropertyGroup>\r\n</Project>\r\n`;

let ws;
before(async () => {
  ws = await makeWorkspace({
    web: { 'src/Acme.Web/Acme.Web.csproj': WEB, 'src/Acme.Web.Core/Acme.Web.Core.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n</Project>\n', 'legacy/packages.config': '<?xml version="1.0"?>\n<packages>\n  <package id="EntityFramework" version="6.4.4" />\n</packages>\n' },
    billing: { 'src/Billing.Client/Billing.Client.csproj': CLIENT, 'tests/Billing.Tests/Billing.Tests.csproj': '<Project>\n  <ItemGroup><PackageReference Include="xunit" Version="2.9" /></ItemGroup>\n</Project>\n' },
    broken: { 'Broken.csproj': '<Project><PropertyGroup><PackageId>Half' },
    testsonly: { 'tests/Only.Tests/Only.Tests.csproj': '<Project>\n  <ItemGroup><PackageReference Include="xunit" Version="2.9" /></ItemGroup>\n</Project>\n' },
  });
});
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);

test('pkg-dotnet: PackageId beats AssemblyName; AssemblyName beats the file name; file name is heuristic', async () => {
  const billing = await runDetector(detector, member('billing'), ws.members);
  assert.deepEqual(keysOf(billing, 'pkg', 'provides'), ['nuget:Acme.Billing.Client', 'nuget:Billing.Tests']);
  assert.equal(billing.facts.find((f) => f.key === 'nuget:Acme.Billing.Client').norm, 'pkg:nuget:acme.billing.client');
  assert.equal(billing.facts.find((f) => f.key === 'nuget:Billing.Tests').confidence, 'heuristic');
  const web = await runDetector(detector, member('web'), ws.members);
  assert.deepEqual(keysOf(web, 'pkg', 'provides'), ['nuget:Acme.Web', 'nuget:Acme.Web.Core']);
  assert.deepEqual(web.stack, ['dotnet']);
  assertEvidence(member('web'), web);
  assertEvidence(member('billing'), billing);
});

test('pkg-dotnet: PackageReference in any attribute order and nested Version; Update= and comments ignored; packages.config', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'consumes'), ['nuget:Acme.Money', 'nuget:Billing.Client', 'nuget:EntityFramework', 'nuget:Newtonsoft.Json', 'nuget:Serilog']);
  assert.equal(r.facts.find((f) => f.key === 'nuget:Acme.Money').line, 9, 'the Include= line of a multi-line tag');
});

test('pkg-dotnet: ProjectReference into another member (backslashes) targets it; intra-member references are not facts', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  const ref = r.facts.find((f) => f.detail === 'project reference');
  assert.deepEqual([ref.key, ref.target, ref.line], ['nuget:Billing.Client', 'billing', 18]);
  assert.ok(!r.facts.some((f) => f.dir === 'consumes' && f.key === 'nuget:Acme.Web.Core'));
});

test('pkg-dotnet: an MSBuild property name is unresolved; test projects are facts marked test', async () => {
  const web = await runDetector(detector, member('web'), ws.members);
  assert.deepEqual(web.unresolved.map((u) => [u.raw, u.reason, u.line]), [['$(SharedPackage)', 'msbuild property', 14]]);
  const billing = await runDetector(detector, member('billing'), ws.members);
  assert.equal(billing.facts.find((f) => f.key === 'nuget:xunit').test, true);
  const only = await runDetector(detector, member('testsonly'), ws.members);
  assert.deepEqual([only.stack, keysOf(only, 'pkg', 'consumes')], [[], ['nuget:xunit']], 'a test project sets no stack; its facts still count (marked test)');
});

test('pkg-dotnet: truncated project XML never throws', async () => {
  const r = await runDetector(detector, member('broken'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), ['nuget:Broken']);
});
