/**
 * Vectorized Raster Math & Remote Sensing Algorithms
 * Pure mathematical geoprocessing routines for archaeological crop-marks,
 * digital terrain micro-relief (SLRM/TPI), and SAR radar backscatter.
 */

/**
 * Computes Normalized Difference Red-Edge Index (NDRE): (B08 - B05) / (B08 + B05)
 * Highly sensitive to subtle chlorophyll stress in ripening crops over buried foundations.
 */
export function computeNDRE(b8Nir: Float32Array, b5RedEdge: Float32Array): Float32Array {
  const len = Math.min(b8Nir.length, b5RedEdge.length);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const sum = b8Nir[i] + b5RedEdge[i];
    out[i] = sum > 0 ? (b8Nir[i] - b5RedEdge[i]) / sum : 0;
  }
  return out;
}

/**
 * Computes Normalized Difference Vegetation Index (NDVI): (B08 - B04) / (B08 + B04)
 */
export function computeNDVI(b8Nir: Float32Array, b4Red: Float32Array): Float32Array {
  const len = Math.min(b8Nir.length, b4Red.length);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const sum = b8Nir[i] + b4Red[i];
    out[i] = sum > 0 ? (b8Nir[i] - b4Red[i]) / sum : 0;
  }
  return out;
}

/**
 * Computes Normalized Difference Moisture Index (NDMI): (B08 - B11) / (B08 + B11)
 * Detects differential canopy water content and subsurface moisture retention.
 */
export function computeNDMI(b8Nir: Float32Array, b11Swir: Float32Array): Float32Array {
  const len = Math.min(b8Nir.length, b11Swir.length);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const sum = b8Nir[i] + b11Swir[i];
    out[i] = sum > 0 ? (b8Nir[i] - b11Swir[i]) / sum : 0;
  }
  return out;
}

/**
 * Converts linear radar backscatter power (gamma-0 or sigma-0) to decibels (dB):
 * dB = 10 * log10(max(1e-5, linear))
 */
export function linearPowerToDecibels(linear: Float32Array): Float32Array {
  const out = new Float32Array(linear.length);
  for (let i = 0; i < linear.length; i++) {
    const val = Math.max(1e-6, linear[i]);
    out[i] = 10.0 * Math.log10(val);
  }
  return out;
}

/**
 * Computes SAR Cross-Polarization Ratio in decibels:
 * CrossRatio_dB = VH_dB - VV_dB = 10 * log10(VH / VV)
 */
export function computeSarCrossPolRatioDb(vhDb: Float32Array, vvDb: Float32Array): Float32Array {
  const len = Math.min(vhDb.length, vvDb.length);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = vhDb[i] - vvDb[i];
  }
  return out;
}

/**
 * Computes standardized spatial anomaly Z-Scores relative to a local moving window:
 * Z(x,y) = (I(x,y) - mean_local) / max(eps, std_local)
 */
export function computeLocalZScore(
  grid: Float32Array,
  width: number,
  height: number,
  kernelRadius: number = 3,
): Float32Array {
  const out = new Float32Array(width * height);
  const eps = 1e-4;

  for (let r = 0; r < height; r++) {
    const rMin = Math.max(0, r - kernelRadius);
    const rMax = Math.min(height - 1, r + kernelRadius);

    for (let c = 0; c < width; c++) {
      const cMin = Math.max(0, c - kernelRadius);
      const cMax = Math.min(width - 1, c + kernelRadius);

      let sum = 0;
      let count = 0;
      for (let kr = rMin; kr <= rMax; kr++) {
        for (let kc = cMin; kc <= cMax; kc++) {
          sum += grid[kr * width + kc];
          count++;
        }
      }

      const mean = count > 0 ? sum / count : grid[r * width + c];

      let varianceSum = 0;
      for (let kr = rMin; kr <= rMax; kr++) {
        for (let kc = cMin; kc <= cMax; kc++) {
          varianceSum += Math.pow(grid[kr * width + kc] - mean, 2);
        }
      }

      const std = Math.sqrt(varianceSum / Math.max(1, count));
      const val = grid[r * width + c];
      out[r * width + c] = std > eps ? (val - mean) / std : 0.0;
    }
  }

  return out;
}

/**
 * Computes Horn's 2D Directional Terrain Slope using a standard 3x3 finite-difference convolution.
 * (Horn, 1981)
 */
