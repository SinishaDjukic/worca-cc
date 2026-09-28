import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/db.mjs';

const BILLING = {
  // CRLF (Windows checkout): same keys, lines and evidence
  'src/main/resources/db/migration/V1__init.sql': `-- CREATE TABLE commented_out (id int);
CREATE TABLE IF NOT EXISTS billing.invoices (id bigint primary key);
CREATE TEMPORARY TABLE scratch (x int);
/* CREATE TABLE also_commented (id int); */
CREATE TABLE "Line_Items" (id bigint);
INSERT INTO billing.invoices VALUES (1);
`.replace(/\n/g, '\r\n'),
  'src/main/resources/application.yml': 'spring:\n  datasource:\n    url: jdbc:postgresql://pg:5432/billing\n',
  'src/main/java/Invoice.java': '@Entity\n@Table(name = "invoices", schema = "billing")\npublic class Invoice {}\n',
  'src/main/java/Repo.java': `class Repo {
  String q = "SELECT i.id, EXTRACT(YEAR FROM i.created_at) FROM billing.invoices i JOIN customers c ON c.id = i.customer_id WHERE i.note <> 'from notes'";
  String cte = """
      WITH recent AS (SELECT * FROM payments) SELECT * FROM recent
      """;
  String up = "INSERT INTO audit_log (x) VALUES (?) ON CONFLICT (x) DO UPDATE SET x = 1";
}
`,
};
const REPORTS = {
  'app/models.py': `class Invoice(Base):
    __tablename__ = 'invoices'
report = Table('report_rows', metadata, Column('id'))
`,
  'app/queries.py': 'SQL = """\nSELECT * FROM invoices\nJOIN ledger.entries e ON e.invoice_id = invoices.id\n"""\nfrom os import path\n',
  '.env': 'DATABASE_URL=postgres://ro:x@pg:5432/billing\n',
  'app/ui.js': "const a = 'Delete from favorites?';\nconst b = 'Create table layout';\nconst c = 'delete from favorites';\nconst d = 'please select a file from disk';\n",
  'src/test/resources/schema.sql': 'CREATE TABLE invoices (id int);\n',
  'app/tests.py': 'SQL = "CREATE TABLE scratch_rows (id int)"\n',
  'app/dup.py': 'A = "SELECT * FROM dup_rows"\nB = "SELECT id FROM dup_rows WHERE id = 1"\n',
  'src/test/resources/db/migration/V9__test_only.sql': 'ALTER TABLE invoices ADD COLUMN probe int;\n',
  'app/funcs.py': 'A = "SELECT * FROM my_func(1) JOIN accounts a ON true WHERE a.id = 1"\nB = "INSERT INTO audit(a, b) VALUES (?, ?)"\nC = "SELECT name FROM sqlite_master WHERE type = ?"\n',
  // '--' and '/*' inside a value are data, not comments; (NOLOCK) is a T-SQL hint, not a table function's arguments
  'app/values.py': "A = \"SELECT id FROM notes WHERE sep = '--' AND id IN (SELECT note_id FROM tags)\"\nB = \"SELECT * FROM files WHERE path LIKE '/*%' UNION SELECT * FROM archived_files\"\nC = \"SELECT * FROM users (NOLOCK) WHERE id = ?\"\n",
};
const MIXED = {
  'db/migrate/20240101_create_orders.rb': 'class CreateOrders < ActiveRecord::Migration[7.1]\n  def change\n    create_table :orders do |t|\n    end\n  end\nend\n',
  'shop/migrations/0001_initial.py': `operations = [
    migrations.CreateModel(name='Product', fields=[]),
    migrations.CreateModel(name='Price', fields=[], options={'db_table': 'prices'}),
]
`,
  'migrations/20240101_users.js': "exports.up = (knex) => knex.schema.createTable('users', (t) => {});\n",
  'src/migrations/1700-Init.ts': "await queryRunner.createTable(new Table({ name: 'sessions', columns: [] }));\n",
  'Migrations/20240101_Init.cs': 'migrationBuilder.CreateTable(name: "Shipments", schema: "ops", columns: table => new {});\n',
  'db/changelog/db.changelog-master.xml': '<databaseChangeLog>\n  <changeSet id="1" author="a">\n    <createTable tableName="carts">\n    </createTable>\n  </changeSet>\n  <changeSet id="2" author="a">\n    <createTable tableName="carts">\n    </createTable>\n  </changeSet>\n</databaseChangeLog>\n',
  'prisma/schema.prisma': 'model User {\n  id Int @id\n  @@map("app_users")\n}\nmodel Post {\n  id Int @id\n}\n',
  'prisma/migrations/0001/migration.sql': 'CREATE TABLE "app_users" (id int);\n',
  'go/store.go': 'func (Order) TableName() string { return "legacy_orders" }\nvar c = db.Collection("events")\n',
  'tests/fixtures/seed.sql': 'SELECT * FROM fixture_rows;\n',
  'alembic/versions/001_init.py': "def upgrade():\n    op.create_table(\n        'report_runs',\n        sa.Column('id'),\n        schema='reports',\n    )\n",
};

