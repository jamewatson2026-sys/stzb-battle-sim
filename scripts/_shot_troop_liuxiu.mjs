/**
 * 无头 Chrome / CDP：验证刘秀的「兵种转换」面板（轻骑兵 / 铁骑兵 两个方向）。
 * 流程：开页 → 关首访声明 → 筛 汉+骑 → 点空位「大营」→ 选刘秀 → 点已上阵的刘秀 → 截图兵种卡片。
 * 用法：node scripts/_shot_troop_liuxiu.mjs [url] [out.png]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_APP = process.argv[2] ?? 'http://127.0.0.1:5173/';
const OUT = process.argv[3] ?? path.resolve('docs/逆向对拍/baseline/troop-liuxiu.png');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;

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
    '--user-data-dir=' + path.join(os.tmpdir(), 'stzb-shot-troop'),
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* 启动中 */
    }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

const ws = new WebSocket(await wsUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_APP });
await sleep(2500);
await evalJs(`(() => { try { localStorage.setItem('stzb_disclaimer_seen','1'); } catch {}
  document.querySelector('.modal .m-close')?.click(); document.querySelector('.modal-mask')?.remove(); return 1; })()`);
await sleep(400);

// 筛选：汉 + 骑
await evalJs(`(() => {
  const pick = (d, v) => document.querySelector('.filter-tag[data-dim="'+d+'"][data-v="'+v+'"]')?.click();
  pick('faction','汉'); pick('type','骑'); return 1; })()`);
await sleep(700);

// 点空位「大营」→ 弹出选将 → 点刘秀
console.log('空位:', await evalJs(`(() => {
  const slots = [...document.querySelectorAll('.slot')];
  const byText = slots.find((e) => e.classList.contains('empty') && (e.textContent||'').includes('大营'));
  if (byText) { byText.click(); return byText.className; }
  return 'NO_SLOT:' + slots.length; })()`));
await sleep(900);

console.log('选将弹窗卡片数:', await evalJs(`document.querySelectorAll('.hero-pick-modal .pick-grid .hero-card').length`));
console.log('选中刘秀:', await evalJs(`(() => {
  const cards = [...document.querySelectorAll('.hero-pick-modal .pick-grid .hero-card')];
  const hit = cards.find((c) => (c.textContent||'').includes('刘秀'));
  if (!hit) return false;
  hit.click(); return true; })()`));
await sleep(900);

// 关闭可能残留的弹窗遮罩，点已上阵的刘秀卡
// 选将点击后直接打开「武将详情」，无需再点槽位；这里只确认槽位已上阵
console.log('上阵检查:', await evalJs(`(() => {
  const slots = [...document.querySelectorAll('.slot')];
  const hit = slots.find((s) => !s.classList.contains('empty') && (s.textContent||'').includes('刘秀'));
  return { placed: !!hit, detailOpen: !!document.querySelector('.hero-detail-modal') }; })()`));
await sleep(900);

// 切到「兵种」板块（.hd-tab[data-tab="troop"]）
console.log('切兵种板块:', await evalJs(`(() => {
  const t = document.querySelector('.hero-detail-modal .hd-tab[data-tab="troop"]');
  if (!t) return false; t.click(); return true; })()`));
await sleep(600);

const troopInfo = await evalJs(`(() => {
  const sec = [...document.querySelectorAll('.hd-troop')].find((e) => (e.textContent||'').includes('兵种转换'));
  if (!sec) return { found: false, modal: !!document.querySelector('.modal') };
  const cards = [...sec.querySelectorAll('.troop-card')].map((c) => ({
    troop: c.getAttribute('data-troop'),
    selected: c.classList.contains('selected'),
    text: (c.textContent||'').replace(/\\s+/g,' ').trim().slice(0, 60),
  }));
  return { found: true, title: (sec.querySelector('.hd-troop-title')?.textContent || '').trim(), cards };
})()`);
console.log('兵种转换:', JSON.stringify(troopInfo, null, 1));

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('截图:', OUT);

ws.close();
chrome.kill();
process.exit(0);
