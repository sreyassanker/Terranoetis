import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Cpu, Download, X, Search, Check, Trash2, Sparkles, Eye,
  Zap, HardDrive, RefreshCw, Layers, AlertCircle, CheckCircle2, ChevronDown, ChevronUp
} from 'lucide-react';
import { toast } from 'sonner';

interface DeviceSpecs {
  cpu: string;
  cores: number;
  ramTotalGb: number;
  ramFreeGb: number;
  platform: string;
  arch: string;
  isAppleSilicon: boolean;
  recommendedMaxGb: number;
  recommendation: string;
  deviceTier: 'ultra-light' | 'compact' | 'standard' | 'high-performance';
}

interface CuratedModel {
  id: string;
  name: string;
  repo: string;
  file: string;
  sizeGb: number;
  sizeFormatted: string;
  parameters: string;
  contextWindow: string;
  description: string;
  category: 'under1gb' | 'under2gb' | 'vision' | 'allRounder';
  isVision: boolean;
  isAllRounder: boolean;
  isUnder1Gb: boolean;
  isUnder2Gb: boolean;
  downloadUrl: string;
  recommendedForDevice?: boolean;
}

interface InstalledModel {
  filename: string;
  path: string;
  sizeBytes: number;
  sizeGb: number;
  sizeFormatted: string;
  active: boolean;
  modifiedAt: string;
}

interface DownloadStatus {
  running: boolean;
  repoId: string;
  fileName: string;
  downloadUrl: string;
  received: number;
  total: number;
  percent: number;
  speedBytes: number;
  etaSeconds: number;
  done: boolean;
  error?: string;
  cancelled?: boolean;
  resuming?: boolean;
}

interface HuggingFaceRepo {
  id: string;
  author: string;
  name: string;
  downloads: number;
  likes: number;
  pipelineTag: string;
  tags: string[];
  description: string;
  updatedAt: string;
}

interface RepoGgufFile {
  name: string;
  sizeBytes: number;
  sizeGb: number;
  sizeFormatted: string;
  quant: string;
  downloadUrl: string;
  isRecommendedQuant: boolean;
}

interface LocalAiHubProps {
  token: string | null;
}

type TabType = 'recommended' | 'under1gb' | 'under2gb' | 'vision' | 'allRounder' | 'installed' | 'search';

