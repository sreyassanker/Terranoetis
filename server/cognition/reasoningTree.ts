import { randomUUID } from 'crypto';

export interface ReasoningState {
  query: string;
  context: Record<string, unknown>;
  toolsCalled: string[];
  results: unknown[];
  hypotheses: string[];
  confidence: number;
  status: 'active' | 'complete' | 'failed';
}

export interface ReasoningNode {
  id: string;
  action: string;
  state: ReasoningState;
  parent: string | null;
  children: string[];
  visits: number;
  value: number;
  prior: number;
  depth: number;
}

export class ReasoningTree {
  private nodes: Map<string, ReasoningNode> = new Map();
  private rootId: string;

  constructor(rootQuery: string, context: Record<string, unknown>) {
    const rootState: ReasoningState = {
      query: rootQuery,
      context,
      toolsCalled: [],
      results: [],
      hypotheses: [],
      confidence: 0,
      status: 'active',
    };
    this.rootId = randomUUID();
    this.nodes.set(this.rootId, {
      id: this.rootId,
      action: 'root',
      state: rootState,
      parent: null,
      children: [],
      visits: 0,
      value: 0,
      prior: 1,
      depth: 0,
    });
  }

  addNode(parentId: string, action: string, state: ReasoningState): string {
    const parent = this.nodes.get(parentId);
    if (!parent) throw new Error(`Parent node ${parentId} not found`);

    const id = randomUUID();
    const node: ReasoningNode = {
      id,
      action,
      state,
      parent: parentId,
      children: [],
      visits: 0,
      value: 0,
      prior: 0,
      depth: parent.depth + 1,
    };
    this.nodes.set(id, node);
    parent.children.push(id);
    return id;
  }

  getNode(id: string): ReasoningNode | undefined {
    return this.nodes.get(id);
  }

  getRoot(): ReasoningNode {
    return this.nodes.get(this.rootId)!;
  }

  getBestPath(): ReasoningNode[] {
    const leaves = this.getAllLeaves();
    if (leaves.length === 0) return [this.getRoot()];

    const bestLeaf = leaves.reduce((best, leaf) =>
      leaf.visits > 0 && leaf.value / leaf.visits > (best.visits > 0 ? best.value / best.visits : -1)
        ? leaf
        : best,
    );

    const path: ReasoningNode[] = [];
    let current: ReasoningNode | undefined = bestLeaf;
    while (current) {
      path.unshift(current);
      current = current.parent ? this.nodes.get(current.parent) : undefined;
    }
    return path;
  }

  getAllLeaves(): ReasoningNode[] {
    const leaves: ReasoningNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.children.length === 0) {
        leaves.push(node);
      }
    }
    return leaves;
  }

  pruneNodes(threshold: number): void {
    const toRemove: string[] = [];
    for (const node of this.nodes.values()) {
      if (node.parent === null) continue;
      const avgValue = node.visits > 0 ? node.value / node.visits : 0;
      if (avgValue < threshold && node.children.length === 0) {
        toRemove.push(node.id);
      }
    }
    for (const id of toRemove) {
      const node = this.nodes.get(id);
      if (node && node.parent) {
        const parent = this.nodes.get(node.parent);
        if (parent) {
          parent.children = parent.children.filter(c => c !== id);
        }
        this.nodes.delete(id);
      }
    }
  }

  getNodeCount(): number {
    return this.nodes.size;
  }

  getAllNodes(): ReasoningNode[] {
    return Array.from(this.nodes.values());
  }

  toJSON(): object {
    return {
      rootId: this.rootId,
      nodes: Array.from(this.nodes.entries()).map(([id, node]) => ({
        id,
        action: node.action,
        state: node.state,
        parent: node.parent,
        children: node.children,
        visits: node.visits,
        value: node.value,
        prior: node.prior,
        depth: node.depth,
      })),
    };
  }

  static fromJSON(json: {
    rootId: string;
    nodes: Array<{
      id: string;
      action: string;
      state: ReasoningState;
      parent: string | null;
      children: string[];
      visits: number;
      value: number;
      prior: number;
      depth: number;
    }>;
  }): ReasoningTree {
    const tree = new ReasoningTree('', {});
    tree.rootId = json.rootId;
    tree.nodes.clear();
    for (const n of json.nodes) {
      tree.nodes.set(n.id, {
        id: n.id,
        action: n.action,
        state: n.state,
        parent: n.parent,
        children: [...n.children],
        visits: n.visits,
        value: n.value,
        prior: n.prior,
        depth: n.depth,
      });
    }
    return tree;
  }
}
