import test from "node:test";
import assert from "node:assert/strict";
import { createRequestId, isAllowedOrigin, parseAllowedOrigins, parseTrustProxy } from "./security.js";

test("parses a comma-separated CORS allowlist", () => {
  assert.deepEqual(parseAllowedOrigins("https://app.example.com, https://admin.example.com"), [
    "https://app.example.com", "https://admin.example.com",
  ]);
});

test("allows server-to-server requests and only configured browser origins", () => {
  const allowed = parseAllowedOrigins("https://app.example.com");
  assert.equal(isAllowedOrigin(undefined, allowed), true);
  assert.equal(isAllowedOrigin("https://app.example.com", allowed), true);
  assert.equal(isAllowedOrigin("https://attacker.example", allowed), false);
});

test("parses explicit reverse-proxy trust settings", () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy("true"), true);
  assert.equal(parseTrustProxy("2"), 2);
  assert.throws(() => parseTrustProxy("many"));
});

test("creates unique UUID request identifiers", () => {
  const first = createRequestId();
  const second = createRequestId();
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
});
