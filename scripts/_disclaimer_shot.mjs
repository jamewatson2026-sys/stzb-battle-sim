/**
 * 声明（`web/disclaimer.ts`）真机自检 —— 无头 Chrome + CDP 直驱主站（内部脚本，`_` 前缀）。
 *
 * 用法（先起服务：`npm run web` → http://localhost:5173）：
 *   node scripts/_disclaimer_shot.mjs [http://localhost:5173] [输出目录]
 *
 * 取证四件事（DOM 断言 + 截图 + summary.json）：
 *   ① 首次进入（无水位）→ 自动弹一次声明，正文含关键条款（非官方 / 素材不适用 MIT / 严禁盈利 / 侵权联系 / 现状免责）；
 *   ② 关掉后刷新 → 不再自动弹（水位 `stzb_disclaimer_seen` 生效）；
 *   ③ 底栏「声明」按钮 → 随时能再打开；
 *   ④ 公告在场时（新版本上线那一次）→ 声明让路，不叠遮罩；公告里能看到 v1.3 那条。
 * 另记：JS 异常 0、HTTP 4xx/5xx 0（favicon 除外）。
 * 依赖：本机装有 Chrome 或 Edge（自动探测），无额外 npm 包。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:5173').replace(/\/+$/, '');
const outDir = process.argv[3] ?? join(tmpdir(), 'dsh-disclaimer-verify');
mkdirSync(outDir, { recursive: true });

const W = 1280;
const H = 1200;
const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!exe) throw new Error('本机没找到 Chrome / Edge');

const port = 9600 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'dsh-disclaimer-shot-'));
spawn(
  exe,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {
      /* devtools 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('devtools endpoint never came up');
}

const ws = new WebSocket(await wsUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const events = [];
const problems = [];
const httpErrors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (!msg.method) return;
  if (msg.method === 'Runtime.exceptionThrown') {
    problems.push(`[exception] ${msg.params?.exceptionDetails?.exception?.description ?? JSON.stringify(msg.params)}`);
  }
  if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
    problems.push(`[console.error] ${msg.params.entry.text}`);
  }
  if (msg.method === 'Network.responseReceived' && Number(msg.params?.response?.status) >= 400) {
    httpErrors.push(`${msg.params.response.status} ${msg.params.response.url}`);
  }
  events.push(msg);
});

const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

async function waitEvent(method, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const i = events.findIndex((e) => e.method === method);
    if (i >= 0) return events.splice(i, 1)[0];
    await sleep(50);
  }
  throw new Error(`timeout waiting ${method}`);
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);

const shot = async (name, clip) => {
  const res = await send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' }, sessionId);
  const file = join(outDir, name);
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('saved', file);
  return file;
};
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`);
  return r.result.value;
};
const until = async (expr, timeout = 30000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await evaluate(expr);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`until timeout: ${expr.slice(0, 120)}`);
    await sleep(250);
  }
};
const reload = async () => {
  events.length = 0;
  await send('Page.reload', {}, sessionId);
  await waitEvent('Page.loadEventFired');
  await until(`document.querySelector('.control-bar') !== null`, 40000);
  await sleep(400);
};

// ─────────────────────────── 走流程 ───────────────────────────
const pass = {};
const steps = [];

// 进入主站 → 清掉水位（模拟第一次来的玩家）→ 刷新
events.length = 0;
await send('Page.navigate', { url: `${base}/` }, sessionId);
await waitEvent('Page.loadEventFired');
await until(`document.querySelector('.control-bar') !== null`, 40000);
await evaluate(`localStorage.clear(); true`);
await reload();

// ① 首访自动弹一次 + 正文条款
await until(`document.querySelector('.disclaimer-mask') !== null`, 20000);
const clauses = [
  '非官方',
  '网易公司及其关联方',
  '不适用本项目的 MIT 许可证',
  'MIT 只覆盖本项目自己编写的代码',
  '严禁任何形式的盈利',
  '单独再分发',
  '训练模型',
  'GitHub Issues',
  '不代表官方数据或官方口径',
];
const bodyText = await evaluate(`document.querySelector('.dp-body').textContent`);
const missing = clauses.filter((c) => !bodyText.includes(c));
pass['① 首访自动弹一次声明'] = true;
pass['① 正文含全部关键条款'] = missing.length === 0;
steps.push({
  label: '① 首访自动弹窗',
  header: await evaluate(`document.querySelector('.disclaimer-modal .m-head h3').textContent.trim()`),
  缺条款: missing,
});
await shot('1-first-visit-autopopup.png');
if (await evaluate(`(() => { const b = document.querySelector('.dp-body'); return b.scrollHeight > b.clientHeight + 4; })()`)) {
  await evaluate(`(() => { const b = document.querySelector('.dp-body'); b.scrollTop = b.scrollHeight; return true; })()`);
  await sleep(250);
  await shot('1b-disclaimer-scrolled-bottom.png');
}

// ② 关掉 → 刷新 → 不再自动弹（水位）
await evaluate(`(() => { document.querySelector('.disclaimer-mask .m-close').click(); return true; })()`);
pass['② × 能关掉'] = await evaluate(`document.querySelector('.disclaimer-mask') === null`);
await reload();
pass['② 刷新后不再自动弹（水位生效）'] = await evaluate(`document.querySelector('.disclaimer-mask') === null`);
pass['② 水位已写入 localStorage'] = await evaluate(`localStorage.getItem('stzb_disclaimer_seen') !== null`);

// ③ 底栏入口：全屏 + 「声明 / 版本号 / 开始模拟」那一段的局部放大各一张
await shot('2-main-footer-entry.png');
const rects = await evaluate(
  `(() => {
     const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
     return {
       bar: r(document.querySelector('.control-bar')),
       btn: r(document.querySelector('#disclaimer-btn')),
       tag: r(document.querySelector('#build-tag')),
       start: r(document.querySelector('#start')),
     };
   })()`
);
pass['③ 底栏「声明」按钮可见（非 0 尺寸、未被隐藏）'] = await evaluate(
  `(() => { const b = document.querySelector('#disclaimer-btn'); const r = b.getBoundingClientRect(); return b.offsetParent !== null && r.width > 10 && r.height > 8; })()`
);
// 裁剪范围：从「声明」左侧一点，一直包含到「开始模拟」右缘
const clipX0 = Math.max(0, rects.btn.x - 300);
const clipX1 = Math.min(W, rects.start.x + rects.start.w + 12);
await shot('2b-footer-entry-zoom.png', {
  x: clipX0,
  y: Math.max(0, rects.bar.y - 6),
  width: clipX1 - clipX0,
  height: rects.bar.h + 12,
  scale: 2,
});
steps.push({
  label: '③ 底栏入口',
  按钮文案: await evaluate(`document.querySelector('#disclaimer-btn').textContent`),
  位置: { 声明: Math.round(rects.btn.x), 版本号: Math.round(rects.tag.x), 开始模拟: Math.round(rects.start.x) },
});
await evaluate(`(() => { document.querySelector('#disclaimer-btn').click(); return true; })()`);
await until(`document.querySelector('.disclaimer-mask') !== null`, 10000);
pass['③ 底栏「声明」按钮可再打开'] = true;
await shot('3-open-from-footer.png');
await evaluate(`(() => { document.querySelector('.disclaimer-mask .m-close').click(); return true; })()`);

// ④ 公告在场时让路 + 公告里有 v1.3
await evaluate(
  `localStorage.setItem('stzb_site_version_seen','0.9'); localStorage.setItem('stzb_site_version_notified','0.9'); localStorage.removeItem('stzb_disclaimer_seen'); true`
);
await reload();
await until(`document.querySelector('.announcement-mask') !== null`, 20000);
await sleep(500);
pass['④ 公告在场时声明让路（不叠遮罩）'] = await evaluate(`document.querySelector('.disclaimer-mask') === null`);
const annText = await evaluate(`document.querySelector('.announcement-mask').textContent`);
pass['④ 公告里有 v1.3「声明与许可」'] = annText.includes('1.3') && annText.includes('声明与许可');
await shot('4-announcement-v13.png');

// ⑤ 窄屏（手机）：主站是手机优先的，声明弹窗不许撑破视口
await evaluate(`localStorage.clear(); true`);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);
await reload();
await until(`document.querySelector('.disclaimer-mask') !== null`, 20000);
await sleep(300);
const narrow = await evaluate(
  `(() => { const m = document.querySelector('.disclaimer-modal').getBoundingClientRect();
     return { w: Math.round(m.width), h: Math.round(m.height), vw: window.innerWidth, vh: window.innerHeight,
              scrollW: document.documentElement.scrollWidth }; })()`
);
pass['⑤ 窄屏 390px：弹窗不超出视口宽'] = narrow.w <= narrow.vw && narrow.scrollW <= narrow.vw + 1;
pass['⑤ 窄屏：弹窗不高于视口（86vh 上限）'] = narrow.h <= narrow.vh;
steps.push({ label: '⑤ 窄屏 390×844', 弹窗: narrow });
await shot('5-narrow-390x844.png');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);

// ─────────────────────────── 收口 ───────────────────────────
const jsExceptions = problems.filter((p) => p.startsWith('[exception]'));
const realHttpErrors = httpErrors.filter((u) => !u.endsWith('/favicon.ico'));
pass['JS 异常 0'] = jsExceptions.length === 0;
pass['HTTP 4xx/5xx 0（favicon 除外）'] = realHttpErrors.length === 0;

const summary = { base, outDir, steps, problems, httpErrors, pass };
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

console.log('\n=== 判定 ===');
for (const [k, v] of Object.entries(pass)) console.log(`${v ? '✔' : '✘'} ${k}`);
console.log(`\nHTTP 4xx/5xx：${httpErrors.length ? httpErrors.join(' | ') : '0 条'}`);
console.log(`JS 异常 / console.error：${problems.length ? problems.join(' | ') : '0 条'}`);
console.log(`写入：${join(outDir, 'summary.json')}`);

ws.close();
process.exit(Object.values(pass).every(Boolean) ? 0 : 1);
