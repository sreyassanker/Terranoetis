#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// Docs quality gate — CI-enforced checks for the documentation site.
//   node scripts/docs/quality-gate.mjs
// Fails (exit 1) on: broken internal links, missing anchor targets, missing
// page metadata, unresolvable file:line citations, banned vocabulary,
// sitemap gaps, or build drift.
// ═══════════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOCS = path.join(ROOT, 'docs');
const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);

const walk = (dir, out = []) => {
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('.')) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const htmlFiles = walk(DOCS).filter((f) => f.endsWith('.html'));
const mdFiles = [path.join(ROOT, 'README.md'), path.join(ROOT, 'CONTRIBUTING.md'), path.join(ROOT, 'SECURITY.md')]
  .concat(walk(DOCS).filter((f) => f.endsWith('.md')));

// ── 0. build drift ─────────────────────────────────────────────────────────
try {
  const out = execFileSync('node', ['scripts/docs/build.mjs', '--check'], { cwd: ROOT, encoding: 'utf-8' });
  if (/DRIFT/.test(out)) err('build drift: ' + out.trim());
} catch (e) {
  const o = (e.stdout || '') + (e.stderr || '');
  if (/DRIFT/.test(o)) err('build drift — rerun `node scripts/docs/build.mjs` and commit output');
  else err('build --check failed: ' + o.split('\n').slice(0, 3).join(' | '));
}

