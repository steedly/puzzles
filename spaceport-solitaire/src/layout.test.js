// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
//
// Layout and UI regression tests. Run via `npm test`.
// These validate CSS/layout invariants that have broken before and must
// not regress. They run against the built dist/ via headless Chrome.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn } from 'child_process';
import { readFileSync } from 'fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4174;
const BASE = `http://localhost:${PORT}/puzzles/`;
let preview;

function chromeExists() {
  try { readFileSync(CHROME); return true; } catch { return false; }
}

const VIEWPORTS = [
  { name: 'iPhone SE',         w: 375,  h: 667  },
  { name: 'iPhone 14 Pro',     w: 393,  h: 852  },
  { name: 'iPhone 15 Pro Max', w: 430,  h: 932  },
  { name: 'iPad Mini',         w: 768,  h: 1024 },
  { name: 'iPad Air',          w: 820,  h: 1180 },
  { name: 'iPad Pro 12.9"',    w: 1024, h: 1366 },
  { name: 'Mac narrow',        w: 800,  h: 600  },
  { name: 'Mac medium',        w: 1100, h: 800  },
  { name: 'Mac wide',          w: 1280, h: 900  },
  { name: 'Mac ultra-wide',    w: 1600, h: 1000 },
  { name: 'Mac small window',  w: 500,  h: 700  },
  { name: 'Mac half-screen',   w: 960,  h: 800  },
];

async function cdpSession(fn) {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=9223', 'about:blank',
  ], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  try {
    const tabs = await (await fetch('http://localhost:9223/json')).json();
    const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
    let id = 0;
    const send = (m, p = {}) => new Promise(r => {
      id++;
      const k = id;
      const h = e => { const d = JSON.parse(e.data); if (d.id === k) { ws.removeEventListener('message', h); r(d); } };
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id: k, method: m, params: p }));
    });
    await new Promise(r => ws.addEventListener('open', r));
    await fn(send);
    ws.close();
  } finally {
    chrome.kill();
    await new Promise(r => setTimeout(r, 300));
  }
}

