# OneUX images: write to production - step 11, the only pause of the workflow (replace_blobs.py of
# the replacing-oneux-product-images skill, reworked per plan phase 9). The first attempt freezes
# the write plan - every byte-different path with its scaled bytes and the ETag of its verified
# backup - records a pending approval for this run and pauses the run with a preview and the plan's
# SHA-256. Clicking Resume on that paused run is the approval: the next attempt in the SAME run finds
# the pending approval for the same digest, records who/when (run id) and writes. Stopping the run
# cancels. (A new run of the same job with 'Approved: <digest>' works too.) Then all locales in one
# go: pilot locale first, then the rest. Per blob: re-hash the scaled file and the backup, HEAD must
# still show the backed-up ETag, refuse positive index tags, journal put-started (fsync), overwrite
# with etag + match_condition=IfNotModified (the old if_match kwarg fails on the installed SDK)
# keeping metadata and content settings, setting Content-MD5, without tag headers; journal
# put-accepted, read the full blob back under the new ETag, check SHA-256 and Content-MD5, journal
# verified. Production _hash markers are never touched. The first failure stops (pauses) the run;
# Resume reconciles every unfinished journal entry against the live blob before continuing.
import datetime
import hashlib
import json
import os
import re
import time

TARGET = 'https://prodoneuxpremium2.blob.core.windows.net'
HEX64 = re.compile(r'\b[0-9a-f]{64}\b')


def log(message, level='info'):
    """One live progress line. print() reaches the run log WHILE the step runs; api.log()
    lines only travel on the result frame, and a frame that failed is never rendered - so
    the approval preview below, which is logged and then raised, would never be seen."""
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


def read_json(path):
    if not os.path.isfile(path):
        return None
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sha256_file(path):
    with open(path, 'rb') as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def approvals(api):
    texts = [task_line(api, 'approved', 'approve', 'approval'), str(api.params.get('approve') or '')]
    p = api.inputs.get('approval') if hasattr(api.inputs, 'get') else None
    if p and p.get('path') and os.path.isfile(p['path']):
        with open(p['path'], encoding='utf-8', errors='replace') as fh:
            texts.append(fh.read())
    return set(HEX64.findall(' '.join(texts).lower()))


def build_plan(api, work_dir, request, scaled, comparison, backup):
    by_path = {r['blob_path']: r for r in scaled['rows']}
    compared = {r['Locale'] + '/' + r['Filename']: r for r in comparison['rows']}
    candidates = set(p for p, c in compared.items() if c['ContentStatus'] == 'byte-different')
    rows = []
    for e in backup['entries']:
        path = e['blob_path']
        m, c = by_path[path], compared[path]
        if c['ContentStatus'] != 'byte-different' or c['ProductionETag'] != e['etag'] or c['LocalSha256'] != m['sha256']:
            raise ValueError('Backup, comparison and scaled manifest disagree for %s' % path)
        rows.append({'container': e['container'], 'blob_path': path, 'filename': path.split('/', 1)[1],
                     'media_id': m['media_id'], 'local_image': m['local_image'], 'new_sha256': m['sha256'],
                     'new_md5_hex': m['md5_hex'], 'new_size': m['size_bytes'], 'old_etag': e['etag'],
                     'old_sha256': e['sha256'], 'old_size': e['size'], 'backup_path': e['local_path'],
                     'remote_backup': e.get('remote_blob'), 'tag_count': e['tag_count']})
    if candidates != set(r['blob_path'] for r in rows):
        raise ValueError('The backup does not cover exactly the byte-different paths.')
    rows.sort(key=lambda r: r['blob_path'])
    locales = sorted(set(r['container'] for r in rows))
    pilot = (api.params.get('pilotLocale') or '').strip() or task_line(api, 'pilot locale', 'pilot')
    if pilot and pilot not in locales:
        raise ValueError('Pilot locale %s has nothing to write; choose one of %s' % (pilot, locales))
    pilot = pilot or ('ro-ro' if 'ro-ro' in locales else (locales[0] if locales else None))
    return {'version': 1, 'kind': 'oneux-write-plan', 'workDir': work_dir, 'job': request['job'], 'target': TARGET,
            'hashPolicy': 'leave', 'pilotLocale': pilot,
            'counts': {'rows': len(rows), 'locales': len(locales),
                       'pilotRows': sum(1 for r in rows if r['container'] == pilot),
                       'byteIdenticalSkipped': comparison['counts'].get('byte-identical', 0),
                       'unknownTagCount': sum(1 for r in rows if r['tag_count'] is None)},
            'rows': rows}


