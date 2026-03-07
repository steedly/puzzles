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

const distDir    = path.resolve(__dirname, '..', 'dist');
const indexPath  = path.join(distDir, 'index.html');
const outputPath = path.join(distDir, 'index.bundle.html');

if (!fs.existsSync(indexPath)) {
  console.error('dist/index.html not found — run "npm run build" first.');
  process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf8');

// Inline CSS: <link rel="stylesheet" … href="/assets/foo.css">
html = html.replace(
  /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g,
  (tag, href) => {
    const file = path.join(distDir, href.replace(/^\//, ''));
    if (!fs.existsSync(file)) { console.warn('CSS not found:', file); return tag; }
    const css = fs.readFileSync(file, 'utf8');
    return `<style>${css}</style>`;
  }
);

// Inline JS: <script type="module" … src="/assets/foo.js"></script>
html = html.replace(
  /<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g,
  (tag, before, src, after) => {
    const file = path.join(distDir, src.replace(/^\//, ''));
    if (!fs.existsSync(file)) { console.warn('JS not found:', file); return tag; }
    const js = fs.readFileSync(file, 'utf8');
    // Keep all attributes except src; drop crossorigin (not needed for inline)
    const attrs = (before + after)
      .replace(/\scrossorigin/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `<script ${attrs}>${js}</script>`;
  }
);

// Embed puzzles.llp as window.__PUZZLES_LLP__ so the app needs no network request.
const llpPath = path.join(distDir, 'puzzles.llp');
if (fs.existsSync(llpPath)) {
  const llpText  = fs.readFileSync(llpPath, 'utf8');
  const inlined  = `<script>window.__PUZZLES_LLP__=${JSON.stringify(llpText)};</script>`;
  // Inject before </head> so the variable is defined before the app JS runs.
  html = html.replace('</head>', `${inlined}\n</head>`);
  console.log(`Embedded puzzles.llp  (${(llpText.length / 1024).toFixed(1)} kB of puzzle data)`);
} else {
  console.warn('puzzles.llp not found in dist/ — bundle will show file picker instead.');
}

fs.writeFileSync(outputPath, html, 'utf8');
const kb = (fs.statSync(outputPath).size / 1024).toFixed(1);
console.log(`Bundled → dist/index.bundle.html  (${kb} kB)`);
console.log('Share index.bundle.html as a single self-contained file.');
