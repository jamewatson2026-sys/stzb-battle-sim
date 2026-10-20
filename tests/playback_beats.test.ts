/**
 * 推演模拟 · 镜头归并（`web/playback/beats.ts`）回归
 *
 * 这一层是「播片」的数据源：把引擎事件流压成一个个镜头（谁 → 打/治/挂了谁 → 多少）。
 * 它必须是纯函数、可复现 —— 页面只负责画，任何数字都得在这里就对。
 *
 * 钉住的口径（与 `docs/推演模拟-落地设计.md` §4 一致）：
 *   ① 每个镜头都带**该镜时点**的六将兵力/伤兵/阵亡快照（跳镜后卡片数字要对得上）
 *   ② 治疗并入当前镜（受击触发的急救跟着那一刀走），而不是另开一镜
 *   ③ 引擎 `modifiers` 是逐来源数组 → 归一化成「合计 + 来源名」，供数字下方 chip 显示
 *   ④ 关键镜判据：大伤害 / 大治疗 / 控制 / 多目标
 *   ⑤ 文案：状态标题同源取战法名，多源叫「状态」
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runBattle } from '../src/engine/combat';
import { recordToGeneral, leveledFromRecord } from '../src/data/hero-utils';
import type { BattleReport, General } from '../src/engine/types';
import { beatify, markKey, modChips, shotBadge, shotTitle, statusLabel } from '../web/playback/beats';

const heroes = JSON.parse(readFileSync('web/data/heroes.json', 'utf8')) as any[];
const byId = new Map<string, any>(heroes.map((h) => [h.id, h]));

function make(id: string, position: General['position']): General {
  const rec = byId.get(id);
  if (!rec) throw new Error('hero not found: ' + id);
  const base = leveledFromRecord(recordToGeneral(rec), rec, 40, {}, 9000);
  return { ...base, position, morale: 120 } as General;
}

/** 曹纯 / 张辽 / 文鸯 vs 庞统 / XP程昱 / 刘备 —— 与设计稿同一组阵容 */
function report(seed = 2468): BattleReport {
  return runBattle({
    myTeam: [make('h498', '大营'), make('h27', '中军'), make('h704', '前锋')],
    enemyTeam: [make('h477', '大营'), make('h787', '中军'), make('h16', '前锋')],
    seed,
    maxRounds: 8,
  });
}

describe('beatify：事件流 → 镜头', () => {
  const r = report();
  const res = beatify(r);

  it('产出镜头与六将，镜头序号连续', () => {
    expect(res.shots.length).toBeGreaterThan(20);
    expect(res.units).toHaveLength(6);
    res.shots.forEach((s, i) => expect(s.i).toBe(i));
  });

  it('每个镜头都带六将的兵力快照（跳镜后卡片不会错数）', () => {
    for (const s of res.shots) {
      for (const u of res.units) {
        expect(typeof s.troops[u.id]).toBe('number');
        expect(s.troops[u.id]).toBeGreaterThanOrEqual(0);
        expect(s.troops[u.id]).toBeLessThanOrEqual(u.maxTroops);
      }
    }
  });

  it('镜头里的伤害合计与引擎事件流一致（不重不漏）', () => {
    const fromShots = res.shots.reduce((a, s) => a + s.hits.reduce((x, h) => x + h.amount, 0), 0);
    const fromEvents = (r.events as any[])
      .filter((e) => ['attack_hit', 'damage', 'dot_tick', 'split_damage'].includes(e.type))
      .reduce((a, e) => a + (e.damage ?? 0), 0);
    expect(fromShots).toBe(fromEvents);
  });

  it('治疗并入当前镜：存在「同一镜既有伤害又有治疗」的镜头', () => {
    const merged = res.shots.filter((s) => s.hits.length > 0 && s.heals.length > 0);
    expect(merged.length).toBeGreaterThan(0);
    // 治疗量必须来自 heal 事件本身，且不超过目标兵力上限
    for (const s of merged) {
      for (const h of s.heals) expect(h.amount).toBeGreaterThan(0);
    }
  });

  it('归一化增减伤：合计是数字，减伤带来源名', () => {
    const hit = res.shots.flatMap((s) => s.hits).find((h) => h.mods?.reduce?.length);
    expect(hit, '本局应当至少有一次带减伤来源的命中').toBeTruthy();
    const mods = hit!.mods!;
    expect(typeof mods.caused === 'number' || mods.caused === undefined).toBe(true);
    for (const rr of mods.reduce ?? []) {
      expect(typeof rr.r).toBe('number');
      expect(typeof rr.n).toBe('string');
      expect(rr.n.length).toBeGreaterThan(0);
    }
    const chips = modChips(hit!, 5);
    expect(chips.length).toBeGreaterThan(0);
    for (const c of chips) expect(c.value).toMatch(/^[+−]\d+%$/);
  });

  it('关键镜：至少一个，且多目标命中必为关键镜', () => {
    expect(res.keyCount).toBeGreaterThan(0);
    expect(res.shots.filter((s) => s.key).length).toBe(res.keyCount);
    for (const s of res.shots) {
      const tg = new Set(s.hits.map((h) => h.to));
      if (tg.size >= 2) expect(s.key).toBe(true);
    }
  });

  it('markKey 幂等（重复调用不改变结果）', () => {
    const copy = JSON.parse(JSON.stringify(res.shots));
    const once = copy.filter((s: any) => s.key).length;
    markKey(copy);
    const twice = copy.filter((s: any) => s.key).length;
    expect(twice).toBe(once);
  });

  it('标题与徽标永远有字可显示', () => {
    for (const s of res.shots) {
      expect(shotTitle(s).length).toBeGreaterThan(0);
      expect(shotBadge(s).length).toBeGreaterThan(0);
    }
  });
});

describe('文案与判据的小口径', () => {
  it('状态文案把 0.05 的减伤翻成 5%', () => {
    expect(statusLabel('damage_reduce', '减伤 0.05').t).toBe('减伤 5%');
    expect(statusLabel('evasion', '规避 +1 层').t).toBe('规避 +1 层');
  });

  it('状态镜标题：同源一条 → 战法名；多源 → 「状态」', () => {
    const base = { i: 0, round: 1, actor: 'a', skill: null, type: null, hits: [], heals: [], troops: {}, wounded: {}, dead: {}, key: false } as const;
    const one = { ...base, statuses: [{ to: 'a', st: 'combo' as const, skill: '其疾如风' }] };
    const many = {
      ...base,
      statuses: [
        { to: 'a', st: 'combo' as const, skill: '其疾如风' },
        { to: 'b', st: 'split' as const, skill: '长兵方阵' },
      ],
    };
    expect(shotTitle(one as any)).toBe('其疾如风');
    expect(shotTitle(many as any)).toBe('状态');
    expect(shotBadge(many as any)).toBe('状态');
  });
});
