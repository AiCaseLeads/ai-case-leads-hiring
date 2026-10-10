import { defineRailway, preserve, project, service, volume } from "railway/iac";

// This partial owns only this app and its volume in a linked environment.
// Configure secrets/source/domain in Railway before adopting the specification.
export const partial = "ai-case-leads-hiring";

export default defineRailway(() => {
  const data = volume("hiring-data", {});
  const hub = service("hiring-hub", {
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "npm run start:railway",
    healthcheck: "/api/health",
    healthcheckTimeout: 300,
    replicas: 1,
    deploy: {
      sleepApplication: false,
      restartPolicyType: "ALWAYS",
      requiredMountPath: "/data",
      drainingSeconds: 55,
    },
    env: {
      NODE_ENV: "production",
      DATA_DIR: "/data",
      ADMIN_EMAILS: "sales@aicaseleads.com",
      BACKGROUND_ENABLED: "true",
      PUBLIC_SITE_ORIGIN: preserve(),
      EXPECTED_RECRUITING_EMAIL: preserve(),
      APPLICATIONS_ENABLED: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      GOOGLE_TOKEN_KEY: preserve(),
    },
    volumeMounts: { "/data": data },
  });
  return project("AI Case Leads Hiring", { resources: [hub, data] });
});
