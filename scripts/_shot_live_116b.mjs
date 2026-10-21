/**
 * 线上验收（1.16 二次部署）：公告「优化」条目 + 战报子战法标注。
 * 用法：node scripts/_shot_live_116b.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_APP = 'https://ybytlai78-dev.github.io/stzb-battle-sim/';
const OUT_DIR = path.resolve('docs/逆向对拍/baseline');
const RECORD = path.resolve('docs/逆向对拍/baseline/guangwu_record.json');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9341;

fs.mkdirSync(OUT_DIR, { recursive: true });
const record = fs.readFileSync(RECORD, 'utf8');

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1440,1200',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + path.join(os.tmpdir(), 'stzb-shot-live116b'),
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

const ws = new WebSocket(await getWs());
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
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
const shoot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('截图:', file);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_APP });
await sleep(4000);

// 关声明弹窗 + 写入历史战报
await evalJs(`(() => {
  try { localStorage.setItem('stzb_disclaimer_seen', '1'); } catch {}
  const c = document.querySelector('.modal .m-close'); if (c) c.click();
  const mask = document.querySelector('.modal-mask'); if (mask) mask.remove();
  try { localStorage.setItem('stzb_battle_history', JSON.stringify([${record}])); } catch {}
  return true;
})()`);

// 1) 公告：确认首条 1.16 里有「优化 · 光武中兴的派遣标注」
const noticeInfo = await evalJs(`(() => {
  const nav = document.querySelector('[data-nav="notice"]');
  if (!nav) return { ok: false, why: 'no notice nav' };
  nav.click();
  return { ok: true };
})()`);
await sleep(900);
const notice = await evalJs(`(() => {
  const el = document.querySelector('.modal .m-body, .modal, .notice-body');
  const txt = el ? el.innerText : '';
  const items = [...document.querySelectorAll('.modal .ann-item, .modal li, .modal p')].map((x) => x.innerText.trim());
  return {
    hasVersion: /1\\.16/.test(txt),
    hasOptimizeKind: txt.includes('优化'),
    hasSubLabel: txt.includes('派遣标注') || txt.includes('〈落雷〉'),
    snippet: items.find((s) => s.includes('派遣标注')) ?? null,
  };
})()`);
console.log('公告:', noticeInfo, JSON.stringify(notice));
await shoot(path.join(OUT_DIR, 'live-1.16b-notice.png'));

// 2) 战报：关公告 → 打开历史 → 详细战报 → 第 1 回合 → 断言 .dmg-sub
await evalJs(`(() => {
  const c = document.querySelector('.modal .m-close'); if (c) c.click();
  const mask = document.querySelector('.modal-mask'); if (mask) mask.remove();
  return true;
})()`);
await sleep(400);

// 历史面板在启动时读一次 localStorage ⇒ 写完后必须整页重载，再打开战报
await send('Page.navigate', { url: URL_APP });
await sleep(3800);
await evalJs(`(() => {
  try { localStorage.setItem('stzb_disclaimer_seen', '1'); } catch {}
  const c = document.querySelector('.modal .m-close'); if (c) c.click();
  const mask = document.querySelector('.modal-mask'); if (mask) mask.remove();
  return true;
})()`);
await sleep(500);
await evalJs(`document.querySelector('[data-nav="history"]')?.click()`);
await sleep(900);
await evalJs(`(() => { const it = document.querySelector('.hist-item'); if (it) { it.click(); return true; } return false; })()`);
await sleep(700);
await evalJs(`(() => {
  const b = [...document.querySelectorAll('button, [class*="expand"]')].find((x) => (x.textContent || '').includes('详细战报'));
  if (b) { b.click(); return true; } return false;
})()`);
await sleep(1000);
const jumped = await evalJs(`(() => {
  const tabs = [...document.querySelectorAll('.dv-rail .rtab, .dv-rail button, .rtab')];
  const t = tabs.find((x) => (x.textContent || '').trim() === '1');
  if (t) { t.click(); return true; } return false;
})()`);
await sleep(1200);
const report = await evalJs(`(() => {
  const subs = [...document.querySelectorAll('.dmg-sub')].map((e) => e.textContent.trim());
  const uniq = [...new Set(subs)];
  const body = document.querySelector('.modal, .hist-detail')?.innerText ?? '';
  return { count: subs.length, uniq, jumped: true, hasStatusLabel: body.includes('光武中兴·') };
})()`);
console.log('战报:', JSON.stringify({ jumped, ...report }));
await shoot(path.join(OUT_DIR, 'live-1.16b-report.png'));

ws.close();
chrome.kill();
process.exit(0);
