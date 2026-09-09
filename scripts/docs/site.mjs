// ═══════════════════════════════════════════════════════════════════════
// Terranoetis docs — shared page template and site model.
// All HTML pages are generated from this module so navigation, metadata,
// breadcrumbs and version stamps stay consistent. Prose lives in the
// linked Markdown files; this module emits only structure + verified data.
// ═══════════════════════════════════════════════════════════════════════

export const DOCS_VERSION = '3.0.0';
export const LAST_REVIEWED = '2026-09-08';
export const SITE_ORIGIN = 'https://sreyassanker.github.io/Terranoetis';
export const REPO = 'https://github.com/sreyassanker/Terranoetis';

// Sidebar navigation tree. `href` values are repo-root-relative (from docs/).
export const NAV = [
  { group: 'Start', items: [
    { href: 'index.html', label: 'Product overview' },
    { href: 'documentation.html', label: 'Documentation home' },
    { href: 'getting-started.html', label: 'Getting started' },
    { href: 'architecture.html', label: 'Platform architecture' },
  ]},
  { group: 'Hazard simulations', items: [
    { href: 'capabilities/hazard-simulations.html', label: 'Overview & architecture' },
    { href: 'capabilities/earthquake.html', label: 'Earthquake ground motion' },
    { href: 'capabilities/tsunami.html', label: 'Tsunami propagation' },
    { href: 'capabilities/volcano.html', label: 'Volcanic eruption' },
    { href: 'capabilities/landslide.html', label: 'Landslide debris flow' },
    { href: 'capabilities/flood.html', label: 'Flood inundation' },
    { href: 'capabilities/hurricane.html', label: 'Hurricane wind & surge' },
    { href: 'capabilities/wildfire.html', label: 'Wildfire spread' },
  ]},
  { group: 'Intelligence capabilities', items: [
    { href: 'capabilities/analytical-engine.html', label: 'Analytical equation engine' },
    { href: 'capabilities/ai-cognition.html', label: 'AI chat & cognition' },
    { href: 'capabilities/live-data-and-monitoring.html', label: 'Live data & monitoring' },
    { href: 'capabilities/world-model-and-causal.html', label: 'World model & causal reasoning' },
    { href: 'capabilities/memory.html', label: 'Memory system' },
  ]},
  { group: 'Interface & platform', items: [
    { href: 'capabilities/globe-visualization.html', label: '3D globe visualization' },
    { href: 'capabilities/platform-services.html', label: 'Platform services' },
  ]},
  { group: 'Reference', items: [
    { href: 'reference/api.html', label: 'REST & WebSocket API' },
    { href: 'reference/simulation-api.html', label: 'Simulation job API & parameter contracts' },
  ]},
  { group: 'Quality', items: [
    { href: 'methodology.html', label: 'Methodology & verification' },
    { href: 'deployment.html', label: 'Deployment & operations' },
  ]},
  { group: 'Governance', items: [
    { href: 'governance/style-guide.html', label: 'Documentation style guide' },
    { href: 'governance/contributing.html', label: 'Contributing' },
    { href: 'governance/security.html', label: 'Security' },
  ]},
];

export const YOUTUBE_PLAYLIST = 'https://www.youtube.com/playlist?list=PLFp9mjre3Lco';

export const TOP_NAV = [
  { href: 'index.html', label: 'Overview' },
  { href: 'documentation.html', label: 'Documentation' },
  { href: 'capabilities/hazard-simulations.html', label: 'Capabilities' },
  { href: 'methodology.html', label: 'Verification' },
  { href: 'deployment.html', label: 'Deployment' },
  { href: 'governance/style-guide.html', label: 'Governance' },
  { href: YOUTUBE_PLAYLIST, label: 'Demo', external: true, cls: 'nav-demo' },
];

/** Repo-root-relative path from a page at `depth` levels below docs/ root. */
export function rel(depth, target) {
  return '../'.repeat(depth) + target;
}

const esc = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

/** Inline citation chip: src('kaggle-kernels/earthquake-sim/main.py', '14-21') */
export function src(path, lines) {
  return `<cite class="src">${esc(path)}:${esc(lines)}</cite>`;
}
export function srcRaw(pathLine) {
  return `<cite class="src">${esc(pathLine)}</cite>`;
}

export function tagMeasured(extra = 'verified by execution') {
  return `<span class="tag tag-measured">MEASURED — ${esc(extra)}</span>`;
}

function renderSection(s) {
  switch (s.kind) {
    case 'h2': return `<h2 id="${esc(s.id)}">${s.title}</h2>`;
    case 'h3': return `<h3 id="${esc(s.id)}">${s.title}</h3>`;
    case 'p': return `<p>${s.html}</p>`;
    case 'lede': return `<p class="lede">${s.html}</p>`;
    case 'code': return `<h3 id="${esc(s.id)}">${esc(s.title)}</h3>\n<pre><code>${s.lines.map(esc).join('\n')}</code></pre>`;
    case 'verbatim': return `<blockquote class="verbatim">${esc(s.quote)}<footer>${s.cite}</footer></blockquote>`;
    case 'eq': return `<figure class="equation"><span class="formula">${esc(s.formula)}</span><figcaption>${esc(s.caption || '')} ${s.cite || ''}</figcaption></figure>`;
    case 'table': {
      const cols = s.cols.map((c) => `<th scope="col">${c}</th>`).join('');
      const body = s.rows.map((r) => `<tr>${r.map((cell, i) => `<${i === 0 && s.rowheaders ? 'th scope="row"' : 'td'}>${cell}</${i === 0 && s.rowheaders ? 'th' : 'td'}>`).join('')}</tr>`).join('\n');
      return `<div class="table-scroll"><table><caption>${s.caption || ''}</caption>\n<thead><tr>${cols}</tr></thead>\n<tbody>\n${body}\n</tbody></table></div>`;
    }
    case 'metrics': return `<dl class="metrics">${s.items.map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join('\n')}</dl>`;
    case 'callout': {
      const tone = { verified: 'callout-verified', inspect: 'callout-inspect', caution: 'callout-caution', warning: 'callout-warning' }[s.tone] || 'callout-inspect';
      return `<div class="callout ${tone}" role="note"><div class="callout-title">${esc(s.title)}</div>${s.html}</div>`;
    }
    case 'list': return `<${s.ordered ? 'ol' : 'ul'}>${s.items.map((i) => `<li>${i}</li>`).join('\n')}</${s.ordered ? 'ol' : 'ul'}>`;
    case 'cards': return `<div class="card-grid">${s.items.map((c) => `<div class="card">${c.tag || ''}<a href="${esc(c.href)}">${esc(c.title)}</a><p>${c.desc}</p></div>`).join('\n')}</div>`;
    default: throw new Error(`unknown section kind: ${s.kind}`);
  }
}

