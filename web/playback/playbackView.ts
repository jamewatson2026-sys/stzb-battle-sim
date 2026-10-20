/**
 * 推演模拟 · 全屏推演层
 * ---------------------------------------------------------------------------
 * 吃一份 `BattleReport`，用「左右双联画 + 浮动战斗文字」把整场战斗推演一遍。
 * 纯展示：不改引擎、不重跑随机，全部数字来自 `beatify()` 归并出的事件流。
 *
 * 与设计提案 `design-sets/a2-playback.html`（04 战演录·播片）同一套视觉；
 * 数据契约与坑见 `docs/推演模拟-落地设计.md`。
 */

import type { BattleReport } from '../../src/engine/types';
import {
  statusName,
  beatify,
  KIND_CN,
  modChips,
  shotBadge,
  shotTitle,
  statusLabel,
  type PlaybackShot,
  type PlaybackUnit,
} from './beats';
import { unitAssets, type UnitAssets } from './units';
import './playback.css';

/* ────────────────────────── 常量 ────────────────────────── */

const TROOP_CN: Record<string, string> = {
  infantry: '步兵',
  cavalry: '骑兵',
  archer: '弓兵',
};

const SIDE_CN: Record<string, string> = { my: '我方', enemy: '敌方' };
const FACTION_CN: Record<string, string> = {
  wei: '魏', shu: '蜀', wu: '吴', qun: '群', han: '汉', jin: '晋',
};

const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.6v10.8L13 8z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.6 2.6h3.2v10.8H3.6zM9.2 2.6h3.2v10.8H9.2z"/></svg>';

/** 一镜停留时长（ms）：有伤害 2500 / 仅治疗 2100 / 其余 1700 */
function baseDuration(shot: PlaybackShot): number {
  if (shot.hits.length) return 2500;
  if (shot.heals.length) return 2100;
  return 1700;
}

const fmt = (n: number): string => n.toLocaleString('en-US');

/* ────────────────────────── 状态 ────────────────────────── */

interface Session {
  root: HTMLElement;
  report: BattleReport;
  shots: PlaybackShot[];
  index: number;
  order: number[];
  units: PlaybackUnit[];
  assets: Record<string, UnitAssets>;
  playing: boolean;
  speed: number;
  keyOnly: boolean;
  timer: number;
  restoreFocus: HTMLElement | null;
  onClose?: () => void;
  onOpenReport?: (r: BattleReport) => void;
  ended: boolean;
}

let session: Session | null = null;

export function isPlaybackOpen(): boolean {
  return !!session;
}

/* ────────────────────────── 打开 / 关闭 ────────────────────────── */

export function openPlayback(
  report: BattleReport,
  opts?: { onClose?: () => void; onOpenReport?: (r: BattleReport) => void },
): void {
  closePlayback();

  const { shots, units } = beatify(report);
  const assets = unitAssets(report);

  const root = document.createElement('div');
  root.className = 'pb';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '推演模拟');
  root.innerHTML = shell(report, shots.length, units);
  document.body.appendChild(root);
  document.body.classList.add('pb-open');

  const s: Session = {
    root,
    report,
    shots,
    index: 0,
    order: shots.map((_, i) => i),
    units,
    assets,
    playing: false,
    speed: 1,
    keyOnly: false,
    timer: 0,
    restoreFocus: document.activeElement as HTMLElement | null,
    onClose: opts?.onClose,
    onOpenReport: opts?.onOpenReport,
    ended: false,
  };
  session = s;

  bindEvents(s);
  renderFlanks(s);
  renderDockRounds(s);
  goTo(s, 0, false);
  root.classList.add('on');

  if (shots.length) play(s);
  else {
    const head = root.querySelector('.pb-name');
    if (head) head.textContent = '战斗没有可推演的事件';
  }
}

export function closePlayback(): void {
  const s = session;
  if (!s) return;
  window.clearTimeout(s.timer);
  s.root.classList.remove('on');
  const el = s.root;
  window.setTimeout(() => el.remove(), 260);
  document.body.classList.remove('pb-open');
  session = null;
  s.restoreFocus?.focus?.();
  s.onClose?.();
}

/* ────────────────────────── 骨架 ────────────────────────── */

