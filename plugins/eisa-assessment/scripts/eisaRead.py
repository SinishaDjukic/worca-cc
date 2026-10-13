# EISA: read workbook — turns the EISA requirements .xlsx attached to the run into
# JSON rows for the assessor, and keeps a copy of the workbook for eisaWrite.
# Standard library only: an .xlsx is a zip of XML parts.
import glob
import json
import os
import re
import shutil
import zipfile
import xml.etree.ElementTree as ET

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PR = '{http://schemas.openxmlformats.org/package/2006/relationships}'

# json key -> header text, normalised (lower case, letters and digits only)
COLUMNS = {
    'id': 'id', 'title': 'title', 'implemented': 'implemented', 'rationale': 'rationale',
    'statement': 'statement', 'cd09000Relevant': 'cd09000relevant',
    'differentiation': 'differentiationoption', 'applicability': 'applicability',
    'highProtection': 'highprotection', 'iso27001': 'iso27001', 'nist': 'nist',
    'csf': 'csf', 'role': 'role',
}
REQUIRED = ('id', 'title', 'implemented', 'rationale')
STATUSES = ('assess', 'prefilled', 'notApplicable', 'outOfScope', 'heading')
# rows nobody assesses keep only what eisaCheck and eisaWrite read, so the file stays small
COMPACT = ('row', 'id', 'title', 'implemented', 'rationale', 'status', 'reason')
SOURCE_COPY = os.path.join('eisa', 'source', 'requirements.xlsx')


