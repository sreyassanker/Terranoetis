import React, { useState, useCallback } from 'react';
import { Network, Loader2, RefreshCw } from 'lucide-react';
import Panel from '@/components/ui/Panel';

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

export function OmniNetPanel({ onClose }: { onClose?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(null);
  const [prompt, setPrompt] = useState('What is the current weather in San Francisco?');
  const [lastAction, setLastAction] = useState('');

  const api = useCallback(async (method: string, path: string, body?: unknown) => {
    setLoading(true); setError(null);
    try {
      const opts: RequestInit = { headers: { 'Content-Type': 'application/json' } };
      if (body) { opts.method = 'POST'; opts.body = JSON.stringify(body); }
      const res = await fetch(path, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0,200)}`);
      setData(await res.json());
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, []);

  const act = (label: string, method: string, path: string, body?: unknown) => () => { setLastAction(label); api(method, path, body); };

  return (
    <div style={{position:'absolute',top:60,right:10,zIndex:1000,width:380}}>
      <Panel title="OMNINET" icon={<Network size={16} />} accentColor="#8b5cf6" onClose={onClose}
        headerExtra={
          <RefreshCw size={12} style={{color:'#8b5cf6',cursor:'pointer'}} onClick={(e)=>{e.stopPropagation(); act('status','GET','/api/omninet/providers')();}} />
        }>
        <div style={{padding:'8px 14px',borderBottom:'1px solid rgba(139,92,246,0.15)'}}>
              <input value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Enter a query..."
                style={{width:'100%',padding:'5px 8px',background:'rgba(0,0,0,0.3)',border:'1px solid rgba(139,92,246,0.3)',borderRadius:4,color:'#e2e8f0',fontSize:10,outline:'none'}} />
            </div>
            <div style={{padding:'8px 14px',borderBottom:'1px solid rgba(139,92,246,0.15)',display:'flex',flexWrap:'wrap',gap:4}}>
              <Btn label="Providers" color="#8b5cf6" onClick={act('providers','GET','/api/omninet/providers')} loading={loading} />
              <Btn label="Classify" color="#a78bfa" onClick={act('classify','POST','/api/omninet/classify',{query:prompt})} loading={loading} />
              <Btn label="Route" color="#c084fc" onClick={act('route','POST','/api/omninet/route',{query:prompt})} loading={loading} />
              <Btn label="Embed" color="#22c55e" onClick={act('embed','POST','/api/omninet/embed',{text:prompt})} loading={loading} />
              <Btn label="Generate" color="#06b6d4" onClick={act('generate','POST','/api/omninet/generate',{prompt})} loading={loading} />
              <Btn label="Rate Status" color="#f59e0b" onClick={act('rate-status','GET','/api/omninet/rate-status')} loading={loading} />
            </div>
            {error && <div style={{padding:'8px 14px',background:'rgba(239,68,68,0.1)',color:'#ef4444',fontSize:10}}>{error}</div>}
            <div style={{padding:'10px 14px',maxHeight:360,overflowY:'auto',fontSize:10}}>
              {data ? renderJson(data)
                : loading ? <div style={{display:'flex',alignItems:'center',gap:6,color:'#64748b'}}><Loader2 size={12} style={{animation:'spin 1s linear infinite'}} /> Loading...</div>
                : <div style={{color:'#64748b'}}>Select an action above</div>}
            </div>
            <div style={{padding:'6px 14px',borderTop:'1px solid rgba(139,92,246,0.15)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
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

export default OmniNetPanel;
