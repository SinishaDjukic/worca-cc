#!/usr/bin/env node
// scripts/c4-check-cli.mjs — the architect's own check, from a shell: `node scripts/c4-check-cli.mjs <file.c4>`.
// The c4Check card's rules (checkC4), printed for a terminal. Exit 1 on a blocking finding, 2 on usage.
import { readFileSync } from 'node:fs';
import { checkC4, isBlocking } from './c4-check.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: c4-check-cli.mjs <file.c4>'); process.exit(2); }
let text;
try { text = readFileSync(file, 'utf8'); } catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(2); }
const { findings, views, bands } = checkC4(text);
for (const f of findings) console.log(`${f.severity.padEnd(8)}${f.title}: ${f.detail}`);
for (const b of bands) console.log(`band    "${b.title}": ${b.placed} placed`);
for (const v of views) console.log(`view    ${v.id} (${v.type}): ${v.elements} elements, ${v.relationships} relationships`);
const blocking = findings.filter(isBlocking).length;
console.log(blocking ? `\n${blocking} blocking finding(s)` : '\nclean');
process.exit(blocking ? 1 : 0);