const ALTERED = {
  'db/migration/V2__add_column.sql': 'ALTER TABLE invoices ADD COLUMN note text;\n',
  'src/Invoice.kt': '@Table(name = "invoices")\nclass Invoice\n',
};

// Django: managed = False names a table another service owns (never provided, never owned here)
const LEGACY = {
  'orders/migrations/0001_initial.py': "operations = [\n    migrations.CreateModel(name='Order', fields=[], options={'db_table': 'orders', 'managed': False}),\n    migrations.CreateModel(name='Note', fields=[]),\n]\n",
  'orders/models.py': "class Order(models.Model):\n    class Meta:\n        managed = False\n        db_table = 'orders'\n\nclass Note(models.Model):\n    class Meta:\n        db_table = 'orders_note'\n",
};
// a real Django app: the package's __init__.py, a Migration class, and a datasource that would turn into a provide if the member owned it
const UNMANAGED_ONLY = {
  'orders/migrations/__init__.py': '',
  'orders/migrations/0001_initial.py': "from django.db import migrations\n\n\nclass Migration(migrations.Migration):\n    operations = [\n        migrations.CreateModel(name='Order', fields=[], options={'db_table': 'orders', 'managed': False}),\n    ]\n",
  '.env': 'DATABASE_URL=postgres://ro:x@pg:5432/orders\n',
};

