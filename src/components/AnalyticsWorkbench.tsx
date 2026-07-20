import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Search, X, ChevronDown, ChevronRight, BookOpen, Atom,
  TreePine, Mountain, Waves, Cloud,
  Satellite, Wrench, FlaskConical, MapPin, Wifi,
} from 'lucide-react';
import Panel from '@/components/ui/Panel';
import ToolDialog from '@/components/ToolDialog';
import {
  PARTS, TOTAL_EQUATIONS, TOTAL_DOMAINS, TOTAL_PARTS,
  type PartIconId, type AnalysisTool,
} from '@/data/analyticalModels';

interface AnalyticsWorkbenchProps {
  open: boolean;
  onClose: () => void;
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null;
  onToolResult?: (toolId: number, label: string, lat: number, lon: number, value?: number) => void;
  onClearResult?: () => void;
}

function getPartIcon(iconId: PartIconId): React.ReactNode {
  const icons: Record<PartIconId, React.ReactNode> = {
    atom: <Atom size={14} />, treePine: <TreePine size={14} />, waves: <Waves size={14} />,
    mountain: <Mountain size={14} />, cloud: <Cloud size={14} />, satellite: <Satellite size={14} />, wrench: <Wrench size={14} />,
  };
  return icons[iconId] ?? <Atom size={14} />;
}

export const AnalyticsWorkbench: React.FC<AnalyticsWorkbenchProps> = ({ open, onClose, bbox, onToolResult, onClearResult }) => {
  const [search, setSearch] = useState('');
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set(['part1']));
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set(['atmo']));
  const [selectedTool, setSelectedTool] = useState<AnalysisTool | null>(null);
  const [selectedColor, setSelectedColor] = useState('#8b5cf6');
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

  const filteredParts = useMemo(() => {
    if (!search.trim()) return PARTS;
    const q = search.toLowerCase();
    return PARTS.map((part) => ({
      ...part,
      domains: part.domains.map((domain) => ({
        ...domain,
        tools: domain.tools.filter((tool) => {
          const displayName = (tool.toolName || tool.name).toLowerCase();
          const keywords = tool.keywords ?? [];
          const desc = (tool.shortDescription || '').toLowerCase();
          return displayName.includes(q) || domain.name.toLowerCase().includes(q) ||
                 keywords.some(k => k.toLowerCase().includes(q)) || desc.includes(q);
        }),
      })).filter((domain) => domain.tools.length > 0),
    })).filter((part) => part.domains.length > 0);
  }, [search]);

  const totalResults = useMemo(() =>
    filteredParts.reduce((s, p) => s + p.domains.reduce((d, dom) => d + dom.tools.length, 0), 0),
  [filteredParts]);

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', top: 60, right: 10, bottom: 56, zIndex: 999, width: 440, maxWidth: 'calc(100vw - 32px)' }}>
      <Panel title="ANALYTICS WORKBENCH" icon={<FlaskConical size={16} />} accentColor="#8b5cf6" iconColor="#a78bfa" titleColor="#c4b5fd" onClose={onClose} style={{ height: '100%', animation: 'slideInRight 0.25s ease' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(139,92,246,0.2)' }}>
            <Search size={12} color="#64748b" />
            <input ref={searchInputRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tools, keywords, domains..." style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#e2e8f0', fontSize: 12, fontFamily: 'Space Grotesk, sans-serif' }} />
            {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 2, display: 'flex' }}><X size={12} /></button>}
          </div>
        </div>

        <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Wifi size={10} />{search ? `${totalResults} of ${TOTAL_EQUATIONS} tools` : `${TOTAL_EQUATIONS} tools · ${TOTAL_DOMAINS} domains · ${TOTAL_PARTS} categories`}
          </div>
          <div style={{ fontSize: 9, color: '#8b5cf6', background: 'rgba(139,92,246,0.1)', padding: '2px 6px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace' }}>TOOLS</div>
        </div>

        {selectedTool ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            <button onClick={() => setSelectedTool(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8b5cf6', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8, padding: 0 }}>
              <ChevronDown size={10} style={{ transform: 'rotate(90deg)' }} /> Back to tools
            </button>
            <ToolDialog tool={selectedTool} color={selectedColor} onClose={() => setSelectedTool(null)} bbox={bbox} onToolResult={onToolResult} onClearResult={onClearResult} />
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
            <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px);} to { opacity: 1; transform: translateY(0);} } @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>

            {filteredParts.map((part) => {
              const partToolCount = part.domains.reduce((s, d) => s + d.tools.length, 0);
              const isPartExpanded = expandedParts.has(part.id) || !!search.trim();
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
                        const isDomainExpanded = expandedDomains.has(domain.id) || !!search.trim();
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
                                  return (
                                    <div key={tool.id} onClick={() => openTool(tool, domain.color)}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                                        borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
                                        border: '1px solid transparent',
                                      }}
                                      onMouseEnter={(e) => { e.currentTarget.style.background = `${domain.color}08`; e.currentTarget.style.borderColor = `${domain.color}20`; }}
                                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}>
                                      <MapPin size={10} color={domain.color} style={{ flexShrink: 0 }} />
                                      <div style={{ flex: 1, fontSize: 11, color: '#cbd5e1', lineHeight: 1.3 }}>{displayName}</div>
                                      <span style={{ fontSize: 9, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>#{tool.id}</span>
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
            })}

            {filteredParts.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
                <Search size={24} style={{ marginBottom: 8, opacity: 0.3 }} />
                <div style={{ fontSize: 12 }}>No tools match "{search}"</div>
                <div style={{ fontSize: 10, marginTop: 4, color: '#475569' }}>Try searching by tool name, keyword, or domain</div>
              </div>
            )}
          </div>
        )}

        <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 9, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}><FlaskConical size={9} /> All tools non-ML, peer-reviewed</div>
          <div style={{ fontSize: 9, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>{TOTAL_EQUATIONS} verified</div>
        </div>
      </Panel>
    </div>
  );
};
