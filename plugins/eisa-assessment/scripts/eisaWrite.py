# EISA: write workbook — fills Implemented and Rationale of the assessed rows into a
# copy of the original workbook. Only the cells it fills change: the sheet XML is
# edited in place (no XML round-trip), so styles, tables, other sheets and the rows
# that were pre-filled stay exactly as they were. Standard library only.
import json
import os
import re
import shutil
import zipfile


def read(port_value):
    with open(port_value['path'], encoding='utf-8-sig', errors='replace') as fh:
        return fh.read()


def parse_json(text):
    try:
        return json.loads(text)
    except ValueError:
        m = re.search(r'```(?:json)?\s*(.*?)```', text, re.S)
        if m:
            return json.loads(m.group(1))
        raise


def key(s):
    return re.sub(r'\s+', '', str(s or '')).upper()


def field(a, *names):
    for n in names:
        for k, v in a.items():
            if k.lower() == n.lower():
                return v
    return None


def as_text(v):
    if v is None:
        return ''
    if isinstance(v, list):
        return '; '.join(as_text(x) for x in v if as_text(x))
    return str(v).strip()


def col_index(letters):
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n


def esc(s):
    s = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', s)
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def find_row(xml, r):
    return re.search(r'<row\b(?=[^>]*?\sr="%d")[^>]*?(/?)>' % r, xml)


def cell_style(xml, ref):
    m = re.search(r'<c\b(?=[^>]*?\sr="%s")(?=[^>]*?\ss="(\d+)")' % ref, xml)
    return m.group(1) if m else None


def set_cell(xml, letters, r, value):
    """Writes value as an inline string into cell letters+r, keeping its style.
    A cell missing from the row is inserted in column order, styled like the
    same column two rows away (so banding survives), else like its neighbour."""
    m = find_row(xml, r)
    if not m:
        return xml, False
    if m.group(1) == '/':
        tag = xml[m.start():m.end()]
        xml = xml[:m.start()] + tag[:-2].rstrip() + '></row>' + xml[m.end():]
        m = find_row(xml, r)
    open_end = m.end()
    close = xml.index('</row>', open_end)
    body = xml[open_end:close]
    ref = '%s%d' % (letters, r)
    cm = re.search(r'<c\b(?=[^>]*?\sr="%s")([^>]*?)(/>|>.*?</c>)' % ref, body, re.S)
    style = None
    if cm:
        s = re.search(r'\ss="(\d+)"', cm.group(1))
        style = s.group(1) if s else None
    else:
        for d in (2, -2, 1, -1):
            if r + d > 0:
                style = cell_style(xml, '%s%d' % (letters, r + d))
                if style:
                    break
    new = '<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (
        ref, ' s="%s"' % style if style else '', esc(value))
    if cm:
        body = body[:cm.start()] + new + body[cm.end():]
    else:
        target = col_index(letters)
        at = len(body)
        for c in re.finditer(r'<c\b[^>]*?\sr="([A-Z]+)\d+"', body):
            if col_index(c.group(1)) > target:
                at = c.start()
                break
        if style is None:
            prev = [c for c in re.finditer(r'<c\b[^>]*?\ss="(\d+)"', body[:at])]
            if prev:
                new = new.replace('<c r="%s"' % ref, '<c r="%s" s="%s"' % (ref, prev[-1].group(1)), 1)
        body = body[:at] + new + body[at:]
    tag = xml[m.start():open_end]
    sp = re.search(r'\sspans="(\d+):(\d+)"', tag)
    if sp:
        lo, hi = int(sp.group(1)), int(sp.group(2))
        c = col_index(letters)
        if c < lo or c > hi:
            tag = tag.replace(sp.group(0), ' spans="%d:%d"' % (min(lo, c), max(hi, c)))
    return xml[:m.start()] + tag + body + xml[close:], True


def extend_dropdown(xml, letters, values):
    """Adds values to every inline list validation (classic or x14) that covers the column."""
    target = col_index(letters)
    notes = []

    def covers(sqref):
        for tok in sqref.split():
            a, _, b = tok.partition(':')
            ca, cb = re.match(r'\$?([A-Z]+)', a), re.match(r'\$?([A-Z]+)', b or a)
            if ca and cb and col_index(ca.group(1)) <= target <= col_index(cb.group(1)):
                return True
        return False

    def block(m):
        text = m.group(0)
        sq = re.search(r'\ssqref="([^"]*)"', text) or re.search(r'<xm:sqref>(.*?)</xm:sqref>', text)
        if not sq or not covers(sq.group(1)) or 'type="list"' not in text:
            return text
        f = re.search(r'(<(?:x14:)?formula1>\s*(?:<xm:f>)?)(?:"|&quot;)(.*?)(?:"|&quot;)((?:</xm:f>)?\s*</(?:x14:)?formula1>)', text, re.S)
        if not f:
            notes.append('The Implemented dropdown takes its values from a range: add %s there by hand.' % ', '.join(values))
            return text
        items = [v for v in f.group(2).split(',') if v != '']
        added = [v for v in values if v and v not in items]
        if not added:
            return text
        notes.append('Added %s to the Implemented dropdown.' % ', '.join(added))
        return text[:f.start()] + f.group(1) + '"' + ','.join(items + added) + '"' + f.group(3) + text[f.end():]

    xml = re.sub(r'<(x14:)?dataValidation\b[^>]*>.*?</(?:x14:)?dataValidation>', block, xml, flags=re.S)
    return xml, notes


