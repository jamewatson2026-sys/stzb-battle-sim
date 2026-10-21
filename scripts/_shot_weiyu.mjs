/**
 * 无头 Chrome 截图：把一条含「未雨绸缪再次发动 + 无视谋略属性」的合成战报塞进
 * localStorage 的战报历史（`stzb_battle_history`），在**真实页面**里打开战报详情，
 * 目视确认两处标注（2026-10-21 报障 ② 的可视化证据）。
 *
 * 用法：node scripts/_shot_weiyu.mjs [url] [out.png]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_APP = process.argv[2] ?? 'http://127.0.0.1:5173/';
const OUT = process.argv[3] ?? path.resolve('docs/逆向对拍/baseline/weiyu-report.png');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;

fs.mkdirSync(path.dirname(OUT), { recursive: true });

/* ─── 合成战报：第 1 回合 贾诩 落雷 → 未雨绸缪再发动 → 第二次带 ignoreStrategy ─── */
const g = (id, name, position, faction = '汉') => ({
  id,
  name,
  rarity: '5星',
  cost: 3,
  faction,
  tags: [],
  mutualExclusionGroup: null,
  troopType: 'cavalry',
  position,
  attack: 100,
  defense: 100,
  strategy: 100,
  speed: 100,
  attackRange: 3,
  maxTroops: 9000,
  mainSkillName: '未雨绸缪',
  skillDesc: '',
  activeSkillIds: [],
  passiveSkillIds: [],
  commandSkillIds: [],
  pursuitSkillIds: [],
  morale: 120,
});

const events = [
  { type: 'battle_start', turnOrder: ['my1'], seed: 20261021 },
  { type: 'prep_phase', phase: 'formation' },
  { type: 'prep_phase', phase: 'troop' },
  { type: 'prep_phase', phase: 'skill' },
  { type: 'preparation_end' },
  { type: 'round_start', round: 1, turnOrder: ['my1', 'enemy1'] },
  { type: 'unit_act_start', unitId: 'my1', name: '贾诩', position: '中军', phase: 'active_skill' },
  { type: 'skill_cast', unitId: 'my1', skillId: 'luolei', skillName: '落雷' },
  {
    type: 'damage',
    sourceId: 'my1',
    targetId: 'enemy1',
    skillId: 'luolei',
    skillName: '落雷',
    damageType: 'strategy',
    damage: 2140,
    breakdown: { troopBase: 820, attrBase: 610, main: 710 },
  },
  { type: 'skill_cast', unitId: 'my1', skillId: 'luolei', skillName: '落雷', recastBy: '未雨绸缪', recastRate: 0.5 },
  {
    type: 'damage',
    sourceId: 'my1',
    targetId: 'enemy1',
    skillId: 'luolei',
    skillName: '落雷',
    damageType: 'strategy',
    damage: 1310,
    breakdown: { troopBase: 820, attrBase: 420, main: 70 },
    ignoreStrategy: { pct: 32, skillId: 'weiyu_choumou', skillName: '未雨绸缪' },
  },
  { type: 'unit_act_end', unitId: 'my1' },
  {
    type: 'round_end',
    round: 1,
    myTroops: [9000, 9000],
    enemyTroops: [6550],
    myWounded: [0, 0],
    enemyWounded: [0],
    myDead: [0, 0],
    enemyDead: [0],
  },
  { type: 'battle_end', result: 'win', rounds: 1, myTroops: [9000, 9000], enemyTroops: [6550] },
];

const report = {
  schemaVersion: '1.0',
  seed: 20261021,
  maxRounds: 8,
  result: 'win',
  rounds: 1,
  myTeam: [g('my1', '贾诩', '中军'), g('my2', '刘秀', '大营')],
  enemyTeam: [g('enemy1', '敌甲', '大营', '魏')],
  finalMyTroops: [9000, 9000],
  finalEnemyTroops: [6550],
  finalMyWounded: [0, 0],
  finalEnemyWounded: [0],
  finalMyDead: [0, 0],
  finalEnemyDead: [0],
  events,
  stats: [],
};

const record = {
  id: 'demo_weiyu',
  ts: Date.now(),
  label: '未雨绸缪 · 再次发动演示',
  result: 'win',
  rounds: 1,
  seed: 20261021,
  myTeam: ['刘秀', '贾诩', ''],
  enemyTeam: ['敌甲', '', ''],
  report,
};

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
await sleep(2200);

// 写入战报历史 + 关掉首访声明
console.log(
  '写入历史:',
  JSON.stringify(
    (
      await send('Runtime.evaluate', {
        expression: `(() => {
          try {
            localStorage.setItem('stzb_disclaimer_seen', '1');
            localStorage.setItem('stzb_battle_history', JSON.stringify([${JSON.stringify(record)}]));
          } catch (e) { return String(e); }
          return 'ok';
        })()`,
        returnByValue: true,
      })
    ).result?.value
  )
);

await send('Page.reload');
await sleep(2600);

// 关掉可能出现的声明弹窗
await send('Runtime.evaluate', {
  expression: `(() => {
    const c = document.querySelector('.modal .m-close');
    if (c) c.click();
    const m = document.querySelector('.modal-mask');
    if (m) m.remove();
    return true;
  })()`,
  returnByValue: true,
});
await sleep(300);

// 打开「战报」→ 第一条记录
console.log(
  '打开战报:',
  JSON.stringify(
    (
      await send('Runtime.evaluate', {
        expression: `(() => {
          const nav = document.querySelector('[data-nav="history"]');
          if (nav) nav.click();
          return !!nav;
        })()`,
        returnByValue: true,
      })
    ).result?.value
  )
);
await sleep(900);

console.log(
  '点开记录:',
  JSON.stringify(
    (
      await send('Runtime.evaluate', {
        expression: `(() => {
          const item = document.querySelector('.hist-item');
          if (!item) return 'no-item';
          item.click();
          return (item.textContent || '').slice(0, 40);
        })()`,
        returnByValue: true,
      })
    ).result?.value
  )
);
await sleep(900);

// 展开详细战报（简略战报里没有事件行）
console.log(
  '展开详细战报:',
  JSON.stringify(
    (
      await send('Runtime.evaluate', {
        expression: `(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('展开详细战报'));
          if (!btn) return 'no-btn';
          btn.click();
          return 'ok';
        })()`,
        returnByValue: true,
      })
    ).result?.value
  )
);
await sleep(900);

// 战报按回合分页：点 rail 上的「1」号回合页签
console.log(
  '切回合:',
  JSON.stringify(
    (
      await send('Runtime.evaluate', {
        expression: `(() => {
          const tab = [...document.querySelectorAll('.dv-rail .rtab')].find((t) => (t.textContent || '').trim() === '1');
          if (!tab) return 'no-tab';
          tab.click();
          return 'ok';
        })()`,
        returnByValue: true,
      })
    ).result?.value
  )
);
await sleep(700);

const verify = await send('Runtime.evaluate', {
  expression: `(() => {
    const text = document.body.textContent || '';
    return {
      recast: text.includes('未雨绸缪：再次发动，效果 50%'),
      ignore: text.includes('未雨绸缪：无视目标 32% 谋略属性'),
      ignoreNodes: document.querySelectorAll('.dmg-ignore').length,
      snippet: text.replace(/\\s+/g, ' ').match(/发动【落雷】[^。]{0,60}/g),
    };
  })()`,
  returnByValue: true,
});
console.log('页面断言:', JSON.stringify(verify.result?.value, null, 1));

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('截图:', OUT);

ws.close();
chrome.kill();
process.exit(0);
