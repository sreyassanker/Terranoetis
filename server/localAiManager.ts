import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { logger } from './observability/logger';

export interface DeviceSpecs {
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

export interface CuratedModel {
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

export interface InstalledModel {
  filename: string;
  path: string;
  sizeBytes: number;
  sizeGb: number;
  sizeFormatted: string;
  active: boolean;
  modifiedAt: string;
}

export interface DownloadState {
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
  startedAt?: number;
  resumeOffset?: number;
}

export interface RepoGgufFile {
  name: string;
  sizeBytes: number;
  sizeGb: number;
  sizeFormatted: string;
  quant: string;
  downloadUrl: string;
  isRecommendedQuant: boolean;
}

export interface HuggingFaceModelSummary {
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

class LocalAiManager {
  private activeProcess: ChildProcess | null = null;
  private activeModelPath: string | null = null;
  private activeModelName: string | null = null;
  private downloadAbort: AbortController | null = null;
  private downloadState: DownloadState = {
    running: false,
    repoId: '',
    fileName: '',
    downloadUrl: '',
    received: 0,
    total: 0,
    percent: 0,
    speedBytes: 0,
    etaSeconds: 0,
    done: false,
  };

  private curatedCatalog: CuratedModel[] = [
    // ── Under 1 GB ──
    {
      id: 'qwen2.5-0.5b',
      name: 'Qwen 2.5 0.5B Instruct',
      repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
      file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
      sizeGb: 0.39,
      sizeFormatted: '390 MB',
      parameters: '0.5B',
      contextWindow: '32k',
      description: 'Ultra-fast, micro-footprint model with surprisingly sharp general reasoning. Runs at 70+ tok/s.',
      category: 'under1gb',
      isVision: false,
      isAllRounder: false,
      isUnder1Gb: true,
      isUnder2Gb: true,
      downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    },
    {
      id: 'llama-3.2-1b',
      name: 'Llama 3.2 1B Instruct',
      repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF',
      file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
      sizeGb: 0.77,
      sizeFormatted: '770 MB',
      parameters: '1.2B',
      contextWindow: '128k',
      description: "Meta's flagship compact model. Optimized for on-device reasoning, summarization, and interactive tool use.",
      category: 'under1gb',
      isVision: false,
      isAllRounder: true,
      isUnder1Gb: true,
      isUnder2Gb: true,
      downloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    },
    {
      id: 'smollm2-1.7b',
      name: 'SmolLM2 1.7B Instruct',
      repo: 'HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF',
      file: 'smollm2-1.7b-instruct-q4_k_m.gguf',
      sizeGb: 1.05,
      sizeFormatted: '1.05 GB',
      parameters: '1.7B',
      contextWindow: '8k',
      description: "Hugging Face's state-of-the-art small model trained on curated educational data. High coding accuracy.",
      category: 'under1gb',
      isVision: false,
      isAllRounder: true,
      isUnder1Gb: false,
      isUnder2Gb: true,
      downloadUrl: 'https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF/resolve/main/smollm2-1.7b-instruct-q4_k_m.gguf',
    },

    // ── Under 2 GB ──
    {
      id: 'lfm-2.5-2.6b',
      name: 'LFM 2.5 2.6B (Liquid AI)',
      repo: 'LiquidAI/LFM2.5-2.6B-GGUF',
      file: 'LFM2.5-2.6B-Q4_K_M.gguf',
      sizeGb: 1.67,
      sizeFormatted: '1.67 GB',
      parameters: '2.6B',
      contextWindow: '32k',
      description: 'Next-gen hybrid state-space model. Superior memory footprint with long-range geospatial analysis.',
      category: 'under2gb',
      isVision: false,
      isAllRounder: true,
      isUnder1Gb: false,
      isUnder2Gb: true,
      downloadUrl: 'https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/resolve/main/LFM2.5-2.6B-Q4_K_M.gguf',
    },
    {
      id: 'qwen2.5-1.5b',
      name: 'Qwen 2.5 1.5B Instruct',
      repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
      file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
      sizeGb: 1.12,
      sizeFormatted: '1.12 GB',
      parameters: '1.5B',
      contextWindow: '32k',
      description: 'Leading coder and instruction follower in the <2GB tier. Excels at math, formatting, and structured output.',
      category: 'under2gb',
      isVision: false,
      isAllRounder: true,
      isUnder1Gb: false,
      isUnder2Gb: true,
      downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    },
    {
      id: 'gemma-2-2b',
      name: 'Gemma 2 2B IT (Google)',
      repo: 'bartowski/gemma-2-2b-it-GGUF',
      file: 'gemma-2-2b-it-Q4_K_M.gguf',
      sizeGb: 1.63,
      sizeFormatted: '1.63 GB',
      parameters: '2.6B',
      contextWindow: '8k',
      description: "Google DeepMind's distilled architectural masterpiece. High intellectual density in a lightweight frame.",
      category: 'under2gb',
      isVision: false,
      isAllRounder: true,
      isUnder1Gb: false,
      isUnder2Gb: true,
      downloadUrl: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
    },

    // ── Vision & Multimodal ──
    {
      id: 'moondream2',
      name: 'Moondream 2 Vision',
      repo: 'moondream/moondream2-gguf',
      file: 'moondream2-text-model-f16.gguf',
      sizeGb: 2.84,
      sizeFormatted: '2.84 GB',
      parameters: '1.8B',
      contextWindow: '4k',
      description: 'Ultra-compact vision model designed for image description, map inspection, visual Q&A, and OCR.',
      category: 'vision',
      isVision: true,
      isAllRounder: false,
      isUnder1Gb: false,
      isUnder2Gb: false,
      downloadUrl: 'https://huggingface.co/moondream/moondream2-gguf/resolve/main/moondream2-text-model-f16.gguf',
    },
    {
      id: 'qwen2-vl-2b',
      name: 'Qwen2-VL 2B Instruct',
      repo: 'leafspark/Qwen2-VL-2B-Instruct-GGUF',
      file: 'Qwen2-VL-2B-Instruct.bf16.gguf',
      sizeGb: 3.09,
      sizeFormatted: '3.09 GB',
      parameters: '2.2B',
      contextWindow: '32k',
      description: 'State-of-the-art vision-language model. Capable of understanding complex geospatial diagrams, charts, and maps.',
      category: 'vision',
      isVision: true,
      isAllRounder: false,
      isUnder1Gb: false,
      isUnder2Gb: false,
      downloadUrl: 'https://huggingface.co/leafspark/Qwen2-VL-2B-Instruct-GGUF/resolve/main/Qwen2-VL-2B-Instruct.bf16.gguf',
    },

    // ── All-Rounder Chat Assistants ──
    {
      id: 'llama-3.2-3b',
      name: 'Llama 3.2 3B Instruct',
      repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
      file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
      sizeGb: 2.02,
      sizeFormatted: '2.02 GB',
      parameters: '3.2B',
      contextWindow: '128k',
      description: "Meta's flagship 3B conversational assistant. Remarkable comprehension and fluency across complex dialogues.",
      category: 'allRounder',
      isVision: false,
      isAllRounder: true,
      isUnder1Gb: false,
      isUnder2Gb: false,
      downloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    },
    {
      id: 'qwen2.5-3b',
      name: 'Qwen 2.5 3B Instruct',
      repo: 'Qwen/Qwen2.5-3B-Instruct-GGUF',
      file: 'qwen2.5-3b-instruct-q4_k_m.gguf',
      sizeGb: 2.15,
      sizeFormatted: '2.15 GB',
      parameters: '3.1B',
      contextWindow: '32k',
      description: 'Gold standard 3B model. Outstanding multilingual knowledge, code generation, and complex instruction adherence.',
      category: 'allRounder',
      isVision: false,
      isAllRounder: true,
      isUnder1Gb: false,
      isUnder2Gb: false,
      downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    },
    {
      id: 'phi-3.5-mini',
      name: 'Phi 3.5 Mini Instruct',
      repo: 'bartowski/Phi-3.5-mini-instruct-GGUF',
      file: 'Phi-3.5-mini-instruct-Q4_K_M.gguf',
      sizeGb: 2.39,
      sizeFormatted: '2.39 GB',
      parameters: '3.8B',
      contextWindow: '128k',
      description: "Microsoft's high-reasoning 3.8B model with 128k context support. Strong multi-step analytical capabilities.",
      category: 'allRounder',
      isVision: false,
      isAllRounder: true,
      isUnder1Gb: false,
      isUnder2Gb: false,
      downloadUrl: 'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf',
    },
  ];

