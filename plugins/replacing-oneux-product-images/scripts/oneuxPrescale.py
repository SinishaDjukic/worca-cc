# OneUX images: prescale - step 6 (new, plan phase 5). Runs the existing sibling prescaler once,
# with its own Docker image, from the bosch-oneux-py-imagescaler checkout:
#   docker compose run --rm --no-deps py_imagescaler_local bash -o pipefail -c
#     'python3 main_scanner.py de-de | parallel --halt soon,fail=1 -jN -n 1 python3 main_scaler.py'
# Its scaling is not reimplemented here. Preflight: application.ini points only at the dev scaler
# accounts (devscalerlocalenvsource -> devscalerlocalenvtarget) with do_overwrite=false - credential
# values are never logged - and image_sizes.yml enables exactly 3200x1800 (several variants would
# collide under the same output name). The scaler can log per-image failures and still exit 0, so
# the whole log is scanned. SOURCE_/TARGET_STORAGE_CREDENTIAL from the environment are passed
# through by name only. A continued job reuses the result instead of scaling again.
import configparser
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time

SERVICE = 'py_imagescaler_local'
DEV_SOURCE = 'https://devscalerlocalenvsource.blob.core.windows.net'
DEV_TARGET = 'https://devscalerlocalenvtarget.blob.core.windows.net'
ERROR_RE = re.compile(r'(ERROR|CRITICAL|Traceback|Skipping scale of image|Failed to upload MD5)')
HEARTBEAT_SECONDS = 60


def log(message, level='info'):
    """One live progress line. print() reaches the run log WHILE the step runs; api.log()
    lines only travel on the result frame, and a frame that failed is never rendered - so
    anything logged before a raise would be lost."""
    print('[%s] %s' % (level, message), flush=True)


