interface ClusterResult {
  clusterId: string;
  examples: string[];
  proposedIntent: string;
}

interface ToolChainProposal {
  tools: string[];
  code: string;
}

interface RouteProposal {
  path: string;
  method: string;
  handler: string;
}

interface Proposal {
  id: string;
  intent: string;
  type: 'tool' | 'route';
  payload: ToolChainProposal | RouteProposal;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
}

export class IntentDiscoveryV2 {
  private memoryManager: any;
  private codeWriter: any;
  private proposals: Proposal[] = [];
  private intentLibrary: Map<string, string[]> = new Map();

  constructor(memoryManager: any, codeWriter: any) {
    this.memoryManager = memoryManager;
    this.codeWriter = codeWriter;
  }

  async clusterQueries(queries: string[]): Promise<ClusterResult[]> {
    const clusters = new Map<string, { examples: string[]; count: number }>();
    for (const q of queries) {
      const normalized = q.toLowerCase().trim();
      const words = normalized.split(/\s+/);
      const key = words.slice(0, 3).sort().join('_');
      if (!clusters.has(key)) {
        clusters.set(key, { examples: [], count: 0 });
      }
      const cluster = clusters.get(key)!;
      if (cluster.examples.length < 5) cluster.examples.push(q);
      cluster.count++;
    }
    const results: ClusterResult[] = [];
    for (const [key, val] of clusters.entries()) {
      if (val.count < 2) continue;
      results.push({
        clusterId: `cluster_${key}`,
        examples: val.examples,
        proposedIntent: this.inferIntent(val.examples),
      });
    }
    for (const r of results) {
      this.intentLibrary.set(r.clusterId, r.examples);
    }
    return results.sort((a, b) => b.examples.length - a.examples.length);
  }

  async proposeToolChain(intent: string): Promise<ToolChainProposal> {
    const tools = this.deriveToolsFromIntent(intent);
    let code = '';
    if (tools.length > 0) {
      code = await this.codeWriter.generateTool({
        name: tools[0],
        description: intent,
        inputSchema: { query: 'string' },
        outputSchema: { result: 'string' },
      });
    }
    const proposal: Proposal = {
      id: `prop_${Date.now()}`,
      intent,
      type: 'tool',
      payload: { tools, code },
      status: 'pending',
      createdAt: new Date(),
    };
    this.proposals.push(proposal);
    return { tools, code };
  }

  async proposeRoute(intent: string): Promise<RouteProposal> {
    const { path, method } = this.deriveRouteFromIntent(intent);
    const handler = `handle${intent.replace(/\s+/g, '')}`;
    const proposal: Proposal = {
      id: `prop_${Date.now()}`,
      intent,
      type: 'route',
      payload: { path, method, handler },
      status: 'pending',
      createdAt: new Date(),
    };
    this.proposals.push(proposal);
    return { path, method, handler };
  }

  async humanApproval(proposalId: string, approve: boolean): Promise<boolean> {
    const prop = this.proposals.find(p => p.id === proposalId);
    if (!prop) return false;
    prop.status = approve ? 'approved' : 'rejected';
    return approve;
  }

  getPendingProposals(): Proposal[] {
    return this.proposals.filter(p => p.status === 'pending');
  }

  getAllProposals(): Proposal[] {
    return this.proposals;
  }

  getIntentsForCluster(clusterId: string): string[] {
    return this.intentLibrary.get(clusterId) || [];
  }

  async generateCodeFromIntent(intent: string): Promise<string> {
    const toolChain = await this.proposeToolChain(intent);
    return toolChain.code;
  }

  private inferIntent(examples: string[]): string {
    const all = examples.join(' ').toLowerCase();
    if (all.includes('earthquake') || all.includes('seismic')) return 'earthquake_alert';
    if (all.includes('weather') || all.includes('temperature')) return 'weather_forecast';
    if (all.includes('fire') || all.includes('wildfire')) return 'wildfire_detection';
    if (all.includes('flood') || all.includes('tsunami')) return 'flood_warning';
    if (all.includes('trade') || all.includes('shipping')) return 'maritime_tracking';
    return 'generic_intent';
  }

  async analyzeIntentFrequency(): Promise<Array<{ intent: string; count: number; lastSeen: Date }>> {
    const freq = new Map<string, { count: number; lastSeen: Date }>();
    for (const [clusterId, examples] of this.intentLibrary.entries()) {
      const intent = this.inferIntent(examples);
      if (!freq.has(intent)) freq.set(intent, { count: 0, lastSeen: new Date(0) });
      const entry = freq.get(intent)!;
      entry.count += examples.length;
      entry.lastSeen = new Date();
    }
    return Array.from(freq.entries()).map(([intent, data]) => ({ intent, ...data }));
  }

  async proposeRefactoring(intent: string): Promise<{ currentFiles: string[]; proposedChanges: string; estimatedImprovement: string }> {
    return {
      currentFiles: [],
      proposedChanges: `Refactor ${intent} handlers into dedicated module`,
      estimatedImprovement: '~30% latency reduction, ~20% code reduction',
    };
  }

  async proposeOptimization(pattern: string): Promise<{ pattern: string; suggestion: string; expectedGain: string }> {
    const suggestions: Record<string, { suggestion: string; expectedGain: string }> = {
      duplicate_queries: { suggestion: 'Add query result cache layer', expectedGain: '50-80% DB load reduction' },
      n_plus_one: { suggestion: 'Batch related queries', expectedGain: '60-90% latency reduction' },
      large_payloads: { suggestion: 'Add pagination and field selection', expectedGain: '70% bandwidth reduction' },
    };
    return {
      pattern,
      ...(suggestions[pattern] || { suggestion: 'Review for optimization opportunities', expectedGain: 'Unknown' }),
    };
  }

  async getInsights(): Promise<{ topIntents: string[]; pendingProposals: number; optimizationOpportunities: string[] }> {
    const freq = await this.analyzeIntentFrequency();
    freq.sort((a, b) => b.count - a.count);
    return {
      topIntents: freq.slice(0, 5).map(f => f.intent),
      pendingProposals: this.proposals.filter(p => p.status === 'pending').length,
      optimizationOpportunities: ['duplicate_queries', 'n_plus_one', 'large_payloads'],
    };
  }

  private deriveToolsFromIntent(intent: string): string[] {
    const toolMap: Record<string, string[]> = {
      earthquake_alert: ['queryEarthquakes', 'analyzeSeismicRisk'],
      weather_forecast: ['getWeather', 'forecastExtended'],
      wildfire_detection: ['detectHotspots', 'predictSpread'],
      flood_warning: ['getRainfall', 'predictInundation'],
      maritime_tracking: ['trackVessel', 'predictRoute'],
    };
    return toolMap[intent] || ['queryData'];
  }

  private deriveRouteFromIntent(intent: string): { path: string; method: string } {
    const routeMap: Record<string, { path: string; method: string }> = {
      earthquake_alert: { path: '/api/earthquakes', method: 'GET' },
      weather_forecast: { path: '/api/weather', method: 'GET' },
      wildfire_detection: { path: '/api/fires', method: 'GET' },
      flood_warning: { path: '/api/floods', method: 'GET' },
      maritime_tracking: { path: '/api/maritime', method: 'GET' },
    };
    return routeMap[intent] || { path: '/api/data', method: 'GET' };
}
}
