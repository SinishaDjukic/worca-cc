# OneUX images: backup - step 10, the new backup_remote.py of plan phase 8. Backs up every
# byte-different production blob exactly once, before any write: HEAD the exact name, require the
# ETag the comparison saw, refuse a positive index-tag count (an unreported count is recorded as
# unknown, never as zero), download under that ETag and verify length, stored Content-MD5 and the
# SHA-256 of the disk read-back. Bytes and a properties snapshot (metadata, content settings, ETag,
# tag count) go to <work dir>/10-backup/ and, create-only, to the job folder of the upload container
# (oneux-jobs/<job>/backup/), each copy read back. The pilot and the remainder reuse this backup.
# Nothing is written to prodoneuxpremium2 and no _hash marker is touched.
import datetime
import hashlib
import json
import os
import time

TARGET = 'https://prodoneuxpremium2.blob.core.windows.net'


def log(message, level='info'):
    """One live progress line. print() reaches the run log WHILE the step runs; api.log()
    lines only travel on the result frame, and a frame that failed is never rendered - so
    anything logged before a raise would be lost."""
    print('[%s] %s' % (level, message), flush=True)


def progress(label, done, total, t0, every=10):
    """A progress line every `every` items and on the last one - a bulk loop is otherwise
    silent for as long as it runs."""
    if done % every and done != total:
        return
    elapsed = time.time() - t0
    log('%s %d/%d (%.0f s elapsed, %.1f/s)' % (label, done, total, elapsed, done / max(elapsed, 0.001)))


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


def write_new(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'xb') as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    with open(path, 'rb') as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def put_remote(container, name, data, content_type):
    """Create-only upload to the job folder, read back under its ETag."""
    from azure.core import MatchConditions
    from azure.storage.blob import ContentSettings
    blob = container.get_blob_client(name)
    blob.upload_blob(data, overwrite=False, content_settings=ContentSettings(
        content_type=content_type, content_md5=hashlib.md5(data).digest()))
    props = blob.get_blob_properties()
    back = blob.download_blob(etag=props.etag, match_condition=MatchConditions.IfNotModified).readall()
    if hashlib.sha256(back).digest() != hashlib.sha256(data).digest():
        raise RuntimeError('Read-back of the remote backup %s differs.' % name)
    return name


