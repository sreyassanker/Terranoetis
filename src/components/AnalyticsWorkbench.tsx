import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Search, X, ChevronDown, ChevronRight, Atom,
  TreePine, Mountain, Waves, Cloud,
  Satellite, Wrench, FlaskConical, MapPin, Wifi,
  Calculator, Database, Layers, Zap,
} from 'lucide-react';
import Panel from '@/components/ui/Panel';
import ToolDialog, { type ToolGrid } from '@/components/ToolDialog';
import {
  PARTS, TOTAL_EQUATIONS, TOTAL_DOMAINS,
  type PartIconId, type AnalysisTool, type Domain,
} from '@/data/analyticalModels';

interface AnalyticsWorkbenchProps {
  open: boolean;
  onClose: () => void;
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null;
  polygon?: Array<Array<[number, number]>>;
  points?: Array<{ lat: number; lon: number }>;
  onToolResult?: (
    toolId: number, label: string, lat: number, lon: number,
    value?: number, grid?: ToolGrid, unit?: string,
  ) => void;
  onClearResult?: () => void;
  zIndex?: number;
}

function getPartIcon(iconId: PartIconId): React.ReactNode {
  const icons: Record<PartIconId, React.ReactNode> = {
    atom: <Atom size={14} />, treePine: <TreePine size={14} />, waves: <Waves size={14} />,
    mountain: <Mountain size={14} />, cloud: <Cloud size={14} />, satellite: <Satellite size={14} />, wrench: <Wrench size={14} />,
  };
  return icons[iconId] ?? <Atom size={14} />;
}

/** Flatten all tools from all parts/domains for search. */
function flattenTools(): Array<{ tool: AnalysisTool; domain: Domain; partColor: string }> {
  const out: Array<{ tool: AnalysisTool; domain: Domain; partColor: string }> = [];
  for (const part of PARTS) {
    for (const domain of part.domains) {
      for (const tool of domain.tools) {
        out.push({ tool, domain, partColor: part.color });
      }
    }
  }
  return out;
}

const ALL_TOOLS = flattenTools();

/** Collect all unique domain names for the filter dropdown. */
const ALL_DOMAIN_NAMES = Array.from(new Set(PARTS.flatMap(p => p.domains.map(d => d.name)))).sort();