  public getModelsDirs(): string[] {
    const dirs: string[] = [];
    if (process.env.TERRANOETIS_MODELS_DIR) {
      dirs.push(process.env.TERRANOETIS_MODELS_DIR);
    }
    const platform = process.platform;
    let baseDir: string;
    if (platform === 'darwin') {
      baseDir = path.join(os.homedir(), 'Library', 'Application Support', 'Terranoetis');
    } else if (platform === 'win32') {
      baseDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming', 'Terranoetis');
    } else {
      baseDir = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share', 'terranoetis');
    }
    const appModels = path.join(baseDir, 'models');
    dirs.push(appModels);

    // Also include project models dir if it exists
    const devModels = path.resolve(process.cwd(), 'models');
    if (!dirs.includes(devModels) && fs.existsSync(devModels)) {
      dirs.push(devModels);
    }
    const serverDevModels = path.resolve(import.meta.dirname, '..', 'models');
    if (!dirs.includes(serverDevModels) && fs.existsSync(serverDevModels)) {
      dirs.push(serverDevModels);
    }

    // Walk up from current working directory to discover repository root models/
    let cur = process.cwd();
    while (cur && cur !== path.dirname(cur)) {
      const candidate = path.join(cur, 'models');
      if (fs.existsSync(candidate) && !dirs.includes(candidate)) {
        dirs.push(candidate);
      }
      cur = path.dirname(cur);
    }

    // Also check standard downloads/workspace model directory and user home models
    const workspaceModels = path.join(os.homedir(), 'Downloads', 'Terranoetis', 'models');
    if (fs.existsSync(workspaceModels) && !dirs.includes(workspaceModels)) {
      dirs.push(workspaceModels);
    }
    const userModels = path.join(os.homedir(), 'models');
    if (fs.existsSync(userModels) && !dirs.includes(userModels)) {
      dirs.push(userModels);
    }

    return dirs;
  }

