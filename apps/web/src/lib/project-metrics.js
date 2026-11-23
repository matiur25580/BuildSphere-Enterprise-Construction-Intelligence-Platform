/** Pure portfolio calculations shared by the dashboard and unit tests. */
export function calculateProgress(completed, total) {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round(Math.min(100, Math.max(0, (completed / total) * 100)));
}

export function summarizePortfolio(projects) {
  return projects.reduce((summary, project) => ({
    projectCount: summary.projectCount + 1,
    activeProjects: summary.activeProjects + (project.status === "active" ? 1 : 0),
    totalBudget: summary.totalBudget + (Number.isFinite(project.budget) ? project.budget : 0),
  }), { projectCount: 0, activeProjects: 0, totalBudget: 0 });
}
