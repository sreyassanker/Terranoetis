import React, { useState, useCallback } from 'react';
import { Shield, Cloud, DollarSign, Loader2, RefreshCw, Thermometer, AlertTriangle } from 'lucide-react';
import Panel from '@/components/ui/Panel';

type Tab = 'security' | 'environmental' | 'financial' | 'climate' | 'niche';

const TABS: { id: Tab; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'security', label: 'Security', icon: <Shield size={12} />, color: '#ef4444' },
  { id: 'environmental', label: 'Environmental', icon: <Cloud size={12} />, color: '#22c55e' },
  { id: 'financial', label: 'Financial', icon: <DollarSign size={12} />, color: '#f59e0b' },
  { id: 'climate', label: 'Climate', icon: <Thermometer size={12} />, color: '#0ea5e9' },
  { id: 'niche', label: 'Niche', icon: <AlertTriangle size={12} />, color: '#a855f7' },
];

function renderJson(data: unknown): React.ReactNode {
  if (data == null) return <span style={{color:'#64748b',fontSize:10}}>—</span>;
  if (typeof data === 'object') {
    if (Array.isArray(data)) return <div style={{display:'flex',flexDirection:'column',gap:4}}>{data.map((item,i) => <div key={i} style={{padding:'6px 8px',background:'rgba(255,255,255,0.03)',borderRadius:4,border:'1px solid rgba(255,255,255,0.06)'}}>{renderJson(item)}</div>)}</div>;
    const entries = Object.entries(data as Record<string,unknown>).filter(([k]) => !k.startsWith('_'));
    return <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'3px 10px',fontSize:10}}>{entries.map(([k,v]) => <React.Fragment key={k}><span style={{color:'#64748b',whiteSpace:'nowrap'}}>{k.replace(/([A-Z])/g,' $1').trim()}</span><span style={{color:'#e2e8f0'}}>{renderJson(v)}</span></React.Fragment>)}</div>;
  }
  if (typeof data === 'boolean') return <span style={{color:data?'#22c55e':'#ef4444',fontSize:10}}>{String(data)}</span>;
  return <span style={{color:'#e2e8f0',fontSize:10}}>{String(data)}</span>;
}

