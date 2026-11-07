#!/usr/bin/env bash
# Run only after approval of the new deployment access.
set -euo pipefail
export AWS_DEFAULT_REGION=us-east-1
account=$(aws sts get-caller-identity --query Account --output text)
[[ "$account" == 286853118669 ]] || { echo 'Wrong account'; exit 1; }
provider="arn:aws:iam::$account:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$provider" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com >/dev/null
fi
audiences=$(aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$provider" --query 'ClientIDList' --output text)
[[ " $audiences " == *"sts.amazonaws.com"* ]] || { echo 'Existing OIDC provider lacks sts.amazonaws.com audience; review provider manually'; exit 1; }
folder=$(mktemp -d)
cat > "$folder/trust.json" <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Federated":"arn:aws:iam::286853118669:oidc-provider/token.actions.githubusercontent.com"},"Action":"sts:AssumeRoleWithWebIdentity","Condition":{"StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com","token.actions.githubusercontent.com:sub":"repo:AiCaseLeads@324953472/ai-case-leads-hiring@1412546527:ref:refs/heads/main"}}}]}
JSON
cat > "$folder/policy.json" <<'JSON'
{"Version":"2012-10-17","Statement":[{"Sid":"EcrLogin","Effect":"Allow","Action":"ecr:GetAuthorizationToken","Resource":"*"},{"Sid":"PublishHiringImage","Effect":"Allow","Action":["ecr:BatchCheckLayerAvailability","ecr:InitiateLayerUpload","ecr:UploadLayerPart","ecr:CompleteLayerUpload","ecr:PutImage"],"Resource":"arn:aws:ecr:us-east-1:286853118669:repository/hiring"},{"Sid":"DeployOnlyHiring","Effect":"Allow","Action":"ssm:SendCommand","Resource":["arn:aws:ssm:us-east-1:286853118669:document/HiringDeploy","arn:aws:ec2:us-east-1:286853118669:instance/i-04bbe6b1c7d2d0451"]},{"Sid":"ReadDeployStatus","Effect":"Allow","Action":"ssm:GetCommandInvocation","Resource":"*"}]}
JSON
cat > "$folder/document.json" <<'JSON'
{"schemaVersion":"2.2","description":"Deploy a full SHA-tagged hiring image using the root-owned host script","parameters":{"CommitSha":{"type":"String","allowedPattern":"^[0-9a-f]{40}$","interpolationType":"ENV_VAR"}},"mainSteps":[{"action":"aws:runShellScript","name":"deployHiring","inputs":{"timeoutSeconds":"1800","runCommand":["/usr/bin/python3 /opt/hiring/deploy-hiring.py \"$SSM_CommitSha\""]}}]}
JSON
if aws iam get-role --role-name hiring-github-actions-deploy >/dev/null 2>&1; then
  aws iam get-role --role-name hiring-github-actions-deploy --query Role.AssumeRolePolicyDocument --output json > "$folder/existing-trust.json"
  python3 -c 'import json,sys; assert json.load(open(sys.argv[1])) == json.load(open(sys.argv[2])), "Existing trust differs; refusing overwrite"' "$folder/trust.json" "$folder/existing-trust.json"
  [[ $(aws iam list-attached-role-policies --role-name hiring-github-actions-deploy --query 'length(AttachedPolicies)' --output text) == 0 ]] || { echo 'Existing role has attached policies; review manually'; exit 1; }
  inline=$(aws iam list-role-policies --role-name hiring-github-actions-deploy --query 'PolicyNames' --output text)
  [[ -z "$inline" || "$inline" == HiringDeployment || "$inline" == None ]] || { echo 'Existing role has unexpected inline policies'; exit 1; }
  if [[ "$inline" == HiringDeployment ]]; then
    aws iam get-role-policy --role-name hiring-github-actions-deploy --policy-name HiringDeployment --query PolicyDocument --output json > "$folder/existing-policy.json"
    python3 -c 'import json,sys; assert json.load(open(sys.argv[1])) == json.load(open(sys.argv[2])), "Existing policy differs; refusing overwrite"' "$folder/policy.json" "$folder/existing-policy.json"
  fi
else
  aws iam create-role --role-name hiring-github-actions-deploy --assume-role-policy-document "file://$folder/trust.json" >/dev/null
fi
if aws ssm describe-document --name HiringDeploy >/dev/null 2>&1; then
  aws ssm get-document --name HiringDeploy --document-format JSON --query Content --output text > "$folder/existing-document.json"
  python3 -c 'import json,sys; assert json.load(open(sys.argv[1])) == json.load(open(sys.argv[2])), "Existing SSM document differs; refusing overwrite"' "$folder/document.json" "$folder/existing-document.json"
else
  aws ssm create-document --name HiringDeploy --document-type Command --document-format JSON --content "file://$folder/document.json" >/dev/null
fi
aws iam put-role-policy --role-name hiring-github-actions-deploy --policy-name HiringDeployment --policy-document "file://$folder/policy.json"
echo 'Configured GitHub main deployment to hiring-prod only.'
