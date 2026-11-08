import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).resolve().parents[2] / "scripts/aws/deploy-failure.py"
spec = importlib.util.spec_from_file_location("deploy_failure", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FailureStageTests(unittest.TestCase):
    def test_only_fixed_label_for_a_failed_backup(self):
        invocation = {"StandardErrorContent": "CalledProcessError: Command ['docker', 'exec', 'hiring', 'node', 'scripts/railway-backup.mjs', '/private/path'] failed"}
        self.assertEqual(module.failure_stage(invocation), "pre-deployment database backup")

    def test_unknown_output_is_kept_private(self):
        self.assertEqual(module.failure_stage({"StandardErrorContent": "private error text"}), "unclassified host failure")
