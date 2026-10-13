# OneUX images: prescaler inputs - step 4 (new, plan phase 3). The dev prescaler scans one
# container (de-de), so every staged copy gets the temporary name COUNTRY_<exact basename>.png.
# A name is shared only when media ID and SHA-256 agree (a country's language locales that use
# the same basename); any other collision stops the job. The map from each temporary name back to
# ALL its locale destinations is frozen here, and the files to upload are copied (create-only,
# SHA-256-checked) into <work dir>/04-prescaler-inputs/. A continued job reuses the inventory.
# No Azure calls.
import base64
import hashlib
import json
import os
import re
import time

NAME_RE = re.compile(r'^[A-Z]{2}_[A-Za-z0-9][A-Za-z0-9._-]*\.png$')


def log(message, level='info'):
    """One live progress line. print() reaches the run log WHILE the step runs; api.log()
    lines only travel on the result frame, and a frame that failed is never rendered - so
    anything logged before a raise would be lost."""
    print('[%s] %s' % (level, message), flush=True)


def progress(label, done, total, t0, every=25):
    """A progress line every `every` items and on the last one - a bulk loop is otherwise
    silent for as long as it runs."""
    if done % every and done != total:
        return
    elapsed = time.time() - t0
    log('%s %d/%d (%.0f s elapsed, %.1f/s)' % (label, done, total, elapsed, done / max(elapsed, 0.001)))


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def read_port(api, port):
    p = api.inputs.get(port) if hasattr(api.inputs, 'get') else None
    if p and p.get('path') and os.path.isfile(p['path']):
        with open(p['path'], encoding='utf-8') as fh:
            return json.load(fh)
    return None


def write_port(api, port, text):
    p = api.outputs.get(port) if hasattr(api.outputs, 'get') else None
    if p and p.get('path'):
        with open(p['path'], 'w', encoding='utf-8') as fh:
            fh.write(text)


def reuse(api, path):
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    doc = json.loads(text)
    if doc.get('kind') != 'oneux-prescaler-inputs':
        raise ValueError('%s is not a prescaler inventory.' % path)
    log('reusing the prescaler inventory of this job (%d inputs for %d rows)'
        % (doc['counts']['inputs'], doc['counts']['rows']))
    write_port(api, 'inventory', text)
    write_port(api, 'report', '# OneUX images: prescaler inputs\n\nReused the inventory (%d inputs for %d rows).\n'
               % (doc['counts']['inputs'], doc['counts']['rows']))
    return {'summary': 'Reused inventory: %d inputs' % doc['counts']['inputs']}


def main(api):
    staged = read_port(api, 'staged')
    if not staged or staged.get('kind') != 'oneux-staged':
        raise ValueError('Wire the staged output of "OneUX images: stage" into this card.')
    work_dir = staged['workDir']
    if os.path.isfile(os.path.join(work_dir, '04-prescaler-inventory.json')):
        return reuse(api, os.path.join(work_dir, '04-prescaler-inventory.json'))

    log('grouping %d staged rows into COUNTRY_<basename>.png prescaler inputs' % len(staged['rows']))
    t0 = time.time()
    groups = {}
    for index, row in enumerate(staged['rows'], 1):
        progress('hashed', index, len(staged['rows']), t0, every=50)
        locale = row['container']
        country = locale.rsplit('-', 1)[-1].upper()
        basename = row['blob_path'].split('/', 1)[1]
        name = '%s_%s' % (country, basename)
        if not NAME_RE.match(name):
            raise ValueError('Unexpected prescaler input name %r for %s' % (name, row['blob_path']))
        with open(row['staged_path'], 'rb') as fh:
            sha = sha256_bytes(fh.read())
        if sha != row['sha256']:
            raise ValueError('Staged copy changed since staging: %s' % row['staged_path'])
        group = groups.get(name)
        if group is None:
            group = groups[name] = {'name': name, 'media_id': row['media_id'], 'source_path': row['staged_path'],
                                    'sha256': sha, 'destinations': []}
        elif group['media_id'] != row['media_id'] or group['sha256'] != sha:
            raise ValueError('Ambiguous prescaler input %s: media %s / %s... vs media %s / %s...'
                             % (name, group['media_id'], group['sha256'][:12], row['media_id'], sha[:12]))
        group['destinations'].append({'container': locale, 'blob_path': row['blob_path']})

    out_dir = os.path.join(work_dir, '04-prescaler-inputs')
    os.makedirs(out_dir, exist_ok=False)
    log('%d staged rows -> %d unique prescaler inputs; copying them into %s'
        % (len(staged['rows']), len(groups), out_dir))
    t0 = time.time()
    inputs = []
    for index, name in enumerate(sorted(groups), 1):
        progress('copied', index, len(groups), t0)
        group = groups[name]
        with open(group['source_path'], 'rb') as fh:
            data = fh.read()
        dest = os.path.join(out_dir, name)
        with open(dest, 'xb') as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        with open(dest, 'rb') as fh:
            if sha256_bytes(fh.read()) != group['sha256']:
                raise ValueError('Copy verification failed: %s' % dest)
        md5 = hashlib.md5(data).digest()
        group.update({
            'local_path': os.path.abspath(dest),
            'size': len(data),
            'md5_hex': md5.hex(),
            'content_md5_b64': base64.b64encode(md5).decode('ascii'),
        })
        group['destinations'].sort(key=lambda d: d['blob_path'])
        inputs.append(group)

    fanned = sum(len(g['destinations']) for g in inputs)
    if fanned != len(staged['rows']):
        raise ValueError('Fan-out map covers %d of %d staged rows' % (fanned, len(staged['rows'])))
    counts = {'rows': len(staged['rows']), 'inputs': len(inputs),
              'shared': sum(1 for g in inputs if len(g['destinations']) > 1)}
    doc = {
        'version': 1,
        'kind': 'oneux-prescaler-inputs',
        'workDir': work_dir,
        'devContainer': 'de-de',
        'staged': os.path.join(work_dir, '03-staged.json'),
        'counts': counts,
        'inputs': inputs,
    }
    text = json.dumps(doc, indent=2)
    with open(os.path.join(work_dir, '04-prescaler-inventory.json'), 'x', encoding='utf-8') as fh:
        fh.write(text)
    digest = hashlib.sha256(text.encode('utf-8')).hexdigest()
    log('inventory: %d inputs, %d of them shared by several locales (digest %s)'
        % (counts['inputs'], counts['shared'], digest))
    write_port(api, 'inventory', text)

    lines = ['# OneUX images: prescaler inputs', '',
             '- Upload folder: `%s`' % os.path.abspath(out_dir),
             '- %d locale rows -> **%d unique prescaler inputs**, %d shared by several locales'
             % (counts['rows'], counts['inputs'], counts['shared']),
             '- Dev container: `de-de` (create-only upload, names prefixed with the job id)',
             '- Inventory digest (sha256 of 04-prescaler-inventory.json): `%s`' % digest, '']
    shared = [g for g in inputs if len(g['destinations']) > 1]
    if shared:
        lines += ['| Shared input | Locales |', '|---|---|']
        lines += ['| `%s` | %s |' % (g['name'], ', '.join(d['container'] for d in g['destinations'])) for g in shared]
    write_port(api, 'report', '\n'.join(lines) + '\n')
    return {'summary': '%d rows -> %d prescaler inputs (%d shared)' % (counts['rows'], counts['inputs'], counts['shared'])}
