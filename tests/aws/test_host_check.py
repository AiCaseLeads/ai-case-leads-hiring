import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
AWS = ROOT / "infra/aws"
spec = importlib.util.spec_from_file_location("host_summary", ROOT / "scripts/aws/host-check-summary.py")
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)

MOCK = """#!/bin/bash
set -eu
case "$1 $2" in
  'sts get-caller-identity') echo 286853118669 ;;
  'iam get-role') ;;
  'ssm get-document')
    if [[ -e "$STATE/document" ]]; then cat "$STATE/document"
    else echo '(InvalidDocument)' >&2; exit 254; fi ;;
  'ssm create-document') cp "${!##file://}" "$STATE/document"; echo create >> "$STATE/actions" ;;
  'iam get-role-policy')
    if [[ -e "$STATE/policy" ]]; then cat "$STATE/policy"
    else echo '(NoSuchEntity)' >&2; exit 254; fi ;;
  'iam put-role-policy') cp "${!##file://}" "$STATE/policy"; echo put >> "$STATE/actions" ;;
  *) echo 'Unexpected AWS command' >&2; exit 2 ;;
esac
"""


class HostCheck(unittest.TestCase):
    def test_bootstrap_preserves_existing_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            aws = target / "aws"
            aws.write_text(MOCK)
            aws.chmod(0o700)
            env = dict(os.environ, STATE=directory, PATH=directory + os.pathsep + os.environ["PATH"])
            def bootstrap():
                return subprocess.run(["bash", AWS / "bootstrap-host-check.sh"], env=env, capture_output=True, text=True)
            for _ in range(2):
                result = bootstrap()
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((target / "actions").read_text().splitlines(), ["create", "put"])
            (target / "policy").write_text("{}")
            self.assertNotEqual(bootstrap().returncode, 0)
            self.assertEqual((target / "policy").read_text(), "{}")
            (target / "document").write_text("{}")
            self.assertNotEqual(bootstrap().returncode, 0)
            self.assertEqual((target / "document").read_text(), "{}")

    def test_host_check_and_summary_have_fixed_outputs(self):
        document = json.loads((AWS / "hiring-host-check.json").read_text())
        self.assertFalse(document.get("parameters"))
        commands = "\n".join(document["mainSteps"][0]["inputs"]["runCommand"])
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            docker = target / "docker"
            docker.write_text('#!/bin/sh\nif [ "$1" = info ]; then echo /; else exit 1; fi\n')
            docker.chmod(0o700)
            env = dict(os.environ, PATH=directory + os.pathsep + os.environ["PATH"])
            # Use a temporary volume for the data partition in this host-independent check.
            commands = commands.replace("space('/data')", "space(" + repr(directory) + ")")
            result = subprocess.run(["bash"], input=commands, env=env, text=True, capture_output=True, check=True)
            report = json.loads(result.stdout)
            self.assertEqual(set(report), {"serviceReady", "root", "docker", "data"})
            self.assertIs(report["serviceReady"], False)
            report["private"] = "secret"
            self.assertNotIn("secret", summary.render(report))
            report["data"]["availableMiB"] = "secret"
            with self.assertRaises(ValueError):
                summary.render(report)