// an inline schema string that opens with a SQL comment (SQLite apps): its DDL still counts, the comment's words never do
// a Django app whose migrations only alter fields (its CreateModel squashed away): still the owner, like an ALTER-only Flyway member
const DJANGO_ALTER = {
  'shop/migrations/__init__.py': '',
  'shop/migrations/0007_item_note.py': "from django.db import migrations, models\n\n\nclass Migration(migrations.Migration):\n    operations = [\n        migrations.AddField(model_name='item', name='note', field=models.TextField(default='')),\n    ]\n",
  'shop/models.py': "class Item(models.Model):\n    note = models.TextField()\n    class Meta:\n        db_table = 'shop_items'\n",
};
// inspectdb-style models: 40 columns put Django's options ~5 000 chars after `CreateModel(`
const WIDE = {
  'legacy/migrations/__init__.py': '',
  'legacy/migrations/0001_initial.py': "from django.db import migrations, models\n\n\nclass Migration(migrations.Migration):\n    operations = [\n        migrations.CreateModel(\n            name='Customer',\n            fields=[\n            ('column_number_00', models.CharField(blank=True, db_column='COLUMN_NUMBER_00', max_length=255, null=True)),\n            ('column_number_01', models.CharField(blank=True, db_column='COLUMN_NUMBER_01', max_length=255, null=True)),\n            ('column_number_02', models.CharField(blank=True, db_column='COLUMN_NUMBER_02', max_length=255, null=True)),\n            ('column_number_03', models.CharField(blank=True, db_column='COLUMN_NUMBER_03', max_length=255, null=True)),\n            ('column_number_04', models.CharField(blank=True, db_column='COLUMN_NUMBER_04', max_length=255, null=True)),\n            ('column_number_05', models.CharField(blank=True, db_column='COLUMN_NUMBER_05', max_length=255, null=True)),\n            ('column_number_06', models.CharField(blank=True, db_column='COLUMN_NUMBER_06', max_length=255, null=True)),\n            ('column_number_07', models.CharField(blank=True, db_column='COLUMN_NUMBER_07', max_length=255, null=True)),\n            ('column_number_08', models.CharField(blank=True, db_column='COLUMN_NUMBER_08', max_length=255, null=True)),\n            ('column_number_09', models.CharField(blank=True, db_column='COLUMN_NUMBER_09', max_length=255, null=True)),\n            ('column_number_10', models.CharField(blank=True, db_column='COLUMN_NUMBER_10', max_length=255, null=True)),\n            ('column_number_11', models.CharField(blank=True, db_column='COLUMN_NUMBER_11', max_length=255, null=True)),\n            ('column_number_12', models.CharField(blank=True, db_column='COLUMN_NUMBER_12', max_length=255, null=True)),\n            ('column_number_13', models.CharField(blank=True, db_column='COLUMN_NUMBER_13', max_length=255, null=True)),\n            ('column_number_14', models.CharField(blank=True, db_column='COLUMN_NUMBER_14', max_length=255, null=True)),\n            ('column_number_15', models.CharField(blank=True, db_column='COLUMN_NUMBER_15', max_length=255, null=True)),\n            ('column_number_16', models.CharField(blank=True, db_column='COLUMN_NUMBER_16', max_length=255, null=True)),\n            ('column_number_17', models.CharField(blank=True, db_column='COLUMN_NUMBER_17', max_length=255, null=True)),\n            ('column_number_18', models.CharField(blank=True, db_column='COLUMN_NUMBER_18', max_length=255, null=True)),\n            ('column_number_19', models.CharField(blank=True, db_column='COLUMN_NUMBER_19', max_length=255, null=True)),\n            ('column_number_20', models.CharField(blank=True, db_column='COLUMN_NUMBER_20', max_length=255, null=True)),\n            ('column_number_21', models.CharField(blank=True, db_column='COLUMN_NUMBER_21', max_length=255, null=True)),\n            ('column_number_22', models.CharField(blank=True, db_column='COLUMN_NUMBER_22', max_length=255, null=True)),\n            ('column_number_23', models.CharField(blank=True, db_column='COLUMN_NUMBER_23', max_length=255, null=True)),\n            ('column_number_24', models.CharField(blank=True, db_column='COLUMN_NUMBER_24', max_length=255, null=True)),\n            ('column_number_25', models.CharField(blank=True, db_column='COLUMN_NUMBER_25', max_length=255, null=True)),\n            ('column_number_26', models.CharField(blank=True, db_column='COLUMN_NUMBER_26', max_length=255, null=True)),\n            ('column_number_27', models.CharField(blank=True, db_column='COLUMN_NUMBER_27', max_length=255, null=True)),\n            ('column_number_28', models.CharField(blank=True, db_column='COLUMN_NUMBER_28', max_length=255, null=True)),\n            ('column_number_29', models.CharField(blank=True, db_column='COLUMN_NUMBER_29', max_length=255, null=True)),\n            ('column_number_30', models.CharField(blank=True, db_column='COLUMN_NUMBER_30', max_length=255, null=True)),\n            ('column_number_31', models.CharField(blank=True, db_column='COLUMN_NUMBER_31', max_length=255, null=True)),\n            ('column_number_32', models.CharField(blank=True, db_column='COLUMN_NUMBER_32', max_length=255, null=True)),\n            ('column_number_33', models.CharField(blank=True, db_column='COLUMN_NUMBER_33', max_length=255, null=True)),\n            ('column_number_34', models.CharField(blank=True, db_column='COLUMN_NUMBER_34', max_length=255, null=True)),\n            ('column_number_35', models.CharField(blank=True, db_column='COLUMN_NUMBER_35', max_length=255, null=True)),\n            ('column_number_36', models.CharField(blank=True, db_column='COLUMN_NUMBER_36', max_length=255, null=True)),\n            ('column_number_37', models.CharField(blank=True, db_column='COLUMN_NUMBER_37', max_length=255, null=True)),\n            ('column_number_38', models.CharField(blank=True, db_column='COLUMN_NUMBER_38', max_length=255, null=True)),\n            ('column_number_39', models.CharField(blank=True, db_column='COLUMN_NUMBER_39', max_length=255, null=True)),\n            ],\n            options={'db_table': 'CUSTOMERS', 'managed': False},\n        ),\n    ]\n",
  '.env': 'DATABASE_URL=postgres://ro:x@pg:5432/crm\n',
};
const INLINE = { 'src/schema.js': "export const SCHEMA = `\n-- core tables, written from POST /api/run\nCREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY);\nCREATE TABLE IF NOT EXISTS events (id INTEGER);\n`;\n" };

const SEEDED = { 'db/seeds.sql': `${Array.from({ length: 6000 }, (_, i) => `INSERT INTO products VALUES (${i}, 'p');`).join('\n')}\n` };