def put_record(request, name, data, content_type):
    """Best-effort, create-only copy of a record into the job folder of the upload container."""
    try:
        from azure.identity import DefaultAzureCredential
        from azure.storage.blob import BlobServiceClient, ContentSettings
        container = BlobServiceClient(request['account'], credential=DefaultAzureCredential()).get_container_client(
            request['container'])
        container.get_blob_client(request['remoteJobPrefix'] + name).upload_blob(
            data, overwrite=False, content_settings=ContentSettings(content_type=content_type))
        return None
    except Exception as exc:
        return str(exc)[:200]


class Journal:
    def __init__(self, path):
        self.path = path
        self.events = []
        if os.path.isfile(path):
            with open(path, encoding='utf-8') as fh:
                self.events = [json.loads(l) for l in fh if l.strip()]
        self.fh = open(path, 'a', encoding='utf-8')

    def last(self, path):
        mine = [e for e in self.events if e['blob_path'] == path]
        return mine[-1] if mine else None

    def add(self, event, row, **extra):
        rec = {'event': event, 'time': now(), 'account': TARGET, 'container': row['container'],
               'blob_path': row['blob_path'], 'old_etag': row['old_etag'], 'sha256': row['new_sha256']}
        rec.update(extra)
        self.fh.write(json.dumps(rec) + '\n')
        self.fh.flush()
        os.fsync(self.fh.fileno())
        self.events.append(rec)


def write_row(service, row, journal, position=''):
    from azure.core import MatchConditions
    from azure.storage.blob import ContentSettings
    with open(row['local_image'], 'rb') as fh:
        data = fh.read()
    if hashlib.sha256(data).hexdigest() != row['new_sha256']:
        raise RuntimeError('Scaled file changed since the plan: %s' % row['local_image'])
    if sha256_file(row['backup_path']) != row['old_sha256']:
        raise RuntimeError('Backup changed since it was taken: %s' % row['backup_path'])
    md5 = hashlib.md5(data).digest()
    blob = service.get_container_client(row['container']).get_blob_client(row['filename'])
    props = blob.get_blob_properties()
    if props.etag != row['old_etag']:
        raise RuntimeError('%s changed since the backup (ETag %s, backed up %s).' % (row['blob_path'], props.etag, row['old_etag']))
    tag_count = getattr(props, 'tag_count', None)
    if tag_count:
        raise RuntimeError('%s reports %s index tags; not overwritten.' % (row['blob_path'], tag_count))
    journal.add('put-started', row, tag_count=tag_count)
    try:
        s = props.content_settings
        result = blob.upload_blob(
            data, overwrite=True, etag=row['old_etag'], match_condition=MatchConditions.IfNotModified,
            metadata=props.metadata,
            content_settings=ContentSettings(content_type=s.content_type or 'image/png', content_md5=md5,
                                             cache_control=s.cache_control, content_disposition=s.content_disposition,
                                             content_encoding=s.content_encoding, content_language=s.content_language))
        new_etag = result['etag']
        journal.add('put-accepted', row, new_etag=new_etag)
        back = blob.download_blob(etag=new_etag, match_condition=MatchConditions.IfNotModified).readall()
        if hashlib.sha256(back).hexdigest() != row['new_sha256']:
            raise RuntimeError('Read-back of %s differs from the scaled file.' % row['blob_path'])
        after = blob.get_blob_properties()
        stored = after.content_settings.content_md5
        if after.etag != new_etag or not stored or bytes(stored) != md5:
            raise RuntimeError('Properties of %s after the write do not match.' % row['blob_path'])
        journal.add('verified', row, new_etag=new_etag)
        # Every production overwrite gets its own line: this is the irreversible step, and the
        # journal it mirrors is only readable after the run.
        log('%swrote and verified %s (%s -> %s, %s bytes)'
            % (position, row['blob_path'], row['old_etag'], new_etag, format(row['new_size'], ',')))
    except Exception as exc:
        log('FAILED on %s: %s' % (row['blob_path'], str(exc)[:300]), 'error')
        journal.add('failed', row, error=str(exc)[:300])
        raise


def reconcile(service, row, journal):
    """An entry left unfinished by an earlier attempt: decide from the live blob. True = still to write."""
    last = journal.last(row['blob_path'])
    if last is None or last['event'] == 'verified':
        return last is None
    log('reconciling %s: an earlier attempt left it at "%s"' % (row['blob_path'], last['event']), 'warn')
    blob = service.get_container_client(row['container']).get_blob_client(row['filename'])
    props = blob.get_blob_properties()
    if props.etag == row['old_etag']:
        log('%s is still the backed-up original: it will be written' % row['blob_path'])
        return True
    data = blob.download_blob().readall()
    if hashlib.sha256(data).hexdigest() == row['new_sha256']:
        log('%s already holds the new image: marked verified, not written again' % row['blob_path'])
        journal.add('verified', row, new_etag=props.etag, reconciled=True)
        return False
    raise RuntimeError('%s is neither the backed-up original nor the new image (journal: %s). Inspect it before '
                       'any retry; restore from %s if needed.' % (row['blob_path'], last['event'], row['backup_path']))


