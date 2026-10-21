/**
 * 无头 Chrome 截图：配将池筛「汉 + 骑」并高亮刘秀（验证 h841 画像已生效）。
 * 用法：node scripts/_shot_pool_liuxiu.mjs [url] [out.png]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_APP = process.argv[2] ?? 'http://127.0.0.1:5173/';
const OUT = process.argv[3] ?? path.resolve('docs/逆向对拍/baseline/pool-liuxiu.png');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1440,1100',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + path.join(os.tmpdir(), 'stzb-shot-profile'),
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

const wsUrl = await getWs();
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_APP });
await sleep(2500);

// 首访声明弹窗会挡住页面：先关掉（水位 stzb_disclaimer_seen 也一并写入，避免再弹）
await send('Runtime.evaluate', {
  expression: `(() => {
    try { localStorage.setItem('stzb_disclaimer_seen', '1'); } catch {}
    const c = document.querySelector('.modal .m-close');
    if (c) c.click();
    const mask = document.querySelector('.modal-mask');
    if (mask) mask.remove();
    return !!c;
  })()`,
  returnByValue: true,
});
await sleep(400);

// 点「汉」「骑」两个筛选标签
const clickRes = await send('Runtime.evaluate', {
  expression: `(() => {
    const pick = (dim, v) => {
      const el = document.querySelector('.filter-tag[data-dim="' + dim + '"][data-v="' + v + '"]');
      if (el) el.click();
      return !!el;
    };
    return [pick('faction','汉'), pick('type','骑')];
  })()`,
  returnByValue: true,
});
console.log('筛选标签点击:', JSON.stringify(clickRes.result?.value));
await sleep(900);

const info = await send('Runtime.evaluate', {
  expression: `(() => {
    const cards = [...document.querySelectorAll('.hero-card, .hc, [data-hero-id]')];
    const hit = cards.find((c) => (c.textContent || '').includes('刘秀'));
    if (hit) hit.scrollIntoView({ block: 'center' });
    const img = hit ? hit.querySelector('img') : null;
    return {
      cards: cards.length,
      刘秀: !!hit,
      imgSrc: img ? img.getAttribute('src') : null,
      imgComplete: img ? img.complete : null,
      imgW: img ? img.naturalWidth : null,
    };
  })()`,
  returnByValue: true,
});
console.log('页面状态:', JSON.stringify(info.result?.value));
// 等图片真正解码完成（轮询 naturalWidth，最多 8s）
const waited = await send('Runtime.evaluate', {
  expression: `(async () => {
    const t0 = Date.now();
    const pick = () => {
      const cards = [...document.querySelectorAll('.hero-card')];
      const hit = cards.find((c) => (c.textContent || '').includes('刘秀'));
      return hit ? hit.querySelector('img') : null;
    };
    while (Date.now() - t0 < 8000) {
      const i = pick();
      if (i && i.complete && i.naturalWidth > 0) return { ok: true, ms: Date.now() - t0, w: i.naturalWidth };
      await new Promise((r) => setTimeout(r, 150));
    }
    const i = pick();
    return { ok: false, src: i ? i.src : null, complete: i ? i.complete : null };
  })()`,
  returnByValue: true,
  awaitPromise: true,
});
console.log('图片加载:', JSON.stringify(waited.result?.value));

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('截图:', OUT);

ws.close();
chrome.kill();
process.exit(0);
