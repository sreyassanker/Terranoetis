// Emits every docs HTML page from scripts/docs/site.mjs + hazards.mjs + pages.mjs.
// Usage: node scripts/docs/build.mjs [--check]   (--check = fail if output differs)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderPage, src, SITE_ORIGIN } from './site.mjs';
import { HAZARDS, COMMON_GRID_SECTION } from './hazards.mjs';
import { PAGES } from './pages.mjs';
import { renderLanding, LANDING_PATH } from './landing.mjs';
import { narrativePages } from './prose.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOCS = path.join(ROOT, 'docs', 'site');

const SPATIAL = {
  earthquake: `Simulation domain: a square of side <code>extent_km</code> centred on the study-box centroid; <code>dx = extent_km·1000/grid_size</code> m (default 500 m without extent). Rows run north→south (row 0 = north edge), columns west→east; the epi-fraction point (x = east, y = south) receives the distance origin so the strongest shaking sits on the clicked trace. <code>lat</code>/<code>lon</code> enter metadata only — never the physics. ${src('kaggle-kernels/earthquake-sim/main.py', '251-270,319,330')}`,
  wildfire: `Square domain, row-major grid, <strong>row 0 = north</strong> (the "compaction contract" shared with all terrain-bearing kernels); <code>state[ignition_y, ignition_x]</code> addresses row= y, col = x. Slope and aspect are derived from the supplied (or synthetic) elevation with <code>np.gradient(elev, cell_m)</code>; wind direction is meteorological ("blows FROM"). ${src('kaggle-kernels/fire-sim/main.py', '553-557,433-435,459-461,302')}`,
  hurricane: `Square domain; row 0 = north, so northward storm motion decreases the row index (<code>cy = cy0 − v_north·t/dx</code>). The eye passes the pinned track point (x = east, y = south, fractions of the grid) at mid-duration; heading 0 = N clockwise; auto-aim computes the bearing from the water centroid. Without supplied terrain the synthetic profile is ocean west / land east with a ~1.5 m/km shelf. ${src('kaggle-kernels/hurricane-sim/main.py', '476-482,376-383,431-440,393-400,240-256')}`,
  flood: `Cell-centred (NY, NX) square grid, uniform dx from extent; row 0 = north (bilinear-upsample docstring shared across kernels); east face = <code>roll(z_b, −1, axis=1)</code>, south face = <code>roll(z_b, −1, axis=0)</code>. lat/lon are decorative (metadata/printing). ${src('kaggle-kernels/flood-sim/main.py', '16,476-478,525-530,91-92,387,375-381')}`,
  tsunami: `Square domain decoded from the uint16-quantized GEBCO sample (<code>bathy_min + u16/65534·bathy_span</code>, sentinel 65535 = NaN→min) and bilinearly upsampled to the run grid; positive-down depth, negative = dry land; row 0 = north, matching the server-side sampler that mirrors the client's cell-centre geometry. The rupture is placed in the deep-ocean region of the box, not the centre. ${src('kaggle-kernels/tsunami-sim/main.py', '208-226,59,79-99')} ${src('server/kaggle/bathymetry.ts', '18-24')}`,
  volcano: `Square domain; row-major terrain, row 0 = north, metres above ellipsoid (server contract); vent at fractions (x = east, y = south) of the grid; column index increases east, row index south, and transport direction is the met convention +180° (wind FROM → TOWARD). Height-resolved ash bins above the domain. ${src('kaggle-kernels/volcano-sim/main.py', '785-798,925-933')}`,
  landslide: `Square domain; row 0 = north. Documented axis-naming quirk: internally <code>dz_dx</code> is the north–south (row-axis) gradient and <code>dz_dy</code> the east–west (column-axis) gradient; the code comment records that the old mapping was swapped and would have driven debris across slopes on real terrain. Runout is measured from the depth-weighted source centroid. ${src('kaggle-kernels/landslide-sim/main.py', '147-148,465-475,457-463')}`,
};