function shell(report: BattleReport, shotCount: number, units: PlaybackUnit[]): string {
  const my = units.filter((u) => u.side === 'my');
  const enemy = units.filter((u) => u.side === 'enemy');
  const myTroops = my.reduce((a, u) => a + u.maxTroops, 0);
  const enemyTroops = enemy.reduce((a, u) => a + u.maxTroops, 0);

  return `
  <div class="pb-top">
    <div class="pb-brand"><b>战演录</b><span>推演模拟</span></div>
    <div class="pb-order" data-role="order"></div>
    <div class="pb-meta">
      <span>种子<b>${report.seed ?? '—'}</b></span>
      <span>镜头<b>${shotCount}</b></span>
      <span>回合上限<b>${report.maxRounds ?? 8}</b></span>
      <span>结果<b>${report.result === 'win' ? '胜' : report.result === 'loss' ? '负' : '平'}</b></span>
    </div>
    <div class="pb-nav">
      <button type="button" data-act="mode">只看关键</button>
      <button type="button" data-act="close">退出推演</button>
    </div>
  </div>

  <div class="pb-stage">
    <div class="pb-duel">
      <div class="pb-pane actor"><img alt="" data-role="actor-img" src=""></div>
      <div class="pb-seam"></div>
      <div class="pb-pane targets" data-role="targets"></div>
      <svg class="pb-fx" data-role="fx" aria-hidden="true"></svg>
      <div class="pb-solo" data-role="solo"></div>
      <div class="pb-plate" data-role="plate"></div>
    </div>

    <div class="pb-flank left">
      <div class="pb-flank-head"><b>${SIDE_CN.my}</b><span>${myTroops.toLocaleString('en-US')}</span></div>
      <div data-role="cards-my"></div>
    </div>
    <div class="pb-flank right">
      <div class="pb-flank-head"><span>${enemyTroops.toLocaleString('en-US')}</span><b>${SIDE_CN.enemy}</b></div>
      <div data-role="cards-enemy"></div>
    </div>

    <div class="pb-head">
      <span class="pb-ty" data-role="badge">战法</span>
      <h2 class="pb-name" data-role="name">—</h2>
      <p class="pb-say" data-role="say"></p>
      <p class="pb-ctx" data-role="ctx"></p>
    </div>

    <div class="pb-foot">
      <div class="pb-bd" data-role="bd"></div>
      <div class="pb-srcs" data-role="srcs"></div>
    </div>
  </div>

  <div class="pb-end" data-role="end" hidden></div>

  <div class="pb-dock">
    <button type="button" class="play" data-act="play" aria-label="播放 / 暂停">${PAUSE_ICON}</button>
    <button type="button" data-act="prev" aria-label="上一镜">‹</button>
    <button type="button" data-act="next" aria-label="下一镜">›</button>
    <span class="pb-shot">SHOT <b data-role="shot">000 / 000</b></span>
    <div class="pb-track">
      <div class="pb-rounds" data-role="rounds"></div>
      <div class="pb-railrow">
        <svg class="pb-spark" data-role="spark" viewBox="0 0 200 34" preserveAspectRatio="none" aria-hidden="true"></svg>
        <div class="pb-rail" data-role="rail"><i></i><s></s></div>
      </div>
    </div>
    <div class="pb-seg" data-role="speed">
      <button type="button" data-speed="0.5">0.5×</button>
      <button type="button" data-speed="1" class="on">1×</button>
      <button type="button" data-speed="2">2×</button>
    </div>
    <span class="pb-hint">空格 播放 · ← → 换镜 · Esc 退出</span>
  </div>`;
}

/* ────────────────────────── 结算卡 ────────────────────────── */

