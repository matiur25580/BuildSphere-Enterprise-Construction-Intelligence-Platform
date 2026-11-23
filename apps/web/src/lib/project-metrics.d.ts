export function calculateProgress(completed: number, total: number): number;
export interface PortfolioProject { status: string; budget: number }
export interface PortfolioSummary { projectCount: number; activeProjects: number; totalBudget: number }
export function summarizePortfolio(projects: PortfolioProject[]): PortfolioSummary;