def write(api, port, text):
    p = api.outputs.get(port) if hasattr(api.outputs, 'get') else None
    if p and p.get('path'):
        with open(p['path'], 'w', encoding='utf-8') as fh:
            fh.write(text)


def main(api):
    doc = parse_json(read(api.inputs['rows']))
    data = parse_json(read(api.inputs['assessment']))
    answers = data.get('assessments') if isinstance(data, dict) else data
    allowed = doc.get('allowedValues') or ['Y', 'N', 'Partial', 'N/A']
    canon = {v.upper(): v for v in allowed}
    write_na = api.params.get('writeNotApplicable', True) not in (False, 'false', 0) and 'N/A' in canon
    cols = doc['columns']
    src = next((p for p in (doc.get('source'), doc.get('workbook')) if p and os.path.isfile(p)), None)
    if not src:
        raise ValueError('The workbook read by EISA: read workbook is gone: %s' % (doc.get('source') or doc.get('workbook')))

    by_id = {key(field(a, 'id')): a for a in answers or [] if isinstance(a, dict)}
    part = doc['sheetPart']
    with zipfile.ZipFile(src) as z:
        xml = z.read(part).decode('utf-8-sig')

    filled, skipped, table = 0, [], []
    for row in doc['rows']:
        status = row.get('status')
        if status == 'notApplicable' and write_na:
            text = 'Not applicable: %s.' % (row.get('reason') or 'outside the assessed system types')
            xml, ok = set_cell(xml, cols['implemented'], row['row'], canon['N/A'])
            if ok:
                xml, ok = set_cell(xml, cols['rationale'], row['row'], text)
            filled += 1 if ok else 0
            table.append((row['id'], canon['N/A'], text, 'not applicable'))
            continue
        if status != 'assess':
            table.append((row['id'], row.get('implemented', ''), row.get('rationale', ''), status))
            continue
        a = by_id.get(key(row['id']))
        if a is None:
            skipped.append(row['id'])
            table.append((row['id'], '', '', 'not answered'))
            continue
        raw = as_text(field(a, 'implemented'))
        value = canon.get(raw.upper(), '')
        if raw and not value:
            skipped.append(row['id'])
        rationale = as_text(field(a, 'rationale'))
        ok = True
        if value:
            xml, ok = set_cell(xml, cols['implemented'], row['row'], value)
        if rationale and ok:
            xml, ok = set_cell(xml, cols['rationale'], row['row'], rationale)
        if not ok:
            skipped.append(row['id'])
        filled += 1 if (value or rationale) and ok else 0
        table.append((row['id'], value, rationale, 'filled' if value else 'open'))

    notes = []
    if api.params.get('extendDropdown', True) not in (False, 'false', 0):
        xml, notes = extend_dropdown(xml, cols['implemented'], allowed)

    pdir = api.ctx.get('pipelineDir') or os.getcwd()
    outdir = os.path.join(pdir, 'eisa')
    os.makedirs(outdir, exist_ok=True)
    name = (api.params.get('outputName') or 'EISA-filled.xlsx').strip()
    if not name.lower().endswith('.xlsx'):
        name += '.xlsx'
    out = os.path.join(outdir, name)
    tmp = out + '.tmp'
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, xml.encode('utf-8') if item.filename == part else zin.read(item.filename))
    os.replace(tmp, out)

    proof_out = None
    p = api.inputs.get('proof') if hasattr(api.inputs, 'get') else None
    if p and p.get('path') and os.path.isfile(p['path']):
        proof_out = os.path.join(outdir, 'EISA-proof.md')
        shutil.copyfile(p['path'], proof_out)

    counts = {}
    for _, v, _, st in table:
        if st in ('filled', 'open', 'not applicable'):
            counts[v or 'blank'] = counts.get(v or 'blank', 0) + 1
    lines = ['# EISA workbook written', '',
             '- Workbook: `eisa/%s` (sheet **%s**)' % (name, doc.get('sheet')),
             '- Proof: %s' % ('`eisa/EISA-proof.md`' if proof_out else '_no proof document wired_'),
             '- Rows: ' + (', '.join('%s %d' % kv for kv in sorted(counts.items())) or 'none'),
             '- Rows written: %d' % filled]
    lines += ['- ' + n for n in notes]
    if skipped:
        lines.append('- Not written (no answer, a value outside %s, or the row was not found): %s' % (
            ', '.join(allowed), ', '.join(skipped)))
    lines += ['', '| ID | Implemented | Rationale | Status |', '|---|---|---|---|']
    for rid, v, rat, st in table:
        lines.append('| %s | %s | %s | %s |' % (rid, v, rat.replace('|', '/').replace('\n', ' '), st))
    write(api, 'report', '\n'.join(lines) + '\n')
    return {'summary': '%s: %d rows written%s' % (name, filled, ', %d skipped' % len(skipped) if skipped else '')}
