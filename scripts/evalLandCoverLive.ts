import { readFileSync } from 'node:fs';
import { spectralClassIndex } from '../src/lib/landCoverDetect';

const TILES = [
  { id: 34, path: '351271_sat.jpg', file: 'rawsat_34.bin', mask: 'rawmask_34.bin' },
  { id: 5, path: '104113_sat.jpg', file: 'rawsat_5.bin', mask: 'rawmask_5.bin' },
];

const DG_TO_APP: Record<number, number> = {
  1: 3, // urban      -> Urban
  2: 2, // agriculture -> Vegetation
  3: 2, // rangeland  -> Vegetation
  4: 2, // forest     -> Vegetation
  5: 1, // water      -> Water
  6: 4, // barren     -> Bare
};

const CLASS_NAME: Record<number, string> = {
  1: 'Water',
  2: 'Vegetation',
  3: 'Urban',
  4: 'Bare',
  5: 'Snow',
  6: 'Shadow',
  0: 'Unclassified',
};

function run() {
  const conf: number[][] = Array.from({ length: 7 }, () => new Array(7).fill(0));
  let total = 0;
  let correct = 0;
  let unclassified = 0;

  for (const t of TILES) {
    const rgb = new Uint8Array(readFileSync(`/var/folders/bv/m2h491rj6mz21p6w3q0jn9k40000gn/T/opencode/deepglobe/${t.file}`));
    const mask = new Uint8Array(readFileSync(`/var/folders/bv/m2h491rj6mz21p6w3q0jn9k40000gn/T/opencode/deepglobe/${t.mask}`));
    const px = rgb.length / 3;
    if (px !== mask.length) throw new Error(`mismatch ${t.id}: ${px} vs ${mask.length}`);

    for (let i = 0; i < px; i++) {
      const dg = mask[i];
      const truth = DG_TO_APP[dg];
      if (truth === undefined) continue; // nodata (0) / cloud (7): excluded
      const r = rgb[i * 3];
      const g = rgb[i * 3 + 1];
      const b = rgb[i * 3 + 2];
      const pred = spectralClassIndex(r, g, b);
      total++;
      conf[truth][pred]++;
      if (pred === truth) correct++;
      if (pred === 0) unclassified++;
    }
    console.log(`tile ${t.id} ${t.path}: ${px.toLocaleString()} px`);
  }

  const acc = (correct / total) * 100;
  console.log(`\npixels evaluated: ${total.toLocaleString()}  correct: ${correct.toLocaleString()}`);
  console.log(`OVERALL ACCURACY: ${acc.toFixed(2)}%  (unclassified ${unclassified.toLocaleString()} px, ${((unclassified / total) * 100).toFixed(1)}%)`);

  console.log('\nconfusion[truth][pred]  rows=truth (Water1 Veg2 Urban3 Bare4), cols=pred => WT1 VG2 UB3 BA4 SN5 SH6 U0');
  const order = [1, 2, 3, 4];
  const row = (r: number) =>
    order.map((c) => String(conf[r][c]).padStart(10)).join('') +
    String(conf[r][0]).padStart(10);
  for (const r of order) console.log(`  ${CLASS_NAME[r].padEnd(10)}|${row(r)}`);

  console.log('\nper-class (pixel-level)');
  const gtTotal = conf.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  for (const c of order) {
    const tp = conf[c][c];
    const fp = order.reduce((s, r) => s + (r === c ? 0 : conf[r][c]), 0);
    const fn = order.reduce((s, pred) => s + (pred === c ? 0 : conf[c][pred]), 0);
    const gt = order.reduce((s, r) => s + conf[c][r], 0);
    const prec = tp + fp ? tp / (tp + fp) : 0;
    const rec = tp + fn ? tp / (tp + fn) : 0;
    const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
    console.log(
      `  ${CLASS_NAME[c].padEnd(10)} prec=${(100 * prec).toFixed(1)}% rec=${(100 * rec).toFixed(1)}% F1=${(100 * f1).toFixed(1)}%  (GT px ${gt.toLocaleString()})`
    );
  }
}

run();