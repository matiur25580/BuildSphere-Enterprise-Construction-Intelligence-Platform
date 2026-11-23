import test from "node:test";
import assert from "node:assert/strict";
import { evaluateReadiness } from "./readiness.js";

test("readiness succeeds only when MongoDB and document storage are available", async () => {
  const result = await evaluateReadiness({
    mongodbReady: true,
    documentStorageCheck: async () => undefined,
  });

  assert.deepEqual(result, {
    ready: true,
    mongodb: "connected",
    documentStorage: "available",
  });
});

test("readiness fails when MongoDB is disconnected even if storage is available", async () => {
  const result = await evaluateReadiness({
    mongodbReady: false,
    documentStorageCheck: async () => undefined,
  });

  assert.deepEqual(result, {
    ready: false,
    mongodb: "disconnected",
    documentStorage: "available",
  });
});

test("readiness fails closed when document storage throws", async () => {
  const result = await evaluateReadiness({
    mongodbReady: true,
    documentStorageCheck: async () => {
      throw new Error("private provider credentials or endpoint details");
    },
  });

  assert.deepEqual(result, {
    ready: false,
    mongodb: "connected",
    documentStorage: "unavailable",
  });
});

test("readiness reports both dependencies unavailable when both checks fail", async () => {
  const result = await evaluateReadiness({
    mongodbReady: false,
    documentStorageCheck: async () => {
      throw new Error("storage unavailable");
    },
  });

  assert.deepEqual(result, {
    ready: false,
    mongodb: "disconnected",
    documentStorage: "unavailable",
  });
});
