import React, { useState, useEffect } from 'react';
import { X, Save, Key, Search } from 'lucide-react';

export interface ApiConfig {
  id: string;
  name: string;
  category: string;
  description: string;
  registrationUrl: string;
  docsUrl: string;
  envKey?: string;
  envKeys?: string[];
  free: boolean;
  rateLimit: string;
  status: 'public' | 'authenticated' | 'premium';
}

interface ApiVaultProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (keys: Record<string, string>) => void;
  initialKeys: Record<string, string>;
}

export function ApiVault({ isOpen, onClose, onSave, initialKeys }: ApiVaultProps) {
  const [apis, setApis] = useState<ApiConfig[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>(initialKeys || {});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    const abort = new AbortController();
    fetch('/api/config/apis', { signal: abort.signal })
      .then(r => r.json())
      .then(data => {
        if (abort.signal.aborted) return;
        setApis(data.apis);
        setCategories(data.categories);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => abort.abort();
  }, [isOpen]);

  if (!isOpen) return null;

  const getKeyFields = (api: ApiConfig): string[] => {
    if (api.envKeys) return api.envKeys;
    if (api.envKey && api.envKey !== 'N/A') return [api.envKey];
    return [];
  };

  const configuredCount = apis.filter(api => getKeyFields(api).some(f => keys[f]?.trim())).length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Key size={16} className="text-blue-400" />
            <h2 className="text-lg font-bold text-white">API Keys</h2>
            <span className="text-xs text-gray-500 ml-1">({configuredCount}/{apis.length} configured)</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition p-1">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 pt-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search APIs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-800 text-white rounded pl-8 pr-3 py-1.5 text-xs border border-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="text-center text-gray-500 text-sm py-8">Loading...</div>
          ) : (
            categories.map(cat => {
              const catApis = apis.filter(a =>
                a.category === cat &&
                getKeyFields(a).length > 0 &&
                (!search || a.name.toLowerCase().includes(search.toLowerCase()))
              );
              if (catApis.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{cat}</div>
                  <div className="space-y-2">
                    {catApis.map(api => {
                      const fields = getKeyFields(api);
                      const filled = fields.some(f => keys[f]?.trim());
                      return (
                        <div key={api.id} className="bg-gray-800 rounded p-3 border border-gray-700">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-white">{api.name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded ${filled ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                              {filled ? 'Configured' : 'Not set'}
                            </span>
                          </div>
                          {fields.map(field => (
                            <input
                              key={field}
                              type="password"
                              placeholder={`${field}`}
                              value={keys[field] || ''}
                              onChange={e => setKeys(prev => ({ ...prev, [field]: e.target.value }))}
                              className="w-full bg-gray-700 text-white rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-700 bg-gray-800">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition">
            Cancel
          </button>
          <button onClick={() => { onSave(keys); onClose(); }} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition flex items-center gap-1.5">
            <Save size={12} /> Save Keys
          </button>
        </div>
      </div>
    </div>
  );
}
