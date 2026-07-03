/**
 * Digital Twin Orchestrator — ties data fetching and analysis together.
 * Called by the API endpoint and the agent SSE flow.
 */

import { fetchRegionData, type RegionData } from './dataFetch';
import { runAnalysis, type AnalysisResult } from './analysis';
import type { GlobeCommand, PanelData } from '../agent';

export interface DigitalTwinResult {
  analysis: AnalysisResult;
  region: RegionData;
  commands: GlobeCommand[];
  panel: PanelData;
  text: string;
}

/**
 * Run a full digital twin analysis for a query + location.
 */
export async function analyzeDigitalTwin(
  query: string,
  location: { lat: number; lon: number; label?: string },
  radiusKm: number = 30,
): Promise<DigitalTwinResult> {
  // 1. Fetch all region data
  const region = await fetchRegionData(location, radiusKm);

  // 2. Run analysis
  const analysis = runAnalysis(query, region);

  // 3. Build text summary
  const text = [
    `## ${analysis.title}`,
    '',
    analysis.summary,
    '',
    `**Affected Area:** ${analysis.affectedAreaKm2.toFixed(1)} km²`,
    `**Population at Risk:** ${analysis.affectedPopulation.toLocaleString()}`,
    `**Risk Level:** ${analysis.riskLevel}`,
    '',
    `**Key Recommendations:**`,
    ...analysis.panelData.recommendations.map(r => `- ${r}`),
  ].join('\n');

  return {
    analysis,
    region,
    commands: analysis.globeCommands,
    panel: analysis.panelData,
    text,
  };
}
