/**
 * 出手顺序：每回合按当前生效速度重排（含加点 / 速度增益），同速站位前锋>中军>大营。
 * 局外加点后的面板速度必须进入局内排序（卫瓘加点快过吕蒙 → 卫瓘先手）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runBattle, buildTurnOrder, buildPriorityOrder, buildTurnOrderTieBreaks } from '../src/engine/combat';
import { inflictStatus, effectiveStat, type CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, level40 } from '../src/data/heroes';

beforeAll(async () => {
  await initHeroDB();
});

function dummy(id: string, position: Position, speed: number, troops = 9000): General {
  return {
    id,
    name: id,
    rarity: '4星',
    cost: 1,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 50,
    defense: 80,
    strategy: 60,
    speed,
    attackRange: 2,
    maxTroops: troops,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

function toUnit(g: General, side: 'my' | 'enemy' = 'my'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

/** 每回合首次 unit_act_start 出现顺序 = 该回合实际出手顺序 */
function uniqueActOrder(events: BattleEvent[], round: number): string[] {
  const start = events.findIndex((e) => e.type === 'round_start' && e.round === round);
  if (start < 0) return [];
  const end = events.findIndex((e, i) => i > start && e.type === 'round_start');
  const slice = events.slice(start, end < 0 ? undefined : end);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const e of slice) {
    if (e.type !== 'unit_act_start') continue;
    if (seen.has(e.unitId)) continue;
    seen.add(e.unitId);
    order.push(e.unitId);
  }
  return order;
}

describe('每回合按当前速度排序', () => {
  it('加点后面板速度进入排序：卫瓘速度点超过吕蒙则每回合都先于吕蒙行动', () => {
    const weiguan = level40({ ...HERO_REGISTRY.weiguan }, { speed: 40 });
    weiguan.position = '中军';
    const lvmeng = level40({ ...HERO_REGISTRY.lvmeng }, { speed: 0 });
    lvmeng.position = '大营';
    expect(weiguan.speed).toBeGreaterThan(lvmeng.speed);

    const report = runBattle({
      seed: 7,
      maxRounds: 8,
      myTeam: [weiguan, lvmeng],
      enemyTeam: [dummy('e1', '前锋', 10), dummy('e2', '中军', 10), dummy('e3', '大营', 10)],
    });

    for (let r = 1; r <= report.rounds; r++) {
      const order = uniqueActOrder(report.events, r);
      const wi = order.indexOf(weiguan.id);
      const li = order.indexOf(lvmeng.id);
      if (wi < 0 || li < 0) continue; // 已阵亡则本回合不再出现
      expect(wi, `第 ${r} 回合卫瓘应排在吕蒙前面：${order.join(' > ')}`).toBeLessThan(li);
    }
  });

  it('round_start.turnOrder 为当回合按当前速度排出的行动序', () => {
    const fast = dummy('fast', '大营', 120);
    const slow = dummy('slow', '前锋', 40);
    const report = runBattle({
      seed: 3,
      maxRounds: 2,
      myTeam: [fast, slow],
      enemyTeam: [dummy('e1', '前锋', 10), dummy('e2', '中军', 10), dummy('e3', '大营', 10)],
    });
    const r1 = report.events.find((e): e is Extract<BattleEvent, { type: 'round_start' }> => e.type === 'round_start' && e.round === 1);
    expect(r1?.turnOrder?.[0]).toBe('fast');
    expect(uniqueActOrder(report.events, 1)[0]).toBe('fast');
  });

  it('速度增益在下一回合重排中生效：慢将叠速度后超过快将则下一回合先手', () => {
    const slow = toUnit(dummy('slow', '前锋', 60));
    const fast = toUnit(dummy('fast', '中军', 80), 'enemy');
    const skills = new Map<string, Skill>(Object.entries(SKILL_REGISTRY));

    expect(buildPriorityOrder([slow, fast], 1, skills)[0].general.id).toBe('fast');

    const ctx: CombatContext = {
      rng: new Rng(1),
      myTeam: [slow],
      enemyTeam: [fast],
      events: [],
      skills,
      lockedCommands: [],
      stackBuffs: [],
      currentRound: 1,
    };
    inflictStatus(ctx, slow, { type: 'speed_buff', amount: 50, duration: 2 }, 'active', 'test_speed', slow.general.id);

    expect(buildTurnOrder([slow, fast])[0].general.id).toBe('slow');
    expect(buildPriorityOrder([slow, fast], 2, skills)[0].general.id).toBe('slow');
  });
});

