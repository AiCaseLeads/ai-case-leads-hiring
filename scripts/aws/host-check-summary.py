"""Publish only aggregate, allowlisted metrics received from the fixed SSM check."""
import json
import os
import sys


def render(report):
    if type(report.get("serviceReady")) is not bool:
        raise ValueError("Invalid readiness field")
    state = "ready" if report["serviceReady"] else "unhealthy"
    lines = [f"Hiring service: **{state}**", "", "| Storage | Available MiB | Capacity MiB | Free inodes |", "| --- | ---: | ---: | ---: |"]
    for name in ("root", "docker", "data"):
        disk = report[name]
        if disk is None and name == "docker":
            lines.append("| docker | unavailable | unavailable | unavailable |")
            continue
        values = [disk[k] for k in ("availableMiB", "capacityMiB", "freeInodes")]
        if any(type(value) is not int or value < 0 for value in values):
            raise ValueError("Invalid storage metrics")
        lines.append(f"| {name} | {values[0]} | {values[1]} | {values[2]} |")
    return "\n".join(lines)


if __name__ == "__main__":
    try:
        report = json.load(sys.stdin)
        result = render(report)
    except (TypeError, ValueError, KeyError, AttributeError):
        sys.exit("Invalid host health response")
    print(result)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            print(result, file=summary)
    sys.exit(0 if report["serviceReady"] else 1)