def main(api):
    prev = read_port(api, 'prev')
    if not prev or not prev.get('workDir'):
        raise ValueError('Wire the output of "OneUX images: compare" into "prev".')
    work_dir = prev['workDir']
    out = os.path.join(work_dir, '10-backup-index.json')
    if os.path.isfile(out):
        with open(out, encoding='utf-8') as fh:
            text = fh.read()
        if json.loads(text).get('kind') != 'oneux-backup':
            raise ValueError('%s is not a backup index.' % out)
        log('reusing the backup of this job; production is not read again')
        write_port(api, 'job', text)
        write_port(api, 'report', '# OneUX images: backup\n\nReused the backup of this job; production was not read again.\n')
        return {'summary': 'Reused backup'}
    comparison = load(work_dir, '09-comparison.json', 'oneux-comparison')
    request = load(work_dir, '00-request.json', 'oneux-request')
    candidates = [r for r in comparison['rows'] if r['ContentStatus'] == 'byte-different']

    from azure.core import MatchConditions
    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient
    credential = DefaultAzureCredential()
    target = BlobServiceClient(TARGET, credential=credential)
    remote = BlobServiceClient(request['account'], credential=credential).get_container_client(request['container'])
    prefix = request['remoteJobPrefix'] + 'backup/'
    root = os.path.join(work_dir, '10-backup')
    os.makedirs(root, exist_ok=False)
    log('backing up %d byte-different production blobs before any write: local %s, remote %s/%s'
        % (len(candidates), root, request['container'], prefix))
    t0, saved = time.time(), 0

    entries = []
    for index, r in enumerate(candidates, 1):
        locale, filename = r['Locale'], r['Filename']
        blob = target.get_container_client(locale).get_blob_client(filename)
        props = blob.get_blob_properties()
        if props.etag != r['ProductionETag']:
            raise RuntimeError('%s/%s changed since the comparison; start a new job.' % (locale, filename))
        tag_count = getattr(props, 'tag_count', None)
        if tag_count:
            raise RuntimeError('%s/%s reports %s index tags; a plain overwrite would drop them.' % (locale, filename, tag_count))
        data = blob.download_blob(etag=props.etag, match_condition=MatchConditions.IfNotModified).readall()
        if len(data) != props.size:
            raise RuntimeError('Incomplete backup of %s/%s' % (locale, filename))
        settings = props.content_settings
        stored = settings.content_md5
        if stored and bytes(stored) != hashlib.md5(data).digest():
            raise RuntimeError('Backup of %s/%s does not match its stored Content-MD5' % (locale, filename))
        local = os.path.join(root, locale, filename)
        sha = write_new(local, data)
        if sha != hashlib.sha256(data).hexdigest():
            raise RuntimeError('Backup read-back of %s differs' % local)
        snapshot = {
            'account': TARGET, 'container': locale, 'blob': filename, 'etag': props.etag, 'size': props.size,
            'sha256': sha, 'metadata': props.metadata, 'tag_count': tag_count,
            'tag_count_note': 'not reported (unknown)' if tag_count is None else 'reported',
            'content_type': settings.content_type,
            'content_md5': bytes(stored).hex() if stored else None,
            'cache_control': settings.cache_control, 'content_disposition': settings.content_disposition,
            'content_encoding': settings.content_encoding, 'content_language': settings.content_language,
            'last_modified': props.last_modified.isoformat() if props.last_modified else None,
        }
        snapshot_text = json.dumps(snapshot, indent=2)
        with open(local + '.properties.json', 'x', encoding='utf-8') as fh:
            fh.write(snapshot_text)
        remote_blob = put_remote(remote, prefix + locale + '/' + filename, data, settings.content_type or 'image/png')
        put_remote(remote, prefix + locale + '/' + filename + '.properties.json', snapshot_text.encode('utf-8'),
                   'application/json')
        entries.append({'container': locale, 'blob_path': locale + '/' + filename, 'etag': props.etag,
                        'size': props.size, 'sha256': sha, 'tag_count': tag_count, 'metadata': props.metadata,
                        'content_type': settings.content_type, 'local_path': os.path.abspath(local),
                        'remote_blob': remote_blob})
        saved += len(data)
        progress('backed up', index, len(candidates), t0)

    doc = {'version': 1, 'kind': 'oneux-backup', 'workDir': work_dir, 'job': request['job'], 'target': TARGET,
           'remote': {'account': request['account'], 'container': request['container'], 'prefix': prefix},
           'backedUpAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'counts': {'paths': len(entries), 'unknownTagCount': sum(1 for e in entries if e['tag_count'] is None)},
           'entries': entries}
    text = json.dumps(doc, indent=2)
    with open(out, 'x', encoding='utf-8') as fh:
        fh.write(text)
    put_remote(remote, request['remoteJobPrefix'] + '10-backup-index.json', text.encode('utf-8'), 'application/json')
    log('backed up %d blobs (%s MB) in %.0f s, each verified locally and remotely'
        % (len(entries), format(saved // (1024 * 1024), ','), time.time() - t0))
    if doc['counts']['unknownTagCount']:
        log('index tag count not reported for %d blobs: unknown, not proof of no tags'
            % doc['counts']['unknownTagCount'], 'warn')
    write_port(api, 'job', text)
    write_port(api, 'report', '# OneUX images: backup\n\n- %d production blobs backed up once, each verified\n'
                              '- Local: `%s`\n- Remote: `%s/%s/%s`\n- Index tag count unknown for %d blobs\n'
                              '- Clearing the upload container deletes the remote copy; keep `%s` until the change is confirmed.\n'
               % (len(entries), root, request['account'], request['container'], prefix,
                  doc['counts']['unknownTagCount'], request['remoteJobPrefix']))
    return {'summary': 'Backed up %d production blobs' % len(entries)}