describe('同速同站位：中立 tie-break（不再固定红方先手）', () => {
  const skills = () => new Map<string, Skill>(Object.entries(SKILL_REGISTRY));

  it('buildTurnOrderTieBreaks 按种子确定、随种子变化（不消耗主 rng）', () => {
    const a = toUnit(dummy('a', '前锋', 100), 'my');
    const b = toUnit(dummy('b', '前锋', 100), 'enemy');

    const auto = buildTurnOrderTieBreaks([a, b], 7);
    expect(auto.size).toBe(2);
    expect(new Set(auto.values()).size).toBe(2);
    expect(buildTurnOrderTieBreaks([a, b], 7).get(a)).toBe(auto.get(a));

    const winners = new Set<string>();
    for (let seed = 1; seed <= 32; seed++) {
      const tie = buildTurnOrderTieBreaks([a, b], seed);
      winners.add((tie.get(a) ?? 0) < (tie.get(b) ?? 0) ? 'a' : 'b');
    }
    expect(winners.size).toBe(2); // 镜像队不再永远红方先出手
  });

  it('buildTurnOrder / buildPriorityOrder 用 tieBreak 决定，且与输入顺序无关', () => {
    const a = toUnit(dummy('a', '前锋', 100), 'my');
    const b = toUnit(dummy('b', '前锋', 100), 'enemy');
    const tie = new Map<UnitState, number>([[a, 0.2], [b, 0.8]]);

    expect(buildTurnOrder([a, b], tie).map((u) => u.general.id)).toEqual(['a', 'b']);
    expect(buildTurnOrder([b, a], tie).map((u) => u.general.id)).toEqual(['a', 'b']);
    expect(buildPriorityOrder([a, b], 1, skills(), undefined, tie).map((u) => u.general.id)).toEqual(['a', 'b']);
    expect(buildPriorityOrder([b, a], 1, skills(), undefined, tie).map((u) => u.general.id)).toEqual(['a', 'b']);

    const tie2 = new Map<UnitState, number>([[a, 0.8], [b, 0.2]]);
    expect(buildTurnOrder([a, b], tie2).map((u) => u.general.id)).toEqual(['b', 'a']);
  });
});

describe('出手排序读「未过期」的速度状态', () => {
  it('remaining = 0 的速度增益不再影响排序（第 2 组状态滞后移除）', () => {
    const slow = toUnit(dummy('slow', '前锋', 90), 'my');
    const fast = toUnit(dummy('fast', '中军', 100), 'my');
    slow.statuses.push({
      type: 'speed_buff',
      amount: 50,
      duration: 2,
      sourceSkillType: 'active',
      sourceSkillId: 'test_speed',
      remaining: 0,
    } as unknown as UnitState['statuses'][number]);

    // 普通读（面板展示）仍按当前生效属性算 —— 状态未被移除
    expect(effectiveStat(slow, 'speed')).toBe(140);
    // 排序专用：remaining=0 视为已过期
    expect(effectiveStat(slow, 'speed', { ignoreExpired: true })).toBe(90);
    expect(buildTurnOrder([slow, fast])[0].general.id).toBe('fast');
  });
});

describe('长弓兵·先发只在防守方生效', () => {
  it('defenderSide 是自己才进先手组；缺省 = 无防守方不生效', () => {
    const archer = toUnit(dummy('archer', '前锋', 90), 'my');
    archer.general.secondaryTroop = '长弓兵';
    const other = toUnit(dummy('other', '前锋', 100), 'enemy');
    const skills = new Map<string, Skill>(Object.entries(SKILL_REGISTRY));

    // 我的长弓兵作为防守方 → 前 2 回合先手
    expect(buildPriorityOrder([archer, other], 1, skills, 'my')[0].general.id).toBe('archer');
    // 不是防守方 → 先发不生效，按速度
    expect(buildPriorityOrder([archer, other], 1, skills, 'enemy')[0].general.id).toBe('other');
    // 缺省（无防守方）→ 不生效
    expect(buildPriorityOrder([archer, other], 1, skills)[0].general.id).toBe('other');
    // 白衣死士（priorityOnlyDefender 未设）仍不限攻守
    const guard = toUnit(dummy('guard', '前锋', 90), 'my');
    guard.general.secondaryTroop = '白衣死士';
    expect(buildPriorityOrder([guard, other], 1, skills, 'enemy')[0].general.id).toBe('guard');
  });
});
