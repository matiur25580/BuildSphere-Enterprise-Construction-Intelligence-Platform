import test from "node:test";
import assert from "node:assert/strict";
import { notificationOwnerScope, projectActivityScope } from "./collaboration.service.js";
import { collaborationEventTypes } from "./collaboration.models.js";

test("notification scope always includes both authenticated tenant and recipient", () => {
  const scope = notificationOwnerScope("64b000000000000000000001", "64b000000000000000000002");
  assert.deepEqual(Object.keys(scope).sort(), ["organizationId", "recipientId"]);
  assert.equal(String(scope.organizationId), "64b000000000000000000001");
  assert.equal(String(scope.recipientId), "64b000000000000000000002");
});

test("activity scope always includes tenant and project", () => {
  const scope = projectActivityScope("64b000000000000000000001", "64b000000000000000000003");
  assert.equal(String(scope.organizationId), "64b000000000000000000001");
  assert.equal(String(scope.projectId), "64b000000000000000000003");
});

test("collaboration events are restricted to the declared event allowlist", () => {
  assert.ok(collaborationEventTypes.includes("documents.approval_changed"));
  assert.equal(collaborationEventTypes.includes("arbitrary.admin_export" as never), false);
});