  public getPrimarySaveDir(): string {
    const dirs = this.getModelsDirs();
    const primary = dirs[0];
    try {
      fs.mkdirSync(primary, { recursive: true, mode: 0o700 });
    } catch { /* ignore */ }
    return primary;
  }

  public getDeviceSpecs(): DeviceSpecs {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const ramTotalGb = Number((totalBytes / 1e9).toFixed(1));
    const ramFreeGb = Number((freeBytes / 1e9).toFixed(1));
    const cpuModel = os.cpus()[0]?.model || 'Processor';
    const cores = os.cpus().length;
    const platform = os.platform();
    const arch = os.arch();
    const isAppleSilicon = platform === 'darwin' && arch === 'arm64';

    let recommendedMaxGb = 2.0;
    let deviceTier: DeviceSpecs['deviceTier'] = 'compact';
    let recommendation = '';

    if (ramTotalGb <= 8.5) {
      recommendedMaxGb = 2.0;
      deviceTier = 'compact';
      recommendation = `${isAppleSilicon ? 'Apple Silicon' : 'Device'} with ${ramTotalGb} GB RAM. We recommend models under 2.0 GB for instantaneous 50+ tok/s response without system memory pressure.`;
    } else if (ramTotalGb <= 16.5) {
      recommendedMaxGb = 4.5;
      deviceTier = 'standard';
      recommendation = `Device with ${ramTotalGb} GB RAM. Smooth performance on models up to 4.5 GB (including Llama 3.2 3B and Qwen 2.5 3B).`;
    } else {
      recommendedMaxGb = 14.0;
      deviceTier = 'high-performance';
      recommendation = `High-capacity workstation with ${ramTotalGb} GB RAM. Can comfortably run 7B-14B models on local hardware.`;
    }

    return {
      cpu: cpuModel,
      cores,
      ramTotalGb,
      ramFreeGb,
      platform,
      arch,
      isAppleSilicon,
      recommendedMaxGb,
      recommendation,
      deviceTier,
    };
  }

  public getCuratedCatalog(): CuratedModel[] {
    const specs = this.getDeviceSpecs();
    return this.curatedCatalog.map(m => ({
      ...m,
      recommendedForDevice: m.sizeGb <= specs.recommendedMaxGb,
    }));
  }