/** 末镜停住后给一张战绩卡：结果 / 双方残兵 / 输出前三 / 三条出口 */
function showEnd(s: Session): void {
  const el = s.root.querySelector<HTMLElement>('[data-role="end"]');
  if (!el || s.ended) return;
  s.ended = true;

  const last = s.shots[s.shots.length - 1];
  const troops = last?.troops ?? {};
  const sum = (side: 'my' | 'enemy'): { left: number; max: number } => {
    const list = s.units.filter((u) => u.side === side);
    return {
      left: list.reduce((a, u) => a + (troops[u.id] ?? u.maxTroops), 0),
      max: list.reduce((a, u) => a + u.maxTroops, 0),
    };
  };
  const my = sum('my');
  const enemy = sum('enemy');

  // 伤害榜：按战法名汇总（普攻 / 分兵 / 持续各自成条）
  const bySkill = new Map<string, number>();
  for (const sh of s.shots) {
    for (const h of sh.hits) {
      const k = h.skill ?? (h.kind === 'attack' ? '普通攻击' : h.kind === 'split' ? '分兵' : '持续伤害');
      bySkill.set(k, (bySkill.get(k) ?? 0) + h.amount);
    }
  }
  const top = [...bySkill.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const maxTop = top[0]?.[1] ?? 1;

  const rounds = Math.max(...s.shots.map((x) => x.round), 0);
  const result = s.report.result === 'win' ? '胜' : s.report.result === 'loss' ? '负' : '平';

  el.innerHTML = `
    <div class="pb-end-card" role="status">
      <div class="pb-end-kicker">推演结束 · 第 ${pad(rounds)} 回合</div>
      <div class="pb-end-res ${s.report.result}">${result}</div>
      <div class="pb-end-armies">
        <div><span>我方残兵</span><b>${fmt(my.left)}</b><s>/ ${fmt(my.max)}</s></div>
        <div><span>敌方残兵</span><b>${fmt(enemy.left)}</b><s>/ ${fmt(enemy.max)}</s></div>
      </div>
      <div class="pb-end-top">
        <div class="hd">伤害来源 · 前三</div>
        ${top
          .map(
            ([k, v]) =>
              `<div class="row"><span class="nm">${k}</span><span class="track"><i style="width:${Math.round((v / maxTop) * 100)}%"></i></span><b>${fmt(v)}</b></div>`,
          )
          .join('')}
      </div>
      <div class="pb-end-acts">
        <button type="button" class="btn" data-end="replay">重看一遍</button>
        <button type="button" class="btn ghost" data-end="report">看文字战报</button>
        <button type="button" class="btn ghost" data-end="close">退出推演</button>
      </div>
      <div class="pb-end-hint">Esc 退出 · 空格 继续单步</div>
    </div>`;
  el.hidden = false;
  el.classList.add('on');

  el.querySelector('[data-end="replay"]')?.addEventListener('click', () => {
    hideEnd(s);
    goTo(s, 0, false);
    play(s);
  });
  el.querySelector('[data-end="report"]')?.addEventListener('click', () => {
    s.onOpenReport?.(s.report);
  });
  el.querySelector('[data-end="close"]')?.addEventListener('click', () => closePlayback());
}

function hideEnd(s: Session): void {
  const el = s.root.querySelector<HTMLElement>('[data-role="end"]');
  if (!el) return;
  s.ended = false;
  el.classList.remove('on');
  el.hidden = true;
  el.innerHTML = '';
}

/* ────────────────────────── 武将档案 ────────────────────────── */

/**
 * 点左/右栏的武将卡 → 侧向档案：立绘、营位兵种、本局战绩（造成/承受/恢复/发动）、当前状态。
 * 只读，不改变播放位置；给一个「看他的下一镜」的出口。
 */
function openDossier(s: Session, id: string): void {
  closeDossier(s);
  const u = s.units.find((x) => x.id === id);
  if (!u) return;

  // 造成伤害按「镜头归属」算：beatify 已经把 creditToId 折进 actor（分兵/代打算到施法者头上）
  const dealt = s.shots.reduce((a, sh) => (sh.actor === id ? a + sh.hits.reduce((x, h) => x + h.amount, 0) : a), 0);
  const taken = s.shots.reduce((a, sh) => a + sh.hits.filter((h) => h.to === id).reduce((x, h) => x + h.amount, 0), 0);
  const healed = s.shots.reduce((a, sh) => a + sh.heals.filter((h) => h.to === id).reduce((x, h) => x + h.amount, 0), 0);
  const casts = s.shots.filter((sh) => sh.actor === id && (sh.skill || sh.hits.length)).length;
  const cur = s.shots[s.index];
  const troops = cur?.troops?.[id] ?? u.maxTroops;
  const statuses = (cur?.statuses ?? []).filter((st) => st.to === id).slice(0, 4);
  const a = s.assets[id];

  const el = document.createElement('div');
  el.className = `pb-doss ${u.side}`;
  el.innerHTML = `
    <button type="button" class="x" data-doss="close" aria-label="关闭档案">×</button>
    <div class="hero">
      <img alt="" src="${a?.portrait ?? ''}">
      <div class="meta">
        <div class="pos">${POSITION_CN[u.position] ?? u.position} · ${u.troopType ?? ''}</div>
        <h3>${u.name}</h3>
        <div class="sub">${FACTION_CN[u.faction] ?? u.faction ?? ''}${u.level ? ` · ${u.level} 级` : ''}${u.redness ? ` · ${u.redness} 红` : ''}</div>
      </div>
    </div>
    <div class="tr">
      <span>当前兵力</span><b>${fmt(troops)}</b><s>/ ${fmt(u.maxTroops)}</s>
    </div>
    <dl class="nums">
      <div><dt>造成</dt><dd>${fmt(dealt)}</dd></div>
      <div><dt>承受</dt><dd>${fmt(taken)}</dd></div>
      <div><dt>恢复</dt><dd>${fmt(healed)}</dd></div>
      <div><dt>出手</dt><dd>${casts}</dd></div>
    </dl>
    ${statuses.length ? `<div class="sts">${statuses
      .map((st) => {
        const lb = statusLabel(st.st, st.detail);
        return `<span class="c-${lb.c}">${statusName(st.st)}</span>`;
      })
      .join('')}</div>` : ''}
    <button type="button" class="btn ghost jump" data-doss="jump">看他的下一镜 →</button>`;

  s.root.querySelector('.pb-stage')?.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));

  const jump = (): void => {
    const from = s.order.indexOf(s.index);
    const found = s.order
      .slice(from + 1)
      .concat(s.order.slice(0, from + 1))
      .find((i) => s.shots[i].actor === id || s.shots[i].hits.some((h) => h.to === id));
    closeDossier(s);
    if (found != null) {
      goTo(s, found, false);
      play(s);
    }
  };
  el.querySelector('[data-doss="jump"]')?.addEventListener('click', jump);
  el.querySelector('[data-doss="close"]')?.addEventListener('click', () => closeDossier(s));
  el.addEventListener('click', (ev) => {
    if (ev.target === el) closeDossier(s);
  });
}

function closeDossier(s: Session): void {
  for (const el of Array.from(s.root.querySelectorAll<HTMLElement>('.pb-doss'))) {
    el.classList.remove('on');
    window.setTimeout(() => el.remove(), 180);
  }
}

/* ────────────────────────── 左栏六卡 ────────────────────────── */

function renderFlanks(s: Session): void {
  const my = s.root.querySelector<HTMLElement>('[data-role="cards-my"]');
  const enemy = s.root.querySelector<HTMLElement>('[data-role="cards-enemy"]');
  if (my) my.innerHTML = s.units.filter((u) => u.side === 'my').map((u) => card(u, s)).join('');
  if (enemy) enemy.innerHTML = s.units.filter((u) => u.side === 'enemy').map((u) => card(u, s)).join('');
  for (const el of Array.from(s.root.querySelectorAll<HTMLElement>('.pb-card'))) {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (id) openDossier(s, id);
    });
  }
}

