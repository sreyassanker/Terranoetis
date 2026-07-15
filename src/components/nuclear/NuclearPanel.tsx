import { useState } from 'react';
import Panel from '@/components/ui/Panel';

interface NuclearPanelProps {
  events: any[];
  plumes: any[];
  zones: any[];
  onClose: () => void;
}

export function NuclearPanel({ events, plumes, zones, onClose }: NuclearPanelProps) {
  const [tab, setTab] = useState('events');
  return (
    <Panel title="Nuclear/WMD Monitoring" onClose={onClose} width={420}>
      <div className="flex gap-1 mb-3">
        {['events', 'plumes', 'zones'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-2 py-1 text-xs rounded ${tab === t ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      {tab === 'events' && <div className="space-y-2 max-h-64 overflow-y-auto">{events.length === 0 ? <div className="text-center text-slate-400 py-4">No events</div> : events.map((e: any) => <div key={e.id} className="p-2 bg-slate-800 rounded border border-slate-600"><div className="text-sm font-mono text-red-400">{e.name}</div><div className="text-xs text-slate-400">{e.type} - {e.dispersalModel}</div></div>)}</div>}
      {tab === 'plumes' && <div className="space-y-2 max-h-64 overflow-y-auto">{plumes.length === 0 ? <div className="text-center text-slate-400 py-4">No plumes</div> : plumes.map((p: any) => <div key={p.id} className="p-2 bg-slate-800 rounded border border-slate-600"><div className="text-sm font-mono text-yellow-400">Plume {p.eventId}</div><div className="text-xs text-slate-400">{p.maxRange}km range</div></div>)}</div>}
      {tab === 'zones' && <div className="space-y-2 max-h-64 overflow-y-auto">{zones.length === 0 ? <div className="text-center text-slate-400 py-4">No zones</div> : zones.map((z: any) => <div key={z.id} className="p-2 bg-slate-800 rounded border border-slate-600"><div className="text-sm font-mono">{z.severity}</div><div className="text-xs text-slate-400">{z.doseRate} mSv/hr</div></div>)}</div>}
      <div className="mt-3 pt-3 border-t border-slate-600"><div className="grid grid-cols-3 gap-2 text-center"><div className="bg-slate-800 rounded p-2"><div className="text-xs text-slate-400">Events</div><div className="text-lg font-bold text-red-400">{events.length}</div></div><div className="bg-slate-800 rounded p-2"><div className="text-xs text-slate-400">Plumes</div><div className="text-lg font-bold text-yellow-400">{plumes.length}</div></div><div className="bg-slate-800 rounded p-2"><div className="text-xs text-slate-400">Zones</div><div className="text-lg font-bold text-orange-400">{zones.length}</div></div></div></div>
    </Panel>
  );
}
