# OneUX images: manifest - step 2, build_manifest.py of the replacing-oneux-product-images skill:
# joins the discovery mapping with the corrected images named by media ID (416317.png) into one
# row per target blob: exact blob and _hash marker path, local image, size and MD5. With a request
# the images are its frozen copies, re-checked against the SHA-256 recorded at fetch time. Stricter
# than the original: two candidate files for one ID fail instead of taking the first. A continued
# job reuses the frozen manifest. No Azure calls.
import csv
import hashlib
import json
import os
import re
import struct

CONTENT_TYPES = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
}


def log(message, level='info'):
    """One live progress line. print() reaches the run log WHILE the step runs; api.log()
    lines only travel on the result frame, and a frame that failed is never rendered - so
    anything logged before a raise would be lost."""
    print('[%s] %s' % (level, message), flush=True)


def md5_file(path):
    """Return (md5 digest bytes, md5 hex string)."""
    digest = hashlib.md5()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.digest(), digest.hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def hash_blob_name(blob_path):
    """'fr-ch/imagename.png' -> 'fr-ch/imagename_hash.png' (_hash before the extension)."""
    if '.' in blob_path:
        base, ext = blob_path.rsplit('.', 1)
        return f'{base}_hash.{ext}'
    return f'{blob_path}_hash'


def read_local_variant(image_dir, prefix):
    """Find '<image_dir>/<prefix>.<ext>' for a known image extension (case-insensitive)."""
    if not os.path.isdir(image_dir):
        return []
    wanted = prefix.lower()
    found = []
    for name in sorted(os.listdir(image_dir)):
        base, ext = os.path.splitext(name)
        if base.lower() == wanted and ext.lower().lstrip('.') in CONTENT_TYPES:
            found.append(os.path.join(image_dir, name))
    return found


def png_size(path):
    """[width, height] from the PNG header, or None when the file is not a PNG."""
    with open(path, 'rb') as fh:
        head = fh.read(24)
    if len(head) < 24 or head[:8] != b'\x89PNG\r\n\x1a\n' or head[12:16] != b'IHDR':
        return None
    return list(struct.unpack('>II', head[16:24]))


def task_line(api, *names):
    task = api.inputs.get('task') if hasattr(api.inputs, 'get') else None
    if not task or not task.get('path') or not os.path.isfile(task['path']):
        return ''
    with open(task['path'], encoding='utf-8', errors='replace') as fh:
        text = fh.read()
    for name in names:
        m = re.search(r'^\s*(?:[-*]\s*)?(?:\*\*)?%s(?:\*\*)?\s*[:=]\s*(.+)$' % name, text, re.I | re.M)
        if m:
            return m.group(1).strip().strip('*').strip().strip('`')
    return ''


def setting(api, param, *names):
    value = api.params.get(param)
    if isinstance(value, str):
        value = value.strip()
    return value if value not in (None, '') else task_line(api, *names)


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
    if doc.get('kind') != 'oneux-manifest':
        raise ValueError('%s is not a manifest file.' % path)
    log('reusing the frozen manifest of this job (%d rows)' % doc['counts']['rows'])
    write_port(api, 'manifest', text)
    write_port(api, 'report', '# OneUX images: manifest\n\nReused the frozen manifest (%d rows). Digest `%s`.\n'
               % (doc['counts']['rows'], hashlib.sha256(text.encode('utf-8')).hexdigest()))
    return {'summary': 'Reused manifest: %d rows' % doc['counts']['rows']}


def find_images(api, wanted, ids):
    """The folder holding the corrected images: the param / task line, else the run's extras/."""
    if wanted:
        path = os.path.abspath(os.path.expanduser(wanted))
        if not os.path.isdir(path):
            raise ValueError('Images folder %s does not exist.' % path)
        return path
    ctx = api.ctx or {}
    roots = [p for p in (ctx.get('pipelineDir'), ctx.get('runRoot')) if p]
    if ctx.get('pipelineDir'):
        roots.append(os.path.dirname(ctx['pipelineDir']))
    hits = set()
    for extras in (os.path.join(r, 'extras') for r in roots):
        for root, _dirs, files in os.walk(extras):
            for f in files:
                base, ext = os.path.splitext(f)
                if base.lower() in ids and ext.lower().lstrip('.') in CONTENT_TYPES:
                    hits.add(os.path.abspath(root))
    if len(hits) == 1:
        return hits.pop()
    if not hits:
        raise ValueError('No corrected images found. Wire "OneUX images: request" into discovery, attach the '
                         '<mediaId>.png files to the run, or give their folder in the images param.')
    raise ValueError('Corrected images found in several folders %s; set the images param.' % sorted(hits))