function card(u: PlaybackUnit, s: Session): string {
  const a = s.assets[u.id];
  const faction = FACTION_CN[u.faction] ?? u.faction ?? '';
  return `
  <div class="pb-card" data-id="${u.id}">
    <div class="pic">
      <img class="pf" alt="" src="${a?.portrait ?? ''}">
      <img class="flag" alt="" src="${a?.factionIcon ?? ''}">
    </div>
    <div class="info">
      <div class="row1"><span class="pb-slot">${POSITION_CN[u.position] ?? u.position}</span><span>${faction || ''}</span></div>
      <div class="nm">${u.name}</div>
      <div class="tr"><b data-role="troops">${fmt(u.maxTroops)}</b><s>/ ${fmt(u.maxTroops)}</s></div>
      <div class="bar"><i class="t" data-role="bar-t"></i><i class="w" data-role="bar-w"></i><i class="d" data-role="bar-d"></i></div>
      <div class="chips" data-role="chips"></div>
    </div>
    <div class="pb-fct" data-role="fct"></div>
  </div>`;
}

const POSITION_CN: Record<string, string> = { back: '大营', middle: '中军', front: '前锋' };

/* ────────────────────────── 渲染一镜 ────────────────────────── */

function goTo(s: Session, index: number, autoplay = true): void {
  if (!s.shots.length) return;
  const pos = Math.max(0, Math.min(s.order.length - 1, index));
  s.index = s.order[pos];
  const shot = s.shots[s.index];

  window.clearTimeout(s.timer);
  hideEnd(s);
  syncTroops(s, shot);
  renderHead(s, shot);
  renderDuel(s, shot);
  renderFoot(s, shot);
  renderDock(s, shot);
  floaters(s, shot);

  const cursor = pos;
  if (s.playing && autoplay) {
    const dur = Math.max(900, Math.round(baseDuration(shot) / s.speed));
    s.timer = window.setTimeout(() => {
      if (cursor >= s.order.length - 1) {
        pause(s);
        showEnd(s);
        return;
      }
      goTo(s, cursor + 1, true);
    }, dur);
  }
}

/* 兵力：数字 + 三段条（剩余 / 伤兵 / 阵亡），全部来自本镜快照 */
function syncTroops(s: Session, shot: PlaybackShot): void {
  for (const u of s.units) {
    const cardEl = s.root.querySelector<HTMLElement>(`.pb-card[data-id="${u.id}"]`);
    if (!cardEl) continue;
    const round0 = shot.troops[u.id] ?? u.maxTroops;
    const cur = Math.max(0, Math.min(u.maxTroops, round0));
    const lost = Math.max(0, u.maxTroops - cur);
    const wounded = Math.min(lost, shot.wounded[u.id] ?? 0);
    const dead = Math.max(0, Math.min(lost - wounded, shot.dead[u.id] ?? 0));

    const numEl = cardEl.querySelector<HTMLElement>('[data-role="troops"]');
    if (numEl) numEl.textContent = fmt(cur);
    const pct = (n: number): string => `${(n / u.maxTroops) * 100}%`;
    const barT = cardEl.querySelector<HTMLElement>('[data-role="bar-t"]');
    const barW = cardEl.querySelector<HTMLElement>('[data-role="bar-w"]');
    const barD = cardEl.querySelector<HTMLElement>('[data-role="bar-d"]');
    if (barT) barT.style.width = pct(Math.max(0, cur - wounded - dead));
    if (barW) barW.style.width = pct(wounded);
    if (barD) barD.style.width = pct(dead);

    const chips = cardEl.querySelector<HTMLElement>('[data-role="chips"]');
    if (chips) {
      chips.innerHTML = shot.statuses
        .filter((st) => st.to === u.id)
        .slice(0, 3)
        .map((st) => {
          const lb = statusLabel(st.st, st.detail);
          const cls = lb.c === 'debuff' ? 'dn' : lb.c === 'heal' ? 'up' : 'st';
          return `<span class="${cls}">${lb.t}</span>`;
        })
        .join('');
    }
  }
}

function renderHead(s: Session, shot: PlaybackShot): void {
  const badge = s.root.querySelector('[data-role="badge"]');
  const name = s.root.querySelector('[data-role="name"]');
  const say = s.root.querySelector('[data-role="say"]');
  const ctx = s.root.querySelector('[data-role="ctx"]');
  if (badge) badge.textContent = shotBadge(shot);
  if (name) name.textContent = shotTitle(shot);
  if (say) {
    const actor = s.units.find((u) => u.id === shot.actor);
    const targets = Array.from(new Set(shot.hits.map((h) => h.to).concat(shot.heals.map((h) => h.to)).concat(shot.statuses.map((h) => h.to))));
    const names = targets.map((id) => s.units.find((u) => u.id === id)?.name ?? '').filter(Boolean);
    say.textContent = actor ? `${actor.name}　→　${names.join('、') || '—'}` : names.join('、') || '';
  }
  if (ctx) {
    // 计数跟着「当前播放序列」走：只看关键时总数会变小，不能拿 shots.length 充数
    const pos = Math.max(0, s.order.indexOf(shot.i));
    ctx.textContent = `第 ${pad(shot.round)} 回合 · 镜头 ${pad(pos + 1)} / ${s.order.length}`;
  }

  const order = s.root.querySelector<HTMLElement>('[data-role="order"]');
  if (order) {
    const ids = shot.order ?? [];
    order.innerHTML = ids.length
      ? `<span class="lb">出手</span>` +
        ids
          .map((id) => {
            const u = s.units.find((x) => x.id === id);
            if (!u) return '';
            const a = s.assets[id];
            return `<i class="who ${u.side}${id === shot.actor ? ' act' : ''}" title="${u.name}">
              <img alt="" src="${a?.avatar ?? a?.portrait ?? ''}"><b>${u.name}</b></i>`;
          })
          .join('')
      : '';
  }
}