// an unmanaged reader one step off UNMANAGED_ONLY: a proxy model, a state-only field operation, a docstring naming
// one, a help_text naming migrations — none makes it an owner; a real field operation does
const DJ_MIG = (ops, head = '') => `${head}from django.db import migrations\n\n\nclass Migration(migrations.Migration):\n    operations = [\n${ops}    ]\n`;
const READER = { ...UNMANAGED_ONLY, 'orders/models.py': "class Invoice(Base):\n    __tablename__ = 'invoices'\n" };
const PROXY = { ...READER, 'orders/migrations/0002_activeorder.py': DJ_MIG("        migrations.CreateModel(\n            name='ActiveOrder',\n            fields=[],\n            options={'proxy': True, 'indexes': [], 'constraints': []},\n            bases=('orders.order',),\n        ),\n") };
const STATE_ONLY = { ...READER, 'orders/migrations/0002_state.py': DJ_MIG("        migrations.SeparateDatabaseAndState(\n            state_operations=[migrations.AddField(model_name='order', name='x', field=models.IntegerField())],\n            database_operations=[],\n        ),\n"), 'orders/migrations/0003_doc.py': DJ_MIG('', '"""Replaces migrations.AlterField( on order.x by hand."""\n') };
const HELP_TEXT = { ...READER, 'orders/migrations/0001_initial.py': DJ_MIG("        migrations.CreateModel(\n            name='Customer',\n            fields=[\n                ('id', models.IntegerField(primary_key=True, help_text='see docs/migrations.md')),\n            ],\n            options={'db_table': 'legacy_customer', 'managed': False},\n        ),\n") };
const JSON_DEFAULT = { 'gw/migrations/__init__.py': '', 'gw/migrations/0001_initial.py': DJ_MIG("        migrations.CreateModel(\n            name='Gateway',\n            fields=[('cfg', models.JSONField(default={\"proxy\": True}))],\n        ),\n") };
const REAL_FIELD = { ...READER, 'orders/migrations/0002_real.py': DJ_MIG("        migrations.AddField(model_name='order', name='x', field=models.IntegerField()),\n") };

let ws;
before(async () => { ws = await makeWorkspace({ billing: BILLING, reports: REPORTS, mixed: MIXED, altered: ALTERED, seeded: SEEDED, legacy: LEGACY, unmanaged: UNMANAGED_ONLY, inline: INLINE, wide: WIDE, djalter: DJANGO_ALTER, proxy: PROXY, stateonly: STATE_ONLY, helptext: HELP_TEXT, realfield: REAL_FIELD, jsondefault: JSON_DEFAULT }); });
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);
const rows = (r, file) => r.facts.filter((f) => !file || f.file === file).map((f) => `${f.dir === 'provides' ? 'P' : 'C'} ${f.key}`).sort();

test('db (.sql / Flyway): CREATE TABLE provides (schema kept, quotes stripped, temp tables and comments skipped); INSERT consumes', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  assert.deepEqual(rows(r, 'src/main/resources/db/migration/V1__init.sql'), ['C table:billing.invoices', 'P table:Line_Items', 'P table:billing.invoices']);
  assert.equal(r.facts.find((f) => f.key === 'table:Line_Items').norm, 'table:line_items');
  assertEvidence(member('billing'), r);
});

test('db: a member owning migrations PROVIDES its ORM tables and datasource database', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  assert.deepEqual(rows(r, 'src/main/java/Invoice.java'), ['P table:billing.invoices']);
  assert.deepEqual(rows(r, 'src/main/resources/application.yml'), ['P db:billing']);
});

test('db: SQL literals consume FROM/JOIN/INTO/UPDATE tables; EXTRACT(… FROM x), CTE names, string values and keywords (DO UPDATE SET) skipped', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  assert.deepEqual(rows(r, 'src/main/java/Repo.java'), ['C table:audit_log', 'C table:billing.invoices', 'C table:customers', 'C table:payments']);
});

test('db: without migrations of its own, ORM mappings and SQL are consumes; the datasource is left to config-env', async () => {
  const r = await runDetector(detector, member('reports'), ws.members);
  // still consumes: test schemas (src/test/…, Django tests.py) and UI prose never make a member the owner
  assert.deepEqual(rows(r, 'app/models.py'), ['C table:invoices', 'C table:report_rows']);
  assert.deepEqual(rows(r, 'app/dup.py'), ['C table:dup_rows'], 'one fact per (dir, key) per file');
  assert.deepEqual(rows(r, 'app/ui.js'), [], "prose ('Delete from favorites?', 'Create table layout', 'delete from favorites', 'please select a file from disk') is not SQL");
  assert.deepEqual(rows(r, 'app/queries.py'), ['C table:invoices', 'C table:ledger.entries'], '`from os import path` is Python, not SQL');
  assert.deepEqual(rows(r, '.env'), [], 'no provides without migrations; config-env already emits the consume');
});

