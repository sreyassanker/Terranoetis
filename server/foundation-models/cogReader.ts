/**
 * Shared COG (Cloud Optimized GeoTIFF) Reader Utility
 *
 * Provides:
 * - readCOGTile(): Read a windowed tile from a Cloud Optimized GeoTIFF URL
 * - latLonToUTM(): Convert WGS84 coordinates to UTM
 * - utmZone(): Compute UTM zone number from longitude
 *
 * Extracted from prithvi.ts and prithvi-v2.ts to eliminate duplication.
 */

// WGS84 constants for UTM conversion
const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const DEG2RAD = Math.PI / 180;

/**
 * Compute the UTM zone number for a given longitude.
 */
export function utmZone(lon: number): number {
  return Math.floor((lon + 180) / 6) + 1;
}

/**
 * Convert WGS84 latitude/longitude to UTM easting/northing.
 */
export function latLonToUTM(lat: number, lon: number): { easting: number; northing: number; zone: number } {
  const zone = utmZone(lon);
  const lon0 = (zone * 6 - 183) * DEG2RAD;
  const e2 = 2 * F - F * F;
  const phi = lat * DEG2RAD;
  const lam = lon * DEG2RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const N = A / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = e2 / (1 - e2) * cosPhi * cosPhi;
  const A_ = (lam - lon0) * cosPhi;

  const M = A * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi)
    - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi));

  const easting = K0 * N * (A_ + (1 - T + C) * A_ * A_ * A_ / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * e2) * A_ * A_ * A_ * A_ * A_ / 120) + 500000;

  const northing = K0 * (M + N * tanPhi * (A_ * A_ / 2
    + (5 - T + 9 * C + 4 * C * C) * A_ * A_ * A_ * A_ / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * e2) * A_ * A_ * A_ * A_ * A_ * A_ / 720));

  return { easting, northing: northing + (lat < 0 ? 10000000 : 0), zone };
}

/**
 * Read a windowed tile from a Cloud Optimized GeoTIFF URL.
 *
 * This function performs HTTP Range requests to read specific tile data
 * from COG files hosted on remote servers (e.g., AWS Earth Search).
 *
 * @param url - The URL of the COG file
 * @param targetEasting - UTM easting of the center point
 * @param targetNorthing - UTM northing of the center point
 * @param halfSize - Half the window size in pixels (e.g., 112 for 224x224)
 * @param outSize - Output size in pixels (e.g., 224)
 * @returns Float32Array of pixel values
 */