  public listInstalledModels(): InstalledModel[] {
    const dirs = this.getModelsDirs();
    const results: InstalledModel[] = [];
    const seenFiles = new Set<string>();

    for (const d of dirs) {
      if (!fs.existsSync(d)) continue;
      try {
        const files = fs.readdirSync(d);
        for (const file of files) {
          if (!file.endsWith('.gguf') || file.endsWith('.partial') || file.startsWith('mmproj-')) continue;
          if (seenFiles.has(file)) continue;

          seenFiles.add(file);
          const fullPath = path.join(d, file);
          const stats = fs.statSync(fullPath);
          const sizeGb = Number((stats.size / 1e9).toFixed(2));
          const sizeFormatted = stats.size >= 1e9 ? `${sizeGb} GB` : `${(stats.size / 1e6).toFixed(0)} MB`;
          const active = this.activeModelName === file || (this.activeModelPath === fullPath && this.isProcessRunning());

          results.push({
            filename: file,
            path: fullPath,
            sizeBytes: stats.size,
            sizeGb,
            sizeFormatted,
            active,
            modifiedAt: stats.mtime.toISOString(),
          });
        }
      } catch (err) {
        logger.warn({ err, dir: d }, 'Error reading models directory');
      }
    }

    return results;
  }

  public getActiveModelName(): string | null {
    return this.activeModelName;
  }

  public isProcessRunning(): boolean {
    return Boolean(this.activeProcess && !this.activeProcess.killed);
  }

  public async searchHuggingFaceHub(query: string): Promise<HuggingFaceModelSummary[]> {
    const clean = (query || '').trim();
    const url = `https://huggingface.co/api/models?search=${encodeURIComponent(clean || 'gguf')}&filter=gguf&sort=downloads&direction=-1&limit=25`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) {
      throw new Error(`Hugging Face API returned HTTP ${resp.status}`);
    }
    const data = await resp.json() as Array<Record<string, unknown>>;
    return data.map(item => {
      const id = String(item.id || item.modelId || '');
      const parts = id.split('/');
      const author = parts.length > 1 ? parts[0] : 'community';
      const name = parts.length > 1 ? parts.slice(1).join('/') : id;
      const downloads = typeof item.downloads === 'number' ? item.downloads : 0;
      const likes = typeof item.likes === 'number' ? item.likes : 0;
      const pipelineTag = String(item.pipeline_tag || 'text-generation');
      const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
      const updatedAt = String(item.lastModified || item.createdAt || new Date().toISOString());

      return {
        id,
        author,
        name,
        downloads,
        likes,
        pipelineTag,
        tags: tags.slice(0, 10),
        description: `GGUF model repository by ${author}. ${downloads.toLocaleString()} downloads, ${likes} likes.`,
        updatedAt,
      };
    });
  }

  public async getRepoFiles(repoId: string): Promise<RepoGgufFile[]> {
    const cleanRepo = repoId.trim();
    const url = `https://huggingface.co/api/models/${cleanRepo}/tree/main`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) {
      throw new Error(`Failed to inspect repository files (HTTP ${resp.status})`);
    }
    const data = await resp.json() as Array<{ type?: string; path?: string; size?: number }>;
    const results: RepoGgufFile[] = [];

    for (const f of data) {
      if (!f || typeof f !== 'object') continue;
      const p = String(f.path || '');
      if (!p.endsWith('.gguf')) continue;

      const sizeBytes = Number(f.size || 0);
      const sizeGb = Number((sizeBytes / 1e9).toFixed(2));
      const sizeFormatted = sizeBytes >= 1e9 ? `${sizeGb} GB` : `${(sizeBytes / 1e6).toFixed(0)} MB`;

      // Extract quant tag: e.g. Q4_K_M, Q5_K_M, IQ3_M, Q8_0
      const quantMatch = p.match(/(Q[0-9]+_[A-Z0-9_]+|IQ[0-9]+_[A-Z0-9_]+|BF16|F16|F32)/i);
      const quant = quantMatch ? quantMatch[1].toUpperCase() : 'GGUF';
      const isRecommendedQuant = Boolean(quant.includes('Q4_K') || quant.includes('Q4_0') || quant.includes('Q5_K'));

      results.push({
        name: p,
        sizeBytes,
        sizeGb,
        sizeFormatted,
        quant,
        downloadUrl: `https://huggingface.co/${cleanRepo}/resolve/main/${p}`,
        isRecommendedQuant,
      });
    }