export const LocalAiHub: React.FC<LocalAiHubProps> = ({ token }) => {
  const [activeTab, setActiveTab] = useState<TabType>('recommended');
  const [deviceSpecs, setDeviceSpecs] = useState<DeviceSpecs | null>(null);
  const [curatedModels, setCuratedModels] = useState<CuratedModel[]>([]);
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HuggingFaceRepo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [repoFiles, setRepoFiles] = useState<Record<string, RepoGgufFile[]>>({});
  const [loadingRepoFiles, setLoadingRepoFiles] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const authHeaders = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    const effectiveToken = token || (typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null);
    if (effectiveToken) {
      h.Authorization = `Bearer ${effectiveToken}`;
    }
    return h;
  }, [token]);

  // Quick matching curated models for search
  const matchingCurated = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return curatedModels.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.repo.toLowerCase().includes(q) ||
      m.file.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      m.parameters.toLowerCase().includes(q)
    );
  }, [searchQuery, curatedModels]);

  // Format seconds into clean m/s string
  const formatEta = (seconds: number): string => {
    if (seconds <= 0) return 'calculating…';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  // Fetch installed models
  const fetchInstalledModels = useCallback(async () => {
    try {
      const resp = await fetch('/api/admin/local-ai/installed', { headers: authHeaders });
      if (resp.ok) {
        const data = await resp.json();
        setInstalledModels(data.models || []);
        setActiveModel(data.activeModel || null);
      }
    } catch { /* silent */ }
  }, [authHeaders]);

  // Fetch device specs and curated catalog
  const fetchCatalogAndSpecs = useCallback(async () => {
    try {
      const resp = await fetch('/api/admin/local-ai/catalog', { headers: authHeaders });
      if (resp.ok) {
        const data = await resp.json();
        setDeviceSpecs(data.device || null);
        setCuratedModels(data.models || []);
      }
    } catch { /* silent */ }
  }, [authHeaders]);

  // Fetch live download status
  const fetchDownloadStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/admin/local-ai/download-status', { headers: authHeaders });
      if (resp.ok) {
        const data = (await resp.json()) as DownloadStatus;
        setDownloadStatus(data);
        if (data.done) {
          toast.success(`Download completed: ${data.fileName}`);
          void fetchInstalledModels();
        } else if (data.error) {
          toast.error(`Download failed: ${data.error}`);
        }
      }
    } catch { /* silent */ }
  }, [authHeaders, fetchInstalledModels]);

  // Initial load
  useEffect(() => {
    void fetchCatalogAndSpecs();
    void fetchInstalledModels();
    void fetchDownloadStatus();
  }, [fetchCatalogAndSpecs, fetchInstalledModels, fetchDownloadStatus]);

  // Refresh installed models when switching tabs
  useEffect(() => {
    void fetchInstalledModels();
  }, [activeTab, fetchInstalledModels]);

  // High-frequency polling during active download for accurate real-time percentage
  useEffect(() => {
    if (!downloadStatus?.running) return;
    const interval = setInterval(() => {
      void fetchDownloadStatus();
    }, 500);
    return () => clearInterval(interval);
  }, [downloadStatus?.running, fetchDownloadStatus]);

  // Hugging Face Hub Search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const resp = await fetch(`/api/admin/local-ai/search?q=${encodeURIComponent(searchQuery)}`, {
          headers: authHeaders,
        });
        if (resp.ok) {
          const data = await resp.json();
          setSearchResults(data.results || []);
        }
      } catch {
        toast.error('Failed to search Hugging Face');
      } finally {
        setIsSearching(false);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [searchQuery, authHeaders]);

  // Fetch repo GGUF files when expanding a Hugging Face repo
  const toggleRepoFiles = async (repoId: string) => {
    if (expandedRepo === repoId) {
      setExpandedRepo(null);
      return;
    }
    setExpandedRepo(repoId);
    if (repoFiles[repoId]) return;

    setLoadingRepoFiles(prev => ({ ...prev, [repoId]: true }));
    try {
      const resp = await fetch(`/api/admin/local-ai/repo-files?repo=${encodeURIComponent(repoId)}`, {
        headers: authHeaders,
      });
      if (resp.ok) {
        const data = await resp.json();
        setRepoFiles(prev => ({ ...prev, [repoId]: data.files || [] }));
      } else {
        toast.error('Could not list GGUF files in this repository');
      }
    } catch {
      toast.error('Network error fetching repository files');
    } finally {
      setLoadingRepoFiles(prev => ({ ...prev, [repoId]: false }));
    }
  };

  // Start Download
  const handleStartDownload = async (repoId: string, fileName: string, downloadUrl: string) => {
    setActionLoading(`download-${fileName}`);
    setDownloadStatus({
      running: true,
      repoId,
      fileName,
      downloadUrl,
      received: 0,
      total: 0,
      percent: 0,
      speedBytes: 0,
      etaSeconds: 0,
      done: false,
      cancelled: false,
    });
    try {
      const resp = await fetch('/api/admin/local-ai/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ repoId, fileName, downloadUrl }),
      });
      if (resp.ok) {
        toast.success(`Download started: ${fileName}`);
        void fetchDownloadStatus();
      } else {
        const err = await resp.json().catch(() => ({}));
        setDownloadStatus(null);
        toast.error(err.error || 'Failed to start download');
      }
    } catch {
      setDownloadStatus(null);
      toast.error('Network error starting download');
    } finally {
      setActionLoading(null);
    }
  };

  // Cancel Download
  const handleCancelDownload = async () => {
    setActionLoading('cancel');
    try {
      const resp = await fetch('/api/admin/local-ai/cancel', {
        method: 'POST',
        headers: authHeaders,
      });
      if (resp.ok) {
        toast.info('Download cancelled. Partial file kept for resuming.');
        void fetchDownloadStatus();
      } else {
        toast.error('Failed to cancel download');
      }
    } catch {
      toast.error('Network error cancelling download');
    } finally {
      setActionLoading(null);
    }
  };

  // Activate Model
  const handleActivateModel = async (filename: string) => {
    setActionLoading(`activate-${filename}`);
    try {
      const resp = await fetch('/api/admin/local-ai/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ filename }),
      });
      if (resp.ok) {
        const res = await resp.json();
        setActiveModel(filename);
        toast.success(res.message || `Activated ${filename}`);
        void fetchInstalledModels();
      } else {
        toast.error('Failed to activate model');
      }
    } catch {
      toast.error('Network error activating model');
    } finally {
      setActionLoading(null);
    }
  };

  // Two-step inline delete confirmation (replaces window.confirm for Tauri / WKWebView compatibility)
  const [confirmDeleteModel, setConfirmDeleteModel] = useState<string | null>(null);
  const confirmDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
    };
  }, []);

  const requestDeleteModel = (filename: string) => {
    setConfirmDeleteModel(filename);
    if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
    confirmDeleteTimerRef.current = setTimeout(() => {
      setConfirmDeleteModel(null);
    }, 6000);
  };

  const executeDeleteModel = async (filename: string) => {
    if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
    setConfirmDeleteModel(null);
    setActionLoading(`delete-${filename}`);
    try {
      const resp = await fetch(`/api/admin/local-ai/models/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        toast.success(data.message || `Deleted ${filename}`);
        if (activeModel === filename) {
          setActiveModel(null);
        }
        void fetchInstalledModels();
      } else {
        toast.error(data.message || 'Failed to delete model');
      }
    } catch {
      toast.error('Network error deleting model');
    } finally {
      setActionLoading(null);
    }
  };

  const renderDeleteButton = (filename: string, size: 'small' | 'normal' = 'normal') => {
    const isConfirming = confirmDeleteModel === filename;
    const isDeleting = actionLoading === `delete-${filename}`;

    if (isConfirming) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => void executeDeleteModel(filename)}
            disabled={isDeleting}
            style={{
              padding: size === 'small' ? '3px 8px' : '5px 10px',
              borderRadius: 6,
              background: '#dc2626',
              border: '1px solid #ef4444',
              color: '#ffffff',
              cursor: isDeleting ? 'not-allowed' : 'pointer',
              fontSize: 10,
              fontWeight: 700,
              boxShadow: '0 0 10px rgba(239, 68, 68, 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {isDeleting ? <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={10} />}
            <span>{isDeleting ? 'Deleting…' : 'Confirm Delete?'}</span>
          </button>
          <button
            onClick={() => setConfirmDeleteModel(null)}
            disabled={isDeleting}
            style={{
              padding: size === 'small' ? '3px 6px' : '5px 8px',
              borderRadius: 6,
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: 10,
            }}
          >
            Cancel
          </button>
        </div>
      );
    }

    return (
      <button
        onClick={() => requestDeleteModel(filename)}
        disabled={isDeleting}
        style={{
          padding: size === 'small' ? '4px 6px' : '5px 8px',
          borderRadius: 6,
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#f87171',
          cursor: 'pointer',
          fontSize: 11,
          transition: 'all 0.15s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
        title="Delete model file from disk"
      >
        <Trash2 size={size === 'small' ? 12 : 13} />
      </button>
    );
  };

  // Filter models for active tab
  const filteredCurated = useMemo(() => {
    if (activeTab === 'recommended') {
      return curatedModels.filter(m => m.recommendedForDevice);
    }
    if (activeTab === 'under1gb') {
      return curatedModels.filter(m => m.isUnder1Gb);
    }
    if (activeTab === 'under2gb') {
      return curatedModels.filter(m => m.isUnder2Gb);
    }
    if (activeTab === 'vision') {
      return curatedModels.filter(m => m.isVision);
    }
    if (activeTab === 'allRounder') {
      return curatedModels.filter(m => m.isAllRounder);
    }
    return curatedModels;
  }, [activeTab, curatedModels]);

  const isModelInstalled = (filename: string) => {
    return installedModels.some(m => m.filename.toLowerCase() === filename.toLowerCase());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Hardware Profiler & Recommendation Banner ── */}
      {deviceSpecs && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.85) 100%)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          borderRadius: 12,
          padding: '14px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'rgba(59, 130, 246, 0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#60a5fa',
              }}>
                <Cpu size={18} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>
                  {deviceSpecs.cpu} {deviceSpecs.isAppleSilicon && <span style={{ color: '#38bdf8', fontSize: 11, marginLeft: 4 }}>(Metal GPU Accelerated)</span>}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  {deviceSpecs.ramTotalGb} GB Total RAM · {deviceSpecs.cores} CPU Cores · {deviceSpecs.platform.toUpperCase()}
                </div>
              </div>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(34, 197, 94, 0.12)', border: '1px solid rgba(34, 197, 94, 0.3)',
              borderRadius: 20, padding: '4px 12px', fontSize: 11, color: '#4ade80', fontWeight: 500,
            }}>
              <Zap size={13} />
              <span>Recommended Model Size: ≤ {deviceSpecs.recommendedMaxGb.toFixed(1)} GB</span>
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.5, background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: 8 }}>
            <span style={{ color: '#60a5fa', fontWeight: 600 }}>Device Analysis: </span>
            {deviceSpecs.recommendation}
          </div>
        </div>
      )}

      {/* ── Active Download Card with Professional High-Tech Animation & Live Accurate Progress ── */}
      {downloadStatus && (downloadStatus.running || downloadStatus.error) && (
        <div
          className={downloadStatus.error ? '' : 'ai-download-card-pro'}
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 40,
            background: downloadStatus.error
              ? 'linear-gradient(135deg, rgba(127, 29, 29, 0.95) 0%, rgba(24, 15, 15, 0.95) 100%)'
              : 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)',
            backdropFilter: 'blur(16px)',
            border: downloadStatus.error ? '1px solid rgba(239, 68, 68, 0.6)' : '1px solid rgba(56, 189, 248, 0.35)',
            borderRadius: 12,
            padding: '16px 20px',
            boxShadow: downloadStatus.error ? '0 10px 30px rgba(239, 68, 68, 0.3)' : '0 10px 32px rgba(14, 165, 233, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {downloadStatus.error ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <AlertCircle size={20} style={{ color: '#f87171', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fca5a5' }}>
                    Download Interrupted: {downloadStatus.fileName}
                  </div>
                  <div style={{ fontSize: 11, color: '#f87171', marginTop: 2 }}>
                    {downloadStatus.error}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setDownloadStatus(null)}
                style={{
                  padding: '6px 14px', borderRadius: 6,
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#e2e8f0', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                }}
              >
                Dismiss
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="ai-beacon-ring" />
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', letterSpacing: '0.01em' }}>
                    {downloadStatus.resuming ? 'Resuming Download' : 'Downloading Local AI Model'}
                  </div>
                  <span style={{ fontSize: 11, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace' }}>
                    {downloadStatus.fileName}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    fontSize: 16, fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace',
                    textShadow: '0 0 12px rgba(56, 189, 248, 0.6)',
                  }}>
                    {downloadStatus.percent}%
                  </div>

                  {/* Cancel Button */}
                  <button
                    onClick={handleCancelDownload}
                    disabled={actionLoading === 'cancel'}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 12px', borderRadius: 6,
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      color: '#f87171', fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.3)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'; }}
                  >
                    <X size={13} />
                    <span>Cancel</span>
                  </button>
                </div>
              </div>

              {/* High-Tech Animated Liquid / Laser Scan Progress Bar */}
              <div className="ai-progress-track-pro">
                {downloadStatus.percent === 0 && (!downloadStatus.received || downloadStatus.received === 0) ? (
                  <div className="ai-progress-scanner-pro" />
                ) : (
                  <div
                    className="ai-progress-fill-pro"
                    style={{ width: `${Math.max(1.5, Math.min(100, downloadStatus.percent))}%` }}
                  />
                )}
              </div>

              {/* Progress Stats & Real-time Metrics */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#cbd5e1', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <HardDrive size={13} style={{ color: '#38bdf8' }} />
                  <span style={{ fontFamily: 'monospace' }}>
                    {downloadStatus.total > 0
                      ? `${(downloadStatus.received / 1e9).toFixed(2)} GB / ${(downloadStatus.total / 1e9).toFixed(2)} GB`
                      : downloadStatus.received > 0
                        ? `${(downloadStatus.received / 1e6).toFixed(1)} MB downloaded (connecting…)`
                        : 'Connecting to Hugging Face CDN & Allocating Buffer…'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {downloadStatus.speedBytes > 0 && (
                    <span style={{
                      color: '#38bdf8', fontWeight: 600,
                      background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.25)',
                      padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace',
                    }}>
                      ⚡ {(downloadStatus.speedBytes / 1e6).toFixed(1)} MB/s
                    </span>
                  )}
                  {downloadStatus.etaSeconds > 0 && (
                    <span style={{
                      color: '#94a3b8', background: 'rgba(255, 255, 255, 0.05)',
                      padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace',
                    }}>
                      ⏱ ~{formatEta(downloadStatus.etaSeconds)} left
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Search Bar & Filter Header ── */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        background: 'rgba(255, 255, 255, 0.02)', padding: 14, borderRadius: 12,
        border: '1px solid rgba(255, 255, 255, 0.06)',
      }}>
        {/* Search Input */}
        <div style={{ position: 'relative', width: '100%' }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: '#64748b' }} />
          <input
            type="text"
            placeholder="Search any model on Hugging Face (e.g. Qwen, Llama, Mistral, Gemma, Phi, DeepSeek, Vision)..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value.trim() && activeTab !== 'search') {
                setActiveTab('search');
              }
            }}
            style={{
              width: '100%',
              padding: '10px 38px 10px 36px',
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 8,
              color: '#f8fafc',
              fontSize: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setActiveTab('recommended'); }}
              style={{
                position: 'absolute', right: 10, top: 10,
                background: 'transparent', border: 'none', color: '#64748b',
                cursor: 'pointer', padding: 2,
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Category Navigation Pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => setActiveTab('recommended')}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5, border: 'none',
              background: activeTab === 'recommended' ? '#2563eb' : 'rgba(255, 255, 255, 0.05)',
              color: activeTab === 'recommended' ? '#fff' : '#94a3b8',
              transition: 'all 0.15s',
            }}
          >
            <Zap size={12} style={{ color: activeTab === 'recommended' ? '#fde047' : '#eab308' }} />
            <span>Recommended for Your Device</span>
          </button>

          <button
            onClick={() => setActiveTab('under1gb')}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5, border: 'none',
              background: activeTab === 'under1gb' ? '#2563eb' : 'rgba(255, 255, 255, 0.05)',
              color: activeTab === 'under1gb' ? '#fff' : '#94a3b8',
            }}
          >
            <span>&lt; 1 GB (Ultra-Fast)</span>
          </button>

          <button
            onClick={() => setActiveTab('under2gb')}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5, border: 'none',
              background: activeTab === 'under2gb' ? '#2563eb' : 'rgba(255, 255, 255, 0.05)',
              color: activeTab === 'under2gb' ? '#fff' : '#94a3b8',
            }}
          >
            <span>&lt; 2 GB (Balanced)</span>
          </button>

          <button
            onClick={() => setActiveTab('vision')}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5, border: 'none',
              background: activeTab === 'vision' ? '#7c3aed' : 'rgba(255, 255, 255, 0.05)',
              color: activeTab === 'vision' ? '#fff' : '#94a3b8',
            }}
          >
            <Eye size={12} style={{ color: activeTab === 'vision' ? '#e9d5ff' : '#a855f7' }} />
            <span>Vision & Multimodal</span>
          </button>

          <button
            onClick={() => setActiveTab('allRounder')}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5, border: 'none',
              background: activeTab === 'allRounder' ? '#0891b2' : 'rgba(255, 255, 255, 0.05)',
              color: activeTab === 'allRounder' ? '#fff' : '#94a3b8',
            }}
          >
            <Sparkles size={12} style={{ color: activeTab === 'allRounder' ? '#a5f3fc' : '#06b6d4' }} />
            <span>All-Rounder Chat</span>
          </button>

          <button
            onClick={() => setActiveTab('installed')}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5, border: 'none', marginLeft: 'auto',
              background: activeTab === 'installed' ? '#059669' : 'rgba(255, 255, 255, 0.05)',
              color: activeTab === 'installed' ? '#fff' : '#94a3b8',
            }}
          >
            <HardDrive size={12} style={{ color: activeTab === 'installed' ? '#a7f3d0' : '#10b981' }} />
            <span>Installed Models ({installedModels.length})</span>
          </button>
        </div>
      </div>

      {/* ── Hugging Face Live Hub Search Tab ── */}
      {activeTab === 'search' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Curated Pre-Tested Models Matching Query */}
          {matchingCurated.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={13} />
                <span>Verified Pre-Tested Models Matching &quot;{searchQuery}&quot; ({matchingCurated.length})</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
                {matchingCurated.map((model) => {
                  const installed = isModelInstalled(model.file);
                  const isDownloading = downloadStatus?.running && downloadStatus.fileName === model.file;
                  const isActive = activeModel === model.file;

                  return (
                    <div
                      key={`curated-${model.id}`}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                        borderRadius: 10,
                        padding: 14,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 12,
                        boxShadow: '0 4px 14px rgba(56, 189, 248, 0.08)',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc' }}>
                              {model.name}
                            </div>
                            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                              {model.repo}
                            </div>
                          </div>

                          <div style={{
                            fontSize: 10, fontWeight: 600, color: '#38bdf8',
                            background: 'rgba(56, 189, 248, 0.12)', padding: '2px 8px', borderRadius: 4,
                          }}>
                            {model.sizeFormatted}
                          </div>
                        </div>

                        <div style={{ fontSize: 11, color: '#94a3b8', margin: '8px 0', lineHeight: 1.45 }}>
                          {model.description}
                        </div>

                        {/* Feature Badges */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                          {model.recommendedForDevice && (
                            <span style={{ fontSize: 9, color: '#4ade80', background: 'rgba(34, 197, 94, 0.1)', padding: '1px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                              <Zap size={10} /> Recommended for your Mac
                            </span>
                          )}
                          {model.isVision && (
                            <span style={{ fontSize: 9, color: '#c084fc', background: 'rgba(168, 85, 247, 0.1)', padding: '1px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                              <Eye size={10} /> Vision & Multimodal
                            </span>
                          )}
                          {model.isAllRounder && (
                            <span style={{ fontSize: 9, color: '#67e8f9', background: 'rgba(6, 182, 212, 0.1)', padding: '1px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                              <Sparkles size={10} /> All-Rounder Chat
                            </span>
                          )}
                          <span style={{ fontSize: 9, color: '#cbd5e1', background: 'rgba(255, 255, 255, 0.05)', padding: '1px 6px', borderRadius: 4 }}>
                            {model.contextWindow} Context
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        {installed ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Check size={12} /> Installed
                            </span>
                            {isActive ? (
                              <span style={{ fontSize: 10, color: '#4ade80', background: 'rgba(34, 197, 94, 0.15)', padding: '2px 6px', borderRadius: 4 }}>
                                Active
                              </span>
                            ) : (
                              <button
                                onClick={() => handleActivateModel(model.file)}
                                disabled={actionLoading === `activate-${model.file}`}
                                style={{
                                  padding: '4px 10px', borderRadius: 4,
                                  background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.3)',
                                  color: '#60a5fa', cursor: 'pointer', fontSize: 10,
                                }}
                              >
                                Activate
                              </button>
                            )}
                          </div>
                        ) : isDownloading ? (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '5px 12px', borderRadius: 6,
                            background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.4)',
                            color: '#38bdf8', fontSize: 11, fontWeight: 600,
                          }}>
                            <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
                            <span>Downloading {downloadStatus?.percent || 0}%</span>
                            {downloadStatus && downloadStatus.speedBytes > 0 && (
                              <span style={{ fontSize: 10, color: '#93c5fd' }}>
                                ({(downloadStatus.speedBytes / 1e6).toFixed(1)} MB/s)
                              </span>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => handleStartDownload(model.repo, model.file, model.downloadUrl)}
                            disabled={Boolean(downloadStatus?.running) || actionLoading === `download-${model.file}`}
                            style={{
                              padding: '6px 14px', borderRadius: 6,
                              background: 'rgba(59, 130, 246, 0.85)',
                              border: 'none', color: '#fff', fontSize: 11, fontWeight: 500,
                              cursor: downloadStatus?.running ? 'not-allowed' : 'pointer',
                              display: 'flex', alignItems: 'center', gap: 5,
                            }}
                          >
                            <Download size={12} />
                            <span>Download Model</span>
                          </button>
                        )}

                        {installed && renderDeleteButton(model.file, 'small')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Hugging Face Hub Community Repositories */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#94a3b8' }}>
              <span>Hugging Face Hub Repositories for &quot;{searchQuery}&quot;</span>
              {isSearching && <span style={{ color: '#60a5fa' }}>Searching Hub…</span>}
            </div>

            {searchResults.length === 0 && !isSearching && matchingCurated.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 20px', color: '#64748b', fontSize: 12 }}>
                No models found matching &quot;{searchQuery}&quot;. Try searching for &quot;llama-3.2&quot;, &quot;qwen2.5&quot;, or &quot;gemma&quot;.
              </div>
            )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {searchResults.map((repo) => {
              const isExpanded = expandedRepo === repo.id;
              const files = repoFiles[repo.id] || [];
              const isLoadingFiles = loadingRepoFiles[repo.id] || false;

              return (
                <div
                  key={repo.id}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 10,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>
                        {repo.id}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        {repo.downloads.toLocaleString()} downloads · {repo.likes.toLocaleString()} likes · {repo.pipelineTag}
                      </div>
                    </div>

                    <button
                      onClick={() => toggleRepoFiles(repo.id)}
                      style={{
                        padding: '6px 12px', borderRadius: 6,
                        background: isExpanded ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: isExpanded ? '#60a5fa' : '#cbd5e1',
                        cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <span>{isExpanded ? 'Hide Files' : 'Inspect GGUF Files'}</span>
                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>

                  {/* Expanded File List for this Repo */}
                  {isExpanded && (
                    <div style={{
                      background: 'rgba(0, 0, 0, 0.25)',
                      borderRadius: 8, padding: 12,
                      display: 'flex', flexDirection: 'column', gap: 8,
                      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8' }}>
                        Available GGUF Quantizations:
                      </div>

                      {isLoadingFiles && (
                        <div style={{ fontSize: 11, color: '#64748b' }}>Inspecting repository files…</div>
                      )}

                      {!isLoadingFiles && files.length === 0 && (
                        <div style={{ fontSize: 11, color: '#64748b' }}>No .gguf files found in this repository.</div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {files.map((file) => {
                          const installed = isModelInstalled(file.name);
                          const isDownloading = downloadStatus?.running && downloadStatus.fileName === file.name;

                          return (
                            <div
                              key={file.name}
                              style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '6px 10px', borderRadius: 6,
                                background: 'rgba(255, 255, 255, 0.02)',
                                border: file.isRecommendedQuant ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(255, 255, 255, 0.04)',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 11, color: '#e2e8f0', fontFamily: 'monospace' }}>
                                  {file.name}
                                </span>
                                <span style={{ fontSize: 10, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '1px 6px', borderRadius: 4 }}>
                                  {file.sizeFormatted}
                                </span>
                                {file.isRecommendedQuant && (
                                  <span style={{ fontSize: 9, color: '#4ade80', background: 'rgba(34, 197, 94, 0.1)', padding: '1px 6px', borderRadius: 4 }}>
                                    Recommended Quant
                                  </span>
                                )}
                              </div>

                              <div>
                                {installed ? (
                                  <span style={{ fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Check size={12} /> Installed
                                  </span>
                                ) : isDownloading ? (
                                  <span style={{ fontSize: 11, color: '#38bdf8', fontWeight: 600 }}>
                                    Downloading {downloadStatus?.percent || 0}%…
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handleStartDownload(repo.id, file.name, file.downloadUrl)}
                                    disabled={Boolean(downloadStatus?.running)}
                                    style={{
                                      padding: '4px 10px', borderRadius: 4,
                                      background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)',
                                      color: '#60a5fa', cursor: 'pointer', fontSize: 11,
                                    }}
                                  >
                                    ⬇ Download ({file.sizeFormatted})
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}

      {/* ── Installed Models Management Tab ── */}
      {activeTab === 'installed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#94a3b8' }}>
            <span>Installed GGUF Models on Local Disk</span>
            <span style={{ color: '#22c55e' }}>{installedModels.length} models ready</span>
          </div>

          {installedModels.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '36px 20px',
              background: 'rgba(255, 255, 255, 0.02)', borderRadius: 10,
              border: '1px solid rgba(255, 255, 255, 0.06)', color: '#64748b', fontSize: 12,
            }}>
              No models downloaded yet. Choose a recommended model from the tabs above or search Hugging Face to download one.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {installedModels.map((model) => {
                const isActive = activeModel === model.filename;

                return (
                  <div
                    key={model.filename}
                    style={{
                      background: isActive ? 'rgba(34, 197, 94, 0.06)' : 'rgba(255, 255, 255, 0.03)',
                      border: isActive ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: 10,
                      padding: 14,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', fontFamily: 'monospace' }}>
                          {model.filename}
                        </span>
                        {isActive && (
                          <span style={{
                            fontSize: 10, color: '#22c55e', background: 'rgba(34, 197, 94, 0.15)',
                            padding: '2px 8px', borderRadius: 4, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                            <CheckCircle2 size={11} /> Active in Copilot
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                        Size: {model.sizeFormatted} · Stored in {model.path.includes('Application Support') ? 'Application Support' : 'Workspace Models'}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {!isActive && (
                        <button
                          onClick={() => handleActivateModel(model.filename)}
                          disabled={actionLoading === `activate-${model.filename}`}
                          style={{
                            padding: '6px 12px', borderRadius: 6,
                            background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.4)',
                            color: '#60a5fa', cursor: 'pointer', fontSize: 11, fontWeight: 500,
                          }}
                        >
                          {actionLoading === `activate-${model.filename}` ? 'Activating…' : 'Activate Model'}
                        </button>
                      )}

                      {renderDeleteButton(model.filename, 'normal')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Curated Catalog Cards & Installed Models Section ── */}
      {activeTab !== 'search' && activeTab !== 'installed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Downloaded Models Section on Active Tab */}
          {installedModels.length > 0 ? (
            <div style={{
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.75) 0%, rgba(20, 30, 48, 0.85) 100%)',
              border: '1px solid rgba(34, 197, 94, 0.35)',
              borderRadius: 12,
              padding: '14px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 size={16} style={{ color: '#22c55e' }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', letterSpacing: '0.02em' }}>
                    Downloaded & Ready Models ({installedModels.length})
                  </span>
                </div>
                <span style={{
                  fontSize: 10, color: '#4ade80', background: 'rgba(34, 197, 94, 0.12)',
                  border: '1px solid rgba(34, 197, 94, 0.25)', padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                }}>
                  ✓ 100% Offline Ready
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {installedModels.map((model) => {
                  const isActive = activeModel === model.filename;
                  return (
                    <div
                      key={model.filename}
                      style={{
                        background: isActive ? 'rgba(34, 197, 94, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                        border: isActive ? '1px solid rgba(34, 197, 94, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: 8,
                        padding: '10px 14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: isActive ? '#22c55e' : '#64748b',
                          boxShadow: isActive ? '0 0 8px #22c55e' : 'none',
                          flexShrink: 0,
                        }} />
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9', fontFamily: 'monospace' }}>
                              {model.filename}
                            </span>
                            {isActive && (
                              <span style={{
                                fontSize: 10, color: '#22c55e', background: 'rgba(34, 197, 94, 0.15)',
                                padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                              }}>
                                Active in Copilot
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                            Size: {model.sizeFormatted} · Available locally
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        {!isActive && (
                          <button
                            onClick={() => handleActivateModel(model.filename)}
                            disabled={actionLoading === `activate-${model.filename}`}
                            style={{
                              padding: '5px 12px', borderRadius: 6,
                              background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.5)',
                              color: '#60a5fa', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.35)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)'; }}
                          >
                            {actionLoading === `activate-${model.filename}` ? 'Activating…' : 'Activate for Copilot'}
                          </button>
                        )}

                        {renderDeleteButton(model.filename, 'normal')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              background: 'rgba(255, 255, 255, 0.02)', border: '1px dashed rgba(255, 255, 255, 0.12)',
              borderRadius: 10, padding: '12px 16px', color: '#94a3b8', fontSize: 11,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <HardDrive size={15} style={{ color: '#64748b' }} />
                <span>No local AI models downloaded yet. Pick a recommended model below to start 100% offline inference.</span>
              </div>
            </div>
          )}

          {/* Curated Catalog Section Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#94a3b8' }}>
            <span>Available Pre-Tested Models</span>
            <span>{filteredCurated.length} options</span>
          </div>

          {/* Catalog Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {filteredCurated.map((model) => {
              const installed = isModelInstalled(model.file);
              const isDownloading = downloadStatus?.running && downloadStatus.fileName === model.file;
              const isActive = activeModel === model.file;

              return (
                <div
                  key={model.id}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: isActive
                      ? '1px solid rgba(34, 197, 94, 0.6)'
                      : installed
                        ? '1px solid rgba(34, 197, 94, 0.35)'
                        : model.recommendedForDevice
                          ? '1px solid rgba(59, 130, 246, 0.3)'
                          : '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 10,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 12,
                    boxShadow: isActive
                      ? '0 4px 18px rgba(34, 197, 94, 0.15)'
                      : model.recommendedForDevice
                        ? '0 4px 14px rgba(59, 130, 246, 0.1)'
                        : 'none',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc' }}>
                          {model.name}
                        </div>
                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                          {model.repo}
                        </div>
                      </div>

                      <div style={{
                        fontSize: 10, fontWeight: 600, color: '#38bdf8',
                        background: 'rgba(56, 189, 248, 0.12)', padding: '2px 8px', borderRadius: 4,
                      }}>
                        {model.sizeFormatted}
                      </div>
                    </div>

                    <div style={{ fontSize: 11, color: '#94a3b8', margin: '8px 0', lineHeight: 1.45 }}>
                      {model.description}
                    </div>

                    {/* Feature Badges */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {model.recommendedForDevice && (
                        <span style={{ fontSize: 9, color: '#4ade80', background: 'rgba(34, 197, 94, 0.1)', padding: '1px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Zap size={10} /> Recommended for your Mac
                        </span>
                      )}
                      {model.isVision && (
                        <span style={{ fontSize: 9, color: '#c084fc', background: 'rgba(168, 85, 247, 0.1)', padding: '1px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Eye size={10} /> Vision & Multimodal
                        </span>
                      )}
                      {model.isAllRounder && (
                        <span style={{ fontSize: 9, color: '#67e8f9', background: 'rgba(6, 182, 212, 0.1)', padding: '1px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Sparkles size={10} /> All-Rounder Chat
                        </span>
                      )}
                      <span style={{ fontSize: 9, color: '#cbd5e1', background: 'rgba(255, 255, 255, 0.05)', padding: '1px 6px', borderRadius: 4 }}>
                        {model.contextWindow} Context
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    {installed ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                          <Check size={12} /> Downloaded & Ready
                        </span>
                        {isActive ? (
                          <span style={{ fontSize: 10, color: '#4ade80', background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                            Active
                          </span>
                        ) : (
                          <button
                            onClick={() => handleActivateModel(model.file)}
                            disabled={actionLoading === `activate-${model.file}`}
                            style={{
                              padding: '4px 10px', borderRadius: 4,
                              background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)',
                              color: '#60a5fa', cursor: 'pointer', fontSize: 10, fontWeight: 600,
                            }}
                          >
                            {actionLoading === `activate-${model.file}` ? 'Activating…' : 'Activate'}
                          </button>
                        )}
                      </div>
                    ) : isDownloading ? (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '5px 12px', borderRadius: 6,
                        background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.4)',
                        color: '#38bdf8', fontSize: 11, fontWeight: 600,
                      }}>
                        <div className="ai-beacon-ring" style={{ width: 8, height: 8 }} />
                        <span>Downloading {downloadStatus?.percent || 0}%</span>
                        {downloadStatus && downloadStatus.speedBytes > 0 && (
                          <span style={{ fontSize: 10, color: '#93c5fd' }}>
                            ({(downloadStatus.speedBytes / 1e6).toFixed(1)} MB/s)
                          </span>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => handleStartDownload(model.repo, model.file, model.downloadUrl)}
                        disabled={Boolean(downloadStatus?.running) || actionLoading === `download-${model.file}`}
                        style={{
                          padding: '6px 14px', borderRadius: 6,
                          background: model.recommendedForDevice ? 'rgba(59, 130, 246, 0.85)' : 'rgba(255, 255, 255, 0.08)',
                          border: 'none', color: '#fff', fontSize: 11, fontWeight: 500,
                          cursor: downloadStatus?.running ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', gap: 5,
                        }}
                      >
                        <Download size={12} />
                        <span>Download Model</span>
                      </button>
                    )}

                    {installed && renderDeleteButton(model.file, 'small')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
export default LocalAiHub;