// ── helpers ────────────────────────────────────────────────────────────────
const idsInHtml = new Map();
for (const f of htmlFiles) {
  const t = fs.readFileSync(f, 'utf-8');
  idsInHtml.set(f, new Set([...t.matchAll(/id="([^"]+)"/g)].map((m) => m[1])));
}
const idsInMd = new Map();
const slug = (s) => s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
for (const f of mdFiles) {
  const t = fs.readFileSync(f, 'utf-8');
  idsInMd.set(f, new Set([...t.matchAll(/^#{1,4}\s+(.+)$/gm)].map((m) => slug(m[1]))));
}

const BANNED = ['world-class', 'world class', 'cutting-edge', 'best-in-class', 'state-of-the-art',
  'revolutionary', 'unparalleled', 'game-changing', 'industry-leading', 'unprecedented',
  'next-generation', 'ultimate solution', 'seamless', 'blazing-fast', 'blazing fast'];

function checkLinks(file, text, isHtml) {
  const dir = path.dirname(file);
  const hrefs = isHtml
    ? [...text.matchAll(/href="([^"]+)"|src="([^"]+)"/g)].map((m) => m[1] || m[2])
    : [...text.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[2]);
  for (const href of hrefs) {
    if (!href || href.startsWith('#')) continue;
    if (/^(https?:|mailto:|data:|blob:)/.test(href)) continue;
    const [rawTarget, anchor] = href.split('#');
    if (!rawTarget) continue;
    if (/^[a-z]+:\/\//.test(rawTarget)) { err(`${path.relative(ROOT, file)}: protocol-relative or unknown scheme "${href}"`); continue; }
    const target = path.resolve(dir, rawTarget);
    if (!fs.existsSync(target)) {
      err(`${path.relative(ROOT, file)}: broken link → ${href}`);
      continue;
    }
    if (anchor) {
      if (target.endsWith('.html')) {
        const ids = idsInHtml.get(target) || new Set();
        if (!ids.has(anchor)) err(`${path.relative(ROOT, file)}: missing anchor #${anchor} in ${href}`);
      } else if (target.endsWith('.md')) {
        const ids = idsInMd.get(target) || new Set();
        if (!ids.has(slug(decodeURIComponent(anchor)))) {
          // GitHub-style heading match only; ignore explicit heading-anchors we cannot resolve offline
          if (!idsInMd.has(target)) warnings.push(`${path.relative(ROOT, file)}: no headings found in ${href} for #${anchor}`);
          else err(`${path.relative(ROOT, file)}: missing anchor #${anchor} in ${href}`);
        }
      }
    }
  }
}

function checkVocab(file, text) {
  // strip code/pre blocks so quotes are not policed as prose
  const prose = text.replace(/<pre[\s\S]*?<\/pre>/gi, ' ').replace(/<code[\s\S]*?<\/code>/gi, ' ')
    .replace(/<blockquote class="verbatim"[\s\S]*?<\/blockquote>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ');
  for (const w of BANNED) {
    const re = new RegExp('\\b' + w.replace(/-/g, '[- ]') + '\\b', 'i');
    if (re.test(prose)) err(`${file}: banned marketing vocabulary "${w}"`);
  }
}

// ── 1. HTML pages ──────────────────────────────────────────────────────────
for (const f of htmlFiles) {
  const rel = path.relative(ROOT, f);
  const t = fs.readFileSync(f, 'utf-8');
  // generated pages only (skip archived marketing stub which is a pure redirect)
  const isGenerated = /name="generator" content="scripts\/docs\/build.mjs"/.test(t);
  checkLinks(rel.startsWith('docs') ? f : f, t, true);
  checkVocab(rel, t);
  if (!isGenerated) continue;
  for (const m of ['<meta name="description"', '<link rel="canonical"', 'meta property="og:title"',
    '<meta name="docs-version"', '<meta name="docs-last-reviewed"', '<title>', '<main id="main"',
    'aria-label="Breadcrumb"', 'lang="en"']) {
    if (!t.includes(m)) err(`${rel}: missing required element "${m}"`);
  }
  // citations
  const citeRe = /<cite class="src">([^<]+)<\/cite>/g;
  for (const m of t.matchAll(citeRe)) {
    const raw = m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const mm = raw.match(/^(.+?):([\d,\s-]+)$/);
    if (!mm) continue; // free-form cites (e.g. "counted") are warnings, not errors
    const [, p, range] = mm;
    if (/^\s*(counted|measured|observed|counted\.)\s*$/.test(range)) continue;
    const target = path.join(ROOT, p.trim());
    if (!fs.existsSync(target)) { err(`${rel}: citation target missing → ${p.trim()}`); continue; }
    const stat = fs.statSync(target);
    if (!stat.isFile()) continue;
    if (/\.(png|webp|jpe?g|pdf|db|npy|tif|json)$/i.test(p)) continue;
    const lines = fs.readFileSync(target, 'utf-8').split('\n').length;
    for (const part of range.split(',')) {
      const nums = [...part.matchAll(/\d+/g)].map((x) => Number(x[0]));
      for (const n of nums) {
        if (n > lines) err(`${rel}: citation ${raw} — line ${n} beyond EOF (${p.trim()} has ${lines} lines)`);
      }
    }
  }
}

// ── 2. Markdown files ──────────────────────────────────────────────────────
for (const f of mdFiles) {
  const t = fs.readFileSync(f, 'utf-8');
  checkLinks(f, t, false);
  checkVocab(path.relative(ROOT, f), t);
}

// ── 3. sitemap coverage ────────────────────────────────────────────────────
const sitemap = fs.readFileSync(path.join(DOCS, 'sitemap.xml'), 'utf-8');
for (const f of htmlFiles) {
  const rel = path.relative(DOCS, f).split(path.sep).join('/');
  const isGenerated = /name="generator"/.test(fs.readFileSync(f, 'utf-8'));
  if (isGenerated && !sitemap.includes('/' + rel) && !(rel === 'index.html' && sitemap.includes('https://terranoetis.com/'))) {
    err(`sitemap.xml missing ${rel}`);
  }
}

// ── report ─────────────────────────────────────────────────────────────────
console.log(`docs quality gate — ${htmlFiles.length} HTML pages, ${mdFiles.length} markdown files`);
for (const w of warnings) console.log('WARN ', w);
if (errors.length) {
  for (const e of errors) console.log('ERROR', e);
  console.log(`FAIL — ${errors.length} error(s)`);
  process.exit(1);
}
console.log('PASS — links, anchors, metadata, citations, vocabulary, sitemap all clean');
