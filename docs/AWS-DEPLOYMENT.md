# AWS push deployment

Production runs on ARM64 EC2 `hiring-prod` (`i-04bbe6b1c7d2d0451`, us-east-1). Caddy proxies to container `hiring:3000` on Docker network `hiring`. `/data` holds the persistent database and uploads. `/opt/hiring/hiring.env` is root-only configuration. The legacy railway runtime name in code does not mean the host is Railway.

## Setup

1. Review and approve the new GitHub OIDC deployment role in `infra/aws/bootstrap-deployment.sh`. Its trust permits only this repository's main branch. It can push only ECR hiring and invoke only the fixed HiringDeploy document against the hiring instance. It cannot invoke arbitrary SSM shell documents or change IAM.
2. Install `scripts/aws/deploy-hiring.py` at `/opt/hiring/deploy-hiring.py`, root-owned mode 0700. Verify Python3, Docker, AWS CLI, and the instance's existing ECR pull permissions. The app and CI role must not be able to edit this script.
3. Run the reviewed bootstrap in AWS CloudShell in the correct account. It reuses only exactly matching role/document policies and refuses unrelated access. No AWS keys or GitHub secrets are required. The source repository is private; transfer reviewed files through an authenticated channel.
4. Merge the workflow only after setup and review. Main pushes run typecheck and backend tests, build an ARM64 image tagged with the full commit SHA, push ECR and invoke SSM. Feature branches do not deploy.
5. Confirm Actions success, `/opt/hiring/release.json` SHA, public health, and read-only job/applicant/file smoke checks. Do not infer completion from push success.

If bootstrap partially fails, rerun after resolving the failure. Existing trust, inline policies and SSM document are compared for exact JSON equality before reuse; unexpected policies stop setup. It never replaces differing access. A pre-existing GitHub provider must already include the sts.amazonaws.com audience.

## Data and rollback

The deployer validates `/data:/data`, takes an online SQLite snapshot with committed WAL pages, and pulls the new image before stopping the app. Caddy stays running; the application restart has a short interruption. The env file, database and uploads are never replaced. Old containers and backup snapshots are retained. Same-host backups do not replace off-host backups and recovery tests.

Failed health checks restart the previous container against the current database. The deployer never restores old data or discards new applications. All automatic releases must use backward-compatible schema changes; breaking migrations need a separate maintenance/migration plan.

Successful releases record the previous container in root-only release.json. To roll back manually, check schema compatibility, stop/rename the current container, rename the recorded prior container to hiring, start it and verify local/public health. Never automatically restore SQLite.

Protect main with required checks/review: permission to merge main is permission to change production app code. The root deployment script is not automatically replaced by CI. Its updates require separate administrator review. Do not log env values or applicant data. Do not prune old backups/images until retention and recovery are agreed.

If Docker removal or inspection times out during rollback, the deployer fails closed rather than risking two active workers. An operator must inspect running containers, stop the failed replacement, restore the recorded previous container name to `hiring`, start it, and verify health. Do not start the previous app while the replacement's writer state is unknown. This exceptional recovery is manual; no database restore is part of it.
