import test from "node:test";
import assert from "node:assert/strict";
import { rankEvidence, scoreBudgetRisk, scoreQualityRisk, scoreSafetyRisk, scoreScheduleRisk } from "./intelligence.rules.js";

test("schedule risk increases with overdue and blocked work", () => {
  assert.equal(scoreScheduleRisk(0, 0, 0, true), 0);
  assert.ok(scoreScheduleRisk(2, 1, 35, true) > scoreScheduleRisk(0, 0, 0, true));
  assert.equal(scoreScheduleRisk(10, 10, 100, true), 100);
  assert.equal(scoreScheduleRisk(10, 10, 100, false), 0);
});
test("budget risk uses explicit commitment thresholds", () => {
  assert.equal(scoreBudgetRisk(0.5, true), 10);
  assert.equal(scoreBudgetRisk(0.8, true), 65);
  assert.equal(scoreBudgetRisk(1.1, true), 100);
  assert.equal(scoreBudgetRisk(1.1, false), 0);
});
test("quality and safety scoring prioritize severe records", () => {
  assert.ok(scoreQualityRisk(1, 0, 0, 0) > scoreQualityRisk(0, 0, 1, 0));
  assert.equal(scoreQualityRisk(5, 0, 0, 0), 100);
  assert.ok(scoreSafetyRisk(1, 0, 0) > scoreSafetyRisk(0, 0, 2));
});
test("evidence ranking matches source fields and prioritizes multiple matches", () => {
  const records = [
    { id: "a", sourceType: "work_item", reference: "T-1", title: "Overdue concrete pour", status: "blocked", severity: "high", date: "2026-11-20", summary: "Concrete task is overdue" },
    { id: "b", sourceType: "ncr", reference: "NCR-2", title: "Concrete quality", status: "open", severity: "major", date: "2026-11-22", summary: "Concrete surface defect" },
    { id: "c", sourceType: "safety_event", reference: "SAFE-3", title: "Access hazard", status: "reported", severity: "low", date: "2026-11-21", summary: "Temporary access obstruction" },
  ];
  const result = rankEvidence("show concrete overdue", records);
  assert.equal(result.scored[0]?.item.id, "a");
  assert.equal(result.scored.length, 2);
  assert.equal(rankEvidence("tell me about the moon", records).scored.length, 0);
});
