export type EvidenceRecord = { id: string; sourceType: string; reference: string; title: string; status: string; severity: string; date: string; summary: string };
const stopWords = new Set(["what","when","where","which","who","whom","does","did","have","has","with","from","that","this","there","their","about","show","tell","give","please","project","current","latest","are","the","and","for","how","can","could","any","all","list","me"]);
export const scoreScheduleRisk = (overdue: number, blocked: number, scheduleGap: number, hasTasks: boolean) => hasTasks ? Math.min(100, overdue * 18 + blocked * 14 + Math.max(0, scheduleGap - 10) * 1.2) : 0;
export const scoreBudgetRisk = (commitmentRatio: number, hasBudget: boolean) => !hasBudget ? 0 : commitmentRatio >= 1 ? 100 : commitmentRatio >= .9 ? 85 : commitmentRatio >= .8 ? 65 : commitmentRatio >= .65 ? 40 : 10;
export const scoreQualityRisk = (criticalNcrs: number, majorNcrs: number, otherOpenNcrs: number, failedInspections: number) => Math.min(100, criticalNcrs * 38 + majorNcrs * 22 + otherOpenNcrs * 8 + failedInspections * 12);
export const scoreSafetyRisk = (critical: number, high: number, otherOpen: number) => Math.min(100, critical * 50 + high * 28 + otherOpen * 7);
export function rankEvidence(question: string, evidence: EvidenceRecord[]) {
  const tokens = question.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((token) => !stopWords.has(token)) ?? [];
  const scored = evidence.map((item) => { const haystack = `${item.sourceType} ${item.reference} ${item.title} ${item.status} ${item.severity} ${item.summary}`.toLowerCase(); const matches = tokens.filter((token) => haystack.includes(token)); return { item, score: matches.length, matches }; }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score || b.item.date.localeCompare(a.item.date)).slice(0, 8);
  return { tokens, scored };
}