    // Sort: recommended quants (Q4_K_M) first, then by file size ascending
    results.sort((a, b) => {
      if (a.isRecommendedQuant && !b.isRecommendedQuant) return -1;
      if (!a.isRecommendedQuant && b.isRecommendedQuant) return 1;
      return a.sizeBytes - b.sizeBytes;
    });

    return results;
  }

  public getDownloadStatus(): DownloadState {
    const elapsedMs = this.downloadState.startedAt ? Date.now() - this.downloadState.startedAt : 0;
    const downloadedSinceStart = Math.max(0, this.downloadState.received - (this.downloadState.resumeOffset || 0));
    const speedBytes = this.downloadState.running && elapsedMs > 0 ? (downloadedSinceStart / elapsedMs) * 1000 : 0;
    const remaining = this.downloadState.total > 0 ? Math.max(0, this.downloadState.total - this.downloadState.received) : 0;
    const etaSeconds = speedBytes > 0 && remaining > 0 ? Math.round(remaining / speedBytes) : 0;
    const percent = this.downloadState.total > 0 ? Math.min(100, Math.round((this.downloadState.received / this.downloadState.total) * 100)) : 0;

    return {
      ...this.downloadState,
      percent,
      speedBytes,
      etaSeconds,
    };
  }

  public async startDownload(params: { repoId: string; fileName: string; downloadUrl: string }): Promise<void> {
    if (this.downloadState.running) {
      throw new Error(`Another download is already in progress (${this.downloadState.fileName})`);
    }

    const { repoId, fileName, downloadUrl } = params;
    const saveDir = this.getPrimarySaveDir();
    const finalPath = path.join(saveDir, fileName);
    const partialPath = `${finalPath}.partial`;

    const abort = new AbortController();
    this.downloadAbort = abort;

    this.downloadState = {
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
      error: undefined,
      startedAt: Date.now(),
    };

    try {
      // Check resume support
      let resumeFrom = 0;
      if (fs.existsSync(partialPath)) {
        try {
          resumeFrom = fs.statSync(partialPath).size;
        } catch { /* ignore */ }
      }
      this.downloadState.resuming = resumeFrom > 0;
      this.downloadState.resumeOffset = resumeFrom;
      this.downloadState.received = resumeFrom;

      const headers: Record<string, string> = {};
      if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;

      const resp = await fetch(downloadUrl, { headers, signal: abort.signal, redirect: 'follow' });
      if (!resp.ok || !resp.body) {
        if (resp.status === 401 || resp.status === 403) {
          throw new Error(`Hugging Face authentication required (HTTP ${resp.status})`);
        }
        throw new Error(`Download failed with HTTP ${resp.status}`);
      }

      if (resumeFrom > 0 && resp.status !== 206) {
        // Range was not honored; start clean from zero to avoid corruption
        try { fs.unlinkSync(partialPath); } catch { /* ignore */ }
        resumeFrom = 0;
        this.downloadState.resuming = false;
        this.downloadState.resumeOffset = 0;
        this.downloadState.received = 0;
      }

      let total = Number(resp.headers.get('content-length') || 0);
      if (resumeFrom > 0) {
        const cr = resp.headers.get('content-range');
        const m = cr ? /\/\s*(\d+)\s*$/.exec(cr) : null;
        if (m) total = Number(m[1]);
        else total += resumeFrom;
      }
      this.downloadState.total = total;

      const writer = fs.createWriteStream(partialPath, { flags: resumeFrom > 0 ? 'a' : 'w' });
      const reader = resp.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          writer.write(Buffer.from(value));
          this.downloadState.received += value.length;
        }
      }

      await new Promise<void>((resolve, reject) => {
        writer.end((err: Error | null) => (err ? reject(err) : resolve()));
      });

      if (fs.existsSync(finalPath)) {
        try { fs.unlinkSync(finalPath); } catch { /* ignore */ }
      }
      await fs.promises.rename(partialPath, finalPath);

      this.downloadState.done = true;
      this.downloadState.running = false;
      logger.info({ path: finalPath, bytes: this.downloadState.received }, '[LocalAiManager] Model download completed');