export function DataSourcesPanel({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState<Tab>('security');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(null);
  const [lastAction, setLastAction] = useState<string>('');

  const [ipAddress, setIpAddress] = useState('8.8.8.8');
  const [fredSeries, setFredSeries] = useState('GDP');

  const api = useCallback(async (path: string) => {
    setLoading(true); setError(null); setLastAction(path);
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0,200)}`);
      setData(await res.json());
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, []);

  const tabColor = TABS.find(t => t.id === tab)?.color || '#64748b';

  return (
    <div style={{position:'absolute',top:60,right:10,zIndex:1000,width:380}}>
      <Panel title="DATA SOURCES" icon={TABS.find(t=>t.id===tab)?.icon} accentColor={tabColor} onClose={onClose}>
        <div style={{display:'flex',borderBottom:`1px solid ${tabColor}20`}}>
              {TABS.map(t => (
                <button key={t.id} onClick={()=>{setTab(t.id);setData(null);setError(null);}}
                  style={{flex:1,padding:'6px 4px',border:'none',cursor:'pointer',background:tab===t.id?`${t.color}20`:'transparent',color:tab===t.id?t.color:'#64748b',fontSize:8,display:'flex',alignItems:'center',justifyContent:'center',gap:4,borderBottom:tab===t.id?`2px solid ${t.color}`:'2px solid transparent'}}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {/* Security tab */}
            {tab === 'security' && (
              <>
                <div style={{padding:'8px 14px',borderBottom:`1px solid ${tabColor}15`}}>
                  <div style={{color:tabColor,fontSize:9,marginBottom:2}}>IP ADDRESS</div>
                  <input value={ipAddress} onChange={e=>setIpAddress(e.target.value)}
                    style={{width:'100%',padding:'4px 6px',background:'rgba(0,0,0,0.3)',border:`1px solid ${tabColor}30`,borderRadius:4,color:'#e2e8f0',fontSize:10,fontFamily:'monospace'}} />
                </div>
                <div style={{padding:'8px 14px',borderBottom:`1px solid ${tabColor}15`,display:'flex',flexWrap:'wrap',gap:4}}>
                  <Btn label="AbuseIPDB" color="#ef4444" onClick={()=>api(`/api/abuseipdb?ipAddress=${ipAddress}`)} loading={loading} />
                  <Btn label="URLhaus Recent" color="#dc2626" onClick={()=>api('/api/urlhaus?limit=50')} loading={loading} />
                  <Btn label="OTX" color="#f97316" onClick={()=>api('/api/otx?limit=10')} loading={loading} />
                  <Btn label="OFAC Sanctions" color="#eab308" onClick={()=>api('/api/sanctions/ofac')} loading={loading} />
                </div>
              </>
            )}

            {/* Environmental tab */}
            {tab === 'environmental' && (
              <div style={{padding:'8px 14px',borderBottom:`1px solid ${tabColor}15`,display:'flex',flexWrap:'wrap',gap:4}}>
                <Btn label="WAQI (SF)" color="#22c55e" onClick={()=>api('/api/waqi?lat=37.77&lon=-122.42')} loading={loading} />
                <Btn label="ReliefWeb" color="#10b981" onClick={()=>api('/api/reliefweb?limit=10')} loading={loading} />
                <Btn label="Windy" color="#06b6d4" onClick={()=>api('/api/windy')} loading={loading} />
              </div>
            )}

            {/* Climate tab */}
            {tab === 'climate' && (
              <div style={{padding:'8px 14px',borderBottom:`1px solid ${tabColor}15`,display:'flex',flexWrap:'wrap',gap:4}}>
                <Btn label="Climate Anomalies" color="#0ea5e9" onClick={()=>api('/api/climate/anomalies')} loading={loading} />
                <Btn label="CO2 Levels" color="#06b6d4" onClick={()=>api('/api/climate/co2')} loading={loading} />
                <Btn label="Sea Ice" color="#22c55e" onClick={()=>api('/api/climate/sea-ice')} loading={loading} />
                <Btn label="Displacement" color="#f59e0b" onClick={()=>api('/api/displacement?limit=10')} loading={loading} />
                <Btn label="WHO Air Quality" color="#84cc16" onClick={()=>api('/api/who/air-quality?limit=10')} loading={loading} />
              </div>
            )}

            {/* Niche tab */}
            {tab === 'niche' && (
              <div style={{padding:'8px 14px',borderBottom:`1px solid ${tabColor}15`,display:'flex',flexWrap:'wrap',gap:4}}>
                <Btn label="SPC Outlook" color="#f97316" onClick={()=>api('/api/spc/outlook')} loading={loading} />
                <Btn label="SPC Risk" color="#ef4444" onClick={()=>api('/api/spc/risk')} loading={loading} />
                <Btn label="GDACS Alerts" color="#dc2626" onClick={()=>api('/api/gdacs/alerts')} loading={loading} />
                <Btn label="MGRS Convert" color="#a855f7" onClick={()=>api('/api/mgrs?lat=37.77&lon=-122.42')} loading={loading} />
                <Btn label="Prediction Markets" color="#eab308" onClick={()=>api('/api/prediction-markets')} loading={loading} />
                <Btn label="Significant EQ" color="#06b6d4" onClick={()=>api('/api/earthquakes/significant')} loading={loading} />
              </div>
            )}

            {/* Financial tab */}
            {tab === 'financial' && (
              <>
                <div style={{padding:'8px 14px',borderBottom:`1px solid ${tabColor}15`}}>
                  <div style={{color:tabColor,fontSize:9,marginBottom:2}}>FRED SERIES ID</div>
                  <input value={fredSeries} onChange={e=>setFredSeries(e.target.value)}
                    style={{width:'100%',padding:'4px 6px',background:'rgba(0,0,0,0.3)',border:`1px solid ${tabColor}30`,borderRadius:4,color:'#e2e8f0',fontSize:10,fontFamily:'monospace'}} />
                </div>
                <div style={{padding:'8px 14px',borderBottom:`1px solid ${tabColor}15`,display:'flex',flexWrap:'wrap',gap:4}}>
                  <Btn label="FRED" color="#f59e0b" onClick={()=>api(`/api/fred?series_id=${fredSeries}`)} loading={loading} />
                  <Btn label="EIA" color="#d97706" onClick={()=>api('/api/eia?route=electricity/retail-sales&limit=5')} loading={loading} />
                  <Btn label="AlphaVantage" color="#f97316" onClick={()=>api('/api/alphavantage?symbol=IBM')} loading={loading} />
                  <Btn label="CoinGecko" color="#84cc16" onClick={()=>api('/api/coingecko?coin=bitcoin')} loading={loading} />
                  <Btn label="IMF" color="#eab308" onClick={()=>api('/api/imf?indicator=NGDP_RPCH')} loading={loading} />
                  <Btn label="Comtrade" color="#a16207" onClick={()=>api('/api/comtrade?limit=10')} loading={loading} />
                  <Btn label="Gold" color="#fbbf24" onClick={()=>api('/api/gold')} loading={loading} />
                  <Btn label="GIE" color="#06b6d4" onClick={()=>api('/api/gie')} loading={loading} />
                  <Btn label="ENTSOE" color="#0ea5e9" onClick={()=>api('/api/entsoe?area=10Y1001A1001A82H')} loading={loading} />
                </div>
              </>
            )}

            {error && <div style={{padding:'8px 14px',background:'rgba(239,68,68,0.1)',color:'#ef4444',fontSize:10}}>{error}</div>}

            <div style={{padding:'10px 14px',maxHeight:360,overflowY:'auto',fontSize:10}}>
              {data ? renderJson(data)
                : loading ? <div style={{display:'flex',alignItems:'center',gap:6,color:'#64748b'}}><Loader2 size={12} style={{animation:'spin 1s linear infinite'}} /> Loading...</div>
                : <div style={{color:'#64748b'}}>Select a data source above</div>}
            </div>

            <div style={{padding:'6px 14px',borderTop:`1px solid ${tabColor}15`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{color:'#475569',fontSize:8}}>{lastAction || 'idle'}</span>
            </div>
      </Panel>
    </div>
  );
}

function Btn({label,color,onClick,loading}:{label:string;color:string;onClick:()=>void;loading:boolean}) {
  return (
    <button onClick={onClick} disabled={loading}
      style={{padding:'4px 8px',borderRadius:4,border:'none',background:`${color}20`,color:'#e2e8f0',fontSize:9,cursor:loading?'not-allowed':'pointer',display:'flex',alignItems:'center',gap:4,opacity:loading?0.6:1}}>
      {label}
    </button>
  );
}

export default DataSourcesPanel;