def preview(plan, digest):
    per = {}
    for r in plan['rows']:
        per[r['container']] = per.get(r['container'], 0) + 1
    lines = ['# OneUX images: write to production - WAITING FOR APPROVAL', '',
             '- Job: `%s`; target `%s`' % (plan['job'], plan['target']),
             '- **%d images** in %d locales will be overwritten (%d byte-identical skipped)'
             % (plan['counts']['rows'], plan['counts']['locales'], plan['counts']['byteIdenticalSkipped']),
             '- One approval covers all of them: pilot `%s` (%d images) first, then every other locale automatically; '
             'the first failure stops' % (plan['pilotLocale'], plan['counts']['pilotRows']),
             '- `_hash` markers: left unchanged; every original backed up and verified',
             '- Index tag count not reported for %d of them (unknown, not proof of no tags)' % plan['counts']['unknownTagCount'],
             '- Plan digest: `%s`' % digest, '',
             '**To approve: click Resume on this paused run.** To cancel: stop the run.', '',
             '| Locale | Images |', '|---|---|']
    lines += ['| %s | %d |' % (k, v) for k, v in sorted(per.items())]
    lines += ['', '## Paths', ''] + ['- `%s`' % r['blob_path'] for r in plan['rows']]
    return '\n'.join(lines) + '\n'


