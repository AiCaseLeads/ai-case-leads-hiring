# Railway configuration

Start with [the deployment guide](../docs/RAILWAY-SETUP.md). A root Dockerfile is the build entry point. New Railway services do not support the deprecated `railway.json` configuration.

The optional `railway.ts` specification uses Railway’s supported TypeScript IaC SDK, pinned in `package-lock.json`. It manages a single continuously running app and the attached `/data` volume. It preserves server credentials and intake state rather than putting their values in source. It does not connect a source repository, generate a domain, authorize Google, or enable intake.

For adoption **after manual setup**, use an isolated Railway project/environment with service named `hiring-hub` and volume named `hiring-data`. Install the current Railway CLI (at least 5.42.1), authenticate, link this directory to that exact project/environment, and preview:

```sh
railway login
railway link
railway config plan
```

Confirm the plan refers to the intended service and volume and keeps existing variables. If it proposes creating a duplicate volume, deleting data, changing the source, or removing variables, stop and reconcile names/import the existing configuration with `railway config pull` first. Do not use `--include-variables`, which can write secrets into source. Run `railway config apply` only after reviewing the concrete plan. This specification has been checked locally against the SDK; a real Railway plan requires your account and has not been run here.

Do not apply this file against a shared production project without inspecting the plan and ownership. Never reduce or detach a volume to work around a deployment failure. Backups and a restore test remain required.

[Railway IaC documentation](https://docs.railway.com/infrastructure-as-code).
