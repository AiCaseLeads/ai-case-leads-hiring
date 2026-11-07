#!/usr/bin/env python3
"""Root-owned deployment entrypoint. Never restores or removes applicant data."""
import fcntl, json, os, pathlib, re, subprocess, sys, time, urllib.request
from uuid import uuid4
REGISTRY = '286853118669.dkr.ecr.us-east-1.amazonaws.com'
REGION = 'us-east-1'
BASE = pathlib.Path('/opt/hiring')
def run(*args, capture=False):
    return subprocess.check_output(args, text=True, timeout=120).strip() if capture else subprocess.run(args, check=True, timeout=120)
def main():
    if os.geteuid() != 0: raise RuntimeError('Run as root')
    sha = sys.argv[1] if len(sys.argv) == 2 else ''
    if not re.fullmatch(r'[0-9a-f]{40}', sha): raise RuntimeError('Expected full lowercase Git commit SHA')
    with open(BASE / 'deploy.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = json.loads(run('docker', 'inspect', 'hiring', capture=True))[0]
        mounts = current['Mounts']
        if len(mounts) != 1 or mounts[0]['Source'] != '/data' or mounts[0]['Destination'] != '/data' or not mounts[0]['RW']:
            raise RuntimeError('Unexpected production mounts; review before deployment')
        if not pathlib.Path('/data/hiring.sqlite').is_file(): raise RuntimeError('Database not found')
        envfile = BASE / 'hiring.env'
        if envfile.is_symlink() or not envfile.is_file() or envfile.stat().st_uid != 0 or envfile.stat().st_mode & 0o077: raise RuntimeError('Unsafe production env permissions')
        networks = current['NetworkSettings']['Networks']
        if set(networks) != {'hiring'}: raise RuntimeError('Expected production hiring network')
        network = next(iter(networks))
        restart = current['HostConfig']['RestartPolicy']
        if current['HostConfig'].get('Privileged'): raise RuntimeError('Unexpected privileged container')
        image = f'{REGISTRY}/hiring:{sha}'
        login = subprocess.Popen(['aws', 'ecr', 'get-login-password', '--region', REGION], stdout=subprocess.PIPE)
        subprocess.run(['docker', 'login', '--username', 'AWS', '--password-stdin', REGISTRY], stdin=login.stdout, check=True, timeout=60)
        login.stdout.close()
        if login.wait(timeout=10): raise RuntimeError('ECR authentication failed')
        run('docker', 'pull', image)
        info = json.loads(run('docker', 'image', 'inspect', image, capture=True))[0]
        if info['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != sha:
            raise RuntimeError('Image revision does not match requested commit')
        digests = [d for d in info['RepoDigests'] if d.startswith(REGISTRY + '/hiring@sha256:')]
        if len(digests) != 1: raise RuntimeError('Expected one ECR image digest')
        image = digests[0]
        architecture = run('docker', 'image', 'inspect', image, '--format', '{{.Architecture}}', capture=True)
        if architecture != 'arm64': raise RuntimeError('Image must be arm64')
        backup = f'/data/backups/predeploy-{sha}-{int(time.time())}.sqlite'
        run('docker', 'exec', '-e', 'DATA_DIR=/data', 'hiring', 'node', 'scripts/railway-backup.mjs', backup)
        staged = 'hiring-next-' + uuid4().hex[:12]
        args = ['docker', 'create', '--name', staged, '--env-file', str(envfile), '--mount', 'type=bind,src=/data,dst=/data', '--network', network]
        policy = restart['Name'] or 'no'
        if policy == 'on-failure' and restart.get('MaximumRetryCount'): policy += ':' + str(restart['MaximumRetryCount'])
        args += ['--restart', policy]
        for port, bindings in (current['HostConfig'].get('PortBindings') or {}).items():
            for binding in bindings or []:
                host = binding.get('HostIp') or '0.0.0.0'
                args += ['-p', f'{host}:{binding["HostPort"]}:{port}']
        for alias in networks[network].get('Aliases') or []:
            if alias not in (current['Id'][:12], current['Id'], 'hiring'): args += ['--network-alias', alias]
        if network not in ('host', 'bridge', 'none'): args += ['--network-alias', 'hiring']
        args += ['--label', f'org.opencontainers.image.revision={sha}', image]
        new_id = run(*args, capture=True)
        previous = 'hiring-previous-' + str(int(time.time()))
        try:
            run('docker', 'stop', '--time', '30', current['Id'])
            run('docker', 'rename', current['Id'], previous)
            run('docker', 'rename', new_id, 'hiring')
            run('docker', 'start', 'hiring')
            healthy = False
            # Probe inside the new container; no dependency on host port publishing.
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                try:
                    probe = subprocess.run(['docker', 'exec', new_id, 'node', '-e', "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok||(await r.json()).status!=='ready')process.exit(1)}).catch(()=>process.exit(1))"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8)
                except subprocess.TimeoutExpired:
                    time.sleep(2)
                    continue
                if probe.returncode == 0:
                    try:
                        with urllib.request.urlopen('https://jobs.aicaseleads.com/api/health', timeout=10) as response:
                            healthy = response.status == 200 and json.load(response).get('status') == 'ready'
                    except Exception: pass
                if healthy: break
                time.sleep(2)
            if not healthy: raise RuntimeError('Health check failed')
            deployed = json.loads(run('docker', 'inspect', 'hiring', capture=True))[0]
            if deployed['Image'] != info['Id']: raise RuntimeError('Running image differs from requested digest')
            record = {'sha': sha, 'image': image, 'previousContainer': previous, 'databaseBackup': backup, 'deployedAt': int(time.time())}
            temporary = BASE / 'release.json.tmp'
            temporary.write_text(json.dumps(record) + '\n')
            os.chmod(temporary, 0o600)
            temporary.replace(BASE / 'release.json')
            print(json.dumps({'status': 'deployed', 'sha': sha}))
        except Exception:
            subprocess.run(['docker', 'rm', '-f', new_id], check=False, timeout=60)
            try:
                old = json.loads(run('docker', 'inspect', current['Id'], capture=True))[0]
                if old['Name'] != '/hiring': run('docker', 'rename', current['Id'], 'hiring')
            finally:
                run('docker', 'start', current['Id'])
            raise
if __name__ == '__main__': main()
