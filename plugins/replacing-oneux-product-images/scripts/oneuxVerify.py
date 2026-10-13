# OneUX images: verify - step 12, verify_replacement.py of the replacing-oneux-product-images
# skill extended per plan phase 10. Independent, read-only reconciliation of the write plan, the
# journal, the live production blobs and the backups: every planned path needs a complete
# put-started / put-accepted / verified sequence (or a reconciled verify) and no journal entry may be
# out of scope; the live blob must show the journaled ETag, the new Content-MD5, the original
# metadata and content type, and its full ETag-conditional download must match the scaled file's
# SHA-256. Each backup is re-hashed. A metadata MD5 alone is never taken as proof.
import datetime
import hashlib
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

TARGET = 'https://prodoneuxpremium2.blob.core.windows.net'
FRONTEND = 'https://www.bosch-diy.com'


def log(message, level='info'):
    """One live progress line. print() reaches the run log WHILE the step runs; api.log()
    lines only travel on the result frame, and a frame that failed is never rendered - so
    anything logged before a raise would be lost."""
    print('[%s] %s' % (level, message), flush=True)


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


def check(service, row, events, original):
    from azure.core import MatchConditions
    problems = []
    seq = [e['event'] for e in events]
    verified = [e for e in events if e['event'] == 'verified']
    if not verified or seq[-1] != 'verified':
        problems.append('journal does not end in verified (%s)' % (seq or 'no entries'))
    elif not verified[-1].get('reconciled') and not ('put-started' in seq and 'put-accepted' in seq):
        problems.append('incomplete journal sequence %s' % seq)
    new_etag = verified[-1]['new_etag'] if verified else None
    with open(row['backup_path'], 'rb') as fh:
        if hashlib.sha256(fh.read()).hexdigest() != row['old_sha256']:
            problems.append('backup file changed')
    blob = service.get_container_client(row['container']).get_blob_client(row['filename'])
    try:
        props = blob.get_blob_properties()
    except Exception as exc:
        return problems + ['live blob unreadable: %s' % str(exc)[:120]]
    if new_etag and props.etag != new_etag:
        problems.append('live ETag %s differs from the journaled %s' % (props.etag, new_etag))
    stored = props.content_settings.content_md5
    if not stored or bytes(stored).hex() != row['new_md5_hex']:
        problems.append('Content-MD5 is not the new image')
    if (props.metadata or {}) != (original.get('metadata') or {}):
        problems.append('metadata differs from the original')
    if (props.content_settings.content_type or None) != (original.get('content_type') or 'image/png'):
        problems.append('content type %s differs from the original' % props.content_settings.content_type)
    try:
        data = blob.download_blob(etag=props.etag, match_condition=MatchConditions.IfNotModified).readall()
        if hashlib.sha256(data).hexdigest() != row['new_sha256']:
            problems.append('live bytes differ from the scaled file')
    except Exception as exc:
        problems.append('full download failed: %s' % str(exc)[:120])
    return problems


