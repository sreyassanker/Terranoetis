import React, { useState, useCallback, useRef } from 'react';

interface CanvasNode {
  id: string;
  type: 'datasource' | 'filter' | 'analysis' | 'visualization';
  label: string;
  x: number;
  y: number;
  inputs: string[];
  outputs: string[];
  config: Record<string, unknown>;
}

interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  fromPort: string;
  toPort: string;
}

type ToolDef = CanvasNode['type'];

const NODE_DEFAULTS: Record<ToolDef, Omit<CanvasNode, 'id' | 'x' | 'y'>> = {
  datasource: { type: 'datasource', label: 'Data Source', inputs: [], outputs: ['data'], config: { source: '', query: '' } },
  filter: { type: 'filter', label: 'Filter', inputs: ['data'], outputs: ['data'], config: { condition: '' } },
  analysis: { type: 'analysis', label: 'Analysis', inputs: ['data'], outputs: ['result'], config: { method: '' } },
  visualization: { type: 'visualization', label: 'Visualization', inputs: ['result'], outputs: [], config: { type: 'map' } },
};

const NODE_COLORS: Record<ToolDef, string> = {
  datasource: '#3b82f6',
  filter: '#f59e0b',
  analysis: '#10b981',
  visualization: '#8b5cf6',
};

const SpatialCanvas: React.FC = () => {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dragType, setDragType] = useState<ToolDef | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  const addNode = useCallback((type: ToolDef, x: number, y: number) => {
    const defaults = NODE_DEFAULTS[type];
    const node: CanvasNode = {
      id: `node_${nextId.current++}`,
      ...defaults,
      x,
      y,
    };
    setNodes(prev => [...prev, node]);
  }, []);

  const removeNode = useCallback((id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id));
    setEdges(prev => prev.filter(e => e.from !== id && e.to !== id));
    setSelectedNode(null);
  }, []);

  const updateNodeConfig = useCallback((id: string, config: Record<string, unknown>) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, config: { ...n.config, ...config } } : n));
  }, []);

  const addEdge = useCallback((from: string, to: string) => {
    const edge: CanvasEdge = {
      id: `edge_${nextId.current++}`,
      from,
      to,
      fromPort: 'out',
      toPort: 'in',
    };
    setEdges(prev => [...prev, edge]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!dragType || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - 75;
    const y = e.clientY - rect.top - 30;
    addNode(dragType, x, y);
    setDragType(null);
  }, [dragType, addNode]);

  const exportChain = useCallback(() => {
    const chain = {
      version: '2.0',
      nodes: nodes.map(n => ({ id: n.id, type: n.type, config: n.config })),
      edges: edges.map(e => ({ from: e.from, to: e.to })),
    };
    const blob = new Blob([JSON.stringify(chain, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `toolchain_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges]);

  const executeChain = useCallback(async () => {
    const results: Record<string, unknown> = {};
    for (const node of nodes) {
      results[node.id] = { status: 'executed', type: node.type, config: node.config };
    }
    console.log('Chain execution results:', results);
  }, [nodes]);

  return (
    <div className="spatial-canvas">
      <div className="canvas-toolbar">
        {(['datasource', 'filter', 'analysis', 'visualization'] as ToolDef[]).map(type => (
          <div
            key={type}
            className="toolbar-item"
            draggable
            onDragStart={() => setDragType(type)}
            style={{ borderColor: NODE_COLORS[type] }}
          >
            <span className="toolbar-dot" style={{ background: NODE_COLORS[type] }} />
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </div>
        ))}
        <div className="toolbar-spacer" />
        <button className="canvas-btn execute-btn" onClick={executeChain} disabled={nodes.length === 0}>
          ▶ Execute
        </button>
        <button className="canvas-btn export-btn" onClick={exportChain} disabled={nodes.length === 0}>
          ⬇ Export
        </button>
        <button className="canvas-btn clear-btn" onClick={() => { setNodes([]); setEdges([]); }} disabled={nodes.length === 0}>
          ✕ Clear
        </button>
      </div>

      <div
        ref={canvasRef}
        className="canvas-area"
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
      >
        {nodes.length === 0 && (
          <div className="canvas-empty">
            Drag tools from the toolbar to build your analysis pipeline
          </div>
        )}
        {nodes.map(node => (
          <div
            key={node.id}
            className={`canvas-node ${selectedNode === node.id ? 'selected' : ''}`}
            style={{ left: node.x, top: node.y, borderColor: NODE_COLORS[node.type] }}
            onClick={() => setSelectedNode(node.id)}
          >
            <div className="node-header" style={{ background: NODE_COLORS[node.type] }}>
              <span className="node-type">{node.type}</span>
              <button className="node-close" onClick={e => { e.stopPropagation(); removeNode(node.id); }}>×</button>
            </div>
            <div className="node-body">
              <div className="node-label">{node.label}</div>
              {node.inputs.length > 0 && (
                <div className="node-ports">
                  {node.inputs.map(p => <span key={p} className="port-input">{p}</span>)}
                </div>
              )}
              {node.outputs.length > 0 && (
                <div className="node-ports">
                  {node.outputs.map(p => <span key={p} className="port-output">{p}</span>)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .spatial-canvas { display: flex; flex-direction: column; height: 100%; background: #0f172a; }
        .canvas-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: #1e293b; border-bottom: 1px solid #334155; }
        .toolbar-item { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; cursor: grab; font-size: 12px; }
        .toolbar-item:active { cursor: grabbing; }
        .toolbar-dot { width: 8px; height: 8px; border-radius: 50%; }
        .toolbar-spacer { flex: 1; }
        .canvas-btn { padding: 6px 12px; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; }
        .execute-btn { background: #10b981; color: white; }
        .export-btn { background: #3b82f6; color: white; }
        .clear-btn { background: transparent; color: #94a3b8; border: 1px solid #334155; }
        .canvas-btn:disabled { opacity: 0.4; cursor: default; }
        .canvas-area { flex: 1; position: relative; overflow: auto; }
        .canvas-empty { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #475569; font-size: 14px; text-align: center; }
        .canvas-node { position: absolute; width: 180px; border: 2px solid; border-radius: 8px; overflow: hidden; cursor: pointer; background: #1e293b; }
        .canvas-node.selected { box-shadow: 0 0 16px rgba(59, 130, 246, 0.4); }
        .node-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; color: white; font-size: 11px; font-weight: 600; text-transform: uppercase; }
        .node-close { background: none; border: none; color: rgba(255,255,255,0.6); cursor: pointer; font-size: 14px; padding: 0 2px; }
        .node-body { padding: 8px; }
        .node-label { font-size: 13px; color: #e2e8f0; margin-bottom: 6px; }
        .node-ports { display: flex; gap: 4px; flex-wrap: wrap; }
        .port-input, .port-output { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #334155; color: #94a3b8; }
      `}</style>
    </div>
  );
};

export default SpatialCanvas;