/**
 * Render a full HTML page.
 * page: { path, depth, title, desc, breadcrumb, sections, proseMd?, tags? }
 */
export function renderPage(page) {
  const d = page.depth;
  const r = (t) => rel(d, t);
  const crumbHtml = [
    `<li><a href="${r('index.html')}">Overview</a></li>
    <li><a href="${r('documentation.html')}">Docs</a></li>`,
    ...page.breadcrumb.map((b, i, a) => i === a.length - 1
      ? `<li aria-current="page">${esc(b.label)}</li>`
      : `<li><a href="${r(b.href)}">${esc(b.label)}</a></li>`),
  ].join('\n');

  const sidebar = NAV.map((g) => `<h2>${esc(g.group)}</h2>\n<ul>${g.items.map((i) => {
    const active = i.href === page.path ? ' aria-current="true"' : '';
    return `<li><a href="${r(i.href)}"${active}>${esc(i.label)}</a></li>`;
  }).join('\n')}</ul>`).join('\n');

  const tags = (page.tags || []).join(' · ');
  const toc = page.sections.filter((s) => s.kind === 'h2')
    .map((s) => `<li><a href="#${esc(s.id)}">${s.title}</a></li>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} — Terranoetis Documentation</title>
<meta name="description" content="${esc(page.desc)}">
<link rel="canonical" href="${SITE_ORIGIN}/${page.path}">
<link rel="stylesheet" href="${r('assets/docs.css')}">
<link rel="icon" href="${r('terranoetis.png')}" type="image/png">
<meta property="og:title" content="${esc(page.title)} — Terranoetis Documentation">
<meta property="og:description" content="${esc(page.desc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${SITE_ORIGIN}/${page.path}">
<meta property="og:image" content="${SITE_ORIGIN}/terranoetis.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="docs-version" content="${DOCS_VERSION}">
<meta name="docs-last-reviewed" content="${LAST_REVIEWED}">
<meta name="generator" content="scripts/docs/build.mjs">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Syncopate:wght@400;700&display=swap" rel="stylesheet">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-banner">
  <div class="site-banner-inner">
    <a class="brand" href="${r('index.html')}"><img src="${r('terranoetis.png')}" alt="" width="32" height="32" class="brand-logo"><span class="terra">TERRA</span><span class="noetis">NOETIS</span></a>
    <nav class="top-nav" aria-label="Primary">
      ${TOP_NAV.map((t) => `<a href="${t.external ? t.href : r(t.href)}"${page.path === t.href ? ' aria-current="page"' : ''}${t.external ? ' rel="noopener"' : ''}${t.cls ? ` class="${t.cls}"` : ''}>${esc(t.label)}</a>`).join('\n      ')}
    </nav>
  </div>
</header>
<div class="layout">
  <nav class="sidebar" aria-label="Documentation">
    ${sidebar}
  </nav>
  <main id="main">
    <div class="content">
      <nav class="breadcrumbs" aria-label="Breadcrumb"><ol>
        ${crumbHtml}
      </ol></nav>
      <h1>${esc(page.title)}</h1>
      <div class="page-meta">
        <span><strong>Platform</strong> v${DOCS_VERSION}</span>
        <span><strong>Docs</strong> v${DOCS_VERSION}</span>
        <span><strong>Last reviewed</strong> ${LAST_REVIEWED}</span>
        ${tags ? `<span>${tags}</span>` : ''}
      </div>
      ${page.proseMd ? `<p><strong>Full description (prose, source of truth):</strong> <a href="${r(page.proseMd)}">${esc(page.proseMdLabel || page.proseMd)}</a></p>` : ''}
      ${toc ? `<nav class="toc" aria-label="On this page"><h2 id="toc">On this page</h2><ul>
        ${toc}
      </ul></nav>` : ''}
      ${page.sections.map(renderSection).join('\n')}
      <footer class="site-footer">
        <p>Terranoetis v${DOCS_VERSION} · documentation last reviewed ${LAST_REVIEWED} ·
        source: <a href="${REPO}">${esc(REPO.replace('https://', ''))}</a> ·
        license: <a href="${REPO}/blob/main/LICENSE">BUSL-1.1</a> ·
        prose source of truth: <a href="${REPO}/tree/main/docs">docs/</a> in-repo Markdown ·
        corrections: see <a href="${r('methodology.html')}#discrepancy-log">discrepancy log</a>.</p>
      </footer>
    </div>
  </main>
</div>
</body>
</html>`;
}
