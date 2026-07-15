import { useState } from 'react';
import Panel from '@/components/ui/Panel';

interface CyberPanelProps { threats: any[]; assets: any[]; killChains: any[]; onClose: () => void; }

export function CyberPanel({ threats, assets, killChains, onClose }: CyberPanelProps) {
  const [tab, setTab] = useState('threats');
  return (
    <Panel title="Cyber Operations" onClose={onClose} width={420}>
      <div className="flex gap-1 mb-3">{['threats', 'assets', 'killChains'].map(t => <button key={t} onClick={() => setTab(t)} className={`px-2 py-1 text-xs rounded ${tab === t ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>{t === 'killChains' ? 'Kill Chains' : t.charAt(0).toUpperCase() + t.slice(1)}</button>)}</div>
      {tab === 'threats' && <div className="space-y-2 max-h-64 overflow-y-auto">{threats.length === 0 ? <div className="text-center text-slate-400 py-4">No threats</div> : threats.map((t: any) => <div key={t.id} className="p-2 bg-red-900/20 rounded border border-red-500"><div className="text-sm font-mono text-red-400">{t.name}</div><div className="text-xs text-slate-400">{t.phase} - {t.severity} - {t.mitreId}</div></div>)}</div>}
      {tab === 'assets' && <div className="space-y-2 max-h-64 overflow-y-auto">{assets.map((a: any) => <div key={a.id} className={`p-2 rounded border ${a.status === 'compromised' ? 'bg-red-900/20 border-red-500' : 'bg-slate-800 border-slate-600'}`}><div className="text-sm font-mono">{a.name}</div><div className="text-xs text-slate-400">{a.type} - {a.status}</div></div>)}</div>}
      {tab === 'killChains' && <div className="space-y-2 max-h-64 overflow-y-auto">{killChains.map((k: any) => <div key={k.id} className="p-2 bg-slate-800 rounded border border-slate-600"><div className="text-sm font-mono">{k.currentPhase}</div><div className="text-xs text-slate-400">{k.phases.length} phases</div></div>)}</div>}
      <div className="mt-3 pt-3 border-t border-slate-600"><div className="grid grid-cols-3 gap-2 text-center"><div className="bg-slate-800 rounded p-2"><div className="text-xs text-slate-400">Threats</div><div className="text-lg font-bold text-red-400">{threats.length}</div></div><div className="bg-slate-800 rounded p-2"><div className="text-xs text-slate-400">Assets</div><div className="text-lg font-bold text-blue-400">{assets.length}</div></div><div className="bg-slate-800 rounded p-2"><div className="text-xs text-slate-400">Compromised</div><div className="text-lg font-bold text-red-400">{assets.filter((a: any) => a.status === 'compromised').length}</div></div></div></div>
    </Panel>
  );
}