export function computeHornSlope(
  elevations: Float32Array,
  width: number,
  height: number,
  cellSpacingM: number,
): Float32Array {
  const slope = new Float32Array(width * height);
  const dx8 = 8.0 * Math.max(1.0, cellSpacingM);
  const dy8 = 8.0 * Math.max(1.0, cellSpacingM);

  for (let r = 0; r < height; r++) {
    const r0 = Math.max(0, r - 1);
    const r1 = Math.min(height - 1, r + 1);

    for (let c = 0; c < width; c++) {
      const c0 = Math.max(0, c - 1);
      const c1 = Math.min(width - 1, c + 1);

      const zNW = elevations[r0 * width + c0];
      const zN  = elevations[r0 * width + c];
      const zNE = elevations[r0 * width + c1];
      const zW  = elevations[r * width + c0];
      const zE  = elevations[r * width + c1];
      const zSW = elevations[r1 * width + c0];
      const zS  = elevations[r1 * width + c];
      const zSE = elevations[r1 * width + c1];

      const dzdx = ((zNE + 2.0 * zE + zSE) - (zNW + 2.0 * zW + zSW)) / dx8;
      const dzdy = ((zSW + 2.0 * zS + zSE) - (zNW + 2.0 * zN + zNE)) / dy8;

      const grad = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
      slope[r * width + c] = parseFloat(((Math.atan(grad) * 180.0) / Math.PI).toFixed(2));
    }
  }

  return slope;
}

/**
 * Computes Topographic Position Index (TPI): TPI = z - mean(neighborhood)
 */
export function computeTPI(
  elevations: Float32Array,
  width: number,
  height: number,
  kernelRadius: number = 3,
): Float32Array {
  const tpi = new Float32Array(width * height);

  for (let r = 0; r < height; r++) {
    const rMin = Math.max(0, r - kernelRadius);
    const rMax = Math.min(height - 1, r + kernelRadius);

    for (let c = 0; c < width; c++) {
      const cMin = Math.max(0, c - kernelRadius);
      const cMax = Math.min(width - 1, c + kernelRadius);

      let sum = 0;
      let count = 0;
      for (let kr = rMin; kr <= rMax; kr++) {
        for (let kc = cMin; kc <= cMax; kc++) {
          if (kr === r && kc === c) continue; // Exclude center
          sum += elevations[kr * width + kc];
          count++;
        }
      }

      const mean = count > 0 ? sum / count : elevations[r * width + c];
      tpi[r * width + c] = elevations[r * width + c] - mean;
    }
  }

  return tpi;
}

/**
 * Computes Simple Local Relief Model (SLRM / Hesse 2010):
 * Subtracts a low-pass Gaussian smoothed macro-trend from the DEM to isolate micro-relief residuals.
 */
export function computeSLRM(
  elevations: Float32Array,
  width: number,
  height: number,
  radius: number = 4,
): Float32Array {
  const macroTrend = new Float32Array(width * height);
  const slrm = new Float32Array(width * height);

  // 1. Generate 2D Gaussian Kernel
  const sigma = Math.max(1.0, radius / 2.5);
  const kernelSize = radius * 2 + 1;
  const kernel = new Float32Array(kernelSize * kernelSize);
  let kernelSum = 0;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const w = Math.exp(-(dx * dx + dy * dy) / (2.0 * sigma * sigma));
      kernel[(dy + radius) * kernelSize + (dx + radius)] = w;
      kernelSum += w;
    }
  }

  // Normalize kernel
  for (let i = 0; i < kernel.length; i++) {
    kernel[i] /= kernelSum;
  }

  // 2. Convolve elevation with Gaussian kernel
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let smoothed = 0;
      let weightSum = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        const nr = r + dy;
        if (nr < 0 || nr >= height) continue;

        for (let dx = -radius; dx <= radius; dx++) {
          const nc = c + dx;
          if (nc < 0 || nc >= width) continue;

          const w = kernel[(dy + radius) * kernelSize + (dx + radius)];
          smoothed += elevations[nr * width + nc] * w;
          weightSum += w;
        }
      }

      macroTrend[r * width + c] = weightSum > 0 ? smoothed / weightSum : elevations[r * width + c];
    }
  }

  // 3. Compute Residual: Original - MacroTrend
  for (let i = 0; i < elevations.length; i++) {
    slrm[i] = parseFloat((elevations[i] - macroTrend[i]).toFixed(2));
  }

  return slrm;
}

/**
 * Resamples any 2D Float32Array matrix from (srcWidth x srcHeight) to (targetWidth x targetHeight)
 * using smooth continuous bilinear interpolation.
 */
export function resampleBilinear(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const dst = new Float32Array(dstW * dstH);
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return dst;
  if (srcW === dstW && srcH === dstH) {
    dst.set(src);
    return dst;
  }

  for (let r = 0; r < dstH; r++) {
    const v = (r / Math.max(1, dstH - 1)) * (srcH - 1);
    const r0 = Math.floor(v);
    const r1 = Math.min(srcH - 1, r0 + 1);
    const fr = v - r0;

    for (let c = 0; c < dstW; c++) {
      const u = (c / Math.max(1, dstW - 1)) * (srcW - 1);
      const c0 = Math.floor(u);
      const c1 = Math.min(srcW - 1, c0 + 1);
      const fc = u - c0;

      const p00 = src[r0 * srcW + c0];
      const p10 = src[r0 * srcW + c1];
      const p01 = src[r1 * srcW + c0];
      const p11 = src[r1 * srcW + c1];

      const top = p00 * (1.0 - fc) + p10 * fc;
      const bot = p01 * (1.0 - fc) + p11 * fc;
      dst[r * dstW + c] = top * (1.0 - fr) + bot * fr;
    }
  }

  return dst;
}