def main(api):
    prev = read_port(api, 'prev')
    if not prev or not prev.get('workDir'):
        raise ValueError('Wire the output of "OneUX images: backup" into "prev".')
    work_dir = prev['workDir']
    request = load(work_dir, '00-request.json', 'oneux-request')
    plan_path = os.path.join(work_dir, '11-write-plan.json')
    if os.path.isfile(plan_path):
        with open(plan_path, encoding='utf-8') as fh:
            text = fh.read()
        plan = json.loads(text)
        if plan.get('kind') != 'oneux-write-plan':
            raise ValueError('%s is not a write plan.' % plan_path)
        log('job %s: reusing the frozen write plan (%d rows)' % (request['job'], plan['counts']['rows']))
    else:
        log('job %s: building the write plan from the scaled manifest, the comparison and the backup'
            % request['job'])
        plan = build_plan(api, work_dir, request, load(work_dir, '08-scaled-manifest.json', 'oneux-scaled-manifest'),
                          load(work_dir, '09-comparison.json', 'oneux-comparison'),
                          load(work_dir, '10-backup-index.json', 'oneux-backup'))
        text = json.dumps(plan, indent=2)
        with open(plan_path, 'x', encoding='utf-8') as fh:
            fh.write(text)
        put_record(request, '11-write-plan.json', text.encode('utf-8'), 'application/json')
    digest = hashlib.sha256(text.encode('utf-8')).hexdigest()
    log('write plan: %d images in %d locales, pilot %s (%d), %d byte-identical skipped; digest %s'
        % (plan['counts']['rows'], plan['counts']['locales'], plan['pilotLocale'], plan['counts']['pilotRows'],
           plan['counts']['byteIdenticalSkipped'], digest))

    if not plan['rows']:
        log('nothing to write: production already holds these exact bytes')
        result = {'version': 1, 'kind': 'oneux-write-result', 'workDir': work_dir, 'job': plan['job'],
                  'planDigest': digest, 'written': 0, 'note': 'nothing to write: every image is byte-identical'}
        write_port(api, 'job', json.dumps(result, indent=2))
        write_port(api, 'report', '# OneUX images: write to production\n\nNothing to write: production already holds '
                                  'these exact bytes.\n')
        return {'summary': 'Nothing to write'}

    # The approval: Resume on the run that paused for this exact plan, or 'Approved: <digest>'.
    run_id = (api.ctx or {}).get('runId')
    approved_path = os.path.join(work_dir, '11-approval.json')
    pending_path = os.path.join(work_dir, '11-approval-pending.json')
    approval = read_json(approved_path)
    if not (approval and approval.get('digest') == digest):
        pending = read_json(pending_path)
        if digest in approvals(api):
            via = 'Approved: line in the task of run %s' % run_id
        elif pending and run_id and pending.get('digest') == digest and pending.get('runId') == run_id:
            via = 'Resume of worca run %s after the approval pause' % run_id
        else:
            with open(pending_path, 'w', encoding='utf-8') as fh:
                json.dump({'digest': digest, 'runId': run_id, 'pausedAt': now()}, fh, indent=2)
            md = preview(plan, digest)
            with open(os.path.join(work_dir, '11-write-preview.md'), 'w', encoding='utf-8') as fh:
                fh.write(md)
            put_record(request, '11-write-preview.md', md.encode('utf-8'), 'text/markdown')
            log(md)
            raise RuntimeError('WAITING FOR APPROVAL - nothing was written to production. %d images in %d locales; '
                               'pilot %s first, then all other locales automatically. Review %s. Click Resume to '
                               'approve and write; stop the run to cancel. (Plan digest %s)'
                               % (plan['counts']['rows'], plan['counts']['locales'], plan['pilotLocale'],
                                  os.path.join(work_dir, '11-write-preview.md'), digest))
        approval = {'digest': digest, 'approvedVia': via, 'runId': run_id, 'approvedAt': now(),
                    'pausedAt': (pending or {}).get('pausedAt')}
        with open(approved_path, 'w', encoding='utf-8') as fh:
            json.dump(approval, fh, indent=2)
        put_record(request, '11-approval.json', json.dumps(approval, indent=2).encode('utf-8'), 'application/json')
        log('APPROVED: %s' % via)

    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient
    service = BlobServiceClient(TARGET, credential=DefaultAzureCredential())
    journal = Journal(os.path.join(work_dir, '11-write-journal.jsonl'))
    pilot = [r for r in plan['rows'] if r['container'] == plan['pilotLocale']]
    rest = [r for r in plan['rows'] if r['container'] != plan['pilotLocale']]
    written, record_error = 0, None
    log('writing to %s: pilot %s (%d), then %d in every other locale; the first failure stops the run'
        % (TARGET, plan['pilotLocale'], len(pilot), len(rest)))
    try:
        for phase, rows in (('pilot', pilot), ('remainder', rest)):
            t0 = time.time()
            todo = [r for r in rows if reconcile(service, r, journal)]
            skipped = len(rows) - len(todo)
            log('%s: %d blobs, %d already verified by an earlier attempt, %d to write'
                % (phase, len(rows), skipped, len(todo)))
            if phase == 'remainder' and todo:
                log('re-checking the backed-up ETag of %d remaining blobs after the pilot' % len(todo))
                moved = []
                for r in todo:
                    props = service.get_container_client(r['container']).get_blob_client(r['filename']).get_blob_properties()
                    if props.etag != r['old_etag']:
                        moved.append(r['blob_path'])
                if moved:
                    log('%d remaining blobs no longer show their backed-up ETag; stopping' % len(moved), 'error')
                    raise RuntimeError('After the pilot, %d remaining blobs no longer show their backed-up ETag: %s'
                                       % (len(moved), moved[:10]))
            for index, r in enumerate(todo, 1):
                write_row(service, r, journal, position='%s %d/%d: ' % (phase, index, len(todo)))
                written += 1
            log('%s done: %d blobs (%d written now) in %.0f s' % (phase, len(rows), len(todo), time.time() - t0))
    finally:
        journal.fh.close()
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
        with open(journal.path, 'rb') as fh:
            record_error = put_record(request, '11-write-journal-%s.jsonl' % stamp, fh.read(), 'application/x-ndjson')

    if record_error:
        log('copy of the journal to the job folder failed: %s' % record_error, 'warn')
    verified = set(e['blob_path'] for e in journal.events if e['event'] == 'verified')
    log('%d of %d production images replaced and verified (%d written in this attempt)'
        % (len(verified), len(plan['rows']), written))
    result = {'version': 1, 'kind': 'oneux-write-result', 'workDir': work_dir, 'job': plan['job'], 'planDigest': digest,
              'approval': approval, 'written': written, 'verified': len(verified), 'planned': len(plan['rows']),
              'journal': journal.path, 'remoteRecordError': record_error}
    write_port(api, 'job', json.dumps(result, indent=2))
    write_port(api, 'report', '# OneUX images: write to production\n\n- Plan `%s` approved (%s)\n- Pilot `%s`, then the '
                              'rest: %d written now, %d of %d verified in total (full read-back)\n- `_hash` markers '
                              'untouched\n- Journal: `%s`%s\n'
               % (digest, approval['approvedVia'], plan['pilotLocale'], written, len(verified), len(plan['rows']),
                  journal.path, '' if not record_error else '\n- Copy of the journal to the job folder failed: %s' % record_error))
    return {'summary': '%d of %d production images replaced and verified' % (len(verified), len(plan['rows']))}