function renderDuel(s: Session, shot: PlaybackShot): void {
  const duel = s.root.querySelector<HTMLElement>('.pb-duel');
  const actorImg = s.root.querySelector<HTMLImageElement>('[data-role="actor-img"]');
  const targets = s.root.querySelector<HTMLElement>('[data-role="targets"]');
  const solo = s.root.querySelector<HTMLElement>('[data-role="solo"]');
  const plate = s.root.querySelector<HTMLElement>('[data-role="plate"]');
  if (!duel || !actorImg || !targets || !solo) return;

  const actor = s.units.find((u) => u.id === shot.actor) ?? null;
  const statusOnly = !shot.hits.length && !shot.heals.length;
  const ids = Array.from(new Set([
    ...shot.hits.map((h) => h.to),
    ...shot.heals.map((h) => h.to),
    ...(statusOnly ? [] : []),
  ]));
  const targetUnits = ids
    .map((id) => s.units.find((u) => u.id === id))
    .filter((u): u is PlaybackUnit => !!u)
    .slice(0, 3);

  const isSolo = statusOnly || (!!actor && targetUnits.length === 1 && targetUnits[0].id === actor.id);
  const isMulti = targetUnits.length >= 3;

  duel.classList.toggle('solo', isSolo);

  const actorUnit = actor ?? targetUnits[0] ?? s.units[0];
  actorImg.src = actorUnit ? (s.assets[actorUnit.id]?.portrait ?? '') : '';
  actorImg.alt = actorUnit?.name ?? '';

  if (plate) {
    plate.innerHTML = actorUnit
      ? `<b>${actorUnit.name}</b><i>${POSITION_CN[actorUnit.position] ?? ''} · ${TROOP_CN[actorUnit.troopType] ?? actorUnit.troopType}</i>`
      : '';
  }

  if (isSolo) {
    targets.innerHTML = '';
    targets.classList.remove('multi');
    const soloUnit = actor ?? targetUnits[0] ?? s.units[0];
    solo.innerHTML = soloBlock(shot, soloUnit, s.units);
    return;
  }
  solo.innerHTML = '';
  targets.classList.toggle('multi', isMulti);

  targets.innerHTML = targetUnits.map((t) => tcol(s, shot, t)).join('');
  playFx(s, shot);
}

function soloBlock(shot: PlaybackShot, u: PlaybackUnit, units: PlaybackUnit[]): string {
  const nameOf = (id: string): string => units.find((x) => x.id === id)?.name ?? '—';
  const heal = shot.heals[0];
  const hit = shot.hits[0];
  if (heal) {
    return `<div class="pb-kind">恢复</div>
      <div class="pb-num heal pop"><small>+</small>${fmt(Math.abs(heal.amount))}</div>
      <div class="pb-nm">${u.name}</div>
      <div class="pb-role">${POSITION_CN[u.position] ?? ''} · ${TROOP_CN[u.troopType] ?? u.troopType}</div>`;
  }
  if (hit) {
    return `<div class="pb-kind">${KIND_CN[hit.kind] ?? '伤害'}</div>
      <div class="pb-num pop">−${fmt(Math.abs(hit.amount))}</div>
      <div class="pb-nm">${u.name}</div>`;
  }
  // 纯状态镜：一镜常同时给多名单位挂状态 → 列成清单，而不是并排三张脸
  const rows = shot.statuses.slice(0, 4);
  if (rows.length) {
    return `<div class="pb-kind">状态</div>
      <div class="pb-slist">${rows
        .map((st) => {
          const lb = statusLabel(st.st, st.detail);
          return `<div class="pb-srow"><span class="who">${st.to === u.id ? '自身' : nameOf(st.to)}</span><span class="txt">${lb.t}</span></div>`;
        })
        .join('')}</div>`;
  }
  return `<div class="pb-kind">状态</div><div class="pb-nm">${u.name}</div>`;
}

function tcol(s: Session, shot: PlaybackShot, t: PlaybackUnit): string {
  const a = s.assets[t.id];
  const hit = shot.hits.find((h) => h.to === t.id);
  const heal = shot.heals.find((h) => h.to === t.id);
  const st = shot.statuses.find((h) => h.to === t.id);

  let kind = '';
  let num = '';
  if (hit) {
    kind = KIND_CN[hit.kind] ?? '伤害';
    num = `<div class="pb-num pop">−${fmt(Math.abs(hit.amount))}</div>`;
  } else if (heal) {
    kind = '恢复';
    num = `<div class="pb-num heal pop"><small>+</small>${fmt(Math.abs(heal.amount))}</div>`;
  } else if (st) {
    const lb = statusLabel(st.st, st.detail);
    kind = '状态';
    num = `<div class="pb-num buff pop">${lb.t}</div>`;
  }

  const chips = hit ? modChips(hit, 3) : [];
  const chipsHtml = chips.length
    ? `<div class="pb-mods">${chips.map((c) => `<span class="${c.dir === 'dn' ? 'dn' : c.dir === 'taken' ? 'taken' : ''}">${c.label}${c.value}</span>`).join('')}</div>`
    : '';

  const left = shot.troops[t.id] ?? t.maxTroops;
  return `
  <div class="pb-tcol">
    <img alt="" src="${a?.portrait ?? ''}">
    <div class="pb-tbody">
      <div class="pb-kind">${kind}</div>
      ${num}
      <div class="pb-nm">${t.name}</div>
      <div class="pb-role">${POSITION_CN[t.position] ?? ''} · ${TROOP_CN[t.troopType] ?? t.troopType}</div>
      ${chipsHtml}
      <div class="pb-lft">剩余 ${fmt(Math.max(0, left))}</div>
    </div>
  </div>`;
}