function hazardPage(key) {
  const hz = HAZARDS[key];
  const sections = [
    { kind: 'p', html: hz.intro },
    { kind: 'metrics', items: [
      ['Execution mode', `${hz.mode} ${hz.runCite}`],
      ['Verification', hz.status],
      ['Wire scenario type', `<code>${hz.wireType}</code> — contract at ${src('src/services/kaggleSim.ts', '28-240')}; job API at <a href="${'../reference/simulation-api.html'}">Simulation job API</a>`],
    ]},
    { kind: 'callout', tone: hz.status.startsWith('MEASURED') ? 'verified' : 'inspect',
      title: 'Evidence legend',
      html: `<p><span class="tag tag-measured">MEASURED</span> marks values produced by executing the actual code on this machine (commands in <a href="#reproduction">Reproduction</a>; raw logs summarised in <a href="../methodology.html#evidence-runs">Methodology → Evidence runs</a>).</p>` },
    { kind: 'h2', id: 'physics', title: 'Governing equations and coefficients' },
    { kind: 'p', html: `Source attribution as stated in the kernel header (verbatim):` },
    { kind: 'verbatim', quote: hz.headerQuote.quote, cite: hz.headerQuote.cite },
    ...hz.equations.map((e) => ({ kind: 'eq', ...e })),
    { kind: 'h3', id: 'coefficients', title: 'Coefficients and named constants' },
    { kind: 'table', ...hz.coefficients, ...(hz.coefficients.rows ? {} : {}) },
    ...(hz.siteCoeffs ? [{ kind: 'table', ...hz.siteCoeffs }] : []),
    ...(hz.mmiTables ? [{ kind: 'table', ...hz.mmiTables }] : []),
    { kind: 'h2', id: 'parameters', title: 'Parameter contract' },
    { kind: 'p', html: hz.paramsCaption + ' ' + COMMON_GRID_SECTION.caption + '.' },
    { kind: 'table', caption: hz.paramsCaption, cols: ['UI control', 'Wire field', 'Unit', 'Valid range (UI · wire · kernel)', 'Default', 'Physical meaning', 'Source'], rows: hz.params },
    { kind: 'h2', id: 'outputs', title: 'Outputs' },
    { kind: 'table', caption: 'Files written per run (also served by <code>GET /api/kaggle/simulate/:jobId/grid/:name</code> and <code>…/geotiff/:name</code>)', cols: ['Field', 'Unit', 'Meaning', 'Source'], rows: hz.outputs },
    { kind: 'h2', id: 'spatial-origin', title: 'Spatial-origin semantics' },
    { kind: 'p', html: SPATIAL[key] },
    { kind: 'h2', id: 'validity', title: 'Documented validity limits (verbatim from the code)' },
    { kind: 'verbatim', quote: hz.validity.quote, cite: hz.validity.cite },
    { kind: 'p', html: hz.gate },
    { kind: 'h2', id: 'measured', title: 'Measured runs and timings' },
    { kind: 'table', caption: 'Executed on an Apple-Silicon laptop (Python 3.14.5, NumPy 2.4.2). These are observations of one environment, not performance guarantees.', cols: ['Run / check', 'Measured result'], rows: hz.measured.map(([a, b]) => [a, b]) },
    ...(hz.knownLimitation ? [
      { kind: 'h2', id: 'known-limitation', title: 'Known numerical limitation' },
      { kind: 'callout', tone: 'warning', title: 'Tsunami solver — non-flat bathymetry instability', html: `<p>${hz.knownLimitation}</p>` },
    ] : []),
    { kind: 'h2', id: 'reproduction', title: 'Reproduction' },
    { kind: 'code', id: 'repro-cmd', title: 'Commands', lines: hz.repro.split('\n') },
  ];
  return {
    path: hz.path, depth: 1, title: hz.title, desc: hz.desc,
    breadcrumb: [{ label: 'Capabilities', href: 'capabilities/hazard-simulations.html' }, { label: hz.title }],
    proseMd: `narratives/capabilities/${hz.proseMd.replace('.md', '.html')}`,
    tags: hz.status.startsWith('MEASURED') || hz.status.startsWith('PHYSICS') || hz.status.startsWith('SOLVER')
      ? ['<span class="tag tag-measured">MEASURED LOCALLY</span>']
      : [],
    sections,
  };
}

const pages = [
  ...Object.keys(HAZARDS).map(hazardPage),
  ...PAGES,
  ...narrativePages(),
];

const CHECK = process.argv.includes('--check');
let changed = 0; const drift = [];
for (const p of pages) {
  const out = renderPage(p);
  const file = path.join(DOCS, p.path);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
  if (prev !== out) {
    changed++;
    if (CHECK) drift.push('DRIFT docs/' + p.path);
    else { fs.writeFileSync(file, out); console.log('wrote docs/' + p.path); }
  }
}
if (CHECK) {
  if (drift.length) { console.log(drift.join('\n')); console.log(`check: ${drift.length} page(s) out of date — run node scripts/docs/build.mjs`); process.exit(1); }
  console.log(`check: ${pages.length} pages match specs`);
} else {
  // landing (docs/index.html)
const landingOut = renderLanding();
const landingFile = path.join(DOCS, LANDING_PATH);
const landingPrev = fs.existsSync(landingFile) ? fs.readFileSync(landingFile, 'utf-8') : null;
if (landingPrev !== landingOut) {
  if (CHECK) { console.log('DRIFT docs/' + LANDING_PATH); process.exitCode = 1; }
  else { fs.writeFileSync(landingFile, landingOut); console.log('wrote docs/' + LANDING_PATH); changed++; }
}
console.log(`build: ${pages.length + 1} pages, ${changed} changed`);
}

// sitemap + robots
const today = '2026-09-09';
const sitemapBody =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_ORIGIN}/</loc><lastmod>${today}</lastmod></url>
  <url><loc>${SITE_ORIGIN}/index.html</loc><lastmod>${today}</lastmod></url>
${pages.map((p) => `  <url><loc>${SITE_ORIGIN}/${p.path}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`;
const robots = `User-agent: *
Allow: /
Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;
if (!CHECK) {
  fs.writeFileSync(path.join(DOCS, 'sitemap.xml'), sitemapBody);
  fs.writeFileSync(path.join(DOCS, 'robots.txt'), robots);
  fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');
  console.log('wrote docs/sitemap.xml, docs/robots.txt, docs/.nojekyll');
} else {
  const cmp = (f, want) => { const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : null; if (cur !== want) { console.log('DRIFT docs/' + path.relative(DOCS, f)); process.exitCode = 1; } };
  cmp(path.join(DOCS, 'sitemap.xml'), sitemapBody);
  cmp(path.join(DOCS, 'robots.txt'), robots);
}
