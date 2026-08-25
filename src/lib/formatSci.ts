// Visual-friendly scientific notation: render "3.00 × 10¹⁸" instead of "3.00e+18".
// Superscript digits (⁰¹²³⁴⁵⁶⁷⁸⁹ ⁻) render correctly in HTML/SVG; for WinAnsi
// PDFs use formatSciPdf (caret notation) since Helvetica lacks those glyphs.

const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

export function toSuperscript(exp: number): string {
  if (exp === 0) return '⁰';
  const neg = exp < 0;
  let n = Math.abs(exp);
  let s = '';
  do { s = SUP[n % 10] + s; n = Math.floor(n / 10); } while (n > 0);
  return (neg ? '⁻' : '') + s;
}

/** mantissa with trailing zeros trimmed, e.g. 3.00 → 3, 2.50 → 2.5 */
function mant(v: number, digits: number): string {
  return v.toFixed(digits).replace(/\.?0+$/, '');
}

/** "3.00 × 10¹⁸" — full Unicode superscripts (HTML/SVG safe). */
export function formatSci(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) {
    const exp = Math.floor(Math.log10(a));
    return `${mant(v / Math.pow(10, exp), digits)} × 10${toSuperscript(exp)}`;
  }
  if (a >= 1000) return Math.round(v).toLocaleString('en-US');
  if (Number.isInteger(v)) return String(v);
  if (a < 1) return v.toFixed(digits);
  return v.toFixed(1);
}

/** Compact for chart ticks: "3×10¹⁸" (fits narrow axes). */
export function formatSciCompact(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) {
    const exp = Math.floor(Math.log10(a));
    const m = mant(v / Math.pow(10, exp), 1);
    return `${m}×10${toSuperscript(exp)}`;
  }
  if (a >= 1000) return Math.round(v).toLocaleString('en-US');
  if (Number.isInteger(v)) return String(v);
  if (a < 1) return v.toFixed(2);
  return v.toFixed(1);
}

/** WinAnsi-safe for jsPDF (Helvetica can't render superscripts): "3.00 × 10^18". */
export function formatSciPdf(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e4 || a < 0.001) {
    const exp = Math.floor(Math.log10(a));
    return `${mant(v / Math.pow(10, exp), digits)} × 10^${exp}`;
  }
  if (a >= 1000) return Math.round(v).toLocaleString('en-US');
  if (Number.isInteger(v)) return String(v);
  if (a < 1) return v.toFixed(digits);
  return v.toFixed(1);
}
