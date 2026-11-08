import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).resolve().parents[2] / 'scripts/aws/deploy-hiring.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class PullRecoveryTests(unittest.TestCase):
    def test_only_disk_full_permits_recovery(self):
        with patch.object(deploy.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stderr=b'unauthorized private error')), patch.object(deploy, 'retired_releases') as releases:
            with self.assertRaises(deploy.subprocess.CalledProcessError):
                deploy.pull_release('target', 'active')
            releases.assert_not_called()

    def test_retries_stop_as_soon_as_a_pull_succeeds(self):
        full = SimpleNamespace(returncode=1, stderr=b'write layer: no space left on device')
        ok = SimpleNamespace(returncode=0)
        with patch.object(deploy.subprocess, 'run', side_effect=[full, ok]), patch.object(deploy, 'retired_releases', return_value=['old', 'newer']), patch.object(deploy, 'remove_retired_release', return_value=True) as remove:
            deploy.pull_release('target', 'active')
            remove.assert_called_once_with('old', 'active', 'target')

    def test_keeps_three_latest_and_recorded_rollback_even_if_older(self):
        names = ['hiring-previous-170000000' + str(i) for i in range(6)]
        with tempfile.TemporaryDirectory() as tmp, patch.object(deploy, 'BASE', Path(tmp)), patch.object(deploy,'run',return_value='\n'.join(['hiring','caddy','hiring-previous-other',*names[::-1]])):
            (Path(tmp) / 'release.json').write_text(json.dumps({'previousContainer': names[1]}))
            self.assertEqual(deploy.retired_releases(), [names[0], names[2]])

    def test_only_verified_retired_containers_and_sole_image_references_are_removed(self):
        repo = deploy.REGISTRY + '/hiring'
        rev, image_id = 'a' * 40, 'sha256:' + 'b' * 64
        digest, tag = repo + '@sha256:' + 'c' * 64, repo + ':' + rev
        name = 'hiring-previous-1700000000'
        for state, container_label, image_tags, extra_ref, expected in [
            ('exited', rev, [tag], '', ['container', 'image']),
            ('exited', rev, [tag], 'another container', ['container']),
            ('running', rev, [tag], '', []),
            ('exited', 'bad', [tag], '', []),
            ('exited', rev, ['another/repo:tag'], '', []),
        ]:
            with self.subTest(state=state, container_label=container_label, image_tags=image_tags, extra_ref=extra_ref):
                changes = []
                container = {'Name':'/'+name, 'State':{'Status':state}, 'Config':{'Labels':{'org.opencontainers.image.revision':container_label},'Image':digest}, 'Image':image_id, 'Id':'container_id'}
                image = {'Config':{'Labels':{'org.opencontainers.image.revision':rev}}, 'RepoDigests':[digest], 'RepoTags':image_tags}
                def run(*args, capture=False):
                    if args == ('docker','container','inspect',name): return json.dumps([container])
                    if args == ('docker','image','inspect',image_id): return json.dumps([image])
                    if args == ('docker','rm','container_id'): changes.append('container'); return
                    if args == ('docker','ps','-aq','--filter','ancestor='+image_id): return extra_ref
                    if args == ('docker','image','rm',tag): changes.append('image'); return
                    self.fail(args)
                with patch.object(deploy, 'run', side_effect=run):
                    deploy.remove_retired_release(name, image_id, 'target')
                    self.assertEqual(changes, [])
                    deploy.remove_retired_release(name, 'active', tag)
                    self.assertEqual(changes, [])
                    deploy.remove_retired_release(name, 'active', 'target')
                    self.assertEqual(changes, expected)
