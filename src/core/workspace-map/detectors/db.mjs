// db: tables and databases.
//   provides  table:<name> from migrations and DDL — CREATE TABLE in any .sql (Flyway V*__*.sql,
//             golang-migrate *.up.sql, plain schema files) and in SQL string literals; Liquibase
//             createTable (XML / YAML / JSON); Alembic op.create_table; Django CreateModel
//             (db_table, else <app_label>_<model>); Rails create_table; Knex / Sequelize
//             createTable; TypeORM new Table({ name }); EF Core migrationBuilder.CreateTable.
//             Any of these — or any file in a migrations / db/migrate / flyway directory,
//             a Flyway V*__*.sql or a *.up.sql — marks the member as OWNING MIGRATIONS.
//   ORM mappings (JPA @Table, Hibernate/EF [Table]/ToTable, SQLAlchemy __tablename__ / Table(),
//             Django db_table, Sequelize tableName, GORM TableName(), ActiveRecord table_name,
//             TypeORM @Entity('x'), Prisma model/@@map, Mongo collections) and datasource
//             database names (config files, lib/urls classifyValue) → provides when the member
//             owns migrations, else consumes (decided in finish).
//   consumes  table:<name> from SQL-shaped string literals and .sql queries (FROM / JOIN / INTO /
//             UPDATE <name>; schema prefix kept; subqueries, CTE names and function FROMs skipped).
import { splitLines, fact, lineIndex } from './lib/text.mjs';
import { isSource, isMinified, langOf, stripComments, literals, firstPerKey } from './lib/code.mjs';
import { classifyValue } from './lib/urls.mjs';
import { claimsConfig, configPairs } from './config-env.mjs';
import { isTestPath } from '../files.mjs';

