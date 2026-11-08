"""Classify an SSM deployment failure without publishing raw host output."""
import json
import sys


def failure_stage(invocation):
    errors = invocation.get("StandardErrorContent") or ""
    if "no space left on device" in errors.lower():
        return "host storage full"
    stages = [
        ("scripts/railway-backup.mjs", "pre-deployment database backup"),
        ("'docker', 'pull'", "container image pull"),
        ("'docker', 'create'", "container creation"),
        ("'docker', 'start'", "container startup"),
        ("'docker', 'stop'", "container shutdown"),
        ("'docker', 'rename'", "container rename"),
        ("'docker', 'login'", "container registry login"),
        ("Health check failed", "application health probe"),
        ("Release verification", "release verification"),
        ("BlockingIOError", "host deployment lock"),
        ("Image revision does not match", "container image revision verification"),
    ]
    for signature, stage in stages:
        if signature in errors:
            return stage
    return "unclassified host failure"


if __name__ == "__main__":
    print("Deployment stopped at " + failure_stage(json.load(sys.stdin)))