      // If no active model currently, automatically activate this one!
      if (!this.activeModelName) {
        this.setActiveModel(fileName);
      }
    } catch (e: unknown) {
      this.downloadState.running = false;
      if (this.downloadState.cancelled) {
        logger.info('[LocalAiManager] Download cancelled by operator');
      } else {
        const errMessage = e instanceof Error ? e.message : String(e);
        this.downloadState.error = errMessage;
        logger.error({ err: e }, '[LocalAiManager] Download failed');
      }
    } finally {
      this.downloadAbort = null;
    }
  }

  public cancelDownload(): { ok: boolean; message: string } {
    if (!this.downloadState.running) {
      return { ok: false, message: 'No active download to cancel' };
    }
    this.downloadState.cancelled = true;
    this.downloadState.running = false;
    if (this.downloadAbort) {
      this.downloadAbort.abort();
      this.downloadAbort = null;
    }
    return { ok: true, message: 'Download cancelled. Partial file retained for future resume.' };
  }

  public resolveLlamaBinary(): string | null {
    if (process.env.LLAMA_SERVER_PATH && fs.existsSync(process.env.LLAMA_SERVER_PATH)) {
      return process.env.LLAMA_SERVER_PATH;
    }
    const isWin = process.platform === 'win32';
    const candidates = [
      '/opt/homebrew/bin/llama-server',
      '/usr/local/bin/llama-server',
      '/usr/bin/llama-server',
      path.join(os.homedir(), '.local/bin/llama-server'),
      'C:\\Program Files\\llama.cpp\\llama-server.exe',
      path.join(process.env.LOCALAPPDATA || '', 'llama.cpp', 'llama-server.exe'),
      path.join(os.homedir(), 'scoop', 'shims', 'llama-server.exe'),
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
    return isWin ? 'llama-server.exe' : 'llama-server';
  }

  public setActiveModel(filename: string): { ok: boolean; message: string; running: boolean } {
    const installed = this.listInstalledModels();
    const target = installed.find(m => m.filename === filename);
    if (!target) {
      return { ok: false, message: `Model file ${filename} not found on disk`, running: false };
    }

    // Stop existing process if running
    this.stopLlamaServer();

    const bin = this.resolveLlamaBinary();
    const port = 11436;

    try {
      const logPath = path.join(os.tmpdir(), 'terranoetis-llama.log');
      const out = fs.openSync(logPath, 'a');

      // Set arguments for llama-server
      // -ngl 99 offloads all layers to Metal GPU on Apple Silicon
      const args = [
        '--model', target.path,
        '--port', String(port),
        '-c', '4096',
        '-ngl', '99',
      ];

      // Auto-detect multimodal projector (mmproj) for vision models
      const targetDir = path.dirname(target.path);
      const directMmproj = path.join(targetDir, `mmproj-${target.filename}`);
      let mmprojFound: string | null = null;
      if (fs.existsSync(directMmproj)) {
        mmprojFound = directMmproj;
      } else {
        try {
          const dirFiles = fs.readdirSync(targetDir);
          const mmCandidate = dirFiles.find(f => f.startsWith('mmproj-') && f.endsWith('.gguf'));
          if (mmCandidate) mmprojFound = path.join(targetDir, mmCandidate);
        } catch { /* ignore */ }
      }

      if (mmprojFound) {
        args.push('--mmproj', mmprojFound, '--mmproj-offload');
        logger.info({ mmproj: mmprojFound }, '[LocalAiManager] Attached vision projector to llama-server');
      }

      const child = spawn(bin || 'llama-server', args, {
        stdio: ['ignore', out, out],
        detached: true,
      });
      child.unref();

      child.on('error', (err) => {
        logger.warn({ err: err.message }, '[LocalAiManager] llama-server spawn error');
      });

      this.activeProcess = child;
      this.activeModelPath = target.path;
      this.activeModelName = target.filename;

      logger.info({ port, model: target.path, bin }, '[LocalAiManager] Active local AI model started');

      return {
        ok: true,
        message: `Activated ${target.filename} on port ${port}`,
        running: true,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn({ err: msg }, '[LocalAiManager] Could not start llama-server');
      this.activeModelPath = target.path;
      this.activeModelName = target.filename;
      return { ok: false, message: `Could not launch llama-server: ${msg}`, running: false };
    }
  }

  public stopLlamaServer(): void {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill('SIGTERM');
      } catch { /* ignore */ }
      this.activeProcess = null;
    }
    try {
      if (process.platform !== 'win32') {
        execSync('pkill -f llama-server || true', { stdio: 'ignore' });
      }
    } catch { /* ignore */ }
  }

  public deleteModel(filename: string): { ok: boolean; message: string } {
    const safeName = path.basename(filename);
    if (!safeName || safeName === '.' || safeName === '..') {
      return { ok: false, message: 'Invalid model filename' };
    }

    if (this.activeModelName === safeName || this.activeModelName === filename) {
      this.stopLlamaServer();
      this.activeModelName = null;
      this.activeModelPath = null;
    }

    const dirs = this.getModelsDirs();
    let deletedCount = 0;

    for (const d of dirs) {
      const targetPath = path.join(d, safeName);
      const partialPath = `${targetPath}.partial`;

      try {
        let isLink = false;
        try {
          isLink = fs.lstatSync(targetPath).isSymbolicLink();
        } catch { /* file not in this dir */ }

        if (fs.existsSync(targetPath) || isLink) {
          let realPath: string | null = null;
          try {
            realPath = fs.realpathSync(targetPath);
          } catch { /* ignore */ }

          // Unlink the file or symlink in this dir
          try {
            fs.unlinkSync(targetPath);
            deletedCount++;
          } catch (e) {
            logger.warn({ err: e, path: targetPath }, 'Failed to unlink target path');
          }

          // If it was a symlink to another file on disk, also remove the real file
          if (realPath && realPath !== targetPath && fs.existsSync(realPath)) {
            try {
              fs.unlinkSync(realPath);
              deletedCount++;
            } catch (e) {
              logger.warn({ err: e, path: realPath }, 'Failed to unlink real target path');
            }
          }
        }
      } catch { /* ignore */ }

      try {
        if (fs.existsSync(partialPath)) {
          fs.unlinkSync(partialPath);
        }
      } catch { /* ignore */ }

      // Also delete companion mmproj file if it exists
      const mmprojPath = path.join(d, `mmproj-${safeName}`);
      try {
        if (fs.existsSync(mmprojPath)) {
          fs.unlinkSync(mmprojPath);
          deletedCount++;
        }
      } catch { /* ignore */ }
    }

    if (deletedCount > 0) {
      logger.info({ filename, deletedCount }, '[LocalAiManager] Model file deleted successfully from disk');
      return { ok: true, message: `Model ${filename} deleted successfully from disk` };
    }

    return { ok: false, message: 'Model file not found on disk' };
  }

  public cleanOrphanedPartials(): { deleted: string[]; freedBytes: number } {
    const dirs = this.getModelsDirs();
    const deleted: string[] = [];
    let freedBytes = 0;
    for (const d of dirs) {
      if (!fs.existsSync(d)) continue;
      try {
        const files = fs.readdirSync(d);
        for (const file of files) {
          if (file.endsWith('.partial')) {
            if (this.downloadState.running && this.downloadState.fileName && file.startsWith(this.downloadState.fileName)) {
              continue;
            }
            const fullPath = path.join(d, file);
            try {
              const stats = fs.statSync(fullPath);
              freedBytes += stats.size;
              fs.unlinkSync(fullPath);
              deleted.push(file);
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }
    return { deleted, freedBytes };
  }

  public async ensureServerRunning(): Promise<boolean> {
    if (this.isProcessRunning()) {
      return true;
    }
    let target = this.activeModelName;
    if (!target) {
      const installed = this.listInstalledModels();
      if (installed.length === 0) return false;
      const preferred = installed[0];
      target = preferred.filename;
    }
    const result = this.setActiveModel(target);
    return result.running;
  }

  public init(): void {
    const installed = this.listInstalledModels();
    if (installed.length > 0) {
      // Pick active installed model for standby without spawning background process
      const preferred = installed[0];
      this.activeModelName = preferred.filename;
      this.activeModelPath = preferred.path;
      logger.info({ model: preferred.filename }, '[LocalAiManager] Discovered local GGUF model; standby mode (lazy load on use)');
    } else {
      logger.info('[LocalAiManager] No installed local GGUF models found on startup');
    }
  }
}

export const localAiManager = new LocalAiManager();
