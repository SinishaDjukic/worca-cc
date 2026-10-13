# OneUX images: request - step 0. The requester uploads the corrected images flat into the upload
# container of the production source account (manual-upload-images/<mediaId>.png) and clears the
# container once the job is done. Folders in the container (oneux-jobs/<job>/...) belong to the
# workflow and are ignored here. This card downloads every root image under the ETag it was listed
# with, checks the stored Content-MD5 and the PNG header, and freezes the bytes (with SHA-256) in a
# fresh local work dir. It writes nothing to Azure. A later run of the same job (same 'Job:') reuses
# the frozen request instead of reading the container again.
# Reads anonymously while the container is public, else with the Azure login (needs a reader role).
import base64
import datetime
import hashlib
import json
import os
import re
import struct
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ACCOUNT = 'https://ptoneuxpcimagestoreprd.blob.core.windows.net'
JOBS = 'oneux-jobs'
JOB_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
FILE_RE = re.compile(r'^(?P<id>\d+)\.png$', re.I)
API_VERSION = '2021-08-06'


def log(message, level='info'):
    """One live progress line. print() reaches the run log WHILE the step runs; api.log()
    lines only travel on the result frame, and a frame that failed is never rendered - so
    anything logged before a raise would be lost."""
    print('[%s] %s' % (level, message), flush=True)


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


def write_port(api, port, text):
    p = api.outputs.get(port) if hasattr(api.outputs, 'get') else None
    if p and p.get('path'):
        with open(p['path'], 'w', encoding='utf-8') as fh:
            fh.write(text)


def png_size(data):
    if len(data) < 24 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        return None
    return list(struct.unpack('>II', data[16:24]))


class Anonymous:
    """Public container: plain REST calls, no credential."""
    access = 'anonymous (public container)'

    def __init__(self, container):
        self.container = container

    def list(self):
        blobs, marker = [], ''
        while True:
            query = {'restype': 'container', 'comp': 'list'}
            if marker:
                query['marker'] = marker
            url = '%s/%s?%s' % (ACCOUNT, self.container, urllib.parse.urlencode(query))
            with urllib.request.urlopen(urllib.request.Request(url, headers={'x-ms-version': API_VERSION}),
                                        timeout=60) as resp:
                root = ET.fromstring(resp.read())
            for blob in root.iter('Blob'):
                props = blob.find('Properties')
                blobs.append({
                    'name': blob.findtext('Name'),
                    'etag': (props.findtext('Etag') or '').strip('"'),
                    'bytes': int(props.findtext('Content-Length') or 0),
                    'content_md5': props.findtext('Content-MD5') or None,
                    'last_modified': props.findtext('Last-Modified'),
                })
            marker = root.findtext('NextMarker') or ''
            if not marker:
                return blobs

    def download(self, name, etag):
        url = '%s/%s/%s' % (ACCOUNT, self.container, urllib.parse.quote(name))
        request = urllib.request.Request(url, headers={'If-Match': '"%s"' % etag, 'x-ms-version': API_VERSION})
        try:
            with urllib.request.urlopen(request, timeout=300) as resp:
                return resp.read(), (resp.headers.get('ETag') or '').strip('"'), resp.headers.get('Content-MD5')
        except urllib.error.HTTPError as exc:
            if exc.code == 412:
                raise RuntimeError('%s changed while it was being fetched; run again once the upload is final.' % name)
            raise


class AzureLogin:
    """Private container: the Azure SDK with DefaultAzureCredential (Storage Blob Data Reader)."""
    access = 'Azure login'

    def __init__(self, container):
        from azure.identity import DefaultAzureCredential
        from azure.storage.blob import ContainerClient
        self.client = ContainerClient(ACCOUNT, container, credential=DefaultAzureCredential())

    def list(self):
        blobs = []
        for b in self.client.list_blobs():
            md5 = b.content_settings.content_md5 if b.content_settings else None
            blobs.append({
                'name': b.name,
                'etag': (b.etag or '').strip('"'),
                'bytes': b.size,
                'content_md5': base64.b64encode(bytes(md5)).decode('ascii') if md5 else None,
                'last_modified': b.last_modified.isoformat() if b.last_modified else None,
            })
        return blobs

    def download(self, name, etag):
        from azure.core import MatchConditions
        from azure.core.exceptions import ResourceModifiedError
        try:
            stream = self.client.get_blob_client(name).download_blob(
                etag='"%s"' % etag, match_condition=MatchConditions.IfNotModified)
        except ResourceModifiedError:
            raise RuntimeError('%s changed while it was being fetched; run again once the upload is final.' % name)
        data = stream.readall()
        md5 = stream.properties.content_settings.content_md5
        return data, (stream.properties.etag or '').strip('"'), (
            base64.b64encode(bytes(md5)).decode('ascii') if md5 else None)