def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def clean(s):
    """Cell text without Excel's _xHHHH_ escapes, CRs and wrapped-line indentation."""
    s = re.sub(r'_x([0-9A-Fa-f]{4})_', lambda m: chr(int(m.group(1), 16)), s or '')
    s = s.replace('\r\n', '\n').replace('\r', '\n')
    s = re.sub(r'\n[ \t]+', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


def col_letters(n):
    s = ''
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def split_ref(ref):
    m = re.match(r'([A-Z]+)(\d+)$', ref or '')
    return (m.group(1), int(m.group(2))) if m else (None, None)


def text_of(el):
    """Text of an <si> or <is>: its <t>, or the <t> of each run (phonetic runs skipped)."""
    parts = [t.text or '' for t in el.findall(M + 't')]
    for r in el.findall(M + 'r'):
        parts += [t.text or '' for t in r.findall(M + 't')]
    return ''.join(parts)


def sheets(z):
    """[(name, part)] in workbook order."""
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    targets = {r.get('Id'): r.get('Target') for r in rels.findall(PR + 'Relationship')}
    out = []
    for s in wb.iter(M + 'sheet'):
        t = targets.get(s.get(R + 'id'))
        if t:
            part = t.lstrip('/') if t.startswith('/') else os.path.normpath(os.path.join('xl', t)).replace(os.sep, '/')
            out.append((s.get('name'), part))
    return out


def shared_strings(z):
    try:
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
    except KeyError:
        return []
    return [text_of(si) for si in root.findall(M + 'si')]


def read_cells(z, part, sst):
    """{row number: {column letters: text}}"""
    root = ET.fromstring(z.read(part))
    grid = {}
    data = root.find(M + 'sheetData')
    if data is None:
        return grid
    for n, row in enumerate(data.findall(M + 'row'), start=1):
        r = int(row.get('r') or n)
        cells = {}
        for i, c in enumerate(row.findall(M + 'c'), start=1):
            letters = split_ref(c.get('r'))[0] or col_letters(i)
            t = c.get('t')
            v = c.find(M + 'v')
            if t == 'inlineStr':
                is_ = c.find(M + 'is')
                val = text_of(is_) if is_ is not None else ''
            elif v is None or v.text is None:
                val = ''
            elif t == 's':
                val = sst[int(v.text)]
            elif t == 'b':
                val = 'TRUE' if v.text.strip() == '1' else 'FALSE'
            else:
                val = v.text
            cells[letters] = val
        grid[r] = cells
    return grid


def find_table(z, sst):
    """The first sheet whose first 30 rows hold an ID / Title / Implemented / Rationale header."""
    for name, part in sheets(z):
        grid = read_cells(z, part, sst)
        for r in sorted(grid)[:30]:
            cols = {}
            for letters, val in grid[r].items():
                key = norm(val)
                for k, h in COLUMNS.items():
                    if key == h and k not in cols:
                        cols[k] = letters
            if all(k in cols for k in REQUIRED):
                return name, part, r, cols, grid
    return None


def find_workbook(ctx, wanted):
    roots = [p for p in (ctx.get('pipelineDir'), ctx.get('runRoot')) if p]
    if ctx.get('pipelineDir'):
        roots.append(os.path.dirname(ctx['pipelineDir']))
    searched = [os.path.join(r, 'extras') for r in roots]
    if wanted:
        if os.path.isabs(wanted):
            return (wanted if os.path.isfile(wanted) else None), [wanted]
        cands = [os.path.join(r, 'extras', wanted) for r in roots] + [os.path.join(r, wanted) for r in roots]
        return next((c for c in cands if os.path.isfile(c)), None), cands
    for d in searched:
        hits = sorted(h for h in glob.glob(os.path.join(d, '**', '*.xlsx'), recursive=True)
                      if not os.path.basename(h).startswith('~$'))
        if hits:
            return hits[0], searched
    # last resort: anywhere in the pipeline folder, except this card's own copy
    pdir = ctx.get('pipelineDir')
    if pdir:
        own = os.path.join(pdir, 'eisa')
        hits = sorted(h for h in glob.glob(os.path.join(pdir, '**', '*.xlsx'), recursive=True)
                      if not h.startswith(own) and not os.path.basename(h).startswith('~$'))
        if hits:
            return hits[0], searched
        searched.append(pdir)
    return None, searched


def task_line(api, names):
    """The value of a 'Name: value' line in the task, for the first name that has one."""
    task = api.inputs.get('task') if hasattr(api.inputs, 'get') else None
    if not task or not task.get('path') or not os.path.isfile(task['path']):
        return ''
    with open(task['path'], encoding='utf-8', errors='replace') as fh:
        text = fh.read()
    for name in names:
        m = re.search(r'^\s*(?:[-*]\s*)?(?:\*\*)?%s(?:\*\*)?\s*[:=]\s*(.+)$' % name, text, re.I | re.M)
        if m:
            return m.group(1).strip().strip('*').strip()
    return ''


def short_id(rid):
    return re.sub(r'^EISA-', '', re.sub(r'\s+', '', rid).upper())


def in_scope(rid, tokens):
    """ACC-301 covers ACC-301 and ACC-301.x; ACC covers every ACC-..."""
    sid = short_id(rid)
    return any(sid == t or sid.startswith(t + '.') or sid.startswith(t + '-') for t in tokens)


def write(api, port, text):
    p = api.outputs.get(port) if hasattr(api.outputs, 'get') else None
    if p and p.get('path'):
        with open(p['path'], 'w', encoding='utf-8') as fh:
            fh.write(text)


def main(api):
    params = api.params
    src, searched = find_workbook(api.ctx, (params.get('workbook') or '').strip())
    if not src:
        raise ValueError('No EISA workbook (.xlsx) found. Attach it to the run, or set the Workbook param. '
                         'Looked in: ' + '; '.join(searched))
    try:
        z = zipfile.ZipFile(src)
    except zipfile.BadZipFile:
        raise ValueError('%s is not an .xlsx zip. An old .xls, or a workbook encrypted by a sensitivity '
                         'label? Save an unencrypted .xlsx copy and attach that.' % src)
    with z:
        sst = shared_strings(z)
        found = find_table(z, sst)
    if not found:
        raise ValueError('No sheet in %s has the header ID / Title / Implemented / Rationale in its first 30 rows.' % src)
    sheet, part, header, cols, grid = found

    system_types = (params.get('systemTypes') or '').strip() or task_line(api, ('system types?', 'applicability'))
    types = set(norm(t) for t in system_types.split(',') if t.strip())
    scope = (params.get('scope') or '').strip() or task_line(api, ('requirements in scope', 'requirements', 'eisa scope'))
    tokens = [short_id(t) for t in re.split(r'[,;\s]+', scope) if t.strip()]
    skip_filled = params.get('skipFilled', True) not in (False, 'false', 0)
    skip_irrelevant = params.get('skipNotRelevant', False) in (True, 'true', 1)
    values = [v.strip() for v in (params.get('values') or 'Y,N,Partial,N/A').split(',') if v.strip()]

    rows = []
    for r in sorted(grid):
        if r <= header:
            continue
        cells = grid[r]
        if not (cells.get(cols['id']) or '').strip():
            continue
        row = {'row': r}
        for k, letters in cols.items():
            row[k] = clean(cells.get(letters))
        applies = set(norm(a) for a in row.get('applicability', '').split(',') if a.strip())
        if '.' not in row['id'] and not row.get('applicability'):
            row['status'], row['reason'] = 'heading', 'group heading, not a requirement'
        elif tokens and not in_scope(row['id'], tokens):
            row['status'], row['reason'] = 'outOfScope', 'not in the requirements in scope'
        elif skip_filled and (row['implemented'] or row['rationale']):
            row['status'], row['reason'] = 'prefilled', 'already filled in the workbook'
        elif types and applies and not (types & applies):
            row['status'], row['reason'] = 'notApplicable', 'Applicability does not list ' + system_types
        elif skip_irrelevant and row.get('cd09000Relevant', '').upper() == 'FALSE':
            row['status'], row['reason'] = 'notApplicable', 'CD09000_relevant is FALSE'
        else:
            row['status'] = 'assess'
        if row['status'] != 'assess':
            row = {k: row[k] for k in COMPACT if k in row}
        rows.append(row)

    pdir = api.ctx.get('pipelineDir') or os.getcwd()
    copy = os.path.join(pdir, SOURCE_COPY)
    os.makedirs(os.path.dirname(copy), exist_ok=True)
    if os.path.abspath(copy) != os.path.abspath(src):
        shutil.copyfile(src, copy)

    counts = {s: sum(1 for x in rows if x['status'] == s) for s in STATUSES}
    doc = {
        'version': 1, 'workbook': os.path.abspath(src), 'source': os.path.abspath(copy),
        'sheet': sheet, 'sheetPart': part, 'headerRow': header, 'columns': cols,
        'systemTypes': system_types, 'scope': scope, 'allowedValues': values, 'counts': counts, 'rows': rows,
    }
    write(api, 'rows', json.dumps(doc, indent=1, ensure_ascii=False))

    listed = [x for x in rows if x['status'] not in ('outOfScope', 'heading')]
    lines = ['# EISA requirements', '',
             '- Workbook: `%s`, sheet **%s** (header row %d)' % (os.path.basename(src), sheet, header),
             '- System types: %s' % (system_types or '_not set: every row applies_'),
             '- Requirements in scope: %s' % (scope or '_not set: every row_'),
             '- Implemented values: %s, or blank' % ', '.join(values),
             '- Rows: %d to assess, %d pre-filled, %d not applicable, %d out of scope, %d group headings' % tuple(
                 counts[s] for s in STATUSES),
             '', '| ID | Title | Role | Status |', '|---|---|---|---|']
    for x in listed:
        lines.append('| %s | %s | %s | %s |' % (x['id'], x['title'].replace('|', '/'), x.get('role', ''), x['status']))
    write(api, 'report', '\n'.join(lines) + '\n')
    return {'summary': '%s: %d to assess, %d pre-filled, %d not applicable, %d out of scope' % (
        sheet, counts['assess'], counts['prefilled'], counts['notApplicable'], counts['outOfScope'])}
