// Product landing page (docs/index.html). Generated — content must remain
// traceable: numbers here are the measured values published in the docs set.
import { DOCS_VERSION, LAST_REVIEWED, SITE_ORIGIN, REPO } from './site.mjs';

export const LANDING_PATH = 'index.html';

export function renderLanding() {
  return `<!DOCTYPE html>
<html lang="en" class="landing">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terranoetis — Real-Time Geospatial Intelligence Platform</title>
<meta name="description" content="Terranoetis: 150 literature-cited equation engines, seven hazard-physics simulation kernels, live-data monitoring and AI-assisted analysis on a CesiumJS globe. Documentation with file-level citations and measured verification.">
<link rel="canonical" href="${SITE_ORIGIN}/">
<link rel="stylesheet" href="assets/docs.css">
<link rel="stylesheet" href="assets/landing.css">
<link rel="icon" href="terranoetis.png" type="image/png">
<meta property="og:title" content="Terranoetis — Real-Time Geospatial Intelligence Platform">
<meta property="og:description" content="150 literature-cited equation engines · 7 hazard-physics kernels · live-data monitoring · AI-assisted analysis on a 3D globe.">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE_ORIGIN}/">
<meta property="og:image" content="${SITE_ORIGIN}/terranoetis.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="docs-version" content="${DOCS_VERSION}">
<meta name="docs-last-reviewed" content="${LAST_REVIEWED}">
<meta name="generator" content="scripts/docs/landing.mjs">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-banner">
  <div class="site-banner-inner">
    <a class="brand" href="index.html">TERRANOETIS</a>
    <nav class="top-nav" aria-label="Primary">
      <a href="documentation.html">Documentation</a>
      <a href="capabilities/hazard-simulations.html">Capabilities</a>
      <a href="methodology.html">Verification</a>
      <a href="deployment.html">Deployment</a>
      <a href="${REPO}" rel="noopener">GitHub</a>
    </nav>
  </div>
</header>
<main id="main">
  <nav class="breadcrumbs" aria-label="Breadcrumb" style="max-width:72rem;margin:1rem auto 0;padding:0 1.5rem;"><ol><li aria-current="page">Overview</li></ol></nav>

  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-inner">
      <div>
        <span class="hero-badge">Open source · BUSL-1.1 · v${DOCS_VERSION}</span>
        <h1 id="hero-title">Terranoetis</h1>
        <p class="tagline">A real-time geospatial intelligence platform for disaster research and operations: a CesiumJS globe, an Express/TypeScript API, 150 literature-cited analytical equations, seven hazard-physics simulation kernels, continuous live-data monitoring, and an AI chat pipeline with dual-process reasoning. The documentation states what the code does — with file-level citations, and measured evidence wherever it was executable.</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="documentation.html">Open the documentation</a>
          <a class="btn btn-ghost" href="capabilities/hazard-simulations.html">Hazard simulations</a>
          <a class="btn btn-ghost" href="${REPO}" rel="noopener">Source on GitHub</a>
        </div>
      </div>
      <figure>
        <img src="Terranoetis_Thumbnail.webp" alt="Terranoetis globe interface showing live data layers and analysis panels over a 3D Earth" width="1280" height="720" loading="eager">
        <figcaption>The Terranoetis globe — live data layers and analysis panels on a CesiumJS terrain.</figcaption>
      </figure>
    </div>
    <div class="stat-strip" role="list" aria-label="Verified platform facts">
      <div role="listitem"><strong>150</strong><span>literature-cited equation engines · 7 parts · 26 domains</span></div>
      <div role="listitem"><strong>7</strong><span>hazard-physics simulation kernels with internal validation gates</span></div>
      <div role="listitem"><strong>1,700+</strong><span>unit &amp; integration tests passing</span></div>
      <div role="listitem"><strong>82</strong><span>registered external API integrations</span></div>
    </div>
  </section>

  <section class="band" id="platform" aria-labelledby="platform-h">
    <div class="band-head">
      <h2 id="platform-h">One platform, four working layers</h2>
      <p>Client, API, computation and persistence — documented per layer with source citations. Three tiers: React 19 + Cesium client · Express 4 + TypeScript API · SQLite primary store with optional Redis acceleration.</p>
    </div>
    <div class="feat-grid">
      <div class="feat"><span class="k">Compute</span><h3>Analytical equation engine</h3><p>150 deterministic functions across 7 parts / 26 domains, each citing primary literature (80 DOI, 12 ISBN, 4 flagged NO-DOI). A never-throw contract returns honest NaN instead of invented values.</p><a class="more" href="capabilities/analytical-engine.html">Engine details →</a></div>
      <div class="feat"><span class="k">Simulation</span><h3>Hazard-physics kernels</h3><p>Seven NumPy kernels — GMPE shakeMaps, Voellmy debris flows, Rothermel fire spread, Holland wind + SWE surge, local-inertial flood SWE, shallow-water tsunami, lava/plume/ash volcano models. Three run locally on CPU; four execute on Kaggle kernels.</p><a class="more" href="capabilities/hazard-simulations.html">Simulation architecture →</a></div>
      <div class="feat"><span class="k">Live data</span><h3>Monitoring &amp; alerts</h3><p>82 registered integrations; Sentinel polling (USGS 60 s, EONET 120 s, FIRMS 180 s, NWS 120 s) with published detection thresholds, correlation engine and reflex actions on the globe.</p><a class="more" href="capabilities/live-data-and-monitoring.html">Data &amp; monitoring →</a></div>
      <div class="feat"><span class="k">Cognition</span><h3>AI chat pipeline</h3><p>Eight-intent router, System 1 / System 2 thresholds (0.92 / 0.70), 4-agent debate with critic, tool loop over live data and kernels; nine-provider model router with local GGUF fallback.</p><a class="more" href="capabilities/ai-cognition.html">Cognition →</a></div>
    </div>
    <div class="showcase">
      <figure><img src="assets/showcase/multi-hazard.gif" alt="Multi-hazard risk surfaces fused from live seismic, fire, storm and flood data rendered on the 3D globe" width="640" height="360" loading="lazy"><figcaption>Multi-hazard risk surfaces fused from live seismic, fire, storm and flood data.</figcaption></figure>
      <figure><img src="assets/showcase/landslide.gif" alt="Landslide debris-flow simulation over real topography, depth field animated in time steps" width="640" height="360" loading="lazy"><figcaption>Landslide debris-flow simulation propagating over real topography.</figcaption></figure>
    </div>
  </section>

  <section class="band alt" id="hazards" aria-labelledby="hazards-h">
    <div class="band-head">
      <h2 id="hazards-h">Seven hazards, seven cited physics pages</h2>
      <p>Every capability page carries the governing equations with their published sources, the UI → wire → kernel parameter contract, outputs with units, spatial-origin semantics, the kernel’s own validity limits verbatim, and reproduction commands — the figures below come from executing each kernel.</p>
    </div>
    <div class="hz-grid">
      <div class="hz"><h3><a href="capabilities/earthquake.html">Earthquake</a></h3><p>BSSA14 NGA-West2 GMPE + USGS instrumental MMI. M 7.5 test → max PGA 251.0 cm/s², 0.008 s compute, 166 ms end-to-end job.</p></div>
      <div class="hz"><h3><a href="capabilities/hurricane.html">Hurricane</a></h3><p>Holland 1980 wind + SWE surge + waves + Lonfat rainfall + TR-55 runoff. Physics gate PASS measured; Cat 4 test: 77.0 m/s, 1.15 m surge.</p></div>
      <div class="hz"><h3><a href="capabilities/wildfire.html">Wildfire</a></h3><p>Rothermel 1972 over Anderson-13 fuels; K_ROS calibration to the 0.105 m/s reference reproduced (0.103 → PASS).</p></div>
      <div class="hz"><h3><a href="capabilities/flood.html">Flood</a></h3><p>Local-inertial SWE (LISFLOOD-FP family) with conservation gates. 300 mm event: mass closure 0.0000 %, max depth 4.01 m.</p></div>
      <div class="hz"><h3><a href="capabilities/landslide.html">Landslide</a></h3><p>Voellmy–Salm depth-averaged flow; μ×ξ calibration against observed runout; convergence script PASS (Δ₂ = 0.050).</p></div>
      <div class="hz"><h3><a href="capabilities/volcano.html">Volcano</a></h3><p>Lava SWE + Morton–Taylor plume + ash settling PDE. Benchmark suite 4/4 PASS — Kilauea 2018 runout 15.0 vs ~13.5 km.</p></div>
      <div class="hz"><h3><a href="capabilities/tsunami.html">Tsunami</a></h3><p>HLL/minmod SWE over real GEBCO 2020. Verification found a non-flat-bathymetry instability — documented openly with repro commands.</p></div>
    </div>
  </section>

  <section class="band" id="verification" aria-labelledby="verif-h">
    <div class="band-head">
      <h2 id="verif-h">Verification is part of the product</h2>
      <p>A documentation quality gate in CI checks links, anchors, page metadata, every <code>file:line</code> citation and a marketing-vocabulary ban. Claims that could not be executed in review are labelled <span class="tag tag-inspected">VERIFIED BY CODE INSPECTION ONLY</span>; defects found in the science are published, not buried.</p>
    </div>
    <div class="feat-grid">
      <div class="feat"><h3>Kernel self-gates</h3><p>GMPE sanity, hurricane physics checks, closed-box conservation and lake-at-rest proofs abort emission on failure — each reproduced in review.</p></div>
      <div class="feat"><h3>Published limitation register</h3><p>Every numerical or engineering finding from the review — from solver behaviour to wire-constant artifacts — is cited and linked from its capability page.</p></div>
      <div class="feat"><h3>Discrepancy log</h3><p>Documentation claims are audited against the code; anything the code does not support is corrected and logged.</p></div>
      <div class="feat"><h3>Reproducible numbers</h3><p>Every measured figure ships with the command that produced it, so any reviewer can rerun the check on their own machine.</p></div>
    </div>
    <p style="margin-top:1.2rem"><a class="btn btn-primary" href="methodology.html" style="background:var(--c-accent)">Read the methodology &amp; evidence runs</a></p>
  </section>

  <section class="band alt" id="start" aria-labelledby="start-h">
    <div class="band-head">
      <h2 id="start-h">Run it locally in minutes</h2>
      <p>Node ≥ 20 and Python 3 are enough: no API keys are required for the analytical engine, the three local simulation kernels, or the API itself.</p>
    </div>
    <pre><code>git clone https://github.com/sreyassanker/Terranoetis.git
cd Terranoetis
cp .env.example .env   # optional keys — features degrade gracefully
npm install
npm run dev            # Vite :3000 + Express :3001
curl -s http://localhost:3001/api/health   # measured boot: status + component checks</code></pre>
    <p>Continue with <a href="getting-started.html">Getting started</a> for the measured first-run transcript, or the <a href="deployment.html">deployment guide</a> for Docker, environment variables and optional Kaggle credentials.</p>
  </section>

  <section class="cta-band" aria-labelledby="cta-h">
    <h2 id="cta-h">Start with the evidence</h2>
    <p>Capability pages, parameter contracts, API reference and verification records — all cited to source.</p>
    <div class="hero-actions" style="justify-content:center">
      <a class="btn btn-primary" href="documentation.html">Documentation hub</a>
      <a class="btn btn-ghost" href="${REPO}" rel="noopener">GitHub repository</a>
    </div>
    <div class="badge-row" aria-label="Repository and maintainer links">
      <a href="${REPO}/stargazers" rel="noopener"><img alt="GitHub stars" src="https://img.shields.io/github/stars/sreyassanker/Terranoetis?style=for-the-badge&logo=github&color=181717"></a>
      <a href="https://sreyassanker.vercel.app" rel="noopener"><img alt="Portfolio" src="https://img.shields.io/badge/Portfolio-000000?style=for-the-badge&logo=vercel&logoColor=white"></a>
      <a href="https://github.com/sreyassanker" rel="noopener"><img alt="GitHub" src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white"></a>
      <a href="https://linkedin.com/in/sreyassanker" rel="noopener"><img alt="LinkedIn" src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white"></a>
      <a href="https://buymeacoffee.com/sreyassanker" rel="noopener"><img alt="Buy Me a Coffee" src="https://img.shields.io/badge/Buy_Me_A_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black"></a>
      <a href="https://youtube.com/playlist?list=PLFp9mjre3Lco&si=yDAxddidcQZ4w_km" rel="noopener"><img alt="YouTube" src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white"></a>
    </div>
  </section>
</main>
<footer class="landing-footer">
  <div class="inner">
    <span>Terranoetis v${DOCS_VERSION} · <a href="sitemap.xml">sitemap</a> · <a href="governance/style-guide.html">documentation style guide</a></span>
    <span>License <a href="${REPO}/blob/main/LICENSE">BUSL-1.1</a> · source <a href="${REPO}">${REPO.replace('https://', '')}</a> · third-party components retain their own licenses (CesiumJS et al.)</span>
  </div>
</footer>
</body>
</html>`;
}