def open_container(container):
    reader = Anonymous(container)
    try:
        blobs = reader.list()
        log('listed %s/%s anonymously: %d blobs' % (ACCOUNT, container, len(blobs)))
        return reader, blobs
    except urllib.error.HTTPError as exc:
        if exc.code not in (401, 403, 404):
            raise
        log('anonymous listing refused (HTTP %d); trying the Azure login' % exc.code)
    try:
        reader = AzureLogin(container)
        blobs = reader.list()
        log('listed %s/%s with the Azure login: %d blobs' % (ACCOUNT, container, len(blobs)))
        return reader, blobs
    except Exception as exc:
        raise RuntimeError('Cannot list %s/%s anonymously or with the Azure login (%s). A private container '
                           'needs Storage Blob Data Reader on ptoneuxpcimagestoreprd.' % (ACCOUNT, container, exc))


def reuse(api, path):
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    doc = json.loads(text)
    if doc.get('kind') != 'oneux-request':
        raise ValueError('%s is not a request file.' % path)
    log('job %s was already frozen on %s: re-checking the SHA-256 of %d images, not reading the container again'
        % (doc['job'], doc['fetchedAt'], len(doc['images'])))
    for media_id, image in doc['images'].items():
        with open(image['path'], 'rb') as fh:
            if hashlib.sha256(fh.read()).hexdigest() != image['sha256']:
                raise ValueError('Frozen image %s changed since job %s was fetched.' % (image['path'], doc['job']))
    log('reused the frozen request of job %s: %d images, every SHA-256 still matches' % (doc['job'], len(doc['images'])))
    write_port(api, 'request', text)
    write_port(api, 'report', '# OneUX images: request (job %s)\n\nReused the request frozen on %s: %d images, '
                              'SHA-256 re-checked. The upload container was not read again.\n'
               % (doc['job'], doc['fetchedAt'], len(doc['images'])))
    return {'summary': 'Job %s: reused the frozen request (%d images)' % (doc['job'], len(doc['images']))}


