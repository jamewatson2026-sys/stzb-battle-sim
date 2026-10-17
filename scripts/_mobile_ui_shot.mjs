/**
 * 手机端 UI 精简 · 视觉自检（内部脚本 `_` 前缀）
 * ---------------------------------------------------------------------------
 * 验证 2026-10-17 四项改动：
 *   ① 手机端武将详情：宝物空槽跟随画像宽度、落在画像正下方、不压右栏；
 *   ② 手机端底栏不显示「随机种子 / 最大回合」；
 *   ③ 手机端顶栏不显示「AI配将」与设置齿轮；
 *   ④ 桌面端（1440×900）以上全部保持原样。
 *
 * 用法（先起服务：`npm run web`，默认 http://localhost:5173）：
 *   node scripts/_mobile_ui_shot.mjs [http://127.0.0.1:5173] [输出目录]
 * 依赖：本机装有 Chrome 或 Edge（自动探测），无额外 npm 包。
 * 产物：输出目录下 4 张 PNG + summary.json（几何测量 + 断言 + 页面错误）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? join('verify-shots', 'mobile-ui-20261017');
mkdirSync(outDir, { recursive: true });

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) throw new Error('没找到 Chrome / Edge，装一个再跑');

const port = 9600 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'dsh-mobile-ui-'));
const child = spawn(
  exe,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--touch-events=enabled',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await res.json();
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
const pageErrors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params?.exceptionDetails?.exception?.description ?? 'exception');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      pageErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
  }
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

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails)}`);
  return r.result.value;
}

async function waitFor(selector, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (ok) return;
    await sleep(100);
  }
  throw new Error(`timeout waiting selector ${selector}`);
}

async function click(selector) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`click target missing: ${selector}`);
  await sleep(350);
}

/** 首次进入会自动弹声明（公告首启只留红点）——截图前关掉，别让它挡主界面 */
async function dismissFirstRunOverlays() {
  for (const sel of ['.disclaimer-mask .m-close', '.announcement-mask .m-close']) {
    const present = await evaluate(`Boolean(document.querySelector(${JSON.stringify(sel)}))`);
    if (present) await click(sel);
  }
}

async function goto(target) {
  events.length = 0;
  await send('Page.navigate', { url: target }, sessionId);
  await waitEvent('Page.loadEventFired');
  await sleep(1800);
  await waitFor('.hero-grid .hero-card');
  await dismissFirstRunOverlays();
}

async function setViewport(width, height, { mobile, touch, scale }) {
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: scale, mobile },
    sessionId,
  );
  await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 }, sessionId);
}

async function shot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  const file = join(outDir, name);
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('saved', file);
}

/** 当前页面顶栏 / 底栏可见性与手机端媒体查询 */
async function chromeState() {
  return evaluate(`(() => {
    const cs = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : 'MISSING';
    };
    return {
      phoneQuery: matchMedia('(max-width: 720px), (orientation: landscape) and (pointer: coarse) and (max-height: 620px)').matches,
      pointerCoarse: matchMedia('(pointer: coarse)').matches,
      innerWidth: innerWidth,
      innerHeight: innerHeight,
      advisorNav: cs('[data-nav="advisor"]'),
      settings: cs('#header-settings'),
      seed: cs('.control-bar .bar-seed'),
      rounds: cs('.control-bar .bar-rounds'),
      historyNav: cs('[data-nav="history"]'),
      moraleRed: cs('#morale-red'),
    };
  })()`);
}

/**
 * 直接以「已放入红队大营」的状态打开武将详情。
 * 走 Vite 开发模块（页面本身已加载同一份 teamEditor / heroes），避免依赖武将池点击链；
 * handlers 传空实现即可——这里只测量左栏布局与宝物入口，不写回队伍。
 */
