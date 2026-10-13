# EISA: check answers — the gate between the assessor and eisaWrite. Every row to
# assess must carry an allowed Implemented value, and every claim a short rationale,
# evidence and a section in the proof document. What is missing goes back to the
# assessor as feedback (blocking); style nits are reported but never block.
import json
import os
import re


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
    if isinstance(v, dict):
        return ', '.join('%s' % x for x in v.values() if x)
    return str(v).strip()


def write(api, port, text):
    p = api.outputs.get(port) if hasattr(api.outputs, 'get') else None
    if p and p.get('path'):
        with open(p['path'], 'w', encoding='utf-8') as fh:
            fh.write(text)


def main(api):
    issues = []

    def issue(sev, title, detail, loc=''):
        issues.append({'severity': sev, 'title': title, 'detail': detail, 'location': loc})

    rows_doc = parse_json(read(api.inputs['rows']))
    rows = rows_doc.get('rows') or []
    allowed = rows_doc.get('allowedValues') or ['Y', 'N', 'Partial', 'N/A']
    canon = {v.upper(): v for v in allowed}
    by_id = {key(r['id']): r for r in rows}
    to_assess = [r for r in rows if r.get('status') == 'assess']

    answers = []
    try:
        data = parse_json(read(api.inputs['assessment']))
        answers = data.get('assessments') if isinstance(data, dict) else data
        if not isinstance(answers, list):
            raise ValueError('no "assessments" list')
    except (ValueError, OSError, KeyError) as e:
        issue('critical', 'The assessment is not readable JSON',
              'Expected {"assessments": [{"id", "implemented", "rationale", "evidence", ...}]}: %s' % e)
        answers = []

    proof = None
    if api.inputs.get('proof') and api.inputs['proof'].get('path') and os.path.isfile(api.inputs['proof']['path']):
        proof = read(api.inputs['proof']).upper()
    require_proof = api.params.get('requireProof', True) not in (False, 'false', 0) and proof is not None
    max_len = int(api.params.get('maxRationale') or 300)

    seen = {}
    for a in answers:
        if not isinstance(a, dict):
            continue
        rid = key(field(a, 'id'))
        if not rid:
            issue('minor', 'An answer without an id', json.dumps(a)[:200])
            continue
        if rid in seen:
            issue('major', '%s is answered twice' % rid, 'Keep one answer per requirement.', rid)
        seen[rid] = a
        row = by_id.get(rid)
        if row is None:
            issue('minor', '%s is not in the workbook' % rid, 'It will be ignored when the workbook is written.', rid)
            continue
        if row.get('status') != 'assess':
            issue('minor', '%s is %s' % (rid, row.get('status')),
                  'It will be left as it is in the workbook (%s).' % row.get('reason', ''), rid)
            continue
        value = as_text(field(a, 'implemented'))
        rationale = as_text(field(a, 'rationale'))
        evidence = as_text(field(a, 'evidence'))
        if value and value.upper() not in canon:
            issue('major', '%s: Implemented "%s" is not allowed' % (rid, value),
                  'Use one of %s, or leave it blank when code and infrastructure cannot prove it.' % ', '.join(allowed), rid)
            continue
        value = canon.get(value.upper(), '')
        if value and value != 'N/A':
            if not rationale:
                issue('major', '%s: %s without a rationale' % (rid, value), 'Add a short rationale with links.', rid)
            if not evidence:
                issue('major', '%s: %s without evidence' % (rid, value),
                      'List the files, configs, pipelines or resources that prove it (repo/path:line or URL).', rid)
            if require_proof and rid not in proof:
                issue('major', '%s: no section in the proof document' % rid,
                      'Add a "## %s" section that explains the claim with its evidence.' % row['id'], rid)
        elif value == 'N/A' and not rationale:
            issue('major', '%s: N/A without a reason' % rid, 'Say in one line why it does not apply.', rid)
        elif not value and not rationale:
            issue('minor', '%s is left blank without a note' % rid, 'Say what could not be verified and who can answer.', rid)
        if len(rationale) > max_len:
            issue('minor', '%s: rationale is %d characters' % (rid, len(rationale)),
                  'Keep the cell short (%d max); the detail belongs in the proof document.' % max_len, rid)

    missing = [r for r in to_assess if key(r['id']) not in seen]
    for r in missing:
        issue('major', '%s is not answered' % r['id'],
              'Every row to assess needs an entry; leave Implemented blank when it cannot be verified.', key(r['id']))
    answered = [a for k, a in seen.items() if by_id.get(k, {}).get('status') == 'assess'
                and as_text(field(a, 'implemented'))]
    if to_assess and answers and not answered:
        issue('major', 'Nothing was assessed', 'Every answer is blank: check the code and infrastructure again.')

    blocking = [i for i in issues if i['severity'] in ('critical', 'major')]
    notes = [i for i in issues if i not in blocking]
    tally = {}
    for k, a in seen.items():
        if by_id.get(k, {}).get('status') == 'assess':
            v = canon.get(as_text(field(a, 'implemented')).upper(), '') or 'blank'
            tally[v] = tally.get(v, 0) + 1
    lines = ['# EISA check', '',
             '- Rows to assess: %d, answered: %d, missing: %d' % (len(to_assess), len(to_assess) - len(missing), len(missing)),
             '- Answers: ' + (', '.join('%s %d' % kv for kv in sorted(tally.items())) or 'none'),
             '- Proof document: %s' % ('checked' if require_proof else 'not checked'), '']
    if blocking:
        lines += ['## Fix these (blocking)', '',
                  'Change only what is listed here and keep every other answer as it is.', '']
        lines += ['- **%s** — %s' % (i['title'], i['detail']) for i in blocking]
        lines.append('')
    if notes:
        lines += ['## Notes', ''] + ['- %s — %s' % (i['title'], i['detail']) for i in notes] + ['']
    if not issues:
        lines.append('All rows are answered and every claim has a rationale, evidence and a proof section.')
    text = '\n'.join(lines) + '\n'
    write(api, 'report', text)
    write(api, 'feedback', text)
    summary = '%d blocking, %d notes' % (len(blocking), len(notes))
    return {'summary': summary, 'verdict': {'summary': summary, 'issues': issues}}
