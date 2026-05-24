import React, { useState, useEffect, useRef } from 'react';
import { X, ExternalLink, Copy, Check } from 'lucide-react';

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
  const [keys, setKeys] = useState<Record<string, string>>(initialKeys || {});
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const abort = new AbortController();

    const fetchApiMetadata = async () => {
      try {
        const res = await fetch('/api/config/apis', { signal: abort.signal });
        const data = await res.json();
        if (abort.signal.aborted) return;
        setApis(data.apis);
        setCategories(data.categories);
        if (data.categories.length > 0) {
          setActiveCategory(data.categories[0]);
        }
        setLoading(false);
      } catch (err) {
        if (abort.signal.aborted) return;
        console.error('Failed to fetch API metadata:', err);
        setLoading(false);
      }
    };

    fetchApiMetadata();

    return () => abort.abort();
  }, [isOpen]);

  const categoryApis = apis.filter((api) => api.category === activeCategory);

  const handleInputChange = (keyName: string, value: string) => {
    setKeys((prev) => ({
      ...prev,
      [keyName]: value,
    }));
  };

  const handleSave = () => {
    onSave(keys);
    onClose();
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(id);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(null), 2000);
  };

  const getKeyFields = (api: ApiConfig): string[] => {
    if (api.envKeys) return api.envKeys;
    if (api.envKey && api.envKey !== 'N/A') return [api.envKey];
    return [];
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-white">API Configuration</h2>
            <p className="text-sm text-gray-400 mt-1">
              Add your API keys to unlock features. All keys are stored locally.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Category Sidebar */}
          <div className="w-48 bg-gray-800 border-r border-gray-700 overflow-y-auto">
            {categories.map((category) => {
              const count = apis.filter((api) => api.category === category).length;
              return (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={`w-full text-left px-4 py-3 border-l-4 transition ${
                    activeCategory === category
                      ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                      : 'border-transparent text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <div className="font-medium">{category}</div>
                  <div className="text-xs text-gray-500 mt-1">{count} APIs</div>
                </button>
              );
            })}
          </div>

          {/* APIs List */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {loading ? (
              <div className="text-center text-gray-400">Loading API metadata...</div>
            ) : categoryApis.length === 0 ? (
              <div className="text-center text-gray-400">No APIs in this category</div>
            ) : (
              categoryApis.map((api) => {
                const keyFields = getKeyFields(api);
                const isFilled = keyFields.some((field) => keys[field]?.trim());

                return (
                  <div
                    key={api.id}
                    className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition"
                  >
                    {/* API Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-lg font-semibold text-white">{api.name}</h3>
                        <p className="text-sm text-gray-400 mt-1">{api.description}</p>
                      </div>
                      <div className="flex gap-2">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            api.free
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-orange-500/20 text-orange-400'
                          }`}
                        >
                          {api.free ? 'Free' : 'Paid'}
                        </span>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            isFilled
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-gray-700/20 text-gray-400'
                          }`}
                        >
                          {isFilled ? '✓ Configured' : 'Not Set'}
                        </span>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="mb-4 space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Rate Limit:</span>
                        <span className="text-gray-300">{api.rateLimit}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={api.registrationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                        >
                          Sign up / Get API Key
                          <ExternalLink size={14} />
                        </a>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={api.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                        >
                          Docs
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    </div>

                    {/* Input Fields */}
                    {keyFields.length > 0 && (
                      <div className="space-y-3">
                        {keyFields.map((field) => (
                          <div key={field}>
                            <label className="block text-xs font-medium text-gray-400 mb-1">
                              {field}
                            </label>
                            <div className="relative">
                              <input
                                type="password"
                                placeholder={`Paste your ${field} here...`}
                                value={keys[field] || ''}
                                onChange={(e) => handleInputChange(field, e.target.value)}
                                className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                              />
                              {keys[field] && (
                                <button
                                  onClick={() =>
                                    copyToClipboard(keys[field], `copy-${field}`)
                                  }
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                                >
                                  {copied === `copy-${field}` ? (
                                    <Check size={16} />
                                  ) : (
                                    <Copy size={16} />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {api.status === 'public' && keyFields.length === 0 && (
                      <div className="text-xs text-green-400 bg-green-500/10 px-3 py-2 rounded">
                        ✓ This API is public and requires no authentication
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-700 bg-gray-800">
          <p className="text-xs text-gray-400">
            Keys are stored in browser localStorage. Never share them publicly.
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
            >
              Save & Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