test('db: a Flyway migration file alone (no CREATE TABLE) still makes the member an owner', async () => {
  const r = await runDetector(detector, member('altered'), ws.members);
  assert.deepEqual(rows(r), ['P table:invoices']);
});

test('db: migration tools — Rails, Django (app_label default and db_table), Knex, TypeORM, EF Core, Liquibase, Prisma (@@map), GORM, Mongo', async () => {
  const r = await runDetector(detector, member('mixed'), ws.members);
  assert.deepEqual(rows(r), [
    'C table:fixture_rows', 'P table:app_users', 'P table:app_users', 'P table:carts', 'P table:events', 'P table:legacy_orders', 'P table:ops.Shipments',
    'P table:orders', 'P table:Post', 'P table:prices', 'P table:reports.report_runs', 'P table:sessions', 'P table:shop_product', 'P table:users',
  ].sort());
  assert.equal(r.facts.find((f) => f.key === 'table:fixture_rows').test, true);
  assertEvidence(member('mixed'), r);
});

test('db: Django managed = False tables are consumes, and an unmanaged-only migration never makes the member an owner; table functions are not tables', async () => {
  const r = await runDetector(detector, member('legacy'), ws.members);
  assert.deepEqual(rows(r), ['C table:orders', 'C table:orders', 'P table:orders_note', 'P table:orders_note']);
  const u = await runDetector(detector, member('unmanaged'), ws.members);
  assert.deepEqual(rows(u), ['C table:orders']);
  const rep = await runDetector(detector, member('reports'), ws.members);
  assert.deepEqual(rows(rep, 'app/funcs.py'), ['C table:accounts', 'C table:audit'], 'FROM my_func(1) is a table function; INSERT INTO audit(a, b) is a table');
  assert.deepEqual(rows(rep, 'app/values.py'), ['C table:archived_files', 'C table:files', 'C table:notes', 'C table:tags', 'C table:users'], "a '--' / '/*' value is not a comment; FROM users (NOLOCK) is the table");
});

test('db: a wide unmanaged Django model (options past 4 000 chars) is still a consume under its db_table, never an owner', async () => {
  const r = await runDetector(detector, member('wide'), ws.members);
  assert.deepEqual(rows(r), ['C table:CUSTOMERS']);
  assertEvidence(member('wide'), r);
  assert.deepEqual(rows(await runDetector(detector, member('djalter'), ws.members)), ['P table:shop_items'], 'an AddField-only Django migration still owns');
});

test('db: a Django proxy model, a state-only field operation, a docstring or a help_text never makes a reader an owner; a real field operation does', async () => {
  const got = async (k) => rows(await runDetector(detector, member(k), ws.members));
  assert.deepEqual(await got('proxy'), ['C table:invoices', 'C table:orders'], 'a proxy CreateModel has no table and grants no ownership');
  assert.deepEqual(await got('stateonly'), ['C table:invoices', 'C table:orders']);
  assert.deepEqual(await got('helptext'), ['C table:invoices', 'C table:legacy_customer'], "'see docs/migrations.md' does not end the CreateModel");
  assert.deepEqual(await got('realfield'), ['C table:orders', 'P db:orders', 'P table:invoices']);
  assert.deepEqual(await got('jsondefault'), ['P table:gw_gateway'], 'a field default {"proxy": True} is no proxy option');
  assertEvidence(member('proxy'), await runDetector(detector, member('proxy'), ws.members));
});

test('db: a SQL string that opens with a -- comment still yields its DDL (and the comment never a table)', async () => {
  const r = await runDetector(detector, member('inline'), ws.members);
  assert.deepEqual(rows(r), ['P table:events', 'P table:runs']);
  assertEvidence(member('inline'), r);
});

test('db: one fact per (dir, key) per file — a seed file never spends the member\'s fact budget', async () => {
  const r = await runDetector(detector, member('seeded'), ws.members);
  assert.deepEqual(r.facts.map((f) => `${f.dir} ${f.key} @${f.line}`), ['consumes table:products @1']);
});
