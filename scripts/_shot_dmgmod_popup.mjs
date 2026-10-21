/**
 * 截图验证「增减伤统计」弹窗：提升 28% / 降低 117% 照实显示，净合计 −89%。
 * 用法：node scripts/_shot_dmgmod_popup.mjs [url] [out.png]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_APP = process.argv[2] ?? 'http://127.0.0.1:5173/';
const OUT = process.argv[3] ?? path.resolve('docs/逆向对拍/baseline/dmgmod-popup.png');
const RECORD = path.resolve('docs/逆向对拍/baseline/dmgmod_record.json');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9344;

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
    '--user-data-dir=' + path.join(os.tmpdir(), 'stzb-shot-dmgmod'),
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
      /* 未就绪 */
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
const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_APP });
await sleep(2600);
await evalJs(`(() => {
  try { localStorage.setItem('stzb_disclaimer_seen', '1'); } catch {}
  try { localStorage.setItem('stzb_battle_history', JSON.stringify([${record}])); } catch {}
  return true;
})()`);
await send('Page.navigate', { url: URL_APP });
await sleep(2600);
await evalJs(`(() => {
  try { localStorage.setItem('stzb_disclaimer_seen', '1'); } catch {}
  const c = document.querySelector('.modal .m-close'); if (c) c.click();
  const mask = document.querySelector('.modal-mask'); if (mask) mask.remove();
  return true;
})()`);
await sleep(400);
await evalJs(`document.querySelector('[data-nav="history"]')?.click()`);
await sleep(900);
await evalJs(`(() => { const it = document.querySelector('.hist-item'); if (it) { it.click(); return true; } return false; })()`);
await sleep(700);
await evalJs(`(() => {
  const b = [...document.querySelectorAll('button, [class*="expand"]')].find((x) => (x.textContent || '').includes('详细战报'));
  if (b) { b.click(); return true; } return false;
})()`);
await sleep(900);
const jumped = await evalJs(`(() => {
  const tabs = [...document.querySelectorAll('.dv-rail .rtab, .dv-rail button, .rtab')];
  const t = tabs.find((x) => (x.textContent || '').trim() === '1');
  if (t) { t.click(); return true; } return false;
})()`);
await sleep(900);
const opened = await evalJs(`(() => {
  const link = document.querySelector('.dmg-mod .dmg-link');
  if (link) { link.click(); return true; } return false;
})()`);
await sleep(600);

const info = await evalJs(`(() => {
  const line = document.querySelector('.dmg-mod')?.textContent ?? '';
  const pop = document.querySelector('.dmg-popup')?.textContent ?? '';
  return { line: line.trim(), pop: pop.replace(/\\s+/g, ' ').slice(0, 400) };
})()`);
console.log('净合计行:', info.line);
console.log('弹窗:', info.pop);
console.log('回合跳转 / 弹窗打开:', jumped, opened);

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('截图:', OUT);

ws.close();
chrome.kill();
process.exit(0);