def main(api):
    container = (api.params.get('container') or 'manual-upload-images').strip()
    started = datetime.datetime.now(datetime.timezone.utc)
    job = setting(api, 'job', 'job', 'job id') or started.strftime('%Y%m%d-%H%M%S')
    if not JOB_RE.match(job):
        raise ValueError('Job id %r: use letters, digits, ".", "_" or "-" only.' % job)
    job_prefix = '%s/%s/' % (JOBS, job)
    work_dir = os.path.abspath(os.path.expanduser(
        setting(api, 'workDir', 'work dir', 'work folder') or os.path.join('~', 'oneux-image-replacements', job)))
    log('job %s; work dir %s' % (job, work_dir))
    existing = os.path.join(work_dir, '00-request.json')
    if os.path.isfile(existing):
        return reuse(api, existing)

    log('reading the upload container %s/%s' % (ACCOUNT, container))
    reader, blobs = open_container(container)
    root = [b for b in blobs if '/' not in b['name']]
    in_folders = len(blobs) - len(root)
    log('%d images at the container root, %d blobs inside job folders (ignored)' % (len(root), in_folders))
    if any(b['name'].startswith(job_prefix) for b in blobs):
        raise ValueError('%s/%s already exists: pick a new job id.' % (container, job_prefix))
    if not root:
        raise ValueError('No images at the root of %s/%s. Upload the corrected <mediaId>.png files first.'
                         % (ACCOUNT, container))
    unexpected = [b['name'] for b in root if not FILE_RE.match(b['name'])]
    if unexpected:
        raise ValueError('Files at the container root that are not <mediaId>.png: %s. Rename or remove them; '
                         'nothing was fetched.' % unexpected)
    by_id = {}
    for b in root:
        media_id = FILE_RE.match(b['name']).group('id')
        if media_id in by_id:
            raise ValueError('Two files for media ID %s: %s and %s' % (media_id, by_id[media_id]['name'], b['name']))
        by_id[media_id] = b
    ids = sorted(by_id, key=lambda x: (len(x), x))
    given = [t for t in re.split(r'[\s,;]+', task_line(api, 'media ids', 'ids')) if t]
    if given and set(given) != set(ids):
        raise ValueError('"Media IDs:" %s differ from the uploaded files %s' % (sorted(given), ids))

    if os.path.exists(work_dir) and os.listdir(work_dir):
        raise ValueError('Work dir %s is not empty and holds no request: pick a new job id.' % work_dir)
    images_dir = os.path.join(work_dir, '00-request')
    os.makedirs(images_dir, exist_ok=False)

    log('freezing %d media IDs (%s) into %s' % (len(ids), ', '.join(ids), images_dir))
    images, problems = {}, []
    for media_id in ids:
        b = by_id[media_id]
        data, etag, stored_md5 = reader.download(b['name'], b['etag'])
        md5 = hashlib.md5(data).digest()
        if etag != b['etag'] or len(data) != b['bytes']:
            problems.append('%s: ETag or length differs from the listing' % b['name'])
            continue
        if stored_md5 and base64.b64decode(stored_md5) != md5:
            problems.append('%s: bytes do not match the stored Content-MD5' % b['name'])
            continue
        size = png_size(data)
        if size is None:
            problems.append('%s: not a PNG file' % b['name'])
            continue
        path = os.path.join(images_dir, '%s.png' % media_id)
        with open(path, 'xb') as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        with open(path, 'rb') as fh:
            sha = hashlib.sha256(fh.read()).hexdigest()
        if sha != hashlib.sha256(data).hexdigest():
            problems.append('%s: local read-back differs' % b['name'])
            continue
        images[media_id] = {
            'blob': b['name'],
            'etag': etag,
            'last_modified': b['last_modified'],
            'bytes': len(data),
            'content_md5_stored': bool(stored_md5),
            'md5_hex': md5.hex(),
            'sha256': sha,
            'png_size': size,
            'path': os.path.abspath(path),
        }
        log('froze %s.png: %dx%d, %s bytes, Content-MD5 %s' % (
            media_id, size[0], size[1], format(len(data), ','), 'checked' if stored_md5 else 'not stored'))
    if problems:
        for p in problems:
            log(p, 'error')
        raise ValueError('Request not frozen: %s' % '; '.join(problems))

    doc = {
        'version': 2,
        'kind': 'oneux-request',
        'job': job,
        'workDir': work_dir,
        'account': ACCOUNT,
        'container': container,
        'request': job,
        'remoteJobPrefix': job_prefix,
        'access': reader.access,
        'fetchedAt': started.isoformat(),
        'imagesDir': os.path.abspath(images_dir),
        'expectedIds': ids,
        'images': images,
    }
    text = json.dumps(doc, indent=2)
    with open(existing, 'x', encoding='utf-8') as fh:
        fh.write(text)
    digest = hashlib.sha256(text.encode('utf-8')).hexdigest()
    log('wrote %s (digest %s)' % (existing, digest))
    write_port(api, 'request', text)

    lines = ['# OneUX images: request (job %s)' % job, '',
             '- Source: `%s/%s/` root, read %s' % (ACCOUNT, container, reader.access),
             '- Fetched %s into `%s`' % (started.strftime('%Y-%m-%d %H:%M UTC'), images_dir),
             '- **%d media IDs**: %s' % (len(ids), ', '.join(ids)),
             '- Ignored %d blobs inside folders (the workflow\'s own job folders)' % in_folders,
             '- Job folder for backups and records: `%s/%s`' % (container, job_prefix),
             '- Request digest (sha256 of 00-request.json): `%s`' % digest, '',
             '| Media ID | PNG size | Bytes | Uploaded | ETag | Content-MD5 checked |', '|---|---|---|---|---|---|']
    for media_id in ids:
        i = images[media_id]
        lines.append('| %s | %dx%d | %s | %s | `%s` | %s |' % (
            media_id, i['png_size'][0], i['png_size'][1], format(i['bytes'], ','), i['last_modified'], i['etag'],
            'yes' if i['content_md5_stored'] else 'no (not stored)'))
    lines += ['', 'Later steps use these frozen copies only; changing the uploads now has no effect on this job.']
    write_port(api, 'report', '\n'.join(lines) + '\n')
    return {'summary': 'Job %s: %d images frozen in %s' % (job, len(ids), work_dir)}
