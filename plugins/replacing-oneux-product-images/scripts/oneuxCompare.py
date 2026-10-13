# OneUX images: compare - step 9, compare_remote.py of the replacing-oneux-product-images skill,
# run on the SCALED manifest only. READ-ONLY: per row an exact-name HEAD of the production blob,
# then - when sizes match - an ETag-conditional full GET and SHA-256 against the local scaled file.
# Fixed for the installed SDK: etag=<etag>, match_condition=MatchConditions.IfNotModified (the old
# if_etag_match kwarg fails). Byte differences are never inferred from ETags. Missing, errored or
# drifted blobs and blobs reporting index tags stop the job; an unreported tag count is recorded as
# unknown, never as zero. Byte-identical paths are not writes. Keeps the OUXD-15919 CSV schema.
import csv
import datetime
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor

TARGET = 'https://prodoneuxpremium2.blob.core.windows.net'


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


def local_sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def compare_one(service, row):
    """HEAD + (if same size) ETag-guarded GET for a single row. Fully read-only."""
    from azure.core import MatchConditions
    from azure.core.exceptions import ResourceModifiedError, ResourceNotFoundError
    locale = row['container']
    filename = row['blob_path'].split('/', 1)[1]
    country = locale.rsplit('-', 1)[-1].upper()
    local_bytes = os.path.getsize(row['local_image'])
    local_sha = local_sha256(row['local_image'])
    base = {'Country': country, 'Locale': locale, 'Filename': filename, 'LocalBytes': local_bytes,
            'LocalSha256': local_sha, 'ProductionBytes': '', 'ProductionETag': '', 'ProductionLastModified': '',
            'ProductionSha256': '', 'ContentHttpStatus': '', 'TagCount': ''}
    if local_sha != row['sha256']:
        return dict(base, Status='error', HttpStatus='', ContentStatus='error',
                    ContentCheck='local scaled file changed since the scaled manifest')
    blob = service.get_container_client(locale).get_blob_client(filename)
    try:
        props = blob.get_blob_properties()
    except ResourceNotFoundError:
        return dict(base, Status='missing', HttpStatus='404', ContentStatus='missing', ContentCheck='missing')
    except Exception as exc:
        return dict(base, Status='error', HttpStatus='?', ContentStatus='error', ContentCheck=str(exc)[:120])
    tag_count = getattr(props, 'tag_count', None)
    base.update(ProductionBytes=props.size, ProductionETag=props.etag,
                ProductionLastModified=props.last_modified.isoformat() if props.last_modified else '',
                TagCount='unknown' if tag_count is None else tag_count)
    if props.size != local_bytes:
        return dict(base, Status='existing', HttpStatus='200', ContentStatus='byte-different',
                    ContentCheck='different byte lengths at metadata check')
    try:
        remote = blob.download_blob(etag=props.etag, match_condition=MatchConditions.IfNotModified).readall()
        remote_sha = hashlib.sha256(remote).hexdigest()
        status = 'byte-identical' if remote_sha == local_sha else 'byte-different'
        return dict(base, Status='existing', HttpStatus='200', ContentStatus=status,
                    ContentCheck='SHA-256, ETag-conditional GET', ContentHttpStatus='200',
                    ProductionSha256=remote_sha if status == 'byte-identical' else '')
    except ResourceModifiedError:
        return dict(base, Status='existing', HttpStatus='200', ContentStatus='etag-drift',
                    ContentCheck='blob changed during comparison', ContentHttpStatus='412')
    except Exception as exc:
        return dict(base, Status='existing', HttpStatus='200', ContentStatus='error', ContentCheck=str(exc)[:120])


def main(api):
    prev = read_port(api, 'prev')
    if not prev or not prev.get('workDir'):
        raise ValueError('Wire the output of "OneUX images: scaled manifest" into "prev".')
    work_dir = prev['workDir']
    out = os.path.join(work_dir, '09-comparison.json')
    if os.path.isfile(out):
        with open(out, encoding='utf-8') as fh:
            text = fh.read()
        if json.loads(text).get('kind') != 'oneux-comparison':
            raise ValueError('%s is not a comparison.' % out)
        write_port(api, 'job', text)
        write_port(api, 'report', '# OneUX images: compare\n\nReused the comparison of this job.\n')
        return {'summary': 'Reused comparison'}
    scaled = load(work_dir, '08-scaled-manifest.json', 'oneux-scaled-manifest')

    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient
    service = BlobServiceClient(TARGET, credential=DefaultAzureCredential())
    with ThreadPoolExecutor(max_workers=max(1, int(api.params.get('threads') or 8))) as pool:
        results = list(pool.map(lambda r: compare_one(service, r), scaled['rows']))
    results.sort(key=lambda r: (r['Locale'], r['Filename']))
    counts = {}
    for r in results:
        counts[r['ContentStatus']] = counts.get(r['ContentStatus'], 0) + 1
    tagged = [r['Locale'] + '/' + r['Filename'] for r in results if isinstance(r['TagCount'], int) and r['TagCount'] > 0]
    bad = [r for r in results if r['ContentStatus'] not in ('byte-different', 'byte-identical')]

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
    doc = {'version': 1, 'kind': 'oneux-comparison', 'workDir': work_dir, 'env': 'prod', 'target': TARGET,
           'manifest': os.path.join(work_dir, '08-scaled-manifest.json'), 'comparedAt': stamp,
           'counts': counts, 'rows': results}
    text = json.dumps(doc, indent=2)
    if bad or tagged:
        failed = os.path.join(work_dir, '09-comparison-FAILED-%s.json' % stamp)
        with open(failed, 'x', encoding='utf-8') as fh:
            fh.write(text)
        raise RuntimeError('Comparison rejected (%s; %d with index tags). Details in %s. First: %s'
                           % (counts, len(tagged), failed,
                              [(r['Locale'] + '/' + r['Filename'], r['ContentStatus'], r['ContentCheck']) for r in bad[:5]] or tagged[:5]))
    with open(out, 'x', encoding='utf-8') as fh:
        fh.write(text)
    with open(os.path.join(work_dir, '09-comparison.csv'), 'x', newline='', encoding='utf-8') as fh:
        writer = csv.DictWriter(fh, fieldnames=list(results[0].keys()))
        writer.writeheader()
        writer.writerows(results)
    write_port(api, 'job', text)
    unknown = sum(1 for r in results if r['TagCount'] == 'unknown')
    write_port(api, 'report', '# OneUX images: compare\n\n- Read-only against `%s`\n- %s\n'
                              '- Write candidates (byte-different): **%d**; byte-identical (skipped): %d\n'
                              '- Index tag count not reported for %d blobs: unknown, not proof of no tags\n'
               % (TARGET, counts, counts.get('byte-different', 0), counts.get('byte-identical', 0), unknown))
    return {'summary': '%d byte-different, %d byte-identical' % (counts.get('byte-different', 0), counts.get('byte-identical', 0))}
