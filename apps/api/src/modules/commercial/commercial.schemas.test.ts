import test from "node:test";
import assert from "node:assert/strict";
import { createCommercialRecordSchema, createCostCodeSchema } from "./commercial.schemas.js";
import { createProjectSchema } from "../projects/project.schemas.js";

const commercialRecord = {
  type: "invoice",
  reference: "INV-001",
  counterparty: "Example Supplier",
  amount: "900719925474.1234",
  currency: "inr",
  issueDate: "2026-01-01",
};

test("commercial amounts remain exact decimal strings and currency is normalized", () => {
  const parsed = createCommercialRecordSchema.parse(commercialRecord);
  assert.equal(parsed.amount, "900719925474.1234");
  assert.equal(parsed.currency, "INR");
});

test("legacy numeric amount input remains accepted for compatibility", () => {
  const parsed = createCommercialRecordSchema.parse({ ...commercialRecord, amount: 125.5 });
  assert.equal(parsed.amount, "125.5");
});

test("commercial amounts reject excess precision and unsafe exponent notation", () => {
  assert.equal(createCommercialRecordSchema.safeParse({ ...commercialRecord, amount: "1.12345" }).success, false);
  assert.equal(createCommercialRecordSchema.safeParse({ ...commercialRecord, amount: "1e6" }).success, false);
  assert.equal(createCommercialRecordSchema.safeParse({ ...commercialRecord, amount: "0.0000" }).success, false);
});

test("cost-code budgets and project budgets use decimal strings", () => {
  const code = createCostCodeSchema.parse({ code: "A-01", name: "Civil works", budget: "100000000000.0001" });
  assert.equal(code.budget, "100000000000.0001");

  const project = createProjectSchema.parse({
    code: "P-01",
    name: "Test project",
    startDate: "2026-01-01",
    targetEndDate: "2026-12-31",
    budget: "250000000000.1234",
    currency: "inr",
  });
  assert.equal(project.budget, "250000000000.1234");
  assert.equal(project.currency, "INR");
});

test("financial currency codes must contain exactly three letters", () => {
  assert.equal(createCostCodeSchema.safeParse({ code: "A-01", name: "Civil works", budget: "1", currency: "US1" }).success, false);
});