function renderFoot(s: Session, shot: PlaybackShot): void {
  const bd = s.root.querySelector<HTMLElement>('[data-role="bd"]');
  const srcs = s.root.querySelector<HTMLElement>('[data-role="srcs"]');
  const hit = shot.hits[0];
  if (bd) {
    bd.innerHTML = hit?.bd
      ? `<span><i>兵力基础</i><b>${fmt(hit.bd.troopBase)}</b></span>
         <span><i>属性基础</i><b>${fmt(hit.bd.base)}</b></span>
         <span><i>主要加成</i><b>${fmt(hit.bd.main)}</b></span>`
      : shot.heals.length
        ? `<span><i>恢复总量</i><b>${fmt(shot.heals.reduce((a, h) => a + h.amount, 0))}</b></span>
           <span><i>受益</i><b>${shot.heals.length}</b></span>`
        : '';
  }
  if (srcs) {
    const chips = hit ? modChips(hit, 5) : [];
    srcs.innerHTML = chips.length
      ? chips.map((c) => `<span class="${c.dir === 'dn' ? 'dn' : c.dir === 'taken' ? 'taken' : ''}">${c.label}${c.value}　${c.name}</span>`).join('')
      : '<span class="none">本镜无增减伤修正</span>';
  }
}

/* ────────────────────────── 演出特效（光束 / 刀光 / 冲击环） ────────────────────────── */