export const AnalyticsWorkbench: React.FC<AnalyticsWorkbenchProps> = ({ open, onClose, bbox, polygon, points, onToolResult, onClearResult, zIndex = 999 }) => {
  const [search, setSearch] = useState('');
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set(['part1']));
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set(['atmo']));
  const [selectedTool, setSelectedTool] = useState<AnalysisTool | null>(null);
  const [selectedColor, setSelectedColor] = useState('#8b5cf6');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'tree' | 'flat'>('tree');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open && searchInputRef.current) setTimeout(() => searchInputRef.current?.focus(), 200); }, [open]);
  const handleKeyDown = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') { if (selectedTool) setSelectedTool(null); else onClose(); } }, [onClose, selectedTool]);
  useEffect(() => { if (open) window.addEventListener('keydown', handleKeyDown); return () => window.removeEventListener('keydown', handleKeyDown); }, [open, handleKeyDown]);

  const togglePart = useCallback((partId: string) => setExpandedParts((prev) => {
    const n = new Set(prev);
    if (n.has(partId)) n.delete(partId); else n.add(partId);
    return n;
  }), []);

  const toggleDomain = useCallback((domainId: string) => setExpandedDomains((prev) => {
    const n = new Set(prev);
    if (n.has(domainId)) n.delete(domainId); else n.add(domainId);
    return n;
  }), []);

  const openTool = useCallback((tool: AnalysisTool, color: string) => {
    setSelectedTool(tool);
    setSelectedColor(color);
  }, []);

  const hasSearch = !!search.trim();
  const q = search.toLowerCase();

  const filteredParts = useMemo(() => {
    let parts = PARTS;
    if (domainFilter !== 'all') {
      parts = PARTS.map(p => ({
        ...p,
        domains: p.domains.filter(d => d.name === domainFilter),
      })).filter(p => p.domains.length > 0);
    }
    if (!hasSearch) return parts;
    return parts.map((part) => ({
      ...part,
      domains: part.domains.map((domain) => ({
        ...domain,
        tools: domain.tools.filter((tool) => {
          const displayName = (tool.toolName || tool.name).toLowerCase();
          const keywords = tool.keywords ?? [];
          const desc = (tool.shortDescription || '').toLowerCase();
          const eq = (tool.equation || '').toLowerCase();
          return displayName.includes(q) || domain.name.toLowerCase().includes(q) ||
                 keywords.some(k => k.toLowerCase().includes(q)) || desc.includes(q) || eq.includes(q);
        }),
      })).filter((domain) => domain.tools.length > 0),
    })).filter((part) => part.domains.length > 0);
  }, [domainFilter, hasSearch, q]);

  const flatFiltered = useMemo(() => {
    if (viewMode !== 'flat' && !hasSearch) return [];
    return ALL_TOOLS.filter(({ tool, domain }) => {
      if (domainFilter !== 'all' && domain.name !== domainFilter) return false;
      if (!hasSearch) return true;
      const displayName = (tool.toolName || tool.name).toLowerCase();
      const keywords = tool.keywords ?? [];
      const desc = (tool.shortDescription || '').toLowerCase();
      const eq = (tool.equation || '').toLowerCase();
      return displayName.includes(q) || domain.name.toLowerCase().includes(q) ||
             keywords.some(k => k.toLowerCase().includes(q)) || desc.includes(q) || eq.includes(q);
    });
  }, [viewMode, hasSearch, q, domainFilter]);

  const totalResults = useMemo(() =>
    filteredParts.reduce((s, p) => s + p.domains.reduce((d, dom) => d + dom.tools.length, 0), 0),
  [filteredParts]);

  if (!open) return null;

  const hasBbox = !!bbox;

  return (
    <div style={{ position: 'fixed', top: 60, right: 10, bottom: 56, zIndex, width: 440, maxWidth: 'calc(100vw - 32px)' }}>
      <Panel title="ANALYTICS WORKBENCH" icon={<FlaskConical size={16} />} accentColor="#8b5cf6" iconColor="#a78bfa" titleColor="#c4b5fd" onClose={onClose} style={{ height: '100%', animation: 'slideInRight 0.25s ease' }}>
        {/* Search Bar */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(139,92,246,0.2)' }}>
            <Search size={12} color="#64748b" />
            <input ref={searchInputRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tools, equations, keywords..." style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#e2e8f0', fontSize: 12, fontFamily: 'Inter, sans-serif' }} />
            {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 2, display: 'flex' }}><X size={12} /></button>}
          </div>
        </div>

        {/* Toolbar: domain filter + view toggle + stats */}
        <div style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Wifi size={10} />
            {hasSearch ? `${totalResults} of ${TOTAL_EQUATIONS}` : `${TOTAL_EQUATIONS} tools`}
            {!hasBbox && <span style={{ color: '#f59e0b' }} title="No study area active — using default location">· no study area</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}
              style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(139,92,246,0.2)', color: '#94a3b8', outline: 'none' }}>
              <option value="all">All domains</option>
              {ALL_DOMAIN_NAMES.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
              <button onClick={() => setViewMode('tree')} style={{ padding: '2px 6px', fontSize: 9, cursor: 'pointer', border: 'none', background: viewMode === 'tree' ? 'rgba(139,92,246,0.2)' : 'transparent', color: viewMode === 'tree' ? '#a78bfa' : '#64748b' }} title="Tree view">
                <Layers size={11} />
              </button>
              <button onClick={() => setViewMode('flat')} style={{ padding: '2px 6px', fontSize: 9, cursor: 'pointer', border: 'none', background: viewMode === 'flat' ? 'rgba(139,92,246,0.2)' : 'transparent', color: viewMode === 'flat' ? '#a78bfa' : '#64748b' }} title="Flat list view">
                <Calculator size={11} />
              </button>
            </div>
          </div>
        </div>

        {selectedTool ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            <button onClick={() => setSelectedTool(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8b5cf6', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8, padding: 0 }}>
              <ChevronDown size={10} style={{ transform: 'rotate(90deg)' }} /> Back to tools
            </button>
            <ToolDialog tool={selectedTool} color={selectedColor} onClose={() => setSelectedTool(null)} bbox={bbox} polygon={polygon} points={points} onToolResult={onToolResult} onClearResult={onClearResult} />
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
            <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px);} to { opacity: 1; transform: translateY(0);} } @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>

            {(viewMode === 'flat' || hasSearch) && flatFiltered.length > 0 ? (
              /* Flat list view — search results */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {flatFiltered.map(({ tool, domain }) => {
                  const displayName = tool.toolName || tool.name;
                  const dataSources = tool.analysisMeta?.autoDataSources ?? [];
                  return (
                    <div key={tool.id} onClick={() => openTool(tool, domain.color)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px',
                        borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
                        border: '1px solid transparent',
                        background: 'rgba(255,255,255,0.02)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = `${domain.color}08`; e.currentTarget.style.borderColor = `${domain.color}20`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'transparent'; }}>
                      <div style={{ width: 24, height: 24, borderRadius: 6, background: `${domain.color}15`, border: `1px solid ${domain.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <MapPin size={10} color={domain.color} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
                          <span style={{ fontSize: 8, color: '#475569', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>#{tool.id}</span>
                        </div>
                        {tool.equation && (
                          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: domain.color, opacity: 0.7, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.equation}</div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                          <span style={{ fontSize: 8, color: '#475569' }}>{domain.name}</span>
                          {dataSources.length > 0 && (
                            <span style={{ fontSize: 7, color: '#86efac', display: 'flex', alignItems: 'center', gap: 2 }}>
                              <Database size={7} /> {dataSources.length} live source{dataSources.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Tree view — Parts → Domains → Tools */
              filteredParts.map((part) => {
                const partToolCount = part.domains.reduce((s, d) => s + d.tools.length, 0);
                const isPartExpanded = expandedParts.has(part.id) || hasSearch;
                return (
                  <div key={part.id} style={{ marginBottom: 6 }}>
                    <div onClick={() => togglePart(part.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: isPartExpanded ? `${part.color}10` : 'rgba(255,255,255,0.03)', border: `1px solid ${isPartExpanded ? `${part.color}30` : 'rgba(255,255,255,0.06)'}`, transition: 'all 0.15s', marginBottom: isPartExpanded ? 6 : 2 }}>
                      {isPartExpanded ? <ChevronDown size={12} color={part.color} /> : <ChevronRight size={12} color="#475569" />}
                      <div style={{ color: part.color, flexShrink: 0 }}>{getPartIcon(part.iconId)}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: part.color, background: `${part.color}15`, padding: '1px 5px', borderRadius: 3 }}>{part.label}</span>{part.title}
                        </div>
                      </div>
                      <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'JetBrains Mono, monospace', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>{partToolCount}</span>
                    </div>

                    {isPartExpanded && (
                      <div style={{ paddingLeft: 8 }}>
                        {part.domains.map((domain) => {
                          const isDomainExpanded = expandedDomains.has(domain.id) || hasSearch;
                          return (
                            <div key={domain.id} style={{ marginBottom: 4 }}>
                              <div onClick={() => toggleDomain(domain.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, cursor: 'pointer' }}>
                                {isDomainExpanded ? <ChevronDown size={10} color={domain.color} /> : <ChevronRight size={10} color="#475569" />}
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: domain.color, flexShrink: 0 }} />
                                <div style={{ flex: 1, fontSize: 11, fontWeight: 500, color: '#94a3b8' }}>{domain.name}</div>
                                <span style={{ fontSize: 9, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>{domain.tools.length}</span>
                              </div>
                              {isDomainExpanded && (
                                <div style={{ paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  {domain.tools.map((tool) => {
                                    const displayName = tool.toolName || tool.name;
                                    const dataSources = tool.analysisMeta?.autoDataSources ?? [];
                                    return (
                                      <div key={tool.id} onClick={() => openTool(tool, domain.color)}
                                        style={{
                                          display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px',
                                          borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
                                          border: '1px solid transparent',
                                        }}
                                        onMouseEnter={(e) => { e.currentTarget.style.background = `${domain.color}08`; e.currentTarget.style.borderColor = `${domain.color}20`; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}>
                                        <MapPin size={10} color={domain.color} style={{ flexShrink: 0, marginTop: 2 }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <span style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.3, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
                                            <span style={{ fontSize: 9, color: '#475569', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>#{tool.id}</span>
                                          </div>
                                          {tool.equation && (
                                            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: domain.color, opacity: 0.6, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.equation}</div>
                                          )}
                                          {dataSources.length > 0 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                                              <Database size={7} color="#22c55e" />
                                              <span style={{ fontSize: 7, color: '#22c55e', opacity: 0.7 }}>{dataSources.length} live source{dataSources.length > 1 ? 's' : ''}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {filteredParts.length === 0 && flatFiltered.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
                <Search size={24} style={{ marginBottom: 8, opacity: 0.3 }} />
                <div style={{ fontSize: 12 }}>No tools match "{search}"</div>
                <div style={{ fontSize: 10, marginTop: 4, color: '#475569' }}>Try searching by tool name, equation, keyword, or domain</div>
              </div>
            )}
          </div>
        )}

        <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 9, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}><FlaskConical size={9} /> All tools non-ML, peer-reviewed</div>
          <div style={{ fontSize: 9, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Zap size={9} /> {TOTAL_EQUATIONS} verified · {TOTAL_DOMAINS} domains
          </div>
        </div>
      </Panel>
    </div>
  );
};