def main(api):
    mapping = read_port(api, 'mapping')
    if not mapping or mapping.get('kind') != 'oneux-discovery':
        raise ValueError('Wire the mapping output of "OneUX images: discover" into this card.')
    expected = [str(i) for i in mapping['expectedIds']]
    work_dir = mapping['workDir']
    if os.path.isfile(os.path.join(work_dir, '02-manifest.json')):
        return reuse(api, os.path.join(work_dir, '02-manifest.json'))
    request = mapping.get('request')
    if request:
        images = request['imagesDir']
        if set(request['images']) != set(expected):
            raise ValueError('Request images %s differ from the discovered IDs %s' % (sorted(request['images']), expected))
    else:
        images = find_images(api, setting(api, 'images', 'images', 'corrected images', 'image folder'),
                             set(i.lower() for i in expected))
    log('joining %d discovered media IDs with the corrected images in %s%s'
        % (len(expected), images, ' (frozen request %s, SHA-256 re-checked)' % request['request'] if request else ''))

    rows, missing_images, sources = [], [], {}
    for media_id in expected:
        entries = mapping['ids'].get(media_id) or []
        locals_found = read_local_variant(images, media_id)
        if not locals_found:
            missing_images.append(media_id)
            continue
        if len(locals_found) > 1:
            raise ValueError('Several corrected images for media ID %s: %s' % (media_id, locals_found))
        local_path = locals_found[0]
        _digest, md5_hex = md5_file(local_path)
        sha = sha256_file(local_path)
        if request and sha != request['images'][media_id]['sha256']:
            raise ValueError('Image %s changed since the request was fetched: %s' % (media_id, local_path))
        sources[media_id] = {
            'path': os.path.abspath(local_path),
            'bytes': os.path.getsize(local_path),
            'md5_hex': md5_hex,
            'sha256': sha,
            'png_size': png_size(local_path),
        }
        for entry in entries:
            blob_path = entry['blob_path']
            rows.append({
                'media_id': media_id,
                'culture': entry.get('culture'),
                'container': entry['container'],
                'blob_path': blob_path,
                'hash_blob_path': hash_blob_name(blob_path),
                'local_image': os.path.abspath(local_path),
                'size_bytes': os.path.getsize(local_path),
                'md5_hex': md5_hex,
            })
        log('media %s: %s -> %d target blobs' % (media_id, os.path.basename(local_path), len(entries)))

    missing = [mid for mid in expected if not mapping['ids'].get(mid)]
    if missing or missing_images or not rows:
        raise ValueError('Incomplete manifest, nothing written. IDs without blobs: %s; IDs without a local '
                         'image in %s: %s' % (missing or 'none', images, missing_images or 'none'))
    not_png = [mid for mid, s in sources.items() if s['png_size'] is None]
    if not_png:
        raise ValueError('Corrected images that are not PNG files: %s' % not_png)

    rows.sort(key=lambda r: (int(r['media_id']) if r['media_id'].isdigit() else r['media_id'], r['blob_path']))
    manifest = {
        'version': 1,
        'kind': 'oneux-manifest',
        'workDir': work_dir,
        'images_dir': images,
        'request': request['request'] if request else None,
        'mapping_source': os.path.join(work_dir, '01-discovery.json'),
        'images': sources,
        'counts': {
            'media_ids': len(expected),
            'locales': len(set(r['container'] for r in rows)),
            'rows': len(rows),
            'missing_local_image': 0,
            'total_bytes': sum(r['size_bytes'] for r in rows),
        },
        'rows': rows,
    }
    text = json.dumps(manifest, indent=2)
    with open(os.path.join(work_dir, '02-manifest.json'), 'x', encoding='utf-8') as handle:
        handle.write(text)
    with open(os.path.join(work_dir, '02-manifest.csv'), 'x', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    digest = hashlib.sha256(text.encode('utf-8')).hexdigest()
    log('manifest: %d rows, %d media IDs, %d locales, %s bytes to stage (digest %s)'
        % (len(rows), len(expected), manifest['counts']['locales'],
           format(manifest['counts']['total_bytes'], ','), digest))
    write_port(api, 'manifest', text)

    lines = ['# OneUX images: manifest', '',
             '- Work dir: `%s`' % work_dir,
             '- Corrected images: `%s`%s' % (images, ' (job %s, SHA-256 re-checked)' % request['request'] if request else ''),
             '- %d rows across %d media IDs and %d locales (%s bytes to stage)'
             % (len(rows), len(expected), manifest['counts']['locales'], format(manifest['counts']['total_bytes'], ',')),
             '- Manifest digest (sha256 of 02-manifest.json): `%s`' % digest, '',
             '| Media ID | File | PNG size | Bytes | Rows |', '|---|---|---|---|---|']
    for mid in expected:
        s = sources[mid]
        lines.append('| %s | `%s` | %dx%d | %s | %d |' % (
            mid, os.path.basename(s['path']), s['png_size'][0], s['png_size'][1], format(s['bytes'], ','),
            sum(1 for r in rows if r['media_id'] == mid)))
    lines += ['', 'These are the corrected source images. They go through the dev prescaler before anything '
                  'is compared with or written to production.']
    write_port(api, 'report', '\n'.join(lines) + '\n')
    return {'summary': '%d rows, %d media IDs, %d locales' % (len(rows), len(expected), manifest['counts']['locales'])}
