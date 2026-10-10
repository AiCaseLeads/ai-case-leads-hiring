import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF || "configure-project-ref-before-deploy",
  dirs: ["./tasks"],
  runtime: "node",
  maxDuration: 600,
  retries: { enabledInDev: false, default: { maxAttempts: 5, minTimeoutInMs: 5000, maxTimeoutInMs: 60000, factor: 2, randomize: true } },
});
