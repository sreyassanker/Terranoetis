// ═══════════════════════════════════════════════════════════════════════
// Narrative pages — renders the in-repo Markdown prose as styled HTML
// pages inside the site chrome, so GitHub Pages never serves raw .md.
// docs/x.md → docs/narratives/x.html · docs/capabilities/x.md →
// docs/narratives/capabilities/x.html · root CONTRIBUTING.md/SECURITY.md →
// docs/narratives/<name>.html. Markdown files remain the repo source of
// truth; this module is the presentation layer for the website.
// ═══════════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOCS = path.join(ROOT, 'docs');

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);

// Heading slugger — must match the quality gate's md-slug rule exactly so
// old #anchor links keep resolving against generated heading ids.
const slug = (s) => s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');

const esc = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const collectText = (node) => {
  if (node.type === 'text') return node.value;
  return (node.children || []).map(collectText).join('');
};

function serialize(node) {
  switch (node.type) {
    case 'root': return node.children.map(serialize).join('\n');
    case 'text': return esc(node.value);
    case 'element': {
      const attrs = Object.entries(node.properties || {})
        .filter(([, v]) => v !== null && v !== undefined && v !== false && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => {
          const name = k === 'className' ? 'class' : k === 'htmlFor' ? 'for' : k;
          return ` ${name}="${esc(Array.isArray(v) ? v.join(' ') : v === true ? k : String(v))}"`;
        })
        .join('');
      const inner = (node.children || []).map(serialize).join('');
      const out = `<${node.tagName}${attrs}>${inner}</${node.tagName}>`;
      return node.tagName === 'table' ? `<div class="table-scroll">${out}</div>` : out;
    }
    default: return '';
  }
}

// Rewrite relative links so they resolve from the generated page's location:
// .md targets → their narrative page; site .html targets → re-relativized;
// absolute/anchor links pass through untouched.
function rewriteLinks(node, srcDir, outDir) {
  if (node.type === 'element' && node.tagName === 'a' && node.properties && typeof node.properties.href === 'string') {
    const href = node.properties.href;
    if (!/^(https?:|mailto:|#)/.test(href) && !href.startsWith('//')) {
      const [raw, anchor] = href.split('#');
      const target = path.resolve(srcDir, raw);
      if (fs.existsSync(target)) {
        let dest;
        if (target.endsWith('.md')) {
          const relFromRoot = path.relative(ROOT, target).replaceAll(path.sep, '/');
          dest = relFromRoot.startsWith('docs/')
            ? 'narratives/' + relFromRoot.slice(5).replace(/\.md$/, '.html')
            : 'narratives/' + path.basename(target).replace(/\.md$/, '.html');
        } else {
          dest = path.relative(DOCS, target).replaceAll(path.sep, '/');
        }
        node.properties.href = (path.relative(outDir, path.join(DOCS, dest)).replaceAll(path.sep, '/') || path.basename(dest)) + (anchor ? '#' + anchor : '');
      }
    }
  }
  for (const child of node.children || []) rewriteLinks(child, srcDir, outDir);
}

function addHeadingIds(node) {
  if (node.type === 'element' && /^h[1-4]$/.test(node.tagName) && !node.properties.id) {
    node.properties.id = slug(collectText(node));
  }
  for (const child of node.children || []) addHeadingIds(child);
}

// Convert ```mermaid fences into <pre class="mermaid"> blocks rendered by
// mermaid.js at view time (exact graphs from the Markdown source).
function markMermaid(node) {
  if (node.type === 'element' && node.tagName === 'pre' && node.children?.[0]?.type === 'element'
      && node.children[0].tagName === 'code'
      && /language-mermaid/.test(node.children[0].properties?.className?.join(' ') || '')) {
    node.tagName = 'pre';
    node.properties = { className: ['mermaid'] };
    node.children = [{ type: 'text', value: collectText(node.children[0]) }];
    return true;
  }
  let found = false;
  for (const child of node.children || []) found = markMermaid(child) || found;
  return found;
}

const MERMAID_HEAD = `<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
</script>`;

function listMarkdownFiles() {
  const walk = (dir, out = []) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith('.md')) out.push(p);
    }
    return out;
  };
  const docsMd = walk(DOCS).map((f) => ({ abs: f, out: 'narratives/' + path.relative(DOCS, f).replace(/\.md$/, '.html') }));
  const rootMd = ['CONTRIBUTING.md', 'SECURITY.md']
    .map((f) => ({ abs: path.join(ROOT, f), out: 'narratives/' + f.replace(/\.md$/, '.html') }));
  return [...docsMd, ...rootMd];
}

/** Page specs consumable by renderPage() in site.mjs / build.mjs. */
export function narrativePages() {
  const specs = [];
  for (const { abs, out } of listMarkdownFiles()) {
    const srcDir = path.dirname(abs);
    const outDir = path.dirname(path.join(DOCS, out));
    const tree = processor.parse(fs.readFileSync(abs, 'utf-8'));
    const hast = processor.runSync(tree);
    // Title = first h1; strip it (renderPage emits its own <h1>).
    let title = path.basename(abs, '.md');
    const first = hast.children.findIndex((n) => n.type === 'element' && n.tagName === 'h1');
    if (first !== -1) {
      title = collectText(hast.children[first]).trim();
      hast.children.splice(first, 1);
    }
    const firstP = hast.children.find((n) => n.type === 'element' && n.tagName === 'p');
    const desc = firstP ? collectText(firstP).replace(/\s+/g, ' ').trim().slice(0, 155) + '…' : title;
    rewriteLinks(hast, srcDir, outDir);
    addHeadingIds(hast);
    const hasMermaid = markMermaid(hast);
    const depth = out.split('/').length - 1;
    specs.push({
      path: out, depth, title, desc,
      breadcrumb: [{ label: 'Documentation', href: 'documentation.html' }, { label: title }],
      head: hasMermaid ? MERMAID_HEAD : '',
      sections: [{ kind: 'raw', html: `<div class="prose">${serialize(hast)}</div>` }],
    });
  }
  return specs;
}