/** 用户系统开了「减少动态效果」就只留排版，不放飞线 */
function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function playFx(s: Session, shot: PlaybackShot): void {
  const svg = s.root.querySelector<SVGSVGElement>('[data-role="fx"]');
  const duel = s.root.querySelector<HTMLElement>('.pb-duel');
  if (!svg || !duel) return;
  svg.innerHTML = '';
  if (reducedMotion() || !shot.hits.length) return;

  const box = duel.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`);

  const actorEl = duel.querySelector<HTMLElement>('.pb-pane.actor');
  if (!actorEl) return;
  const ab = actorEl.getBoundingClientRect();
  const ax = ab.width * 0.78;
  const ay = ab.height * 0.44;

  const cols = Array.from(duel.querySelectorAll<HTMLElement>('.pb-tcol'));
  cols.slice(0, 3).forEach((col, i) => {
    const cb = col.getBoundingClientRect();
    const tx = cb.left - box.left + cb.width / 2;
    const ty = cb.top - box.top + cb.height * 0.42;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'pb-fx-g');
    g.style.animationDelay = `${240 + i * 90}ms`;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(ax));
    line.setAttribute('y1', String(ay));
    line.setAttribute('x2', String(tx));
    line.setAttribute('y2', String(ty));
    line.setAttribute('class', 'pb-beam');
    const glow = line.cloneNode() as SVGLineElement;
    glow.setAttribute('class', 'pb-beam-glow');
    // pathLength=1：不依赖真实长度，dasharray/offset 用 1 就能把整条线描满
    line.setAttribute('pathLength', '1');
    line.setAttribute('stroke-dasharray', '1');
    line.setAttribute('stroke-dashoffset', '1');

    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('cx', String(tx));
    ring.setAttribute('cy', String(ty));
    ring.setAttribute('r', '26');
    ring.setAttribute('class', 'pb-ring');

    const slash = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    slash.setAttribute('x', String(tx - 90));
    slash.setAttribute('y', String(ty - 3));
    slash.setAttribute('width', '180');
    slash.setAttribute('height', '6');
    slash.setAttribute('rx', '3');
    slash.setAttribute('class', 'pb-slash');
    slash.setAttribute('transform', `rotate(-24 ${tx} ${ty})`);

    g.append(glow, line, slash, ring);
    svg.appendChild(g);
  });
}

/* ────────────────────────── 浮动战斗文字 ────────────────────────── */

function floaters(s: Session, shot: PlaybackShot): void {
  const push = (unitId: string, html: string, cls: string, delay: number): void => {
    const host = s.root.querySelector<HTMLElement>(`.pb-card[data-id="${unitId}"] [data-role="fct"]`);
    if (!host) return;
    window.setTimeout(() => {
      const el = document.createElement('div');
      el.className = `i ${cls}`;
      el.innerHTML = html;
      el.style.opacity = '0';
      el.style.transform = 'translateY(12px)';
      el.style.filter = 'blur(2.2px)';
      el.style.transition = 'opacity .34s ease, transform 1.05s cubic-bezier(.16,.84,.28,1), filter .34s ease';
      host.appendChild(el);
      while (host.children.length > 2) host.firstElementChild?.remove();
      void el.offsetWidth;
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
      el.style.filter = 'blur(0)';
      window.setTimeout(() => {
        el.style.transform = 'translateY(-30px)';
        el.style.opacity = '.92';
      }, 340);
      window.setTimeout(() => {
        el.style.transition = 'opacity .62s ease, transform .62s ease';
        el.style.transform = 'translateY(-54px)';
        el.style.opacity = '0';
      }, 1390);
      window.setTimeout(() => el.remove(), 2100);
    }, delay);
  };

  // 同一镜里同一目标可能被同一战法连治两次（受击急救），去重后再上浮，避免两行一模一样的字
  const seenHeal = new Set<string>();
  shot.heals
    .filter((h) => {
      const key = `${h.to}|${h.skill ?? ''}|${h.amount}`;
      if (seenHeal.has(key)) return false;
      seenHeal.add(key);
      return true;
    })
    .forEach((h, i) => {
      push(h.to, `<b>【${h.skill ?? shotTitle(shot)}】</b><em>恢复 +${fmt(h.amount)}</em>`, 'heal', 140 + i * 120);
    });

  // 只有「看得见」的状态才上浮：控制 / 规避 / 连击 / 分兵 / 急救 / DoT。
  // 数值型（增减伤、四维）每刀重挂一次，全上浮会刷屏 —— 它们的去处是卡片 chips 与底部明细。
  const NOTABLE = new Set([
    'confusion', 'taunt', 'hesitation', 'unrest', 'cowardice', 'siege', 'insight',
    'combo', 'split', 'evasion', 'cover', 'burning', 'panic', 'curse', 'ignite', 'first_aid',
  ]);
  const notable = shot.statuses.filter((st) => NOTABLE.has(st.st)).slice(0, 3);
  const many = notable.length > 1;
  notable.forEach((st, i) => {
    const lb = statusLabel(st.st, st.detail);
    const body = many ? lb.t : `<b>【${st.skill ?? shotTitle(shot)}】</b>${lb.t}`;
    const cls = lb.c === 'heal' ? 'heal' : lb.c === 'debuff' ? 'debuff' : lb.c === 'state' ? 'state' : 'buff';
    push(st.to, body, cls, 240 + i * 120);
  });

  const hit = shot.hits[0];
  if (hit) {
    const card = s.root.querySelector<HTMLElement>(`.pb-card[data-id="${hit.to}"]`);
    if (card) {
      const delta = document.createElement('div');
      delta.className = 'pb-delta';
      delta.textContent = `−${fmt(Math.abs(hit.amount))}`;
      delta.style.color = 'rgba(232,150,132,.95)';
      delta.style.opacity = '0';
      card.appendChild(delta);
      window.setTimeout(() => { delta.style.transition = 'opacity .3s ease'; delta.style.opacity = '1'; }, 420);
      window.setTimeout(() => { delta.style.opacity = '0'; }, 1400);
      window.setTimeout(() => delta.remove(), 1900);
    }
  }
}

/* ────────────────────────── 底栏 ────────────────────────── */

function renderDockRounds(s: Session): void {
  const rounds = s.root.querySelector<HTMLElement>('[data-role="rounds"]');
  if (!rounds) return;
  const rs: number[] = [];
  for (const sh of s.shots) if (!rs.includes(sh.round)) rs.push(sh.round);
  rounds.innerHTML = rs.map((r) => `<button type="button" data-round="${r}">${pad(r)}</button>`).join('');
}

function renderDock(s: Session, shot: PlaybackShot): void {
  const total = s.order.length;
  const cursor = s.order.indexOf(s.index);
  const label = s.root.querySelector<HTMLElement>('[data-role="shot"]');
  if (label) label.textContent = `${pad(cursor + 1)} / ${pad(total)}`;

  const rail = s.root.querySelector<HTMLElement>('[data-role="rail"]');
  if (rail) {
    const fill = rail.querySelector('i');
    const head = rail.querySelector('s');
    const pct = total > 1 ? (cursor / (total - 1)) * 100 : 0;
    if (fill) fill.style.width = `${pct}%`;
    if (head) head.style.left = `calc(${pct}% - 1px)`;
  }

  for (const btn of Array.from(s.root.querySelectorAll<HTMLElement>('[data-round]'))) {
    btn.classList.toggle('on', Number(btn.dataset.round) === shot.round);
  }

  const playBtn = s.root.querySelector<HTMLElement>('[data-act="play"]');
  if (playBtn) playBtn.innerHTML = s.playing ? PAUSE_ICON : PLAY_ICON;

  drawSpark(s, shot);
}

/**
 * 底栏兵力走势：双方总兵力沿回合下降的两条细线 + 播放头。
 * 数据取每个回合**最后一镜**的快照（回合末兵力），第 0 个点是开战满兵。
 */
function drawSpark(s: Session, shot: PlaybackShot): void {
  const box = s.root.querySelector<SVGSVGElement>('[data-role="spark"]');
  if (!box) return;
  const rounds: number[] = [];
  for (const sh of s.shots) if (!rounds.includes(sh.round)) rounds.push(sh.round);
  if (rounds.length < 2) { box.innerHTML = ''; return; }

  const maxTroops = s.units.reduce((a, u) => a + u.maxTroops, 0) / 2; // 单方满兵
  const point = (r: number, side: 'my' | 'enemy'): number => {
    let last: PlaybackShot | null = null;
    for (const sh of s.shots) {
      if (sh.round > r) break;
      if (sh.round === r) last = sh;
    }
    const snap = last?.troops ?? {};
    let sum = 0;
    for (const u of s.units) if (u.side === side) sum += snap[u.id] ?? u.maxTroops;
    return sum;
  };
  const W = 200;
  const H = 34;
  const path = (side: 'my' | 'enemy'): string =>
    rounds
      .map((r, i) => {
        const x = (i / (rounds.length - 1)) * W;
        const y = H - (point(r, side) / (maxTroops || 1)) * (H - 4) - 2;
        return `${i ? 'L' : 'M'}${x.toFixed(1)},${Math.max(1, Math.min(H - 1, y)).toFixed(1)}`;
      })
      .join(' ');

  const idx = Math.max(0, rounds.indexOf(shot.round));
  const px = rounds.length > 1 ? (idx / (rounds.length - 1)) * W : 0;
  box.innerHTML = `
    <path class="my" d="${path('my')}" />
    <path class="enemy" d="${path('enemy')}" />
    <line class="head" x1="${px.toFixed(1)}" y1="0" x2="${px.toFixed(1)}" y2="${H}" />`;
}

function renderKeyMode(s: Session): void {
  const btn = s.root.querySelector<HTMLElement>('[data-act="mode"]');
  btn?.classList.toggle('on', s.keyOnly);
  if (btn) btn.textContent = s.keyOnly ? '全部镜头' : '只看关键';
}

/* ────────────────────────── 播放控制 ────────────────────────── */

function play(s: Session): void {
  if (!s.shots.length) return;
  s.playing = true;
  const shot = s.shots[s.index];
  renderDock(s, shot);
  const cursor = s.order.indexOf(s.index);
  const dur = Math.max(900, Math.round(baseDuration(shot) / s.speed));
  window.clearTimeout(s.timer);
  s.timer = window.setTimeout(() => {
    if (cursor >= s.order.length - 1) {
      pause(s);
      showEnd(s);
      return;
    }
    goTo(s, cursor + 1, true);
  }, dur);
}

function pause(s: Session): void {
  s.playing = false;
  window.clearTimeout(s.timer);
  const shot = s.shots[s.index];
  if (shot) renderDock(s, shot);
}

function rebuildOrder(s: Session): void {
  const keep = s.shots[s.index];
  s.order = s.shots.map((_, i) => i).filter((i) => !s.keyOnly || s.shots[i].key);
  if (!s.order.length) s.order = s.shots.map((_, i) => i);
  const pos = Math.max(0, s.order.indexOf(s.shots.indexOf(keep)));
  goTo(s, pos, false);
}

/* ────────────────────────── 事件 ────────────────────────── */

function bindEvents(s: Session): void {
  s.root.addEventListener('click', (ev) => {
    const el = ev.target as HTMLElement;
    const btn = el.closest<HTMLElement>('[data-act], [data-round], [data-speed]');
    if (!btn) return;

    if (btn.dataset.act === 'close') { closePlayback(); return; }
    if (btn.dataset.act === 'play') { s.playing ? pause(s) : play(s); return; }
    if (btn.dataset.act === 'prev') { goTo(s, s.order.indexOf(s.index) - 1, false); return; }
    if (btn.dataset.act === 'next') { goTo(s, s.order.indexOf(s.index) + 1, false); return; }
    if (btn.dataset.act === 'mode') {
      s.keyOnly = !s.keyOnly;
      renderKeyMode(s);
      rebuildOrder(s);
      return;
    }
    if (btn.dataset.round) {
      const r = Number(btn.dataset.round);
      const found = s.order.find((i) => s.shots[i].round === r);
      if (found != null) goTo(s, s.order.indexOf(found), false);
      return;
    }
    if (btn.dataset.speed) {
      s.speed = Number(btn.dataset.speed) || 1;
      for (const b of Array.from(s.root.querySelectorAll<HTMLElement>('[data-speed]'))) {
        b.classList.toggle('on', b === btn);
      }
      if (s.playing) play(s);
      return;
    }
  });

  const rail = s.root.querySelector<HTMLElement>('[data-role="rail"]');
  rail?.addEventListener('click', (ev) => {
    const rect = rail.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    const pos = Math.round(pct * (s.order.length - 1));
    goTo(s, pos, false);
  });

  // 触屏：在双联画上左右滑换镜（阈值 46px，纵向为主时不触发）
  let sx = 0;
  let sy = 0;
  let tracking = false;
  s.root.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse') return;
    const t = ev.target as HTMLElement;
    if (!t.closest('.pb-duel')) return;
    tracking = true;
    sx = ev.clientX;
    sy = ev.clientY;
  });
  s.root.addEventListener('pointerup', (ev) => {
    if (!tracking) return;
    tracking = false;
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    if (Math.abs(dx) < 46 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    goTo(s, s.order.indexOf(s.index) + (dx < 0 ? 1 : -1), false);
  });

  s.root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (s.root.querySelector('.pb-doss')) closeDossier(s);
      else closePlayback();
    }
    else if (ev.key === ' ' || ev.code === 'Space') { ev.preventDefault(); s.playing ? pause(s) : play(s); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); goTo(s, s.order.indexOf(s.index) + 1, false); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); goTo(s, s.order.indexOf(s.index) - 1, false); }
  });

  window.setTimeout(() => s.root.focus(), 30);
  s.root.tabIndex = -1;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/* ────────────────────────── 供调试 ────────────────────────── */

export function __playbackState(): { index: number; total: number; playing: boolean } | null {
  return session ? { index: session.index, total: session.order.length, playing: session.playing } : null;
}
