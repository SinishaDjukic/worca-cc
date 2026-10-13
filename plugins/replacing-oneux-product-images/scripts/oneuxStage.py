# OneUX images: stage - step 3, stage_copies.py of the replacing-oneux-product-images skill (now
# mandatory): copies each corrected image into <work dir>/03-staged-originals/<COUNTRY>/<locale>/
# <exact blob basename>. Every copy is verified byte-for-byte (SHA-256) against its source; a
# destination that already exists with different content is never overwritten. The original
# (ID-named) images are NEVER modified. A continued job reuses the staged tree. No Azure calls.
import hashlib
import json
import os
import re

IMAGE_SHA256_CACHE = {}


def sha256(path):
    """Cache per-path SHA-256 so we don't re-hash a file repeatedly on one run."""
    path = os.path.abspath(path)
    key = (path, os.path.getsize(path))
    if key not in IMAGE_SHA256_CACHE:
        digest = hashlib.sha256()
        with open(path, 'rb') as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b''):
                digest.update(chunk)
        IMAGE_SHA256_CACHE[key] = digest.hexdigest()
    return IMAGE_SHA256_CACHE[key]


def country_from_locale(locale):
    """'fr-ch' (or 'fr-CH') -> 'CH'; fall back to the last segment uppercased."""
    tail = locale.rsplit('-', 1)[-1]
    return tail.upper() if tail else None


def destination_for(row, root):
    """<root>/<COUNTRY>/<locale>/<basename> for one manifest row."""
    locale = row['container']
    country = country_from_locale(locale)
    if not country:
        raise ValueError(f"No country derivable from locale {locale!r} (row {row.get('blob_path')})")
    basename = row['blob_path'].split('/', 1)[1] if '/' in row['blob_path'] else row['blob_path']
    return os.path.join(root, country, locale, basename)


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
    if doc.get('kind') != 'oneux-staged':
        raise ValueError('%s is not a staging file.' % path)
    write_port(api, 'staged', text)
    write_port(api, 'report', '# OneUX images: staged originals\n\nReused the staged tree (%d copies).\n' % len(doc['rows']))
    return {'summary': 'Reused staged tree: %d copies' % len(doc['rows'])}


def main(api):
    manifest = read_port(api, 'manifest')
    if not manifest or manifest.get('kind') != 'oneux-manifest':
        raise ValueError('Wire the manifest output of "OneUX images: manifest" into this card.')
    work_dir = manifest['workDir']
    if os.path.isfile(os.path.join(work_dir, '03-staged.json')):
        return reuse(api, os.path.join(work_dir, '03-staged.json'))
    exclude_param = api.params.get('exclude')
    exclude = set(t for t in re.split(r'[\s,;]+', 'xz-xy' if exclude_param is None else exclude_param) if t)
    excluded = sorted(set(r['container'] for r in manifest['rows'] if r['container'] in exclude))
    if excluded:
        raise ValueError('Manifest contains excluded locales %s; fix the discovery scope.' % excluded)

    root = os.path.join(work_dir, '03-staged-originals')
    os.makedirs(root, exist_ok=False)
    staged, skipped_existing, missing_source, conflicts, out_rows = [], [], [], [], []

    for row in manifest['rows']:
        src = row['local_image']
        if not os.path.isfile(src):
            missing_source.append(row['blob_path'])
            continue
        dest = destination_for(row, root)
        os.makedirs(os.path.dirname(dest), exist_ok=True)

        if os.path.exists(dest):
            if sha256(dest) == sha256(src):
                skipped_existing.append(row['blob_path'])  # already staged identically
                continue
            conflicts.append(row['blob_path'])  # different content at destination -> never overwrite
            continue

        with open(src, 'rb') as src_handle, open(dest, 'xb') as dest_handle:
            dest_handle.write(src_handle.read())
            dest_handle.flush()
            os.fsync(dest_handle.fileno())

        if sha256(dest) != sha256(src):
            os.remove(dest)  # do not leave a corrupt copy behind
            conflicts.append(row['blob_path'] + ' (verification failed, removed)')
            continue
        staged.append(row['blob_path'])
        out_rows.append({
            'media_id': row['media_id'],
            'container': row['container'],
            'blob_path': row['blob_path'],
            'local_image': src,
            'staged_path': os.path.abspath(dest),
            'sha256': sha256(dest),
        })

    if missing_source or conflicts or skipped_existing:
        raise ValueError('Staging failed - missing source: %s; conflicts/failures: %s; duplicate paths: %s'
                         % (missing_source or 'none', conflicts or 'none', skipped_existing or 'none'))
    doc = {
        'version': 1,
        'kind': 'oneux-staged',
        'workDir': work_dir,
        'root': os.path.abspath(root),
        'manifest': os.path.join(work_dir, '02-manifest.json'),
        'rows': out_rows,
    }
    text = json.dumps(doc, indent=2)
    with open(os.path.join(work_dir, '03-staged.json'), 'x', encoding='utf-8') as fh:
        fh.write(text)
    write_port(api, 'staged', text)

    countries = {}
    for r in out_rows:
        countries.setdefault(country_from_locale(r['container']), set()).add(r['container'])
    lines = ['# OneUX images: staged originals', '',
             '- Tree: `%s`' % os.path.abspath(root),
             '- %d copies, each SHA-256-checked against its ID-named source' % len(out_rows),
             '- %d countries; countries with several language locales: %s' % (
                 len(countries),
                 ', '.join('%s (%s)' % (c, ', '.join(sorted(l))) for c, l in sorted(countries.items()) if len(l) > 1) or 'none'),
             '', 'Unscaled copies: input for the dev prescaler only, never for a production write.']
    write_port(api, 'report', '\n'.join(lines) + '\n')
    return {'summary': 'Staged %d copies in %d countries' % (len(out_rows), len(countries))}
