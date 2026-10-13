# OneUX images: discover - step 1 of the OneUX image replacement. Replaces the Kibana export
# (parse_export.py) of the replacing-oneux-product-images skill: finds every production blob of
# the request's media IDs by name, <slug>-<productId>-hires-png-rgb-oneux-<mediaId>.png, in each
# real locale container of the scaled-image account. Read-only: lists blob NAMES once per job;
# every later step addresses only the exact names frozen here, and a continued job reuses them.
# The mapping keeps parse_export.py's schema ({"ids": {mediaId: [{culture, container, blob_path,
# ...}]}, "summary"}) and carries the request (frozen images) forward to the manifest.
# Offline / regression: wire a json {container: [blob names]} into the 'names' input.
import datetime
import hashlib
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor

ACCOUNTS = {
    'prod': 'https://prodoneuxpremium2.blob.core.windows.net',
    'stage': 'https://stageoneuxpremium2.blob.core.windows.net',
}
# Real locale containers of prodoneuxpremium2 (checked 2026-10-12; the same list as the prod
# prescaler's 'countries'). xz-xy is synthetic; dev-oneux-keyvault-backups and other non-locale
# containers are never listed.
LOCALES = (
    'ar-ae ar-eg ar-ma ar-sa ar-tn bg-bg cs-cz da-dk de-at de-ch de-de el-gr '
    'en-ae en-ap en-au en-ca en-eg en-gb en-gn en-ie en-in en-my en-nz en-ph en-sa en-sg en-us en-za '
    'es-ar es-cl es-co es-es es-mx es-pe es-us et-ee fi-fi fr-be fr-ca fr-ch fr-fr fr-ma fr-tn '
    'hr-hr hu-hu id-id it-ch it-it ja-jp ko-kr lt-lt lv-lv mk-mk nl-be nl-nl no-no pl-pl pt-br pt-pt '
    'ro-ro ru-by ru-kz ru-ru sk-sk sl-si sr-rs sv-se th-th tr-tr uk-ua vi-vn zh-cn zh-tw'
).split()
LOCALE_RE = re.compile(r'^[a-z]{2,3}-[a-z]{2}$')


def task_line(api, *names):
    """The value of a 'Name: value' line in the task, for the first name that has one."""
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


def tokens(text):
    return [t for t in re.split(r'[\s,;]+', text or '') if t]


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


def fresh_work_dir(path):
    path = os.path.abspath(os.path.expanduser(path))
    if os.path.exists(path) and os.listdir(path):
        raise ValueError('Work dir %s is not empty: every job needs a fresh one '
                         '(earlier artifacts, backups and journals are never reused).' % path)
    os.makedirs(path, exist_ok=True)
    return path


def live_names(account_url, containers, threads):
    try:
        from azure.identity import DefaultAzureCredential
        from azure.storage.blob import BlobServiceClient
    except ImportError:
        raise RuntimeError('Needs the Azure SDK: python -m pip install azure-storage-blob azure-identity')
    service = BlobServiceClient(account_url=account_url, credential=DefaultAzureCredential())
    live = sorted(c.name for c in service.list_containers())

    def names(container):
        client = service.get_container_client(container)
        if hasattr(client, 'list_blob_names'):
            return container, list(client.list_blob_names())
        return container, [b.name for b in client.list_blobs()]

    present = [c for c in containers if c in live]
    with ThreadPoolExecutor(max_workers=max(1, threads)) as pool:
        listed = dict(pool.map(names, present))
    return live, listed


def reuse(api, path):
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    doc = json.loads(text)
    if doc.get('kind') != 'oneux-discovery':
        raise ValueError('%s is not a discovery file.' % path)
    write_port(api, 'mapping', text)
    write_port(api, 'report', '# OneUX images: discovery\n\nReused the discovery of %s (%d blob paths); production '
                              'was not listed again. Digest `%s`.\n'
               % (doc['listedAt'], doc['summary']['blob_paths'], hashlib.sha256(text.encode('utf-8')).hexdigest()))
    return {'summary': 'Reused discovery: %d blob paths' % doc['summary']['blob_paths']}


