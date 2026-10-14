import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Save,
  Key,
  Search,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Trash2,
  ShieldCheck,
  RefreshCw,
  Brain,
  Satellite,
  Plane,
  Ship,
  CloudSun,
  ShieldAlert,
  Landmark,
  Flame,
  Radio,
  Zap,
  Camera,
  Globe2,
  Layers,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  Info,
  Lock,
  Unlock,
  AlertTriangle,
} from 'lucide-react';
import { authHeaders } from '@/context/AuthContext';

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

export interface KeyStatusInfo {
  configured: boolean;
  masked: string;
  source: 'user' | 'env' | 'none';
}

interface ValidationResult {
  validating: boolean;
  valid?: boolean;
  message?: string;
  testedAt?: number;
}

interface ApiVaultProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (savedKeys: Record<string, string>) => void;
  initialKeys?: Record<string, string>;
  isOnboarding?: boolean;
}

export function ApiVault({ isOpen, onClose, onSave, isOnboarding = false }: ApiVaultProps) {
  const [apis, setApis] = useState<ApiConfig[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [keyStatuses, setKeyStatuses] = useState<Record<string, KeyStatusInfo>>({});
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({});
  const [validations, setValidations] = useState<Record<string, ValidationResult>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [filterMode, setFilterMode] = useState<'all' | 'configured' | 'missing' | 'verified' | 'issues'>('all');
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [bulkTesting, setBulkTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Fetch API Catalog & Vault Statuses
  const loadVaultData = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [apiRes, vaultRes] = await Promise.all([
        fetch('/api/config/apis', { signal, headers: { ...authHeaders() } }).then(r => r.json()),
        fetch('/api/config/vault', { signal, headers: { ...authHeaders() } }).then(r => r.json()).catch(() => ({ keys: {} })),
      ]);

      if (signal?.aborted) return;
      setApis(apiRes.apis || []);
      setCategories(apiRes.categories || []);
      setKeyStatuses(vaultRes.keys || {});
    } catch (err) {
      if (!signal?.aborted) {
        console.error('[ApiVault] Failed to load configuration:', err);
        setFeedback({
          type: 'error',
          message: 'Failed to communicate with local vault service. Check backend status.',
        });
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setFeedback(null);
      setInputValues({});
      setValidations({});
      return;
    }

    const abortController = new AbortController();
    loadVaultData(abortController.signal);
    return () => abortController.abort();
  }, [isOpen]);

  // Keyboard shortcut: Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const getKeyFields = (api: ApiConfig): string[] => {
    if (api.envKeys && api.envKeys.length > 0) return api.envKeys;
    if (api.envKey && api.envKey !== 'N/A') return [api.envKey];
    return [];
  };

  const isFieldConfigured = (field: string): boolean => {
    return Boolean(keyStatuses[field]?.configured || inputValues[field]?.trim());
  };

  const isApiConfigured = (api: ApiConfig): boolean => {
    const fields = getKeyFields(api);
    if (fields.length === 0) return true; // public API
    return fields.some(f => isFieldConfigured(f));
  };

  // Counts & Statistics
  const totalFields = useMemo(() => {
    const fields = new Set<string>();
    for (const api of apis) {
      for (const f of getKeyFields(api)) fields.add(f);
    }
    return fields.size;
  }, [apis]);

  const configuredCount = useMemo(() => {
    const counted = new Set<string>();
    for (const api of apis) {
      for (const f of getKeyFields(api)) {
        if (!counted.has(f) && isFieldConfigured(f)) {
          counted.add(f);
        }
      }
    }
    return counted.size;
  }, [apis, keyStatuses, inputValues]);

  const userVaultCount = useMemo(() => {
    return Object.values(keyStatuses).filter(s => s.source === 'user' && s.configured).length;
  }, [keyStatuses]);

  const envFallbackCount = useMemo(() => {
    return Object.values(keyStatuses).filter(s => s.source === 'env' && s.configured).length;
  }, [keyStatuses]);

  const unsavedCount = useMemo(() => {
    return Object.entries(inputValues).filter(([_, v]) => v.trim() && !v.includes('••••')).length;
  }, [inputValues]);

  // Category Configuration Count helper
  const getCategoryStats = (cat: string) => {
    const catApis = apis.filter(a => a.category === cat && getKeyFields(a).length > 0);
    const configured = catApis.filter(a => isApiConfigured(a)).length;
    return { configured, total: catApis.length };
  };

  // Copy helper
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(text);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Single Key Validation
  const handleValidateKey = async (field: string) => {
    const isKaggle = field === 'KAGGLE_USERNAME' || field === 'KAGGLE_KEY';
    const currentTyped = inputValues[field]?.trim();
    const contextKeys: Record<string, string> = {};
    if (isKaggle) {
      const u = inputValues['KAGGLE_USERNAME']?.trim();
      const k = inputValues['KAGGLE_KEY']?.trim();
      if (u && !u.includes('••••')) contextKeys.KAGGLE_USERNAME = u;
      if (k && !k.includes('••••')) contextKeys.KAGGLE_KEY = k;
    }

    setValidations(prev => {
      const next = { ...prev, [field]: { validating: true, message: 'Contacting provider API...' } };
      if (isKaggle) {
        next.KAGGLE_USERNAME = { validating: true, message: 'Contacting Kaggle API...' };
        next.KAGGLE_KEY = { validating: true, message: 'Contacting Kaggle API...' };
      }
      return next;
    });

    try {
      const resp = await fetch('/api/config/vault/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          keyName: field,
          keyValue: (currentTyped && !currentTyped.includes('••••')) ? currentTyped : undefined,
          contextKeys: Object.keys(contextKeys).length > 0 ? contextKeys : undefined,
        }),
      });

      const data = await resp.json() as { valid?: boolean; message?: string };
      const valResult = {
        validating: false,
        valid: Boolean(data.valid),
        message: data.message || (data.valid ? 'Verified successfully' : 'Validation failed'),
        testedAt: Date.now(),
      };

      setValidations(prev => {
        const next = { ...prev, [field]: valResult };
        if (isKaggle) {
          next.KAGGLE_USERNAME = valResult;
          next.KAGGLE_KEY = valResult;
        }
        return next;
      });
    } catch (err) {
      const errResult = {
        validating: false,
        valid: false,
        message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
        testedAt: Date.now(),
      };
      setValidations(prev => {
        const next = { ...prev, [field]: errResult };
        if (isKaggle) {
          next.KAGGLE_USERNAME = errResult;
          next.KAGGLE_KEY = errResult;
        }
        return next;
      });
    }
  };

  // Test All Active Keys in Current Category
  const handleBulkTestCategory = async () => {
    setBulkTesting(true);
    setFeedback({ type: 'info', message: 'Testing active connections in this category...' });

    const apisToTest = apis.filter(a => {
      if (selectedCategory !== 'all' && a.category !== selectedCategory) return false;
      return isApiConfigured(a);
    });

    const fieldsToTest = new Set<string>();
    for (const a of apisToTest) {
      for (const f of getKeyFields(a)) {
        if (isFieldConfigured(f)) fieldsToTest.add(f);
      }
    }

    let passed = 0;
    let failed = 0;

    for (const field of fieldsToTest) {
      setValidations(prev => ({
        ...prev,
        [field]: { validating: true, message: 'Testing connectivity...' },
      }));

      try {
        const resp = await fetch('/api/config/vault/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyName: field, keyValue: inputValues[field]?.trim() || undefined }),
        });
        const data = await resp.json() as { valid?: boolean; message?: string };
        const ok = Boolean(data.valid);
        if (ok) passed++; else failed++;

        setValidations(prev => ({
          ...prev,
          [field]: {
            validating: false,
            valid: ok,
            message: data.message || (ok ? 'Verified' : 'Validation failed'),
            testedAt: Date.now(),
          },
        }));
      } catch (err) {
        failed++;
        setValidations(prev => ({
          ...prev,
          [field]: {
            validating: false,
            valid: false,
            message: `Connection error: ${err instanceof Error ? err.message : String(err)}`,
            testedAt: Date.now(),
          },
        }));
      }
    }

    setBulkTesting(false);
    setFeedback({
      type: failed === 0 ? 'success' : 'error',
      message: `Completed testing ${fieldsToTest.size} active connection(s): ${passed} verified, ${failed} failed.`,
    });
  };

  // Save Single Key
  const handleSaveSingleKey = async (field: string) => {
    const val = inputValues[field]?.trim();
    if (!val || val.includes('••••')) return;

    setSavingKey(field);
    try {
      const resp = await fetch('/api/config/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ keys: { [field]: val } }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${resp.status}`);
      }

      const data = await resp.json() as { keys?: Record<string, KeyStatusInfo> };
      if (data.keys) {
        setKeyStatuses(data.keys);
      }

      setInputValues(prev => {
        const n = { ...prev };
        delete n[field];
        return n;
      });

      setFeedback({ type: 'success', message: `Saved ${field} securely to encrypted device storage.` });
      if (onSave) onSave({ [field]: val });

      // Run live verification automatically on newly saved key
      handleValidateKey(field);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: `Failed to save ${field}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSavingKey(null);
    }
  };

  // Delete User-Saved Key
  const handleDeleteKey = async (field: string) => {
    try {
      const resp = await fetch(`/api/config/vault/${encodeURIComponent(field)}`, {
        method: 'DELETE',
        headers: { ...authHeaders() },
      });

      if (!resp.ok) {
        throw new Error(`Failed to remove key: server responded with ${resp.status}`);
      }

      const data = await resp.json() as { keys?: Record<string, KeyStatusInfo> };
      if (data.keys) {
        setKeyStatuses(data.keys);
      }

      setInputValues(prev => {
        const n = { ...prev };
        delete n[field];
        return n;
      });

      setValidations(prev => {
        const n = { ...prev };
        delete n[field];
        return n;
      });

      setFeedback({ type: 'info', message: `Removed ${field} from user vault. Reverted to default.` });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // Validate Entire Provider / Service Integration (one unified test for the card)
  const handleValidateApi = async (api: ApiConfig) => {
    const fields = getKeyFields(api);
    if (fields.length === 0) return;

    const primaryField = fields[0];
    const currentTyped = inputValues[primaryField]?.trim();
    const contextKeys: Record<string, string> = {};
    for (const f of fields) {
      const val = inputValues[f]?.trim();
      if (val && !val.includes('••••')) {
        contextKeys[f] = val;
      }
    }

    setValidations(prev => {
      const next = { ...prev };
      for (const f of fields) {
        next[f] = { validating: true, message: `Connecting to ${api.name}...` };
      }
      return next;
    });

    try {
      const resp = await fetch('/api/config/vault/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          keyName: primaryField,
          keyValue: (currentTyped && !currentTyped.includes('••••')) ? currentTyped : undefined,
          contextKeys: Object.keys(contextKeys).length > 0 ? contextKeys : undefined,
        }),
      });

      const data = await resp.json() as { valid?: boolean; message?: string };
      const valResult: ValidationResult = {
        validating: false,
        valid: Boolean(data.valid),
        message: data.message || (data.valid ? `${api.name} verified successfully` : 'Validation failed'),
        testedAt: Date.now(),
      };

      setValidations(prev => {
        const next = { ...prev };
        for (const f of fields) {
          next[f] = valResult;
        }
        return next;
      });
    } catch (err) {
      const errResult: ValidationResult = {
        validating: false,
        valid: false,
        message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
        testedAt: Date.now(),
      };
      setValidations(prev => {
        const next = { ...prev };
        for (const f of fields) {
          next[f] = errResult;
        }
        return next;
      });
    }
  };

  // Save All Modified Credentials for a Provider Card
  const handleSaveProvider = async (api: ApiConfig) => {
    const fields = getKeyFields(api);
    const toSave: Record<string, string> = {};
    for (const f of fields) {
      const val = inputValues[f]?.trim();
      if (val && !val.includes('••••')) {
        toSave[f] = val;
      }
    }
    if (Object.keys(toSave).length === 0) return;

    setSavingProvider(api.id);
    try {
      const resp = await fetch('/api/config/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ keys: toSave }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${resp.status}`);
      }
      const data = await resp.json() as { keys?: Record<string, KeyStatusInfo> };
      if (data.keys) {
        setKeyStatuses(data.keys);
      }
      setInputValues(prev => {
        const n = { ...prev };
        for (const f of Object.keys(toSave)) delete n[f];
        return n;
      });
      setFeedback({ type: 'success', message: `Saved ${api.name} credentials securely to encrypted device storage.` });
      if (onSave) onSave(toSave);

      // Automatically test connection after saving
      handleValidateApi(api);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: `Failed to save ${api.name}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSavingProvider(null);
    }
  };

  // Save All Modified Keys
  const handleSaveAll = async () => {
    setSavingAll(true);
    setFeedback(null);

    const payloadKeys: Record<string, string> = {};
    for (const [k, v] of Object.entries(inputValues)) {
      const trimmed = v.trim();
      if (trimmed && !trimmed.includes('••••')) {
        payloadKeys[k] = trimmed;
      }
    }

    if (Object.keys(payloadKeys).length === 0) {
      setFeedback({ type: 'info', message: 'No pending modifications to save.' });
      setSavingAll(false);
      return;
    }

    try {
      const resp = await fetch('/api/config/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ keys: payloadKeys }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with ${resp.status}`);
      }

      const data = await resp.json() as { keys?: Record<string, KeyStatusInfo>; savedCount?: number };
      if (data.keys) {
        setKeyStatuses(data.keys);
      }

      setInputValues({});
      setFeedback({
        type: 'success',
        message: `Successfully encrypted and saved ${data.savedCount || Object.keys(payloadKeys).length} key(s) to device storage.`,
      });

      if (onSave) onSave(payloadKeys);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: `Failed to save keys: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSavingAll(false);
    }
  };

  // Category Icon Resolver
  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'AI & Analytics': return <Brain size={15} />;
      case 'Satellite & Imagery': return <Satellite size={15} />;
      case 'Aviation': return <Plane size={15} />;
      case 'Maritime': return <Ship size={15} />;
      case 'Weather & Disaster': return <CloudSun size={15} />;
      case 'Cyber Threat Intelligence': return <ShieldAlert size={15} />;
      case 'Economic & Financial': return <Landmark size={15} />;
      case 'Conflict & Geopolitics': return <Flame size={15} />;
      case 'Search & Scraping': return <Search size={15} />;
      case 'Social & News': return <Radio size={15} />;
      case 'Infrastructure': return <Zap size={15} />;
      case 'Cameras': return <Camera size={15} />;
      case 'Notifications': return <Info size={15} />;
      case 'Auth & Security': return <Lock size={15} />;
      default: return <Globe2 size={15} />;
    }
  };

  // Filtered APIs
  const filteredApis = useMemo(() => {
    return apis.filter(api => {
      // Category filter
      if (selectedCategory !== 'all' && api.category !== selectedCategory) return false;

      const fields = getKeyFields(api);
      if (fields.length === 0) return false;

      // Text Search filter
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchName = api.name.toLowerCase().includes(q);
        const matchDesc = api.description.toLowerCase().includes(q);
        const matchFields = fields.some(f => f.toLowerCase().includes(q));
        const matchCat = api.category.toLowerCase().includes(q);
        if (!matchName && !matchDesc && !matchFields && !matchCat) return false;
      }

      // Quick Status Filter
      const configured = isApiConfigured(api);
      if (filterMode === 'configured' && !configured) return false;
      if (filterMode === 'missing' && configured) return false;
      if (filterMode === 'verified') {
        const anyVerified = fields.some(f => validations[f]?.valid === true);
        if (!anyVerified) return false;
      }
      if (filterMode === 'issues') {
        const anyFailed = fields.some(f => validations[f]?.valid === false);
        if (!anyFailed) return false;
      }

      return true;
    });
  }, [apis, selectedCategory, search, filterMode, keyStatuses, inputValues, validations]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
      style={{ zIndex: 99999 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-[#0b101d] border border-blue-500/25 rounded-2xl shadow-[0_16px_70px_rgba(0,0,0,0.9)] w-full max-w-5xl h-[90vh] max-h-[860px] min-h-[550px] overflow-hidden flex flex-col text-slate-100 font-sans relative"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* ── HEADER ── */}
        <div className="px-5 py-3.5 border-b border-slate-800/90 bg-gradient-to-r from-slate-950 via-[#0d1424] to-slate-950 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30 flex items-center justify-center shadow-inner shadow-blue-500/20">
              <Key size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-sm sm:text-base font-bold text-white tracking-wide">
                  {isOnboarding ? 'Terranoetis API Vault — Initial Onboarding' : 'API Configuration & Credentials Vault'}
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/25 font-mono font-medium">
                  {configuredCount}/{totalFields} Active
                </span>
              </div>
              <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                <ShieldCheck size={13} className="text-emerald-400 inline shrink-0" />
                <span>
                  {isOnboarding
                    ? 'Configure your basemaps and AI keys, or launch directly with public offline defaults'
                    : 'Encrypted at rest with AES-256-GCM in OS application storage • Zero plaintext exposure'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => loadVaultData()}
              disabled={loading}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 rounded-lg transition"
              title="Refresh vault status from server"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin text-blue-400' : ''} />
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition p-1.5 rounded-lg hover:bg-slate-800/80"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── FEEDBACK TOAST BANNER ── */}
        {feedback && (
          <div
            className={`px-5 py-2 text-xs flex items-center justify-between border-b transition-all ${
              feedback.type === 'success'
                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/30'
                : feedback.type === 'error'
                ? 'bg-rose-950/40 text-rose-300 border-rose-500/30'
                : 'bg-blue-950/40 text-blue-300 border-blue-500/30'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.type === 'success' && <CheckCircle2 size={14} className="text-emerald-400" />}
              {feedback.type === 'error' && <AlertCircle size={14} className="text-rose-400" />}
              {feedback.type === 'info' && <Info size={14} className="text-blue-400" />}
              <span className="font-medium">{feedback.message}</span>
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="text-slate-400 hover:text-white text-xs underline ml-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ── TOP SEARCH & QUICK STATS TOOLBAR ── */}
        <div className="px-5 py-2.5 border-b border-slate-800/80 bg-slate-900/60 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Search bar */}
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search services or credentials (e.g. Gemini, Cesium, FIRMS)..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-950/80 text-slate-100 rounded-lg pl-8 pr-7 py-1.5 text-xs border border-slate-700/80 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Filter Chips */}
          <div className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-lg border border-slate-800 text-[11px]">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-2.5 py-1 rounded-md transition font-medium ${
                filterMode === 'all'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({apis.length})
            </button>
            <button
              onClick={() => setFilterMode('configured')}
              className={`px-2.5 py-1 rounded-md transition font-medium ${
                filterMode === 'configured'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Active ({configuredCount})
            </button>
            <button
              onClick={() => setFilterMode('missing')}
              className={`px-2.5 py-1 rounded-md transition font-medium ${
                filterMode === 'missing'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Missing ({totalFields - configuredCount})
            </button>
            <button
              onClick={() => setFilterMode('issues')}
              className={`px-2.5 py-1 rounded-md transition font-medium ${
                filterMode === 'issues'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Issues
            </button>
          </div>

          {/* Fast Bulk Test in Category */}
          <button
            onClick={handleBulkTestCategory}
            disabled={bulkTesting || loading}
            className="px-3 py-1.5 bg-slate-800/90 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg text-xs font-medium border border-slate-700/80 transition flex items-center gap-1.5 shrink-0"
            title="Sequentially ping all active providers in the selected category"
          >
            {bulkTesting ? (
              <Loader2 size={13} className="animate-spin text-blue-400" />
            ) : (
              <Sparkles size={13} className="text-blue-400" />
            )}
            <span>{bulkTesting ? 'Testing Category...' : 'Test Active Keys'}</span>
          </button>
        </div>

        {/* ── TWO-COLUMN WORKSPACE BODY ── */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left Category Rail */}
          <aside className="w-60 border-r border-slate-800/80 bg-slate-950/40 overflow-y-auto hidden md:flex flex-col p-2 space-y-1 shrink-0">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-1.5">
              Service Domains
            </div>

            {/* "All Categories" Tab */}
            <button
              onClick={() => setSelectedCategory('all')}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition ${
                selectedCategory === 'all'
                  ? 'bg-gradient-to-r from-blue-600/20 to-blue-500/10 text-blue-300 border border-blue-500/30 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <Layers size={14} className={selectedCategory === 'all' ? 'text-blue-400' : 'text-slate-500'} />
                <span className="truncate">All Integrations</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                {apis.length}
              </span>
            </button>

            {/* Category Items */}
            {categories.map(cat => {
              const stats = getCategoryStats(cat);
              const isSelected = selectedCategory === cat;

              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition ${
                    isSelected
                      ? 'bg-gradient-to-r from-blue-600/20 to-blue-500/10 text-blue-300 border border-blue-500/30 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <span className={isSelected ? 'text-blue-400' : 'text-slate-500'}>
                      {getCategoryIcon(cat)}
                    </span>
                    <span className="truncate">{cat}</span>
                  </div>

                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                      stats.configured > 0
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {stats.configured}/{stats.total}
                  </span>
                </button>
              );
            })}
          </aside>

          {/* Right Main Catalog Content */}
          <main className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            
            {/* Mobile Category Dropdown for narrow screens */}
            <div className="block md:hidden mb-2">
              <label className="text-[11px] font-medium text-slate-400 block mb-1">Select Domain</label>
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="w-full bg-slate-900 text-slate-200 rounded-lg px-3 py-2 text-xs border border-slate-700"
              >
                <option value="all">All Integrations ({apis.length})</option>
                {categories.map(cat => {
                  const s = getCategoryStats(cat);
                  return (
                    <option key={cat} value={cat}>
                      {cat} ({s.configured}/{s.total})
                    </option>
                  );
                })}
              </select>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-400 text-xs gap-3">
                <Loader2 size={28} className="animate-spin text-blue-400" />
                <span>Decrypting configuration vault...</span>
              </div>
            ) : filteredApis.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 text-center space-y-2">
                <Search size={32} className="text-slate-600 mb-1" />
                <div className="text-sm font-semibold text-slate-300">No matching APIs found</div>
                <p className="text-xs text-slate-500 max-w-sm">
                  Try adjusting your search query or reset the filter mode to view all available services.
                </p>
                <button
                  onClick={() => { setSearch(''); setFilterMode('all'); setSelectedCategory('all'); }}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline font-medium"
                >
                  Clear all filters
                </button>
              </div>
            ) : (
              filteredApis.map(api => {
                const fields = getKeyFields(api);
                const isConfigured = isApiConfigured(api);
                const cardValidation = fields.map(f => validations[f]).find(v => v !== undefined);
                const isValidatingCard = fields.some(f => validations[f]?.validating);
                const isCardConfigured = fields.some(f => isFieldConfigured(f));
                const dirtyFields = fields.filter(f => {
                  const val = inputValues[f];
                  return val !== undefined && val.trim() !== '' && !val.includes('••••');
                });
                const hasDirtyFields = dirtyFields.length > 0;
                const isSavingCard = savingProvider === api.id;

                return (
                  <div
                    key={api.id}
                    className="bg-slate-900/60 rounded-xl border border-slate-800/80 hover:border-slate-700/80 p-4 transition shadow-sm hover:shadow-md"
                  >
                    {/* Service Header Row */}
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-2.5">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mt-0.5 shrink-0">
                          {getCategoryIcon(api.category)}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-bold text-slate-100">{api.name}</h3>

                            {/* Status Chip */}
                            {isConfigured ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                Configured
                              </span>
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1">
                                <AlertTriangle size={10} className="text-amber-400/80" /> Not Configured
                              </span>
                            )}

                            {/* Tier Badge */}
                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-700/60 font-mono">
                              {api.rateLimit}
                            </span>
                          </div>

                          <p className="text-xs text-slate-400 mt-1 max-w-xl leading-relaxed">
                            {api.description}
                          </p>
                        </div>
                      </div>

                      {/* External Registration / Docs Links */}
                      <div className="flex items-center gap-2 shrink-0">
                        {api.docsUrl && (
                          <a
                            href={api.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 px-2 py-1 rounded bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 transition"
                            title="Open Technical Documentation"
                          >
                            <span>Docs</span>
                            <ExternalLink size={10} />
                          </a>
                        )}

                        {api.registrationUrl && (
                          <a
                            href={api.registrationUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/25 transition font-medium"
                            title="Register and get API Key"
                          >
                            <span>Get API Key</span>
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Credential Inputs Section */}
                    <div className="space-y-3 mt-3.5 pt-3 border-t border-slate-800/80">
                      {fields.map(field => {
                        const status = keyStatuses[field];
                        const isSavedUserKey = status?.source === 'user';
                        const isEnvKey = status?.source === 'env';
                        const hasConfigured = status?.configured;
                        const isVisible = Boolean(visibleFields[field]);
                        const currentVal = inputValues[field] !== undefined ? inputValues[field] : '';
                        const isDirty = currentVal.trim() !== '' && !currentVal.includes('••••');
                        const validation = validations[field];
                        const isSavingThis = savingKey === field;

                        return (
                          <div key={field} className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/70 space-y-1.5">
                            
                            {/* Label & Origin Badges */}
                            <div className="flex flex-wrap items-center justify-between text-xs gap-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-slate-200 font-semibold tracking-wide text-[11px]">
                                  {field}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(field)}
                                  className="text-slate-500 hover:text-slate-300 transition"
                                  title="Copy variable name"
                                >
                                  {copiedField === field ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                                </button>
                              </div>

                              <div className="flex items-center gap-1.5">
                                {isSavedUserKey && (
                                  <span className="text-[10px] text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1 font-medium">
                                    <Lock size={10} /> Saved in Encrypted Vault
                                  </span>
                                )}
                                {isEnvKey && (
                                  <span className="text-[10px] text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 flex items-center gap-1 font-medium">
                                    <Globe2 size={10} /> Dev Default (.env)
                                  </span>
                                )}
                                {isDirty && (
                                  <span className="text-[10px] text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30 font-medium">
                                    Unsaved Changes
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Input Field & Inline Actions */}
                            <div className="flex items-center gap-2">
                              <div className="relative flex-1">
                                <input
                                  type={isVisible ? 'text' : 'password'}
                                  placeholder={
                                    hasConfigured
                                      ? `${status.masked || '••••••••'} (Stored securely in device vault)`
                                      : `Paste ${field} here...`
                                  }
                                  value={currentVal}
                                  onChange={e => {
                                    const val = e.target.value;
                                    // Smart detection for pasted kaggle.json token
                                    if ((field === 'KAGGLE_USERNAME' || field === 'KAGGLE_KEY') && val.trim().startsWith('{') && val.includes('username') && val.includes('key')) {
                                      try {
                                        const parsed = JSON.parse(val.trim()) as { username?: string; key?: string };
                                        if (parsed.username && parsed.key) {
                                          setInputValues(prev => ({
                                            ...prev,
                                            KAGGLE_USERNAME: parsed.username!,
                                            KAGGLE_KEY: parsed.key!,
                                          }));
                                          setFeedback({
                                            type: 'success',
                                            message: 'Parsed Kaggle Username & API Key from pasted kaggle.json! Click Save to store securely in your device vault.',
                                          });
                                          return;
                                        }
                                      } catch { /* proceed with normal text */ }
                                    }

                                    setInputValues(prev => ({ ...prev, [field]: val }));
                                    if (validations[field]) {
                                      setValidations(prev => {
                                        const n = { ...prev };
                                        delete n[field];
                                        return n;
                                      });
                                    }
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && isDirty) {
                                      handleSaveSingleKey(field);
                                    }
                                  }}
                                  className={`w-full bg-slate-900 text-slate-100 rounded-lg pl-3 pr-8 py-2 text-xs font-mono border transition ${
                                    isDirty
                                      ? 'border-blue-500/80 ring-1 ring-blue-500/40'
                                      : 'border-slate-700/80 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                                  } placeholder:text-slate-500`}
                                />

                                <button
                                  type="button"
                                  onClick={() => setVisibleFields(prev => ({ ...prev, [field]: !prev[field] }))}
                                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition p-0.5"
                                  title={isVisible ? 'Hide key' : 'Show key in plaintext'}
                                >
                                  {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                              </div>

                              {/* Save Single Key Button */}
                              {isDirty && (
                                <button
                                  type="button"
                                  disabled={isSavingThis}
                                  onClick={() => handleSaveSingleKey(field)}
                                  className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shrink-0 shadow-sm shadow-blue-500/20"
                                  title="Save this key to encrypted storage"
                                >
                                  {isSavingThis ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                                  <span>Save</span>
                                </button>
                              )}

                              {/* Undo Changes Button */}
                              {isDirty && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setInputValues(prev => {
                                      const n = { ...prev };
                                      delete n[field];
                                      return n;
                                    });
                                  }}
                                  className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition shrink-0"
                                  title="Discard edit"
                                >
                                  <RotateCcw size={13} />
                                </button>
                              )}

                              {/* Delete User Key Button */}
                              {isSavedUserKey && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteKey(field)}
                                  className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition border border-transparent hover:border-rose-500/20 shrink-0"
                                  title="Remove key from user vault"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Unified Service Card Action Bar (Professional Standard) */}
                    <div className="mt-3.5 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                      {/* Left: Validation Status or Config Summary */}
                      <div className="flex-1 min-w-[240px]">
                        {cardValidation ? (
                          <div
                            className={`text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-2 font-sans ${
                              cardValidation.valid
                                ? 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/25'
                                : 'text-rose-300 bg-rose-500/10 border border-rose-500/25'
                            }`}
                          >
                            {cardValidation.valid ? (
                              <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                            ) : (
                              <AlertCircle size={13} className="text-rose-400 shrink-0" />
                            )}
                            <span className="truncate">{cardValidation.message}</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500 font-mono">
                            {isCardConfigured ? '● Credentials ready for verification' : '○ Not yet configured'}
                          </span>
                        )}
                      </div>

                      {/* Right: Unified Test Connection Button & Save Provider Keys */}
                      <div className="flex items-center gap-2 shrink-0">
                        {hasDirtyFields && (
                          <button
                            type="button"
                            disabled={isSavingCard}
                            onClick={() => handleSaveProvider(api)}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shadow-sm shadow-blue-500/20"
                            title={`Save modified credentials for ${api.name}`}
                          >
                            {isSavingCard ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                            <span>Save Changes ({dirtyFields.length})</span>
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={isValidatingCard || !isCardConfigured}
                          onClick={() => handleValidateApi(api)}
                          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition flex items-center gap-1.5 shrink-0 ${
                            cardValidation?.valid === true
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                              : cardValidation?.valid === false
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20'
                              : 'bg-slate-800 hover:bg-slate-700/90 text-slate-200 border-slate-700/80 disabled:opacity-40'
                          }`}
                          title={`Verify connection to ${api.name}`}
                        >
                          {isValidatingCard ? (
                            <Loader2 size={13} className="animate-spin text-blue-400" />
                          ) : (
                            <RefreshCw size={13} className={cardValidation?.valid ? 'text-emerald-400' : 'text-slate-400'} />
                          )}
                          <span>{isValidatingCard ? 'Testing...' : 'Test Connection'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </main>
        </div>

        {/* ── FOOTER TOOLBAR ── */}
        <div className="px-5 py-3 border-t border-slate-800/90 bg-slate-950/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-medium text-slate-300">{userVaultCount} User Keys</span>
            </div>
            <span className="text-slate-600">•</span>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              <span className="font-medium text-slate-300">{envFallbackCount} Dev Defaults</span>
            </div>
            {unsavedCount > 0 && (
              <>
                <span className="text-slate-600">•</span>
                <span className="text-amber-400 font-semibold animate-pulse">
                  {unsavedCount} pending modification(s)
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/80 transition font-medium"
            >
              {isOnboarding ? 'Skip & Launch Cockpit' : 'Close'}
            </button>

            <button
              type="button"
              disabled={savingAll}
              onClick={handleSaveAll}
              className="px-5 py-2 text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 text-white font-bold rounded-lg transition flex items-center gap-2 shadow-lg shadow-blue-500/25"
            >
              {savingAll ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span>
                {savingAll
                  ? 'Encrypting & Saving...'
                  : isOnboarding
                  ? (unsavedCount > 0 ? `Save & Launch (${unsavedCount})` : 'Launch Cockpit')
                  : `Save All Changes (${unsavedCount})`}
              </span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