export async function readCOGTile(
  url: string,
  targetEasting: number,
  targetNorthing: number,
  halfSize: number,
  outSize: number,
): Promise<Float32Array> {
  // TIFF helper: read bytes from a URL range
  const readRange = async (offset: number, length: number): Promise<ArrayBuffer> => {
    const resp = await fetch(url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`COG read failed at ${offset}: ${resp.status}`);
    return resp.arrayBuffer();
  };

  // Read TIFF header (first 512 bytes)
  const headerBuf = await readRange(0, 512);
  const dv = new DataView(headerBuf);
  const le = String.fromCharCode(dv.getUint8(0), dv.getUint8(1)) === 'II';
  if (dv.getUint16(2, le) !== 42) throw new Error('Not a valid TIFF');
  const ifdOff = dv.getUint32(4, le);

  // Parse IFD
  const readIFD = async (offset: number): Promise<{ tags: Map<number, { type: number; count: number; valueOffset: number }>; nextIFD: number }> => {
    const buf = await readRange(offset, 2 + 12 * 64 + 4); // header + 64 entries + next offset
    const d = new DataView(buf);
    const num = d.getUint16(0, le);
    const tags = new Map<number, { type: number; count: number; valueOffset: number }>();
    for (let i = 0; i < num; i++) {
      const entryOff = 2 + i * 12;
      const tag = d.getUint16(entryOff, le);
      const type = d.getUint16(entryOff + 2, le);
      const count = d.getUint32(entryOff + 4, le);
      const valueOffset = d.getUint32(entryOff + 8, le);
      tags.set(tag, { type, count, valueOffset });
    }
    const nextIFD = d.getUint32(2 + num * 12, le);
    return { tags, nextIFD };
  };

  const readTagValues = async (tag: { type: number; count: number; valueOffset: number }): Promise<number[]> => {
    const typeSizes: Record<number, number> = { 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8, 13: 4 };
    const elemSize = typeSizes[tag.type] || 1;
    const totalBytes = elemSize * tag.count;

    let buf: ArrayBuffer;
    if (totalBytes <= 4) {
      // Value stored inline in the 4-byte valueOffset field
      buf = new ArrayBuffer(4);
      new DataView(buf).setUint32(0, tag.valueOffset, le);
    } else {
      buf = await readRange(tag.valueOffset, totalBytes);
    }

    const d = new DataView(buf);
    const values: number[] = [];
    for (let i = 0; i < tag.count; i++) {
      if (tag.type === 3) values.push(d.getUint16(i * 2, le));
      else if (tag.type === 4) values.push(d.getUint32(i * 4, le));
      else if (tag.type === 11) values.push(d.getFloat32(i * 4, le));
      else if (tag.type === 12) values.push(d.getFloat64(i * 8, le));
      else values.push(d.getUint8(i)); // BYTE or unknown
    }
    return values;
  };

  const { tags } = await readIFD(ifdOff);

  const imgW = (await readTagValues(tags.get(256)!))[0];
  const imgH = (await readTagValues(tags.get(257)!))[0];
  const tileW = tags.has(322) ? (await readTagValues(tags.get(322)!))[0] : 512;
  const tileH = tags.has(323) ? (await readTagValues(tags.get(323)!))[0] : 512;
  const bitsPerSample = (await readTagValues(tags.get(258)!))[0];
  const compression = tags.has(259) ? (await readTagValues(tags.get(259)!))[0] : 1;

  const predictor = tags.has(317) ? (await readTagValues(tags.get(317)!))[0] : 1;

  const tileOffsetsV = await readTagValues(tags.get(324)!);
  const tileByteCountsV = await readTagValues(tags.get(325)!);

  // Read georeferencing
  let tieX = 0, tieY = 0, scaleX = 10, scaleY = -10;
  if (tags.has(33922)) {
    const tieValues = await readTagValues(tags.get(33922)!);
    if (tieValues.length >= 6) {
      tieX = tieValues[3];
      tieY = tieValues[4];
    }
  }
  if (tags.has(33550)) {
    const scaleValues = await readTagValues(tags.get(33550)!);
    if (scaleValues.length >= 2) {
      scaleX = scaleValues[0];
      scaleY = scaleValues[1];
    }
  }

  // Compute target pixel coordinates in the full image
  // GeoTIFF convention: scaleY is negative for north-up images
  // (TIFF Y increases downward, northing increases upward).
  // Earth Search COGs store scaleY as positive — negate for correct coords.
  if (scaleX === 0) scaleX = 10;
  if (scaleY >= 0) scaleY = -Math.abs(scaleY);
  const centerPX = Math.round((targetEasting - tieX) / scaleX);
  const centerPY = Math.round((targetNorthing - tieY) / scaleY);

  const x0 = Math.max(0, Math.min(centerPX - halfSize, imgW - outSize));
  const y0 = Math.max(0, Math.min(centerPY - halfSize, imgH - outSize));

  const tilesX = Math.ceil(imgW / tileW);
  const tileStartX = Math.floor(x0 / tileW);
  const tileStartY = Math.floor(y0 / tileH);
  const tileEndX = Math.floor((x0 + outSize - 1) / tileW);
  const tileEndY = Math.floor((y0 + outSize - 1) / tileH);

  const result = new Float32Array(outSize * outSize);

  for (let ty = tileStartY; ty <= tileEndY; ty++) {
    for (let tx = tileStartX; tx <= tileEndX; tx++) {
      const tileIdx = ty * tilesX + tx;
      if (tileIdx >= tileOffsetsV.length) continue;

      const tOff = tileOffsetsV[tileIdx];
      const tLen = tileByteCountsV[tileIdx];

      const tileBuf = await readRange(tOff, tLen);
      let tileData: Buffer;

      if (compression === 8) {
        const zlib = await import('zlib');
        // Try standard zlib (with header) first; fall back to raw
        try {
          tileData = zlib.inflateSync(Buffer.from(tileBuf));
        } catch {
          tileData = zlib.inflateRawSync(Buffer.from(tileBuf));
        }
      } else if (compression === 1 || compression === 5) {
        tileData = Buffer.from(tileBuf);
      } else {
        throw new Error(`Unsupported COG compression: ${compression}`);
      }

      // Undo horizontal differencing (Predictor=2) if present
      if (predictor === 2 && bitsPerSample === 16) {
        for (let row = 0; row < tileH; row++) {
          const rowStart = row * tileW;
          let prev = tileData.readUInt16LE(rowStart * 2);
          for (let col = 1; col < tileW; col++) {
            const idx = rowStart + col;
            const delta = tileData.readInt16LE(idx * 2);
            const val = prev + delta;
            prev = val;
            tileData.writeUInt16LE(val, idx * 2);
          }
        }
      }

      // Copy pixels from this tile to the output
      for (let row = 0; row < tileH; row++) {
        for (let col = 0; col < tileW; col++) {
          const imgX = tx * tileW + col;
          const imgY = ty * tileH + row;
          if (imgX < x0 || imgX >= x0 + outSize || imgY < y0 || imgY >= y0 + outSize) continue;

          const tilePixelIdx = (row * tileW + col);
          let pixelVal = 0;
          if (bitsPerSample <= 8) {
            pixelVal = tileData[tilePixelIdx];
          } else {
            pixelVal = tileData.readUInt16LE(tilePixelIdx * 2);
          }

          const outX = imgX - x0;
          const outY = imgY - y0;
          result[outY * outSize + outX] = pixelVal;
        }
      }
    }
  }

  return result;
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
