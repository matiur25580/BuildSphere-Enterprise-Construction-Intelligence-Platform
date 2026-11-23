import test from "node:test";
import assert from "node:assert/strict";
import { calculateProgress, summarizePortfolio } from "./project-metrics.js";

test("calculateProgress returns rounded completion percentage", () => {
  assert.equal(calculateProgress(1, 3), 33);
  assert.equal(calculateProgress(2, 3), 67);
  assert.equal(calculateProgress(4, 4), 100);
});

test("calculateProgress safely handles empty or invalid totals", () => {
  assert.equal(calculateProgress(0, 0), 0);
  assert.equal(calculateProgress(4, -1), 0);
  assert.equal(calculateProgress(Number.NaN, 4), 0);
  assert.equal(calculateProgress(2, Number.POSITIVE_INFINITY), 0);
});

test("calculateProgress clamps out-of-range completion values", () => {
  assert.equal(calculateProgress(5, 4), 100);
  assert.equal(calculateProgress(-1, 4), 0);
});

test("summarizePortfolio counts projects, active projects and budgets", () => {
  assert.deepEqual(summarizePortfolio([
    { status: "active", budget: 1200 },
    { status: "completed", budget: 800 },
    { status: "active", budget: 500 },
  ]), { projectCount: 3, activeProjects: 2, totalBudget: 2500 });
});

test("summarizePortfolio handles empty portfolios and invalid budgets", () => {
  assert.deepEqual(summarizePortfolio([]), { projectCount: 0, activeProjects: 0, totalBudget: 0 });
  assert.deepEqual(summarizePortfolio([
    { status: "planning", budget: Number.NaN },
    { status: "active", budget: 10 },
  ]), { projectCount: 2, activeProjects: 1, totalBudget: 10 });
});
