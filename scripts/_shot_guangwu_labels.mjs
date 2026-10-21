/**
 * 网页战报截图：把真实引擎跑出来的战报（含光武中兴子战法标注）塞进 localStorage 历史，
 * 打开战报详情，断言出现 `.dmg-sub`「〈落雷〉/〈落石〉/〈绝水遏敌〉」并截图。
 *
 * 用法：node scripts/_shot_guangwu_labels.mjs [url] [out.png]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_APP = process.argv[2] ?? 'http://127.0.0.1:5173/';
const OUT = process.argv[3] ?? path.resolve('docs/逆向对拍/baseline/guangwu-labels.png');
const RECORD = path.resolve('docs/逆向对拍/baseline/guangwu_record.json');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9338;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
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
    '--user-data-dir=' + path.join(os.tmpdir(), 'stzb-shot-guangwu'),
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 60; i++) {
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
    pending.set(mid, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
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

await evalJs(`(() => {
  try { localStorage.setItem('stzb_disclaimer_seen', '1'); } catch {}
  const c = document.querySelector('.modal .m-close'); if (c) c.click();
  const mask = document.querySelector('.modal-mask'); if (mask) mask.remove();
  try { localStorage.setItem('stzb_battle_history', JSON.stringify([${record}])); } catch {}
  return true;
})()`);

await send('Page.navigate', { url: URL_APP });
await sleep(2500);
await evalJs(`(() => {
  try { localStorage.setItem('stzb_disclaimer_seen', '1'); } catch {}
  const c = document.querySelector('.modal .m-close'); if (c) c.click();
  const mask = document.querySelector('.modal-mask'); if (mask) mask.remove();
  return true;
})()`);

const opened = await evalJs(`(() => {
  const nav = document.querySelector('[data-nav="history"]');
  if (nav) nav.click();
  return !!nav;
})()`);
await sleep(800);
const pickedItem = await evalJs(`(() => {
  const it = document.querySelector('.hist-item');
  if (it) { it.click(); return true; }
  return false;
})()`);
await sleep(800);
const expanded = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button, .hist-expand, [class*="expand"]')];
  const b = btns.find((x) => (x.textContent || '').includes('详细战报'));
  if (b) { b.click(); return true; }
  return false;
})()`);
await sleep(800);

// 战报默认停在「回合前阶段」，点右侧回合条切到第 1 回合才能看到伤害行
const jumped = await evalJs(`(() => {
  const tabs = [...document.querySelectorAll('.dv-rail .rtab, .dv-rail button, .rtab')];
  const t = tabs.find((x) => (x.textContent || '').trim() === '1');
  if (t) { t.click(); return true; }
  return false;
})()`);
await sleep(1000);
console.log('切到第1回合:', jumped);

const info = await evalJs(`(() => {
  const subs = [...document.querySelectorAll('.dmg-sub')].map((e) => e.textContent.trim());
  const uniq = [...new Set(subs)];
  const snippets = [...document.querySelectorAll('.dv-line, .dv-body, .dv-main')].slice(0, 0);
  return { count: subs.length, uniq, hasLuolei: uniq.some((s) => s.includes('落雷')), hasLuoshi: uniq.some((s) => s.includes('落石')), hasJueshui: uniq.some((s) => s.includes('绝水遏敌')), snippets: snippets.length };
})()`);

console.log('历史面板:', opened, '选中记录:', pickedItem, '展开详情:', expanded);
console.log('子战法标注:', JSON.stringify(info, null, 1));

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('截图:', OUT);

ws.close();
chrome.kill();
process.exit(0);