def main(api):
    request = read_port(api, 'request')
    if request is not None and request.get('kind') != 'oneux-request':
        raise ValueError('The request input must come from "OneUX images: request".')
    if request and os.path.isfile(os.path.join(request['workDir'], '01-discovery.json')):
        return reuse(api, os.path.join(request['workDir'], '01-discovery.json'))
    given = sorted(set(tokens(setting(api, 'ids', 'media ids', 'ids'))), key=lambda x: (len(x), x))
    if request:
        ids = list(request['expectedIds'])
        if given and set(given) != set(ids):
            raise ValueError('Media IDs %s differ from the request files %s' % (given, ids))
    else:
        ids = given
    if not ids or any(not i.isdigit() for i in ids):
        raise ValueError('Wire "OneUX images: request" into this card, or give the media IDs (digits) in the ids '
                         'param or a "Media IDs:" line in the task.')
    env = (api.params.get('env') or 'prod').strip()
    if env not in ACCOUNTS:
        raise ValueError('Unknown environment %r' % env)
    account = ACCOUNTS[env]
    exclude_param = api.params.get('exclude')
    exclude = set(tokens('xz-xy' if exclude_param is None else exclude_param))
    locales = tokens(setting(api, 'locales', 'locales')) or list(LOCALES)
    bad = [l for l in locales if not LOCALE_RE.match(l)]
    if bad:
        raise ValueError('Not lowercase locale containers: %s' % bad)
    locales = sorted(set(l for l in locales if l not in exclude))
    kind = (api.params.get('kind') or 'hires-png-rgb-oneux').strip()
    require_marker = api.params.get('requireMarker', True) not in (False, 'false', 0)
    pattern = re.compile(r'^(?P<stem>.+)-%s-(?P<mid>\d+)\.png$' % re.escape(kind))

    started = datetime.datetime.now(datetime.timezone.utc)
    offline = read_port(api, 'names')
    if offline is not None:
        live = sorted(offline)
        listed = {c: list(offline.get(c) or []) for c in locales if c in offline}
        source = 'names input (offline)'
    else:
        live, listed = live_names(account, locales, int(api.params.get('threads') or 8))
        source = account
    missing_containers = [c for c in locales if c not in listed]
    if missing_containers:
        raise ValueError('Locale containers missing in %s: %s' % (source, missing_containers))
    unlisted = [c for c in live if LOCALE_RE.match(c) and c not in locales and c not in exclude]

    wanted = set(ids)
    rows = {i: [] for i in ids}
    no_marker = []
    for container in locales:
        names = listed[container]
        markers = set(n for n in names if n.endswith('_hash.png'))
        for name in names:
            m = pattern.match(name)
            if not m or m.group('mid') not in wanted:
                continue
            has_marker = (name[:-4] + '_hash.png') in markers
            if not has_marker:
                no_marker.append(container + '/' + name)
                if require_marker:
                    continue
            pid = re.search(r'-(\d+)$', m.group('stem'))
            rows[m.group('mid')].append({
                'culture': container,
                'container': container,
                'blob_path': container + '/' + name,
                'product_id': pid.group(1) if pid else None,
                'part_number': None,
                'brand': None,
                'media_groups': ['storage-discovery'],
                'hash_marker': has_marker,
            })

    if no_marker and require_marker:
        raise ValueError('%d matching blobs have no _hash.png marker (not prescaler-managed); review them or set '
                         'requireMarker=false deliberately: %s' % (len(no_marker), no_marker[:20]))
    missing = [i for i in ids if not rows[i]]
    if missing:
        raise ValueError('No %s blob found for media IDs %s in %d locale containers of %s. '
                         'Check the IDs (media ID = the number after -oneux-); nothing written.'
                         % (kind, missing, len(locales), source))

    if request:
        work_dir = request['workDir']
    else:
        work_dir = fresh_work_dir(setting(api, 'workDir', 'work dir', 'work folder')
                                  or os.path.join('~', 'oneux-image-replacements', started.strftime('%Y%m%d-%H%M%S')))
    ids_map = {i: sorted(rows[i], key=lambda r: r['blob_path']) for i in ids}
    total = sum(len(v) for v in ids_map.values())
    used_locales = sorted(set(r['container'] for v in ids_map.values() for r in v))
    doc = {
        'version': 1,
        'kind': 'oneux-discovery',
        'workDir': work_dir,
        'env': env,
        'target': account,
        'source': source,
        'listedAt': started.isoformat(),
        'matchKind': kind,
        'expectedIds': ids,
        'locales': locales,
        'excluded': sorted(exclude),
        'unlistedLocaleContainers': unlisted,
        'withoutMarker': no_marker,
        'request': {k: request[k] for k in ('request', 'account', 'container', 'imagesDir', 'images')} if request else None,
        'ids': ids_map,
        'summary': {'media_ids': ids, 'locales': used_locales, 'blob_paths': total, 'missing_expected_ids': []},
    }
    text = json.dumps(doc, indent=2)
    path = os.path.join(work_dir, '01-discovery.json')
    with open(path, 'x', encoding='utf-8') as fh:
        fh.write(text)
    digest = hashlib.sha256(text.encode('utf-8')).hexdigest()
    write_port(api, 'mapping', text)

    lines = ['# OneUX images: discovery', '',
             '- Work dir: `%s`' % work_dir,
             '- Request: %s' % ('`%s` (job %s)' % (request['container'], request['request']) if request else '_none (IDs given directly)_'),
             '- Source: %s (%s), listed %s' % (source, env, started.strftime('%Y-%m-%d %H:%M UTC')),
             '- Match: `<slug>-<productId>-%s-<mediaId>.png`%s' % (kind, ' with `_hash.png` marker' if require_marker else ''),
             '- Searched %d locale containers; excluded: %s' % (len(locales), ', '.join(sorted(exclude)) or 'none'),
             '- Found **%d blob paths** for %d media IDs in %d locales' % (total, len(ids), len(used_locales)),
             '- Discovery digest (sha256 of 01-discovery.json): `%s`' % digest, '']
    if unlisted:
        lines += ['> Locale containers that exist but were NOT searched: %s' % ', '.join(unlisted), '']
    if no_marker:
        lines += ['> Included without a `_hash.png` marker (requireMarker=false): %d' % len(no_marker), '']
    lines += ['| Media ID | Locales | Paths | Locales with several paths |', '|---|---|---|---|']
    for i in ids:
        per = {}
        for r in ids_map[i]:
            per[r['container']] = per.get(r['container'], 0) + 1
        multi = ', '.join('%s (%d)' % (c, n) for c, n in sorted(per.items()) if n > 1) or '-'
        lines.append('| %s | %d | %d | %s |' % (i, len(per), len(ids_map[i]), multi))
    lines += ['', '## Paths', '']
    for i in ids:
        lines.append('### %s' % i)
        lines += ['- `%s`' % r['blob_path'] for r in ids_map[i]]
        lines.append('')
    write_port(api, 'report', '\n'.join(lines) + '\n')
    return {'summary': '%d blob paths for %d media IDs in %d locales; work dir %s'
                       % (total, len(ids), len(used_locales), work_dir)}
