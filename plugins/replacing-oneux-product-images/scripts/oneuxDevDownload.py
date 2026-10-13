# OneUX images: dev download - step 7 (new, plan phase 6). Checks the prescaler's output in
# devscalerlocalenvtarget/de-de: exactly one PNG and one <name>_hash.png marker per input of this
# job (names start with the job id), nothing extra. Each marker must hold the raw MD5 of the
# uploaded source; each output must be a PNG of exactly 3200x1800. Every output is downloaded under
# its ETag (headers alone do not prove the bytes), then fanned out through the frozen one-to-many
# map, without the job/country prefix, to <work dir>/07-scaled-by-locale/<COUNTRY>/<locale>/
# <exact basename>; every copy is SHA-256-checked. Dev _hash markers never go to production.
import hashlib
import json
import os
import struct

DEV_TARGET = 'https://devscalerlocalenvtarget.blob.core.windows.net'
CONTAINER = 'de-de'
SIZE = [3200, 1800]


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


def reuse(api, path):
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    if json.loads(text).get('kind') != 'oneux-scaled':
        raise ValueError('%s is not a scaled-download record.' % path)
    write_port(api, 'job', text)
    write_port(api, 'report', '# OneUX images: dev download\n\nReused the downloaded and fanned-out images of this job.\n')
    return {'summary': 'Reused scaled download'}


def png_size(data):
    if len(data) < 24 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        return None
    return list(struct.unpack('>II', data[16:24]))


def write_new(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'xb') as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    with open(path, 'rb') as fh:
        sha = hashlib.sha256(fh.read()).hexdigest()
    if sha != hashlib.sha256(data).hexdigest():
        raise RuntimeError('Read-back of %s differs.' % path)
    return sha


def main(api):
    prev = read_port(api, 'prev')
    if not prev or not prev.get('workDir'):
        raise ValueError('Wire the output of "OneUX images: prescale" into "prev".')
    work_dir = prev['workDir']
    out = os.path.join(work_dir, '07-scaled.json')
    if os.path.isfile(out):
        return reuse(api, out)
    inventory = load(work_dir, '04-prescaler-inventory.json', 'oneux-prescaler-inputs')
    upload = load(work_dir, '05-dev-upload.json', 'oneux-dev-upload')
    load(work_dir, '06-prescale.json', 'oneux-prescale')
    job = upload['job']

    from azure.core import MatchConditions
    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient
    container = BlobServiceClient(DEV_TARGET, credential=DefaultAzureCredential()).get_container_client(CONTAINER)
    if hasattr(container, 'list_blob_names'):
        present = set(container.list_blob_names(name_starts_with=job + '_'))
    else:
        present = set(b.name for b in container.list_blobs(name_starts_with=job + '_'))
    expected = {e['dev_name']: e for e in upload['entries']}
    wanted = set(expected) | set(n[:-4] + '_hash.png' for n in expected)
    missing, extra = sorted(wanted - present), sorted(present - wanted)
    if missing or extra:
        raise RuntimeError('Prescaler output for job %s is incomplete or has extras. Missing: %s; extra: %s'
                           % (job, missing[:20] or 'none', extra[:20] or 'none'))

    by_name = {i['name']: i for i in inventory['inputs']}
    download_dir = os.path.join(work_dir, '07-scaled-download')
    fan_dir = os.path.join(work_dir, '07-scaled-by-locale')
    os.makedirs(download_dir, exist_ok=False)
    os.makedirs(fan_dir, exist_ok=False)
    outputs, destinations, problems = [], [], []
    for dev_name in sorted(expected):
        item = by_name[expected[dev_name]['name']]
        marker = container.get_blob_client(dev_name[:-4] + '_hash.png').download_blob().readall()
        if marker != bytes.fromhex(item['md5_hex']):
            problems.append('%s: _hash marker does not hold the source MD5' % dev_name)
            continue
        blob = container.get_blob_client(dev_name)
        props = blob.get_blob_properties()
        data = blob.download_blob(etag=props.etag, match_condition=MatchConditions.IfNotModified).readall()
        if len(data) != props.size:
            problems.append('%s: incomplete download' % dev_name)
            continue
        stored = props.content_settings.content_md5
        if stored and bytes(stored) != hashlib.md5(data).digest():
            problems.append('%s: bytes do not match the stored Content-MD5' % dev_name)
            continue
        size = png_size(data)
        if size != SIZE:
            problems.append('%s: PNG size %s, expected 3200x1800' % (dev_name, size))
            continue
        content_type = (props.content_settings.content_type or '').lower()
        if content_type and not content_type.startswith('image/png'):
            problems.append('%s: content type %s' % (dev_name, content_type))
            continue
        sha = write_new(os.path.join(download_dir, dev_name), data)
        outputs.append({'dev_name': dev_name, 'name': item['name'], 'etag': props.etag, 'size': len(data),
                        'sha256': sha, 'png_size': size, 'content_type': content_type or None})
        for d in item['destinations']:
            locale = d['container']
            basename = d['blob_path'].split('/', 1)[1]
            path = os.path.join(fan_dir, locale.rsplit('-', 1)[-1].upper(), locale, basename)
            destinations.append({'container': locale, 'blob_path': d['blob_path'], 'local_path': os.path.abspath(path),
                                 'sha256': write_new(path, data), 'dev_name': dev_name, 'media_id': item['media_id']})
    if problems:
        raise RuntimeError('Scaled output rejected: %s' % '; '.join(problems[:20]))
    if len(destinations) != inventory['counts']['rows']:
        raise RuntimeError('Fan-out produced %d of %d locale files' % (len(destinations), inventory['counts']['rows']))

    doc = {'version': 1, 'kind': 'oneux-scaled', 'workDir': work_dir, 'job': job, 'account': DEV_TARGET,
           'container': CONTAINER, 'outputs': outputs, 'destinations': destinations}
    text = json.dumps(doc, indent=2)
    with open(out, 'x', encoding='utf-8') as fh:
        fh.write(text)
    write_port(api, 'job', text)
    lines = ['# OneUX images: dev download', '',
             '- %d prescaler outputs checked (marker = source MD5, PNG 3200x1800) and downloaded under their ETag'
             % len(outputs),
             '- Fanned out to **%d locale files** in `%s`, each SHA-256-checked' % (len(destinations), fan_dir)]
    write_port(api, 'report', '\n'.join(lines) + '\n')
    return {'summary': '%d outputs -> %d locale files' % (len(outputs), len(destinations))}
