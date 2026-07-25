const ANALYSIS_KEY = "liquid-copy.insights-analysis.v1";
const EXTRACT_KEY = "liquid-copy.insights-extract.v1";

export interface InsightsAnalysisSnapshot {
  markdown: string;
  updatedAt: string;
}

export interface InsightsExtractSnapshot {
  markdown: string;
  updatedAt: string;
}

export function loadInsightsAnalysis(): InsightsAnalysisSnapshot | null {
  try {
    const raw = localStorage.getItem(ANALYSIS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InsightsAnalysisSnapshot;
    if (!parsed?.markdown?.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveInsightsAnalysis(markdown: string): InsightsAnalysisSnapshot {
  const snapshot: InsightsAnalysisSnapshot = {
    markdown: markdown.trim(),
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(ANALYSIS_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export function loadInsightsExtract(): InsightsExtractSnapshot | null {
  try {
    const raw = localStorage.getItem(EXTRACT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InsightsExtractSnapshot;
    if (!parsed?.markdown?.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveInsightsExtract(markdown: string): InsightsExtractSnapshot {
  const snapshot: InsightsExtractSnapshot = {
    markdown: markdown.trim(),
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(EXTRACT_KEY, JSON.stringify(snapshot));
  return snapshot;
}
