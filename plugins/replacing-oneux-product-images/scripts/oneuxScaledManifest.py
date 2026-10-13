# OneUX images: scaled manifest - step 8 (new, plan phase 7). Rebuilds the manifest from the
# reviewed raw manifest, replacing each row's local_image with its verified locale-specific scaled
# file (size and MD5 recomputed) and recording provenance to the corrected original and the dev
# output. The path set must be identical to the raw manifest; a row whose bytes equal any corrected
# original (unscaled), or that is not a 3200x1800 PNG, stops the job. Only this manifest is eligible
# for comparison with and writes to production. No Azure calls.
import hashlib
import json
import os
import struct


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


def load(work_dir, name, kind):
    path = os.path.join(work_dir, name)
    if not os.path.isfile(path):
        raise ValueError('%s is missing: run the earlier steps of this job first.' % path)
    with open(path, encoding='utf-8') as fh:
        doc = json.load(fh)
    if doc.get('kind') != kind:
        raise ValueError('%s is not a %s file.' % (path, kind))
    return doc


def main(api):
    prev = read_port(api, 'prev')
    if not prev or not prev.get('workDir'):
        raise ValueError('Wire the output of "OneUX images: dev download" into "prev".')
    work_dir = prev['workDir']
    out = os.path.join(work_dir, '08-scaled-manifest.json')
    if os.path.isfile(out):
        with open(out, encoding='utf-8') as fh:
            text = fh.read()
        if json.loads(text).get('kind') != 'oneux-scaled-manifest':
            raise ValueError('%s is not a scaled manifest.' % out)
        write_port(api, 'job', text)
        write_port(api, 'report', '# OneUX images: scaled manifest\n\nReused the frozen scaled manifest.\n')
        return {'summary': 'Reused scaled manifest'}
    manifest = load(work_dir, '02-manifest.json', 'oneux-manifest')
    scaled = load(work_dir, '07-scaled.json', 'oneux-scaled')

    by_path = {d['blob_path']: d for d in scaled['destinations']}
    raw_paths = set(r['blob_path'] for r in manifest['rows'])
    if set(by_path) != raw_paths or len(by_path) != len(manifest['rows']):
        raise ValueError('Scaled files do not cover exactly the manifest paths (%d scaled, %d in manifest).'
                         % (len(by_path), len(raw_paths)))
    originals = set(s['sha256'] for s in manifest['images'].values())
    rows = []
    for r in manifest['rows']:
        d = by_path[r['blob_path']]
        with open(d['local_path'], 'rb') as fh:
            data = fh.read()
        sha = hashlib.sha256(data).hexdigest()
        if sha != d['sha256']:
            raise ValueError('Scaled file changed since download: %s' % d['local_path'])
        if sha in originals:
            raise ValueError('Row %s still carries unscaled original bytes.' % r['blob_path'])
        if data[:8] != b'\x89PNG\r\n\x1a\n' or list(struct.unpack('>II', data[16:24])) != [3200, 1800]:
            raise ValueError('Row %s is not a 3200x1800 PNG.' % r['blob_path'])
        rows.append({
            'media_id': r['media_id'],
            'culture': r['culture'],
            'container': r['container'],
            'blob_path': r['blob_path'],
            'hash_blob_path': r['hash_blob_path'],
            'local_image': d['local_path'],
            'size_bytes': len(data),
            'md5_hex': hashlib.md5(data).hexdigest(),
            'sha256': sha,
            'source_image': r['local_image'],
            'dev_name': d['dev_name'],
        })
    doc = {
        'version': 1,
        'kind': 'oneux-scaled-manifest',
        'workDir': work_dir,
        'provenance': {'raw_manifest': os.path.join(work_dir, '02-manifest.json'),
                       'dev_output': os.path.join(work_dir, '07-scaled.json')},
        'counts': {'rows': len(rows), 'locales': len(set(r['container'] for r in rows)),
                   'media_ids': len(set(r['media_id'] for r in rows))},
        'rows': rows,
    }
    text = json.dumps(doc, indent=2)
    with open(out, 'x', encoding='utf-8') as fh:
        fh.write(text)
    write_port(api, 'job', text)
    write_port(api, 'report', '# OneUX images: scaled manifest\n\n- %d rows, %d locales, %d media IDs\n'
                              '- Same paths as the raw manifest; every row a 3200x1800 PNG, none with original bytes\n'
                              '- Digest: `%s`\n' % (len(rows), doc['counts']['locales'], doc['counts']['media_ids'],
                                                     hashlib.sha256(text.encode('utf-8')).hexdigest()))
    return {'summary': 'Scaled manifest: %d rows' % len(rows)}