async function measureViewport(send, w, h) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 600 });
  await send('Page.navigate', { url: BASE + '#1-16o' });
  await new Promise(r => setTimeout(r, 3500));
  const expr = `(()=>{
    const q=s=>{const e=document.querySelector(s);return e?e.getBoundingClientRect():null;};
    const doc=document.documentElement;
    const thumbs=[...document.querySelectorAll('.pnav__range-thumb')];
    const thumbData=thumbs.map(t=>({cls:t.className,z:getComputedStyle(t).zIndex,left:t.style.left}));
    return JSON.stringify({
      iw:window.innerWidth,
      sw:doc.scrollWidth,
      header:q('.app__header'),
      badges:document.querySelectorAll('.pinfo-badge').length,
      gc:q('.game-column'),
      bc:q('.board-container'),
      pnav:q('.pnav'),
      ins:q('.instructions'),
      thumbs:thumbData
    });
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return JSON.parse(r.result.result.value);
}

describe.skipIf(!chromeExists())('Layout regression tests', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: process.cwd(), stdio: 'pipe' });
    preview = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
      cwd: process.cwd(), stdio: 'ignore',
    });
    return new Promise(r => setTimeout(r, 2000));
  });

  afterAll(() => {
    preview?.kill();
  });

  it('no horizontal overflow at any viewport', async () => {
    await cdpSession(async (send) => {
      for (const vp of VIEWPORTS) {
        const m = await measureViewport(send, vp.w, vp.h);
        expect(m.sw, `${vp.name} (${vp.w}px): scrollWidth ${m.sw} > innerWidth ${m.iw}`).toBeLessThanOrEqual(m.iw);
      }
    });
  }, 120000);

  it('header badges are removed (no pinfo-badge elements)', async () => {
    await cdpSession(async (send) => {
      const m = await measureViewport(send, 820, 900);
      expect(m.badges).toBe(0);
    });
  }, 30000);

  it('header fits on single line at all viewports', async () => {
    await cdpSession(async (send) => {
      for (const vp of VIEWPORTS) {
        const m = await measureViewport(send, vp.w, vp.h);
        if (m.header) {
          expect(m.header.height, `${vp.name} (${vp.w}px): header height ${m.header.height}`).toBeLessThan(80);
        }
      }
    });
  }, 120000);

  it('board-container never exceeds viewport width', async () => {
    await cdpSession(async (send) => {
      for (const vp of VIEWPORTS) {
        const m = await measureViewport(send, vp.w, vp.h);
        if (m.bc) {
          expect(m.bc.width, `${vp.name} (${vp.w}px): bc width ${m.bc.width}`).toBeLessThanOrEqual(vp.w);
          expect(m.bc.x, `${vp.name}: bc.x should not be negative`).toBeGreaterThanOrEqual(0);
        }
      }
    });
  }, 120000);

  it('pnav is not clipped at intermediate widths', async () => {
    await cdpSession(async (send) => {
      for (const vp of VIEWPORTS.filter(v => v.w >= 700 && v.w <= 1119)) {
        const m = await measureViewport(send, vp.w, vp.h);
        if (m.pnav) {
          expect(m.pnav.width, `${vp.name}: pnav width`).toBeGreaterThanOrEqual(280);
          const rightEdge = m.pnav.x + m.pnav.width;
          expect(rightEdge, `${vp.name}: pnav right edge`).toBeLessThanOrEqual(vp.w + 1);
        }
      }
    });
  }, 60000);

  it('moves range: both number inputs render and can change values', async () => {
    await cdpSession(async (send) => {
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
      await send('Page.navigate', { url: BASE + '#standard?mv=5-20' });
      await new Promise(r => setTimeout(r, 4000));
      // Verify both inputs render with correct initial values
      let expr = `(()=>{
        const inputs=[...document.querySelectorAll('.pnav__range-input')];
        return JSON.stringify(inputs.map(i=>({
          val:+i.value, min:+i.min, max:+i.max, disabled:i.disabled,
          label:i.getAttribute('aria-label'),
          width:Math.round(i.getBoundingClientRect().width),
          visible:i.offsetParent !== null
        })));
      })()`;
      let r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      let inputs = JSON.parse(r.result.result.value);
      expect(inputs.length, 'should have 2 number inputs').toBe(2);
      expect(inputs[0].val).toBe(5);
      expect(inputs[1].val).toBe(20);
      expect(inputs.every(i => i.visible && !i.disabled && i.width > 0), 'both inputs visible and enabled').toBe(true);
      expect(inputs[0].label).toBe('Minimum moves');
      expect(inputs[1].label).toBe('Maximum moves');

      // Programmatically change min input value via React's native input setter
      const changeExpr = `(()=>{
        const inputs=document.querySelectorAll('.pnav__range-input');
        const minInput=inputs[0];
        const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        setter.call(minInput,'10');
        minInput.dispatchEvent(new Event('input',{bubbles:true}));
        minInput.dispatchEvent(new Event('change',{bubbles:true}));
        return true;
      })()`;
      await send('Runtime.evaluate', { expression: changeExpr, returnByValue: true });
      await new Promise(r2 => setTimeout(r2, 500));
      r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      inputs = JSON.parse(r.result.result.value);
      expect(inputs[0].val, 'min value should update after input change').toBe(10);
    });
  }, 30000);

  it('moves range: both inputs at extremes are still editable', async () => {
    await cdpSession(async (send) => {
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
      await send('Page.navigate', { url: BASE + '#standard?mv=36-36' });
      await new Promise(r => setTimeout(r, 4000));
      const expr = `(()=>{
        const inputs=[...document.querySelectorAll('.pnav__range-input')];
        return JSON.stringify(inputs.map(i=>({
          val:+i.value, disabled:i.disabled, readOnly:i.readOnly,
          width:Math.round(i.getBoundingClientRect().width)
        })));
      })()`;
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      const inputs = JSON.parse(r.result.result.value);
      expect(inputs.length).toBe(2);
      expect(inputs[0].val).toBe(36);
      expect(inputs[1].val).toBe(36);
      expect(inputs.every(i => !i.disabled && !i.readOnly && i.width > 0)).toBe(true);
    });
  }, 30000);
});
