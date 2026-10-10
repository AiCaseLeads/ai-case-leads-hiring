import test from "node:test";
import assert from "node:assert/strict";
import spec, { partial } from "../../.railway/railway";
import { createRailwayContext, project, type ServiceNode, type ResourceNode } from "railway/iac";

test("Railway IaC keeps one continuously running primary, durable volume, and private configuration", async () => {
  const definition = await spec(createRailwayContext({ environmentName: "staging" }), project);
  assert.equal(partial, "ai-case-leads-hiring");
  const resources = (definition.resources || []).flat() as ResourceNode[];
  assert.equal(resources.length, 2);
  const app = resources.find(resource => resource.type === "service") as ServiceNode;
  assert.equal(app.deploy?.numReplicas, 1);
  assert.equal(app.deploy?.sleepApplication, false);
  assert.equal(app.deploy?.requiredMountPath, "/data");
  assert.equal(app.deploy?.healthcheckPath, "/api/health");
  assert.equal(app.build?.builder, "DOCKERFILE");
  assert.equal(app.volumeAttachments?.["hiring-data"]?.mountPath, "/data");
  for (const key of ["PUBLIC_SITE_ORIGIN", "APPLICATIONS_ENABLED", "EXPECTED_RECRUITING_EMAIL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY"]) {
    assert.deepEqual(app.variables?.[key], { type: "preserve" });
  }
  assert.equal(app.source, undefined);
  assert.equal(app.networking, undefined);
});
