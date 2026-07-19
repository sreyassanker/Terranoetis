/**
 * Blackboard — Shared Memory Data Bus for Zero-Serialization Data Flow
 *
 * Implements a SharedArrayBuffer-backed blackboard that serves as the
 * central data bus between the causal graph, multi-modal fusion engine,
 * and CesiumJS rendering layer.
 *
 * Architecture:
 *   Tool Results → Blackboard → Causal Graph → Fusion → Rendering
 *
 * Each hazard domain gets a fixed-size Float32Array slot storing
 * per-cell risk values. The causal graph writes propagated probabilities,
 * the fusion engine reads and combines them, and the renderer reads
 * the final fused risk surface.
 *
 * Based on:
 *   Blackboard architecture (Craig 1995, AI: A Modern Approach)
 *   SharedArrayBuffer specification (W3C)
 */

/* ═════════════════════════════════════════════════════════════════
   SLOT DEFINITIONS
   Each slot stores a Float32Array of per-cell values.
   Total: 9 slots × 40,000 cells = 360,000 floats = 1.44 MB
   ═════════════════════════════════════════════════════════════════ */

export const BOARD_SLOTS = {
  /** Seismic risk probability per cell [0,1] */
  SEISMIC_PROB: { offset: 0, size: 40000, label: 'Seismic Risk' },
  /** Flood risk probability per cell [0,1] */
  FLOOD_PROB: { offset: 40000, size: 40000, label: 'Flood Risk' },
  /** Wildfire risk probability per cell [0,1] */
  FIRE_PROB: { offset: 80000, size: 40000, label: 'Fire Risk' },
  /** Storm/cyclone risk probability per cell [0,1] */
  STORM_PROB: { offset: 120000, size: 40000, label: 'Storm Risk' },
  /** Weather index (temperature, humidity, wind) per cell */
  WEATHER: { offset: 160000, size: 40000, label: 'Weather Index' },
  /** Fused multi-hazard risk per cell [0,1] */
  FUSED_RISK: { offset: 200000, size: 40000, label: 'Fused Risk' },
  /** Confidence/uncertainty per cell [0,1] (1=high confidence) */
  CONFIDENCE: { offset: 240000, size: 40000, label: 'Confidence' },
  /** Cross-attention weights per cell [0,1] */
  ATTENTION_W: { offset: 280000, size: 40000, label: 'Attention Weights' },
  /** Causal probability vector (100 nodes × 1 value each) */
  CAUSAL_RISK: { offset: 320000, size: 100, label: 'Causal Probabilities' },
} as const;

export type SlotKey = keyof typeof BOARD_SLOTS;

const TOTAL_SIZE = Object.values(BOARD_SLOTS).reduce((s, slot) => s + slot.size, 0);

/* ═════════════════════════════════════════════════════════════════
   MEMORY MANAGEMENT
   ═════════════════════════════════════════════════════════════════ */

let buffer: ArrayBufferLike | null = null;
let views: Record<string, Float32Array> = {};
let initialized = false;

function createSlotViews(buf: ArrayBufferLike): Record<string, Float32Array> {
  const v: Record<string, Float32Array> = {};
  for (const [key, slot] of Object.entries(BOARD_SLOTS)) {
    v[key] = new Float32Array(buf, slot.offset * 4, slot.size);
  }
  return v;
}

/**
 * Initialize the blackboard. Tries SharedArrayBuffer first (requires
 * COOP/COEP headers), falls back to regular ArrayBuffer.
 *
 * @returns true if SharedArrayBuffer was successfully allocated
 */
export function initBlackboard(): boolean {
  if (initialized) return isSharedArrayBuffer();

  try {
    if (typeof SharedArrayBuffer !== 'undefined') {
      buffer = new SharedArrayBuffer(TOTAL_SIZE * 4);
    } else {
      buffer = new ArrayBuffer(TOTAL_SIZE * 4);
    }
  } catch {
    buffer = new ArrayBuffer(TOTAL_SIZE * 4);
  }
  views = createSlotViews(buffer);
  initialized = true;
  return isSharedArrayBuffer();
}

/**
 * Write a Float32Array into a named slot.
 */

/**
 * Read data from a named slot.
 */
export function readSlot(slot: SlotKey, length?: number): Float32Array {
  const view = views[slot];
  if (!view) return new Float32Array();
  return view.slice(0, length ?? view.length);
}

/**
 * Get a direct view (no copy) into a slot for zero-copy read access.
 * Mutations to this view directly affect the blackboard.
 */

/**
 * Get the underlying SharedArrayBuffer for passing to Web Workers.
 */

/**
 * Check if the blackboard uses SharedArrayBuffer (vs plain ArrayBuffer).
 */
export function isSharedArrayBuffer(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer;
}

/**
 * Zero out the entire blackboard.
 */

/**
 * Clear a specific slot to zero.
 */

/**
 * Check if the blackboard has been initialized.
 */

/* ═════════════════════════════════════════════════════════════════
   HIGH-LEVEL WRITE OPERATIONS
   ═════════════════════════════════════════════════════════════════ */

/**
 * Write causal probabilities into the CAUSAL_RISK slot.
 * @param probs - Map of node ID → probability
 * @param topoOrder - Topological order for consistent indexing
 */
export function writeCausalProbs(
  probs: Record<string, number>,
  topoOrder: string[],
): void {
  const view = views.CAUSAL_RISK;
  if (!view) return;
  view.fill(0);
  for (let i = 0; i < Math.min(topoOrder.length, view.length); i++) {
    view[i] = probs[topoOrder[i]] ?? 0;
  }
}

/**
 * Read causal probabilities from the CAUSAL_RISK slot.
 */

/**
 * Write a risk surface grid into a named slot.
 * @param slot - Target slot (e.g., 'SEISMIC_PROB', 'FUSED_RISK')
 * @param grid - InterpGrid with data, width, height
 */

/**
 * Read a risk surface from a slot as a flat Float32Array.
 */

/* ═════════════════════════════════════════════════════════════════
   ATOMIC OPERATIONS (for SharedArrayBuffer)
   ═════════════════════════════════════════════════════════════════ */

/**
 * Atomically update a single cell in a slot.
 * Uses Atomics.store when SharedArrayBuffer is available.
 */

/**
 * Atomically read a single cell from a slot.
 */

/* ═════════════════════════════════════════════════════════════════
   STATISTICS & DIAGNOSTICS
   ═════════════════════════════════════════════════════════════════ */

/**
 * Get memory usage statistics for the blackboard.
 */