def main(api):
    prev = read_port(api, 'prev')
    if not prev or not prev.get('workDir'):
        raise ValueError('Wire the output of "OneUX images: write to production" into "prev".')
    work_dir = prev['workDir']
    plan = load(work_dir, '11-write-plan.json', 'oneux-write-plan')
    request = load(work_dir, '00-request.json', 'oneux-request')
    if not plan['rows']:
        log('nothing was planned, nothing to verify')
        write_port(api, 'job', json.dumps({'kind': 'oneux-verify', 'workDir': work_dir, 'checked': 0}))
        write_port(api, 'report', '# OneUX images: verify\n\nNothing was planned, nothing to verify.\n')
        return {'summary': 'Nothing to verify'}
    journal_path = os.path.join(work_dir, '11-write-journal.jsonl')
    if not os.path.isfile(journal_path):
        raise ValueError('No write journal in %s: nothing has been written yet.' % work_dir)
    with open(journal_path, encoding='utf-8') as fh:
        events = [json.loads(l) for l in fh if l.strip()]
    backup = {e['blob_path']: e for e in load(work_dir, '10-backup-index.json', 'oneux-backup')['entries']}
    planned = {r['blob_path']: r for r in plan['rows']}
    out_of_scope = sorted(set(e['blob_path'] for e in events) - set(planned))
    wrong_account = sorted(set(e['blob_path'] for e in events if e.get('account') != TARGET))
    if out_of_scope:
        log('%d journal entries are outside the write plan' % len(out_of_scope), 'error')
    if wrong_account:
        log('%d journal entries name another account than %s' % (len(wrong_account), TARGET), 'error')

    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient
    service = BlobServiceClient(TARGET, credential=DefaultAzureCredential())
    threads = max(1, int(api.params.get('threads') or 8))
    total = len(plan['rows'])
    log('verifying %d planned paths against the journal, the live blobs and the backups, %d threads '
        '(%d journal events read)' % (total, threads, len(events)))
    # The pool is silent until the last row is back: count completions as they land.
    done = {'n': 0}
    lock = threading.Lock()
    t0 = time.time()

    def one(row):
        mine = [e for e in events if e['blob_path'] == row['blob_path']]
        problems = check(service, row, mine, backup[row['blob_path']])
        with lock:
            done['n'] += 1
            if problems:
                log('%s: %s' % (row['blob_path'], '; '.join(problems)), 'error')
            if done['n'] % 25 == 0 or done['n'] == total:
                elapsed = time.time() - t0
                log('verified %d/%d (%.0f s elapsed, %.1f/s)' % (done['n'], total, elapsed, done['n'] / max(elapsed, 0.001)))
        return row, problems

    with ThreadPoolExecutor(max_workers=threads) as pool:
        results = list(pool.map(one, plan['rows']))
    failed = [{'blob_path': r['blob_path'], 'problems': p} for r, p in results if p]
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
    doc = {'version': 1, 'kind': 'oneux-verify', 'workDir': work_dir, 'job': plan['job'], 'target': TARGET,
           'checkedAt': stamp, 'checked': len(results), 'passed': len(results) - len(failed), 'failed': failed,
           'outOfScopeJournalEntries': out_of_scope, 'wrongAccountEntries': wrong_account,
           'sampleUrls': ['%s/%s/%s' % (FRONTEND, r['container'], r['filename']) for r, _ in results[:5]]}
    text = json.dumps(doc, indent=2)
    path = os.path.join(work_dir, '12-verify-%s.json' % stamp)
    with open(path, 'x', encoding='utf-8') as fh:
        fh.write(text)
    try:
        from azure.storage.blob import ContentSettings
        BlobServiceClient(request['account'], credential=DefaultAzureCredential()).get_container_client(
            request['container']).get_blob_client(request['remoteJobPrefix'] + os.path.basename(path)).upload_blob(
            text.encode('utf-8'), overwrite=False, content_settings=ContentSettings(content_type='application/json'))
    except Exception as exc:
        log('copy of the verification to the job folder failed: %s' % str(exc)[:200], 'warn')
    if failed or out_of_scope or wrong_account:
        log('verification FAILED for %d of %d paths; details in %s' % (len(failed), len(results), path), 'error')
        raise RuntimeError('Verification failed for %d of %d paths (out of scope: %d, wrong account: %d). Details in %s. '
                           'First: %s' % (len(failed), len(results), len(out_of_scope), len(wrong_account), path, failed[:3]))
    log('all %d replaced images verified independently in %.0f s; report %s'
        % (len(results), time.time() - t0, path))
    write_port(api, 'job', text)
    write_port(api, 'report', '# OneUX images: verify\n\n- **%d of %d** replaced images verified independently: journal '
                              'complete, live ETag, Content-MD5, metadata, content type and full-byte SHA-256\n'
                              '- Backups re-hashed: intact\n- Report: `%s`\n- Sample pages to look at: %s\n\n'
                              'No Akamai purge was prepared or sent; caches still serve the old images until they expire or are purged.\n'
               % (len(results), len(results), path, ', '.join(doc['sampleUrls'])))
    return {'summary': 'Verified %d replaced images' % len(results)}
