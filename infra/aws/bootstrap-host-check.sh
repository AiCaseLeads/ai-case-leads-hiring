#!/usr/bin/env bash
set -euo pipefail
export AWS_DEFAULT_REGION=us-east-1 AWS_PAGER=
source_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
role=hiring-github-actions-deploy
account=$(aws sts get-caller-identity --query Account --output text)
[[ "$account" == 286853118669 ]] || { echo 'Wrong AWS account' >&2; exit 1; }
aws iam get-role --role-name "$role" >/dev/null
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
compare_json() {
  python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])) == json.load(open(sys.argv[2])) else "Existing AWS configuration differs; refusing to replace it")' "$1" "$2"
}
if aws ssm get-document --name HiringHostCheck --document-version 1 --document-format JSON --query Content --output text > "$work/document" 2> "$work/error"; then
  compare_json "$source_dir/hiring-host-check.json" "$work/document"
elif grep -q '(InvalidDocument)' "$work/error"; then
  aws ssm create-document --name HiringHostCheck --document-type Command --document-format JSON --content "file://$source_dir/hiring-host-check.json" >/dev/null
else
  cat "$work/error" >&2; exit 1
fi
if aws iam get-role-policy --role-name "$role" --policy-name HiringHostCheck --query PolicyDocument --output json > "$work/policy" 2> "$work/error"; then
  compare_json "$source_dir/hiring-host-check-policy.json" "$work/policy"
elif grep -q '(NoSuchEntity)' "$work/error"; then
  aws iam put-role-policy --role-name "$role" --policy-name HiringHostCheck --policy-document "file://$source_dir/hiring-host-check-policy.json"
else
  cat "$work/error" >&2; exit 1
fi
echo 'HiringHostCheck is configured.'
