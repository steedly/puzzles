#!/usr/bin/env node
/**
 * Post-build script: inlines all JS and CSS from dist/assets into a single
 * self-contained dist/index.bundle.html.
 *
 * Usage (automatically run via "npm run bundle"):
 *   node scripts/bundle.cjs
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const distDir    = path.resolve(__dirname, '..', 'dist');
const indexPath  = path.join(distDir, 'index.html');
const outputPath = path.join(distDir, 'index.bundle.html');

if (!fs.existsSync(indexPath)) {
  console.error('dist/index.html not found — run "npm run build" first.');
  process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf8');

// Resolve asset href to a dist/ file path, stripping any base-path prefix.
function resolveAsset(href) {
  // href may be "/puzzles/assets/foo.js" or "/assets/foo.js"
  const rel = href.replace(/^\/[^/]*\//, '');  // strip leading /prefix/
  let file = path.join(distDir, rel);
  if (fs.existsSync(file)) return file;
  // Fallback: strip only the leading slash
  file = path.join(distDir, href.replace(/^\//, ''));
  return fs.existsSync(file) ? file : null;
}

// Inline CSS: <link rel="stylesheet" … href="/puzzles/assets/foo.css">
html = html.replace(
  /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g,
  (tag, href) => {
    const file = resolveAsset(href);
    if (!file) { console.warn('CSS not found:', href); return tag; }
    const css = fs.readFileSync(file, 'utf8');
    return `<style>${css}</style>`;
  }
);

// Inline JS: <script type="module" … src="/puzzles/assets/foo.js"></script>
html = html.replace(
  /<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g,
  (tag, before, src, after) => {
    const file = resolveAsset(src);
    if (!file) { console.warn('JS not found:', src); return tag; }
    const js = fs.readFileSync(file, 'utf8');
    // Keep all attributes except src; drop crossorigin (not needed for inline)
    const attrs = (before + after)
      .replace(/\scrossorigin/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `<script ${attrs}>${js}</script>`;
  }
);

// Embed puzzles.llp as a gzip-compressed base64 blob to minimize bundle size.
// If solutions are present (6-field lines), they are stripped; already-stripped
// 5-field lines are kept as-is.
// The app decompresses it at load time using the browser's DecompressionStream API.
const llpPath = path.join(distDir, 'puzzles.llp');
if (fs.existsSync(llpPath)) {
  const llpText    = fs.readFileSync(llpPath, 'utf8');
  // Strip solution column only from 6-field lines (id|exits|helpers|minMoves|positions|solution).
  // 5-field lines (already stripped) are left unchanged.
  const stripped   = llpText
    .split('\n')
    .map(line => {
      if (!line || line.startsWith('#')) return line;
      const fields = line.split('|');
      if (fields.length === 6) return fields.slice(0, 5).join('|');
      return line;
    })
    .join('\n');
  const gzipped    = zlib.gzipSync(Buffer.from(stripped, 'utf8'), { level: 9 });
  const base64     = gzipped.toString('base64');
  const inlined    = `<script>window.__PUZZLES_GZ_B64__=${JSON.stringify(base64)};</script>`;
  html = html.replace('</head>', `${inlined}\n</head>`);
  const rawKB  = (llpText.length / 1024).toFixed(1);
  const stripKB = (stripped.length / 1024).toFixed(1);
  const gzKB   = (gzipped.length / 1024).toFixed(1);
  const b64KB  = (base64.length / 1024).toFixed(1);
  console.log(`Embedded puzzles.llp  (${rawKB} kB raw → ${stripKB} kB stripped → ${gzKB} kB gzip → ${b64KB} kB base64)`);
} else {
  console.warn('puzzles.llp not found in dist/ — bundle will show file picker instead.');
}

fs.writeFileSync(outputPath, html, 'utf8');
const kb = (fs.statSync(outputPath).size / 1024).toFixed(1);
console.log(`Bundled → dist/index.bundle.html  (${kb} kB)`);
console.log('Share index.bundle.html as a single self-contained file.');
