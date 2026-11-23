import test from "node:test";
import assert from "node:assert/strict";
import { collaborationRetryDelay, notificationOwnerScope, projectActivityScope, projectMemberScope } from "./collaboration.service.js";
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

test("project membership scope is tenant and project scoped, with optional user", () => {
  const scope = projectMemberScope("64b000000000000000000001", "64b000000000000000000003", "64b000000000000000000002");
  assert.equal(String(scope.organizationId), "64b000000000000000000001");
  assert.equal(String(scope.projectId), "64b000000000000000000003");
  assert.equal(String(scope.userId), "64b000000000000000000002");
});

test("outbox retry delay grows exponentially and is capped at one hour", () => {
  assert.equal(collaborationRetryDelay(1), 60_000);
  assert.equal(collaborationRetryDelay(2), 120_000);
  assert.equal(collaborationRetryDelay(8), 3_600_000);
  assert.equal(collaborationRetryDelay(20), 3_600_000);
});
