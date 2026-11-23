import test from "node:test";
import assert from "node:assert/strict";
import { evaluateReadiness } from "./readiness.js";

const healthyDependencies = {
  mongodbReady: true,
  collaborationTransactionsReady: true,
  documentStorageCheck: async () => undefined,
  clamavCheck: async () => true,
};

test("readiness succeeds only when every required dependency is available", async () => {
  const result = await evaluateReadiness(healthyDependencies);

  assert.deepEqual(result, {
    ready: true,
    mongodb: "connected",
    collaborationOutboxTransactions: "enabled",
    clamav: "available",
    documentStorage: "available",
  });
});

test("readiness fails when MongoDB is disconnected", async () => {
  const result = await evaluateReadiness({ ...healthyDependencies, mongodbReady: false });

  assert.equal(result.ready, false);
  assert.equal(result.mongodb, "disconnected");
  assert.equal(result.documentStorage, "available");
  assert.equal(result.clamav, "available");
});

test("readiness fails when collaboration transactions are unavailable", async () => {
  const result = await evaluateReadiness({ ...healthyDependencies, collaborationTransactionsReady: false });

  assert.equal(result.ready, false);
  assert.equal(result.collaborationOutboxTransactions, "unavailable");
});

test("readiness fails closed when document storage throws", async () => {
  const result = await evaluateReadiness({
    ...healthyDependencies,
    documentStorageCheck: async () => {
      throw new Error("private provider credentials or endpoint details");
    },
  });

  assert.equal(result.ready, false);
  assert.equal(result.documentStorage, "unavailable");
  assert.equal(result.clamav, "available");
});

test("readiness fails closed when ClamAV is unavailable", async () => {
  const result = await evaluateReadiness({ ...healthyDependencies, clamavCheck: async () => false });

  assert.equal(result.ready, false);
  assert.equal(result.clamav, "unavailable");
});

test("readiness fails closed when ClamAV health check throws", async () => {
  const result = await evaluateReadiness({
    ...healthyDependencies,
    clamavCheck: async () => {
      throw new Error("private scanner endpoint details");
    },
  });

  assert.equal(result.ready, false);
  assert.equal(result.clamav, "unavailable");
});

test("readiness reports all failed dependencies without leaking provider errors", async () => {
  const result = await evaluateReadiness({
    mongodbReady: false,
    collaborationTransactionsReady: false,
    documentStorageCheck: async () => {
      throw new Error("private storage credentials");
    },
    clamavCheck: async () => {
      throw new Error("private scanner details");
    },
  });

  assert.deepEqual(result, {
    ready: false,
    mongodb: "disconnected",
    collaborationOutboxTransactions: "unavailable",
    clamav: "unavailable",
    documentStorage: "unavailable",
  });
});