async function openPlacedDetail() {
  const opened = await evaluate(`(async () => {
    const heroId = document.querySelector('.hero-grid .hero-card:not(.offline)')?.dataset.heroId;
    if (!heroId) return { ok: false, reason: 'no hero card' };
    const { openHeroDetail, emptySlot } = await import('/web/teamEditor.ts');
    const slot = { ...emptySlot(), heroId };
    const noop = new Proxy({}, { get: () => () => {} });
    openHeroDetail(heroId, { placed: { team: 'red', idx: 0, slot }, handlers: noop });
    return { ok: true, heroId };
  })()`);
  if (!opened?.ok) throw new Error(`openPlacedDetail failed: ${JSON.stringify(opened)}`);
  await waitFor('.hero-detail-modal .hd-treasure-wrap');
  await sleep(300);
}

async function detailGeometry() {
  return evaluate(`(() => {
    const d = document.querySelector('.hero-detail-modal');
    const rect = (sel) => {
      const el = d.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1) };
    };
    return {
      portrait: rect('.hd-portrait'),
      wrap: rect('.hd-treasure-wrap'),
      treasure: rect('.hd-treasure'),
      name: rect('.hd-treasure .ts-name'),
      img: rect('.hd-treasure .ts-img'),
      main: rect('.hd-main'),
      cardClass: d.querySelector('.hd-treasure')?.className ?? null,
      cardDisplay: d.querySelector('.hd-treasure') ? getComputedStyle(d.querySelector('.hd-treasure')).display : null,
      text: d.querySelector('.hd-treasure')?.innerText?.replace(/\\s+/g, ' ').trim() ?? null,
    };
  })()`);
}

/** 已佩戴宝物（横版卡）在手机端的排布——确认 width:100% 没把卡面挤坏 */
async function openFilledDetail() {
  const opened = await evaluate(`(async () => {
    const heroId = document.querySelector('.hero-grid .hero-card:not(.offline)')?.dataset.heroId;
    if (!heroId) return { ok: false, reason: 'no hero card' };
    const { openHeroDetail, emptySlot } = await import('/web/teamEditor.ts');
    const { TREASURES } = await import('/src/data/treasures.ts');
    const slot = { ...emptySlot(), heroId, treasure: { treasureId: TREASURES[0].id, level: 10 } };
    const noop = new Proxy({}, { get: () => () => {} });
    openHeroDetail(heroId, { placed: { team: 'red', idx: 0, slot }, handlers: noop });
    return { ok: true, heroId, treasureId: TREASURES[0].id };
  })()`);
  if (!opened?.ok) throw new Error(`openFilledDetail failed: ${JSON.stringify(opened)}`);
  await waitFor('.hero-detail-modal .hd-treasure.filled');
  await sleep(250);
}

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail ?? '');
}

// ── 手机横屏（844×390，触屏）──────────────────────────────────────────────
await setViewport(844, 390, { mobile: true, touch: true, scale: 2 });
await goto(url);
const phoneChrome = await chromeState();
console.log('phone chrome', phoneChrome);
await shot('1-phone-main.png');
check('手机端命中手机断点', phoneChrome.phoneQuery, phoneChrome);
check('手机端隐藏 AI配将入口', phoneChrome.advisorNav === 'none', phoneChrome.advisorNav);
check('手机端隐藏设置齿轮', phoneChrome.settings === 'none', phoneChrome.settings);
check('手机端隐藏随机种子', phoneChrome.seed === 'none', phoneChrome.seed);
check('手机端隐藏最大回合', phoneChrome.rounds === 'none', phoneChrome.rounds);
check('手机端保留战报入口', phoneChrome.historyNav !== 'none' && phoneChrome.historyNav !== 'MISSING', phoneChrome.historyNav);
check('手机端保留士气输入', phoneChrome.moraleRed !== 'none' && phoneChrome.moraleRed !== 'MISSING', phoneChrome.moraleRed);