def heartbeat(log_path, stop, started):
    """A line a minute while the prescaler runs. Its own output goes to the log FILE, and
    the run can take hours - without this the step looks hung. Daemon thread: the harness
    waits for non-daemon ones, and this one never ends on its own."""
    while not stop.wait(HEARTBEAT_SECONDS):
        try:
            size = os.path.getsize(log_path)
        except OSError:
            size = 0
        log('prescaler still running: %.0f min elapsed, %s KB of log'
            % ((time.time() - started) / 60, format(size // 1024, ',')))


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
    if json.loads(text).get('kind') != 'oneux-prescale':
        raise ValueError('%s is not a prescale record.' % path)
    log('reusing the prescaler run of this job; it is not run again')
    write_port(api, 'job', text)
    write_port(api, 'report', '# OneUX images: prescale\n\nReused the prescaler run of this job; it was not run again.\n')
    return {'summary': 'Reused prescale run'}


def find_scaler(api):
    wanted = setting(api, 'scalerDir', 'scaler dir', 'prescaler dir')
    ctx = api.ctx or {}
    candidates = [wanted] if wanted else [os.getcwd()] + [ctx.get(k) for k in (
        'checkout', 'worktree', 'checkoutDir', 'worktreeDir', 'projectDir', 'repoDir', 'cwd')]
    for c in candidates:
        if c and os.path.isfile(os.path.join(c, 'docker-compose.yml')) and os.path.isfile(os.path.join(c, 'main_scaler.py')):
            return os.path.abspath(c)
    raise ValueError('No bosch-oneux-py-imagescaler checkout found. Run this workflow on that project, or set the '
                     'scalerDir param / a "Scaler dir:" line.')


def preflight(scaler):
    with open(os.path.join(scaler, 'application.ini'), encoding='utf-8') as fh:
        text = fh.read()
    if not text.lstrip().startswith('['):
        text = '[top]\n' + text
    cfg = configparser.ConfigParser(interpolation=None)
    cfg.read_string(text)
    urls = {}
    for section in cfg.sections():
        if 'storage_url' in cfg[section]:
            urls[section] = cfg[section]['storage_url'].strip().rstrip('/')
    source = [u for s, u in urls.items() if 'source' in s.lower()]
    target = [u for s, u in urls.items() if 'target' in s.lower()]
    if source != [DEV_SOURCE] or target != [DEV_TARGET] or len(urls) != 2:
        raise ValueError('application.ini must point only at %s -> %s; found %s' % (DEV_SOURCE, DEV_TARGET, sorted(urls.values())))
    overwrite = [cfg[s]['do_overwrite'].strip().lower() for s in cfg.sections() if 'do_overwrite' in cfg[s]]
    if overwrite != ['false']:
        raise ValueError('application.ini must set do_overwrite = false exactly once; found %s' % overwrite)
    with open(os.path.join(scaler, 'image_sizes.yml'), encoding='utf-8') as fh:
        sizes = re.findall(r'^\s*-\s*(\S+)\s*$', fh.read(), re.M)
    if sizes != ['3200x1800']:
        raise ValueError('image_sizes.yml must enable exactly 3200x1800; enabled: %s' % sizes)
    with open(os.path.join(scaler, 'docker-compose.yml'), encoding='utf-8') as fh:
        compose = fh.read()
    if not re.search(r'^\s+%s:\s*$' % SERVICE, compose, re.M):
        raise ValueError('docker-compose.yml has no %s service' % SERVICE)
    image = re.search(r'^\s+image:\s*(\S+)\s*$', compose, re.M)
    return {'source': DEV_SOURCE, 'target': DEV_TARGET, 'doOverwrite': False, 'sizes': sizes,
            'image': image.group(1) if image else None}


def quiet(cmd, cwd):
    try:
        return subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=600).returncode
    except (OSError, subprocess.TimeoutExpired):
        return -1


def main(api):
    prev = read_port(api, 'prev')
    if not prev or not prev.get('workDir'):
        raise ValueError('Wire the output of "OneUX images: dev upload" into "prev".')
    work_dir = prev['workDir']
    out = os.path.join(work_dir, '06-prescale.json')
    if os.path.isfile(out):
        return reuse(api, out)
    upload = load(work_dir, '05-dev-upload.json', 'oneux-dev-upload')
    job = upload['job']
    scaler = find_scaler(api)
    log('job %s; scaler checkout %s' % (job, scaler))
    checks = preflight(scaler)
    log('preflight passed: %s -> %s, do_overwrite=false, sizes %s, image %s'
        % (checks['source'], checks['target'], checks['sizes'], checks['image']))

    if not shutil.which('docker') or quiet(['docker', 'version'], scaler) != 0:
        raise RuntimeError('Docker is not available (is Docker Desktop running?).')
    compose = ['docker', 'compose'] if quiet(['docker', 'compose', 'version'], scaler) == 0 else ['docker-compose']
    log('using %s' % ' '.join(compose))
    if checks['image'] and quiet(['docker', 'image', 'inspect', checks['image']], scaler) != 0:
        log('image %s is not local yet; pulling it (this can take a while)' % checks['image'])
        if quiet(['docker', 'pull', checks['image']], scaler) != 0:
            raise RuntimeError('Image %s is not available. Log in first: az acr login --name devoneuxcontainerregistry'
                               % checks['image'])
        log('pulled %s' % checks['image'])

    jobs = max(1, int(api.params.get('parallel') or 8))
    inner = 'python3 main_scanner.py de-de | parallel --halt soon,fail=1 -j%d -n 1 python3 main_scaler.py' % jobs
    env_flags = []
    for name in ('SOURCE_STORAGE_CREDENTIAL', 'TARGET_STORAGE_CREDENTIAL'):
        if os.environ.get(name):
            env_flags += ['-e', name]
    cmd = compose + ['run', '--rm', '--no-deps'] + env_flags + [SERVICE, 'bash', '-o', 'pipefail', '-c', inner]
    log_path = os.path.join(work_dir, '06-prescale.log')
    started = datetime.datetime.now(datetime.timezone.utc)
    t0 = time.time()
    timeout = float(api.params.get('timeoutHours') or 3) * 3600
    log('running the prescaler with -j%d, timeout %.1f h; its output goes to %s' % (jobs, timeout / 3600, log_path))
    if env_flags:
        log('passing through by name only: %s' % ', '.join(env_flags[1::2]))
    stop = threading.Event()
    beat = threading.Thread(target=heartbeat, args=(log_path, stop, t0), daemon=True)
    beat.start()
    with open(log_path, 'xb') as handle:
        try:
            code = subprocess.run(cmd, cwd=scaler, stdout=handle, stderr=subprocess.STDOUT, timeout=timeout).returncode
        except subprocess.TimeoutExpired:
            code = 'timeout'
        finally:
            stop.set()
    duration = round(time.time() - t0)
    log('prescaler exited %s after %d s' % (code, duration), 'info' if code == 0 else 'error')
    with open(log_path, encoding='utf-8', errors='replace') as fh:
        errors = [line.rstrip() for line in fh if ERROR_RE.search(line)]
    ours = [l for l in errors if job + '_' in l]
    others = [l for l in errors if job + '_' not in l]
    log('scanned the log: %d error lines, %d of them for this job\'s inputs' % (len(errors), len(ours)),
        'warn' if errors else 'info')
    if code != 0 or ours:
        raise RuntimeError('Prescaler failed (exit %s, %d error lines for this job, %d others). See %s. First: %s'
                           % (code, len(ours), len(others), log_path, (ours or others or ['-'])[:5]))

    doc = {'version': 1, 'kind': 'oneux-prescale', 'workDir': work_dir, 'job': job, 'scalerDir': scaler,
           'preflight': checks, 'command': ' '.join(cmd[:-1] + ["'%s'" % inner]), 'exitCode': code,
           'startedAt': started.isoformat(), 'durationSeconds': duration, 'log': log_path,
           'otherErrorLines': others[:50]}
    text = json.dumps(doc, indent=2)
    with open(out, 'x', encoding='utf-8') as fh:
        fh.write(text)
    write_port(api, 'job', text)
    lines = ['# OneUX images: prescale', '',
             '- Checkout: `%s`, image `%s`' % (scaler, checks['image']),
             '- Preflight: dev source -> dev target, do_overwrite=false, sizes %s' % checks['sizes'],
             '- Exit 0 after %d s; no error lines for this job\'s inputs' % duration,
             '- Log: `%s`' % log_path]
    if others:
        lines += ['', '> %d error lines for other blobs in the shared dev container (not this job):' % len(others), '']
        lines += ['    ' + l for l in others[:10]]
    write_port(api, 'report', '\n'.join(lines) + '\n')
    return {'summary': 'Prescaler finished in %d s for job %s' % (duration, job)}
