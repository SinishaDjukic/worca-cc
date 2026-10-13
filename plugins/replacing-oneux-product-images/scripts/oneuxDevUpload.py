# OneUX images: dev upload - step 5 (new, plan phase 4). Uploads every frozen prescaler input to
# the dev prescaler's source container devscalerlocalenvsource/de-de, create-only, as
# <job>_<COUNTRY>_<basename>.png with content type image/png and Content-MD5 (the prescaler copies
# that MD5 into its _hash marker). Each blob is read back under its ETag and compared by SHA-256.
# Nothing is ever overwritten: an existing blob is accepted only when byte-identical. The job-id
# prefix keeps jobs apart in the shared dev container. A continued job reuses the upload record.
import hashlib
import json
import os

DEV_SOURCE = 'https://devscalerlocalenvsource.blob.core.windows.net'
CONTAINER = 'de-de'


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


def save(work_dir, name, doc):
    text = json.dumps(doc, indent=2)
    with open(os.path.join(work_dir, name), 'x', encoding='utf-8') as fh:
        fh.write(text)
    return text, hashlib.sha256(text.encode('utf-8')).hexdigest()


def reuse(api, path, kind, title):
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    if json.loads(text).get('kind') != kind:
        raise ValueError('%s is not a %s file.' % (path, kind))
    write_port(api, 'job', text)
    write_port(api, 'report', '# %s\n\nReused `%s` from an earlier run of this job; nothing was redone.\n'
               % (title, os.path.basename(path)))
    return {'summary': 'Reused %s' % os.path.basename(path)}


def main(api):
    prev = read_port(api, 'prev')
    if not prev or not prev.get('workDir'):
        raise ValueError('Wire the inventory output of "OneUX images: prescaler inputs" into "prev".')
    work_dir = prev['workDir']
    out = os.path.join(work_dir, '05-dev-upload.json')
    if os.path.isfile(out):
        return reuse(api, out, 'oneux-dev-upload', 'OneUX images: dev upload')
    inventory = load(work_dir, '04-prescaler-inventory.json', 'oneux-prescaler-inputs')
    job = load(work_dir, '00-request.json', 'oneux-request')['job']

    from azure.core import MatchConditions
    from azure.core.exceptions import ResourceExistsError
    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient, ContentSettings
    service = BlobServiceClient(DEV_SOURCE, credential=DefaultAzureCredential())
    container = service.get_container_client(CONTAINER)
    if not container.exists():
        raise RuntimeError('%s/%s does not exist. Creating it needs a separate decision; nothing uploaded.'
                           % (DEV_SOURCE, CONTAINER))

    entries = []
    for item in inventory['inputs']:
        dev_name = '%s_%s' % (job, item['name'])
        with open(item['local_path'], 'rb') as fh:
            data = fh.read()
        sha = hashlib.sha256(data).hexdigest()
        if sha != item['sha256']:
            raise ValueError('Prescaler input changed since the inventory: %s' % item['local_path'])
        md5 = hashlib.md5(data).digest()
        blob = container.get_blob_client(dev_name)
        status = 'uploaded'
        try:
            blob.upload_blob(data, overwrite=False,
                             content_settings=ContentSettings(content_type='image/png', content_md5=md5))
        except ResourceExistsError:
            props = blob.get_blob_properties()
            stored = props.content_settings.content_md5
            if not stored or bytes(stored) != md5 or props.size != len(data):
                raise RuntimeError('%s already exists in %s/%s with different content; nothing was overwritten. '
                                   'Use a new job id.' % (dev_name, DEV_SOURCE, CONTAINER))
            status = 'existing-identical'
        props = blob.get_blob_properties()
        back = blob.download_blob(etag=props.etag, match_condition=MatchConditions.IfNotModified).readall()
        if hashlib.sha256(back).hexdigest() != sha:
            raise RuntimeError('Read-back of %s differs from the local input.' % dev_name)
        entries.append({'name': item['name'], 'dev_name': dev_name, 'etag': props.etag, 'size': len(data),
                        'sha256': sha, 'md5_hex': md5.hex(), 'status': status})

    doc = {'version': 1, 'kind': 'oneux-dev-upload', 'workDir': work_dir, 'job': job,
           'account': DEV_SOURCE, 'container': CONTAINER, 'entries': entries}
    text, digest = save(work_dir, '05-dev-upload.json', doc)
    write_port(api, 'job', text)
    uploaded = sum(1 for e in entries if e['status'] == 'uploaded')
    lines = ['# OneUX images: dev upload', '',
             '- Target: `%s/%s`, names `%s_<COUNTRY>_<basename>.png`' % (DEV_SOURCE, CONTAINER, job),
             '- %d inputs: %d uploaded create-only, %d already present byte-identical' % (
                 len(entries), uploaded, len(entries) - uploaded),
             '- Every blob read back under its ETag and compared by SHA-256',
             '- Record digest: `%s`' % digest]
    write_port(api, 'report', '\n'.join(lines) + '\n')
    return {'summary': '%d prescaler inputs in dev source de-de (%d new)' % (len(entries), uploaded)}
