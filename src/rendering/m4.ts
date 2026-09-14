/**
 * Column-major 4x4 helpers for building glTF node transforms.
 * All matrices are glTF/WebGL column-major: element i*4+j is row j, col i.
 */

export type M4 = number[]; // length 16, column-major

/** Column-major 4x4 multiply: out = a * b (b applied first to a column vector). */
export function matMult(a: M4, b: M4): M4 {
  const out = new Array(16).fill(0) as M4;
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export const MTX_IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mtxTranslation(tx: number, ty: number, tz: number): M4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1];
}

export function mtxScale(sx: number, sy: number, sz: number): M4 {
  return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
}

/** Rotation about X (radians), column-major. */
export function mtxRotX(angle: number): M4 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

/** Rotation about Y (radians), column-major. */
export function mtxRotY(angle: number): M4 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

/** Rotation about Z (radians), column-major. */
export function mtxRotZ(angle: number): M4 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Euler XYZ (applied as Rz then Ry then Rx in local space → M = Rx * Ry * Rz). */
export function mtxEuler(rx: number, ry: number, rz: number): M4 {
  return matMult(mtxRotX(rx), matMult(mtxRotY(ry), mtxRotZ(rz)));
}

/** Translation · (optional Euler) — the common "move and tilt" for parts. */
export function mtxTR(tx: number, ty: number, tz: number, rx = 0, ry = 0, rz = 0): M4 {
  return matMult(mtxTranslation(tx, ty, tz), mtxEuler(rx, ry, rz));
}

/** Quaternion from unit vectors (matching Three.js setFromUnitVectors) → column-major M4. */
export function mtxFromUnitVectors(from: [number, number, number], to: [number, number, number]): M4 {
  const [fx, fy, fz] = from;
  const [tx, ty, tz] = to;
  const dot = fx * tx + fy * ty + fz * tz;
  let qx = 0, qy = 0, qz = 0, qw = 1;
  if (dot < -0.999999) {
    // 180-degree rotation: pick an axis orthogonal to `from`
    if (Math.abs(fx) > Math.abs(fz)) {
      qx = -fy; qy = fx; qz = 0; qw = 0;
    } else {
      qx = 0; qy = -fz; qz = fy; qw = 0;
    }
  } else {
    // Cross product: from x to
    qx = fy * tz - fz * ty;
    qy = fz * tx - fx * tz;
    qz = fx * ty - fy * tx;
    qw = 1 + dot;
  }
  const invLen = 1 / Math.hypot(qx, qy, qz, qw);
  qx *= invLen; qy *= invLen; qz *= invLen; qw *= invLen;
  // quaternion → column-major rotation matrix
  return [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qw * qz), 2 * (qx * qz - qw * qy), 0,
    2 * (qx * qy - qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qw * qx), 0,
    2 * (qx * qz + qw * qy), 2 * (qy * qz - qw * qx), 1 - 2 * (qx * qx + qy * qy), 0,
    0, 0, 0, 1,
  ];
}