const NAME = String.raw`(?:[\x60"\[]?[A-Za-z_][\w$]{0,127}[\x60"\]]?\.)?[\x60"\[]?[A-Za-z_][\w$]{0,127}[\x60"\]]?`;
const CREATE_RE = new RegExp(String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${NAME})`, 'gi');
const REF_RE = new RegExp(String.raw`\b(FROM|JOIN|INTO|UPDATE)\s+(${NAME})`, 'gi');
const NOT_TABLES = new Set(['select', 'where', 'set', 'values', 'lateral', 'dual', 'unnest', 'generate_series', 'only', 'table', 'the', 'a', 'an', 'and', 'or', 'on', 'as', 'using', 'json_each', 'jsonb_each', 'json_table', 'openjson',
  'from', 'into', 'join', 'update', 'delete', 'insert', 'with', 'group', 'order', 'by', 'limit', 'default', 'your', 'my', 'this', 'that', 'our']);
// SQL is written UPPER or lower case; a Title-case lead word ("Select an option from …", "Update
// from server", "Create table layout") is UI / docs prose, never SQL.
const SQL_START = /^\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH|MERGE|CREATE|ALTER|REPLACE|UPSERT|select|insert|update|delete|with|merge|create|alter|replace|upsert)\b/;
const SQL_SELECT = (v) => (/\bSELECT\b/.test(v) && /\bFROM\b/.test(v)) || (/\bselect\b/.test(v) && /\bfrom\b/.test(v));
const unquote = (n) => n.replace(/[\x60"[\]]/g, '');

/** Blank SQL comments (-- line, /* block *\/) outside '…' values ('--' and LIKE '/*%' are data; a value
 *  ends at its line like sqlFacts' value blanking); newlines kept. One forward pass (char loop + indexOf). */
function blankSqlComments(text) {
  const t = String(text);
  const sp = (s) => s.replace(/[^\r\n]/g, ' ');
  let out = '';
  let last = 0;
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === "'") {
      let j = i + 1;
      for (; j < t.length && t[j] !== '\n'; j += 1) {
        if (t[j] === "'") { if (t[j + 1] === "'") { j += 1; continue; } break; }
      }
      i = j + 1;
    } else if ((c === '-' && t[i + 1] === '-') || (c === '/' && t[i + 1] === '*')) {
      const e = c === '-' ? t.indexOf('\n', i) : t.indexOf('*/', i + 2);
      const end = e === -1 ? t.length : c === '-' ? e : e + 2;
      out += t.slice(last, i) + sp(t.slice(i, end));
      last = end;
      i = end;
    } else i += 1;
  }
  return out + t.slice(last);
}

// Migration calls in code: [langs, regex (group 1 = table), label, schema argument pattern | null].
// The schema is looked up inside the call's balanced argument list.
const MIGRATIONS = [
  [['py'], /\bop\.create_table\s*\(\s*['"]([\w.]+)['"]/g, 'alembic', /\bschema\s*=\s*['"](\w+)['"]/],
  [['rb'], /\bcreate_table(?:\s*\(\s*|\s+)[:"']([\w.]+)/g, 'rails', null],
  [['js'], /\.createTable(?:IfNotExists)?\s*\(\s*['"`]([\w.]+)['"`]/g, 'knex/sequelize', null],
  [['js'], /new\s+Table\s*\(\s*\{[^}]{0,300}?\bname\s*:\s*['"`]([\w.]+)['"`]/g, 'typeorm', null],
  [['cs'], /migrationBuilder\.CreateTable\s*\(\s*name:\s*"([\w.]+)"/g, 'ef-core', /\bschema:\s*"(\w+)"/],
];

/** Django: does this migration run a field operation against the database? Its autodetector writes AddField /
 *  AlterField / RemoveField / RenameField for managed models only — but never count one inside a string (a
 *  docstring) or inside a SeparateDatabaseAndState `state_operations=[…]` list (state only, no SQL). */
const FIELD_OP_RE = /\bmigrations\.(?:AddField|AlterField|RemoveField|RenameField)\s*\(/g;
function runsFieldOp(code) {
  if (!code.includes('migrations.') || !/\bmigrations\.(?:AddField|AlterField|RemoveField|RenameField)\s*\(/.test(code)) return false;
  let t = '';
  let last = 0;
  for (const l of literals(code, 'py')) { t += code.slice(last, l.start) + ' '.repeat(Math.max(0, l.end - l.start)); last = l.end; }
  t += code.slice(last);
  const spans = []; // disjoint: a match inside the previous list is skipped, so the scan stays linear
  for (const m of t.matchAll(/\bstate_operations\s*=\s*\[/g)) {
    const from = m.index + m[0].length;
    if (spans.length && from < spans[spans.length - 1][1]) continue;
    spans.push([from, from + callBody(t, from).length]);
  }
  let k = 0;
  for (const m of t.matchAll(FIELD_OP_RE)) {
    while (k < spans.length && spans[k][1] <= m.index) k += 1;
    if (!(k < spans.length && spans[k][0] <= m.index)) return true;
  }
  return false;
}
// the next migration operation (`migrations.X(`, X capitalised): `'see docs/migrations.md'` in a help_text is none
const NEXT_OP_RE = /\bmigrations\.[A-Z]\w{0,60}\s*\(/g;

/** Text of the call's argument list from `pos` (inside the parens) to its closing ')', ≤ 3000 chars. */
function callBody(code, pos) {
  let depth = 0;
  let j = pos;
  for (; j < code.length && j - pos < 3000; j += 1) {
    const c = code[j];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth -= 1; }
  }
  return code.slice(pos, j);
}
// ORM mappings: [langs, regex, table group, schema group|0, label]
const MAPPINGS = [
  [['java', 'kotlin'], /@Table\s*\(\s*(?:name\s*=\s*)?"([\w.]+)"(?:[^)]{0,300}?\bschema\s*=\s*"(\w+)")?/g, 1, 2, 'JPA @Table'],
  [['java', 'kotlin'], /@Document\s*\(\s*(?:collection\s*=\s*|value\s*=\s*)?"([\w.]+)"/g, 1, 0, 'Spring Data @Document'],
  [['py'], /\b__tablename__\s*=\s*['"]([\w.]+)['"]/g, 1, 0, 'SQLAlchemy __tablename__'],
  [['py'], /(?<![\w.])Table\s*\(\s*['"]([\w.]+)['"]\s*,\s*\w*metadata/g, 1, 0, 'SQLAlchemy Table'],
  [['py'], /\bdb_table\s*=\s*['"]([\w.]+)['"]/g, 1, 0, 'Django db_table'],
  [['js'], /\btableName\s*:\s*['"`]([\w.]+)['"`]/g, 1, 0, 'Sequelize tableName'],
  [['js'], /@Entity\s*\(\s*(?:\{[^}]{0,200}?\bname\s*:\s*)?['"`]([\w.]+)['"`]/g, 1, 0, 'TypeORM @Entity'],
  [['js'], /mongoose\.model\s*\(\s*['"`]\w+['"`]\s*,\s*\w+\s*,\s*['"`]([\w.]+)['"`]/g, 1, 0, 'Mongoose collection'],
  [['js', 'py'], /\.collection\s*\(\s*['"`]([\w.]+)['"`]/g, 1, 0, 'Mongo collection'],
  [['go'], /\.Collection\s*\(\s*"([\w.]+)"/g, 1, 0, 'Mongo collection'],
  [['go'], /\)\s*TableName\s*\(\s*\)\s*string\s*\{\s*return\s*"([\w.]+)"/g, 1, 0, 'GORM TableName'],
  [['cs'], /\[Table\s*\(\s*"([\w.]+)"(?:\s*,\s*Schema\s*=\s*"(\w+)")?\s*\)\]/g, 1, 2, 'EF [Table]'],
  [['cs'], /\.ToTable\s*\(\s*"([\w.]+)"(?:\s*,\s*"(\w+)")?/g, 1, 2, 'EF ToTable'],
  [['rb'], /\bself\.table_name\s*=\s*['"]([\w.]+)['"]/g, 1, 0, 'ActiveRecord table_name'],
];
const MIGRATION_PATH = /(^|\/)(V\d+(?:[._]\d+)*__[^/]*\.sql|[^/]*\.up\.sql)$|(^|\/)(db\/migrate|migrations?|flyway)\//i;

function sqlFacts(sql, base, rel, lines, lineOf, st, facts, { refs = true } = {}) {
  // blank string values inside the SQL so 'FROM x' inside a value never counts
  const s = sql.replace(/'(?:[^'\n]|''){0,2000}'/g, (m) => ' '.repeat(m.length));
  const owner = !isTestPath(rel);
  for (const m of s.matchAll(CREATE_RE)) {
    if (m[1]) continue; // temporary / unlogged scratch tables are not owned data
    const name = unquote(m[2]);
    if (owner) st.owns = true;
    facts.push(fact({ kind: 'db', dir: 'provides', key: `table:${name}`, rel, lines, line: lineOf(base + m.index + m[0].length - m[2].length), needle: m[2], detail: 'CREATE TABLE', confidence: 'exact' }));
  }
  if (!refs) return;
  const ctes = new Set([...s.matchAll(/\b(?:WITH|,)\s*(?:RECURSIVE\s+)?([A-Za-z_]\w*)\s+AS\s*\(/gi)].map((m) => m[1].toLowerCase()));
  for (const m of s.matchAll(REF_RE)) {
    const raw = m[2];
    const name = unquote(raw);
    const low = name.toLowerCase();
    if (NOT_TABLES.has(low) || ctes.has(low) || /^(information_schema|pg_catalog|sys)\.|^sqlite_(master|schema|sequence|temp_master|temp_schema|stat\d)$/i.test(name) || name.length < 2) continue;
    if (/\b(EXTRACT|SUBSTRING|TRIM|POSITION|OVERLAY)\s*\([^()]*$|\bDISTINCT\s*$/i.test(s.slice(Math.max(0, m.index - 60), m.index))) continue;
    if (/^(?:FROM|JOIN)$/i.test(m[1]) && /^\s*\((?!\s*(?:NOLOCK|READPAST|UPDLOCK|ROWLOCK|HOLDLOCK|NOWAIT|READUNCOMMITTED|INDEX\s*[(=])\b)/i.test(s.slice(m.index + m[0].length, m.index + m[0].length + 40))) continue; // FROM my_func(1): a table function; FROM t (NOLOCK): a T-SQL hint
    facts.push(fact({ kind: 'db', dir: 'consumes', key: `table:${name}`, rel, lines, line: lineOf(base + m.index + m[0].length - raw.length), needle: raw, detail: `SQL ${m[1].toUpperCase()}`, confidence: 'exact' }));
  }
}

function detect({ rel, text }, ctx) {
  if (isMinified(rel, text)) return undefined;
  const st = ctx.state;
  // ORM mappings / datasource names wait for finish (ownership is known only then): kept as built
  // facts, never as the file's lines, so the state stays small on a 50 000-file member.
  st.mappings ??= [];
  st.dbNames ??= [];
  const owner = !isTestPath(rel); // test schemas / fixtures never make a member the owner
  const lines = splitLines(text);
  const lineOf = lineIndex(text);
  const facts = [];
  // a Django migration (or the migrations package's __init__.py) owns through its CreateModel, never by its path:
  // an app whose models are all managed = False reads another service's tables
  const django = () => /\.py$/i.test(rel) && (/(^|\/)__init__\.py$/.test(rel) || /\bmigrations\.Migration\b/.test(text));
  if (owner && MIGRATION_PATH.test(rel) && /\.(sql|xml|ya?ml|py|rb|js|ts|cs|go)$/i.test(rel) && !django()) st.owns = true; // a migrations dir / Flyway / *.up.sql file
  if (/\.sql$/i.test(rel)) {
    sqlFacts(blankSqlComments(text), 0, rel, lines, lineOf, st, facts);
    return { facts: firstPerKey(facts) };
  }
  if (/\.prisma$/i.test(rel)) {
    // Model headers by a line pattern; each body ends at the first '}', the next header or 20 000
    // chars, whichever comes first (disjoint slices: linear on any input).
    const heads = [...text.matchAll(/^[ \t]*model[ \t]+(\w+)[ \t]*\{/gm)];
    let close = -1;
    heads.forEach((m, k) => {
      const open = m.index + m[0].length;
      if (close !== -2 && close < open) close = text.indexOf('}', open);
      if (close === -1) close = -2;
      const end = Math.min(close < 0 ? text.length : close, k + 1 < heads.length ? heads[k + 1].index : text.length, open + 20000);
      const body = text.slice(open, end);
      const map = /@@map\(\s*(?:name:\s*)?"([\w.]+)"\s*\)/.exec(body);
      const name = map ? map[1] : m[1];
      st.mappings.push(fact({ kind: 'db', dir: 'consumes', key: `table:${name}`, rel, lines, line: lineOf(map ? open + map.index : m.index), needle: map ? map[1] : m[1], detail: 'Prisma model', confidence: 'exact' }));
    });
    st.prismaMigrations ??= (ctx.files || []).some((f) => /(^|\/)prisma\/migrations\//.test(f)); // once per member
    if (owner && st.prismaMigrations) st.owns = true;
    return { facts };
  }
  if (/(^|\/)(db\/)?changelog[^/]*\.(xml|ya?ml|json)$|(^|\/)changelog\/.*\.(xml|ya?ml|json)$/i.test(rel)) {
    const re = /\.xml$/i.test(rel)
      ? /<createTable\b[^>]{0,500}?\btableName\s*=\s*"([\w.]+)"/g
      : /\bcreateTable["']?\s*:[^}]{0,500}?\btableName["']?\s*:\s*["']?([\w.]+)/g;
    for (const m of text.matchAll(re)) {
      if (owner) st.owns = true;
      facts.push(fact({ kind: 'db', dir: 'provides', key: `table:${m[1]}`, rel, lines, line: lineOf(m.index + m[0].lastIndexOf(m[1])), needle: m[1], detail: 'Liquibase createTable', confidence: 'exact' }));
    }
    return { facts: firstPerKey(facts) };
  }
  if (claimsConfig(rel)) {
    for (const p of configPairs(rel, text).pairs) {
      for (const s of classifyValue(p.value, p.key.split('.').pop())) {
        if (s.kind === 'db') st.dbNames.push(fact({ kind: 'db', dir: 'provides', key: s.key, rel, lines, line: p.line, needle: s.needle, detail: `${p.key} (member owns migrations)`, confidence: 'heuristic' }));
      }
    }
    return { facts };
  }
  const lang = langOf(rel);
  if (!lang || !isSource(rel)) return undefined;
  const code = stripComments(text, lang);
  for (const [langs, re, label, schemaRe] of MIGRATIONS) {
    if (!langs.includes(lang)) continue;
    for (const m of code.matchAll(re)) {
      const schema = schemaRe ? schemaRe.exec(callBody(code, m.index + m[0].length))?.[1] : null;
      const name = schema ? `${schema}.${m[1]}` : m[1];
      if (owner) st.owns = true;
      facts.push(fact({ kind: 'db', dir: 'provides', key: `table:${name}`, rel, lines, line: lineOf(m.index + m[0].indexOf(m[1])), needle: m[1], detail: `${label} migration`, confidence: 'exact' }));
    }
  }
  if (lang === 'py' && /(^|\/)migrations\/[^/]+\.py$/.test(rel)) {
    const appLabel = rel.split('/').slice(-3, -2)[0] || '';
    // Django's autodetector writes field operations for managed models only: an AddField / AlterField migration owns
    if (owner && runsFieldOp(code)) st.owns = true;
    for (const m of code.matchAll(/migrations\.CreateModel\s*\(\s*name\s*=\s*['"](\w+)['"]/g)) {
      NEXT_OP_RE.lastIndex = m.index + m[0].length;
      const next = NEXT_OP_RE.exec(code)?.index ?? -1;
      // the whole operation, up to the next one: Django writes options (db_table, managed) AFTER fields, so a
      // 40-column inspectdb model puts them ~5 000 chars in (bounded: 64 KiB; bodies are disjoint, so linear)
      const body = code.slice(m.index, Math.min(next === -1 ? code.length : next, m.index + 65536));
      // a proxy model (options={'proxy': True}) has no table of its own: no fact, no ownership — read in `options`
      // only (`models.JSONField(default={"proxy": True})` is a field default)
      const opt = /\boptions\s*=\s*\{/.exec(body);
      if (opt && /['"]proxy['"]\s*:\s*True\b/.test(callBody(body, opt.index + opt[0].length))) continue;
      const dbTable = /['"]db_table['"]\s*:\s*['"]([\w.]+)['"]/.exec(body);
      const name = dbTable ? dbTable[1] : `${appLabel}_${m[1].toLowerCase()}`;
      // options={'managed': False}: Django never creates this table — another service owns it
      const unmanaged = /['"]managed['"]\s*:\s*False\b/.test(body);
      if (owner && !unmanaged) st.owns = true;
      facts.push(fact({ kind: 'db', dir: unmanaged ? 'consumes' : 'provides', key: `table:${name}`, rel, lines, line: lineOf(m.index + m[0].indexOf(m[1])), needle: m[1], detail: unmanaged ? 'Django CreateModel (managed=False)' : 'Django CreateModel', confidence: 'exact' }));
    }
  }
  const maps = [];
  for (const [langs, re, g, sg, label] of MAPPINGS) {
    if (!langs.includes(lang)) continue;
    if (label === 'Django db_table' && /(^|\/)migrations\//.test(rel)) continue;
    for (const m of code.matchAll(re)) {
      const name = sg && m[sg] ? `${m[sg]}.${m[g]}` : m[g];
      if (label === 'Django db_table') {
        // class Meta: managed = False → never owned here, even by a member with migrations
        const from = Math.max(0, m.index - 600); // bounded windows: linear on a file of 70 000 db_table lines
        const meta = code.slice(from, m.index).lastIndexOf('class Meta');
        const tail = code.slice(m.index, m.index + 600).search(/\n[ \t]*(?:class|def)\s/);
        if (meta !== -1 && /\bmanaged\s*=\s*False\b/.test(code.slice(from + meta, m.index + (tail === -1 ? 600 : tail)))) {
          facts.push(fact({ kind: 'db', dir: 'consumes', key: `table:${name}`, rel, lines, line: lineOf(m.index + m[0].indexOf(m[g])), needle: m[g], detail: `${label} (managed=False)`, confidence: 'exact' }));
          continue;
        }
      }
      maps.push(fact({ kind: 'db', dir: 'consumes', key: `table:${name}`, rel, lines, line: lineOf(m.index + m[0].indexOf(m[g])), needle: m[g], detail: label, confidence: 'exact' }));
    }
  }
  st.mappings.push(...firstPerKey(maps));
  if (/SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE/i.test(code)) {
    for (const l of literals(code, lang)) {
      // a schema string may open with a `-- comment`: SQL comments are blanked before the lead-keyword test
      const v = blankSqlComments(l.value.replace(/\$\{[^}]{0,200}\}/g, (m) => ' '.repeat(m.length)));
      if (!SQL_START.test(v) && !SQL_SELECT(v)) continue;
      // lower-case SQL counts only with a clause, a bind parameter or an UPPER keyword up front:
      // 'delete from favorites' / 'please select a file from disk' are prose
      if (!/[A-Z]{3}/.test(v.trimStart().slice(0, 12)) && !/\b(?:where|values|set|join|limit|returning)\b|\?|\$\d/.test(v)) continue;
      sqlFacts(v, l.start, rel, lines, lineOf, st, facts);
    }
  }
  return { facts: firstPerKey(facts) };
}

function finish(ctx) {
  const st = ctx.state;
  const owns = !!st.owns;
  const facts = (st.mappings || []).map((f) => (owns ? { ...f, dir: 'provides', detail: `${f.detail} (member owns migrations)` } : f));
  if (owns) facts.push(...(st.dbNames || []));
  return { facts };
}

export default Object.freeze({
  id: 'db',
  claims: (rel) => isSource(rel) || /\.(sql|prisma)$/i.test(rel) || claimsConfig(rel) || /(^|\/)(db\/)?changelog[^/]*\.(xml|ya?ml|json)$|(^|\/)changelog\/.*\.(xml|ya?ml|json)$/i.test(rel),
  detect,
  finish,
});
