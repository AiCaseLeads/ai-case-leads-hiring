#!/usr/bin/env python3
"""Only print allowlisted release aggregates, never raw SSM stdout/stderr."""
import json, os, pathlib, re, sys

FIELDS = ('totalFiles', 'undiscovered', 'pending', 'running', 'ready', 'partial', 'failed')
def summarize(invocation, expected_sha):
    if not re.fullmatch(r'[0-9a-f]{40}', expected_sha) or invocation.get('Status') != 'Success': raise ValueError()
    output = invocation.get('StandardOutputContent')
    if not isinstance(output, str) or len(output) > 32768: raise ValueError()
    # The fixed deployer emits one final JSON line after Docker's progress output.
    lines = output.rstrip().splitlines()
    release = json.loads(lines[-1]) if lines else None
    if not isinstance(release, dict) or release.get('status') != 'deployed' or release.get('sha') != expected_sha: raise ValueError()
    report = release.get('verification')
    if not isinstance(report, dict) or type(report.get('schemaVersion')) is not int or report['schemaVersion'] != 1 or any(report.get(key) is not True for key in ('storageReady', 'backgroundReady', 'backgroundEnabled', 'cacheSchemaReady')): raise ValueError()
    counts = report.get('fileTextBackfill')
    if not isinstance(counts, dict) or any(type(counts.get(key)) is not int or not 0 <= counts[key] <= 10**9 for key in FIELDS): raise ValueError()
    if counts['totalFiles'] != sum(counts[key] for key in FIELDS[1:]): raise ValueError()
    state = 'in_progress' if counts['undiscovered'] + counts['pending'] + counts['running'] else 'finished_with_exceptions' if counts['partial'] + counts['failed'] else 'complete'
    if counts.get('state') != state: raise ValueError()
    safe = {'status': 'deployed', 'sha': expected_sha, 'storageReady': True, 'backgroundReady': True, 'backgroundEnabled': True, 'cacheSchemaReady': True, 'fileTextBackfill': {**{key: counts[key] for key in FIELDS}, 'state': state}}
    markdown = '\n'.join(['## Hiring release verified', '', f'Commit: `{expected_sha}`', '', 'Storage, background processing and cache schema: ready.', '', f'File text backfill: **{state}** (supported, eligible uploads; includes résumés and other file answers).', '', '| Total | Ready | Pending | Running | Undiscovered | Partial | Failed |', '| --- | --- | --- | --- | --- | --- | --- |', f"| {counts['totalFiles']} | {counts['ready']} | {counts['pending']} | {counts['running']} | {counts['undiscovered']} | {counts['partial']} | {counts['failed']} |", '', 'Pending work is processed automatically. Failed/partial files require review and do not imply applicant loss. Counts are a release-time snapshot; no applicant data or credentials are included.', ''])
    return safe, markdown

def main():
    try:
        if len(sys.argv) != 3: raise ValueError()
        safe, markdown = summarize(json.loads(pathlib.Path(sys.argv[1]).read_text()), sys.argv[2])
    except (ValueError, TypeError, KeyError, AttributeError, OSError):
        raise SystemExit('Release verification report missing or invalid. No raw SSM output was printed.') from None
    print(json.dumps(safe))
    summary_path = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary_path:
        with open(summary_path, 'a') as stream: stream.write(markdown)
if __name__ == '__main__': main()