await openPlacedDetail();
const phoneGeo = await detailGeometry();
console.log('phone detail', JSON.stringify(phoneGeo));
await shot('2-phone-detail.png');
check('手机端空宝物槽宽=画像宽', Math.abs(phoneGeo.treasure.w - phoneGeo.portrait.w) <= 1.5, {
  treasure: phoneGeo.treasure.w,
  portrait: phoneGeo.portrait.w,
});
check('手机端宝物槽与画像左对齐', Math.abs(phoneGeo.treasure.x - phoneGeo.portrait.x) <= 1.5, {
  treasure: phoneGeo.treasure.x,
  portrait: phoneGeo.portrait.x,
});
check('手机端宝物槽在画像正下方', phoneGeo.treasure.y >= phoneGeo.portrait.bottom + 4, {
  treasureTop: phoneGeo.treasure.y,
  portraitBottom: phoneGeo.portrait.bottom,
});
check('手机端宝物槽不压右栏', phoneGeo.treasure.right <= phoneGeo.main.x + 1, {
  treasureRight: phoneGeo.treasure.right,
  mainLeft: phoneGeo.main.x,
});
check('手机端宝物空槽高度已收小（≤80）', phoneGeo.treasure.h <= 80, phoneGeo.treasure.h);

// 点开宝物弹窗，确认入口还能用
await click('.hd-treasure[data-treasure-open]');
await waitFor('.treasure-modal');
await shot('3-phone-treasure-picker.png');

// 已佩戴宝物：同样宽度下检查横版卡是否还能读
await goto(url);
await openFilledDetail();
const filledGeo = await detailGeometry();
console.log('phone filled', JSON.stringify(filledGeo));
await shot('6-phone-detail-filled.png');
check('手机端已佩戴宝物宽=画像宽', Math.abs(filledGeo.treasure.w - filledGeo.portrait.w) <= 1.5, {
  treasure: filledGeo.treasure.w,
  portrait: filledGeo.portrait.w,
});
check('手机端已佩戴宝物不压右栏', filledGeo.treasure.right <= filledGeo.main.x + 1, {
  treasureRight: filledGeo.treasure.right,
  mainLeft: filledGeo.main.x,
});
check(
  '手机端已佩戴宝物名称在卡内可见',
  filledGeo.name && filledGeo.name.w > 24 && filledGeo.name.right <= filledGeo.treasure.right + 1,
  filledGeo.name,
);

// ── 桌面（1440×900，鼠标）────────────────────────────────────────────────
await setViewport(1440, 900, { mobile: false, touch: false, scale: 1 });
await goto(url);
const desktopChrome = await chromeState();
console.log('desktop chrome', desktopChrome);
await shot('4-desktop-main.png');
check('桌面端不命中手机断点', !desktopChrome.phoneQuery, desktopChrome);
check('桌面端保留 AI配将入口', desktopChrome.advisorNav !== 'none' && desktopChrome.advisorNav !== 'MISSING', desktopChrome.advisorNav);
check('桌面端保留设置齿轮', desktopChrome.settings !== 'none' && desktopChrome.settings !== 'MISSING', desktopChrome.settings);
check('桌面端保留随机种子', desktopChrome.seed !== 'none' && desktopChrome.seed !== 'MISSING', desktopChrome.seed);
check('桌面端保留最大回合', desktopChrome.rounds !== 'none' && desktopChrome.rounds !== 'MISSING', desktopChrome.rounds);

await openPlacedDetail();
const desktopGeo = await detailGeometry();
console.log('desktop detail', JSON.stringify(desktopGeo));
await shot('5-desktop-detail.png');
check('桌面端宝物槽宽仍为 156', Math.abs(desktopGeo.treasure.w - 156) <= 1.5, desktopGeo.treasure.w);
check('桌面端宝物槽不压右栏', desktopGeo.treasure.right <= desktopGeo.main.x + 1, {
  treasureRight: desktopGeo.treasure.right,
  mainLeft: desktopGeo.main.x,
});

const failed = checks.filter((c) => !c.pass);
const summary = {
  url,
  viewportPhone: { w: 844, h: 390, dpr: 2 },
  viewportDesktop: { w: 1440, h: 900, dpr: 1 },
  phoneChrome,
  phoneGeometry: phoneGeo,
  phoneFilledGeometry: filledGeo,
  desktopChrome,
  desktopGeometry: desktopGeo,
  checks,
  failed: failed.length,
  pageErrors,
};
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed; pageErrors=${pageErrors.length}`);
if (pageErrors.length) console.log('pageErrors:', pageErrors);
ws.close();
child.kill();
process.exit(failed.length ? 1 : 0);
