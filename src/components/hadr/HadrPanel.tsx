import { useState } from 'react';
import Panel from '@/components/ui/Panel';

interface HadrPanelProps { events: any[]; assets: any[]; routes: any[]; onClose: () => void; }

export function HadrPanel({ events, assets, routes, onClose }: HadrPanelProps) {
  const [tab, setTab] = useState('events');
  return (
    <Panel title="HADR / Civil-Military" onClose={onClose} width={420}>
      <div className="flex gap-1 mb-3">{['events', 'assets', 'routes'].map(t => <button key={t} onClick={() => setTab(t)} className={`px-2 py-1 text-xs rounded ${tab === t ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>)}</div>
      {tab === 'events' && <div className="space-y-2 max-h-64 overflow-y-auto">{events.length === 0 ? <div className="text-center text-slate-400 py-4">No events</div> : events.map((e: any) => <div key={e.id} className="p-2 bg-slate-800 rounded border border-slate-600"><div className="text-sm font-mono text-orange-400">{e.name}</div><div className="text-xs text-slate-400">{e.type} - {e.severity} - {e.affected} affected</div></div>)}</div>}
      {tab === 'assets' && <div className="space-y-2 max-h-64 overflow-y-auto">{assets.map((a: any) => <div key={a.id} className="p-2 bg-slate-800 rounded border border-slate-600"><div className="text-sm font-mono">{a.name}</div><div className="text-xs text-slate-400">{a.type} - {a.utilization}% util</div></div>)}</div>}
      {tab === 'routes' && <div className="space-y-2 max-h-64 overflow-y-auto">{routes.map((r: any) => <div key={r.id} className={`p-2 rounded border ${r.status === 'blocked' ? 'bg-red-900/20 border-red-500' : 'bg-slate-800 border-slate-600'}`}><div className="text-sm font-mono">{r.name}</div><div className="text-xs text-slate-400">{r.status}</div></div>)}</div>}
      <div className="mt-3 pt-3 border-t border-slate-600"><div className="grid grid-cols-3 gap-2 text-center"><div className="bg-slate-800 rounded p-2"><div className="text-xs text-slate-400">Events</div><div className="text-lg font-bold text-orange-400">{events.length}</div></div><div className="bg-slate-800 rounded p-2"><div className="text-xs text-slate-400">Affected</div><div className="text-lg font-bold text-red-400">{events.reduce((s: number, e: any) => s + (e.affected || 0), 0)}</div></div><div className="bg-slate-800 rounded p-2"><div className="text-xs text-slate-400">Active</div><div className="text-lg font-bold text-green-400">{events.filter((e: any) => e.status === 'active').length}</div></div></div></div>
    </Panel>
  );
}
