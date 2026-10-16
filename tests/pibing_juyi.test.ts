/**
 * 疲兵沮意（XP陆逊）· 避锐层数减伤 —— 消耗式口径回归。
 *
 * 口径（用户 2026-10-16 拍板，A 案）：
 *   ① 每回合开始时避锐**刷新为 2 层**（上限 maxStacks），**不跨回合累加**
 *      —— 旧实现是 `stacks += 2` 无上限累加，会让减伤变成常驻，已废止；
 *   ② 每次受到伤害**消耗 1 层**，该次伤害只吃**一层**的减伤（不按层数叠加）；
 *   ③ 减伤分两档（客户端是两个独立机制位）：攻击伤害吃 perStackRate、策略伤害吃 perStackRateStrategy。
 *
 * dummyUnit / makeCtx 拷自 tests/attack_scale.test.ts（同款最小上下文）。
 */
import { describe, it, expect } from 'vitest';
import { applyDamage, inflictStatus, type CombatContext } from '../src/engine/action';
import type { CreateStatus, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';

function dummyUnit(id: string, position: Position, extra: Partial<General> = {}, side: 'my' | 'enemy' = 'my'): UnitState {
  const g: General = {
    id, name: id, rarity: '4星', cost: 1, faction: '汉', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position,
    attack: 80, defense: 80, strategy: 80, speed: 50, attackRange: 2, maxTroops: 10000,
    mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
    commandSkillIds: [], pursuitSkillIds: [], morale: 100, ...extra,
  };
  return {
    general: g, side, troops: g.maxTroops, wounded: 0, totalDead: 0,
    alive: true, statuses: [], preparations: [], hasActedThisRound: false,
  };
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed), myTeam: my, enemyTeam: enemy, events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [], stackBuffs: [], currentRound: 1,
  };
}

const AVOID: CreateStatus = {
  type: 'avoid_charge',
  stacks: 2,
  maxStacks: 2,
  perStackRate: 0.1,
  perStackRateStrategy: 0.4, // 故意与攻击档不同，用来判定「按 damageType 分档取值」
  duration: 999,
};

const avoidOf = (u: UnitState): Extract<Status, { type: 'avoid_charge' }> | undefined =>
  u.statuses.find((s): s is Extract<Status, { type: 'avoid_charge' }> => s.type === 'avoid_charge');

describe('疲兵沮意 · 避锐（消耗式层数）', () => {
  it('① 同源重复施加 = 刷新为 2 层，不累加（旧实现会累成 4 层）', () => {
    const caster = dummyUnit('caster', '前锋');
    const holder = dummyUnit('holder', '前锋');
    const ctx = makeCtx([caster, holder], [dummyUnit('foe', '前锋', {}, 'enemy')]);

    inflictStatus(ctx, holder, AVOID, 'command', 'pibing_juyi', caster.general.id);
    expect(avoidOf(holder)?.stacks).toBe(2);

    // 第 2、3 回合各刷新一次：仍为 2（不是 4、6）
    inflictStatus(ctx, holder, AVOID, 'command', 'pibing_juyi', caster.general.id);
    inflictStatus(ctx, holder, AVOID, 'command', 'pibing_juyi', caster.general.id);
    expect(avoidOf(holder)?.stacks).toBe(2);
  });

  it('① 消耗后刷新 = 补满到 2 层（不是 1+2=3）', () => {
    const caster = dummyUnit('caster', '前锋');
    const holder = dummyUnit('holder', '前锋');
    const ctx = makeCtx([caster, holder], [dummyUnit('foe', '前锋', {}, 'enemy')]);

    inflictStatus(ctx, holder, AVOID, 'command', 'pibing_juyi', caster.general.id);
    applyDamage(ctx, holder, 100, dummyUnit('foe2', '前锋', {}, 'enemy'), 'physical', 'skill');
    expect(avoidOf(holder)?.stacks).toBe(1);

    inflictStatus(ctx, holder, AVOID, 'command', 'pibing_juyi', caster.general.id);
    expect(avoidOf(holder)?.stacks).toBe(2);
  });

  it('① maxStacks 封顶：配置超过上限时按上限取', () => {
    const caster = dummyUnit('caster', '前锋');
    const holder = dummyUnit('holder', '前锋');
    const ctx = makeCtx([caster, holder], [dummyUnit('foe', '前锋', {}, 'enemy')]);

    inflictStatus(ctx, holder, { ...AVOID, stacks: 99 }, 'command', 'pibing_juyi', caster.general.id);
    expect(avoidOf(holder)?.stacks).toBe(2);
  });

  it('② 每次受击只消耗 1 层，该次伤害只吃一层减伤（不叠加）', () => {
    const caster = dummyUnit('caster', '前锋');
    const holder = dummyUnit('holder', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster, holder], [foe]);

    inflictStatus(ctx, holder, AVOID, 'command', 'pibing_juyi', caster.general.id);

    // 攻击档 10%：扣兵 90
    applyDamage(ctx, holder, 100, foe, 'physical', 'skill');
    expect(holder.troops).toBe(10000 - 90);
    expect(avoidOf(holder)?.stacks).toBe(1);

    // 剩 1 层仍是 10%（不因层数变化而变），且消耗殆尽后移除
    applyDamage(ctx, holder, 100, foe, 'physical', 'skill');
    expect(holder.troops).toBe(10000 - 180);
    expect(avoidOf(holder)).toBeUndefined();

    // 层数耗尽 → 不再减伤
    applyDamage(ctx, holder, 100, foe, 'physical', 'skill');
    expect(holder.troops).toBe(10000 - 280);
  });

  it('③ 分档：策略伤害吃 perStackRateStrategy，攻击伤害吃 perStackRate', () => {
    const caster = dummyUnit('caster', '前锋');
    const physHolder = dummyUnit('phys', '前锋');
    const stratHolder = dummyUnit('strat', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster, physHolder, stratHolder], [foe]);

    inflictStatus(ctx, physHolder, AVOID, 'command', 'pibing_juyi', caster.general.id);
    inflictStatus(ctx, stratHolder, AVOID, 'command', 'pibing_juyi', caster.general.id);

    applyDamage(ctx, physHolder, 100, foe, 'physical', 'skill'); // 10% → 90
    applyDamage(ctx, stratHolder, 100, foe, 'strategy', 'skill'); // 40% → 60
    expect(physHolder.troops).toBe(10000 - 90);
    expect(stratHolder.troops).toBe(10000 - 60);
  });

  it('③ 缺省档位回退：未给 perStackRateStrategy 时策略伤害吃攻击档值', () => {
    const caster = dummyUnit('caster', '前锋');
    const holder = dummyUnit('holder', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster, holder], [foe]);

    const { perStackRateStrategy: _drop, ...noStrategy } = AVOID;
    inflictStatus(ctx, holder, noStrategy as CreateStatus, 'command', 'pibing_juyi', caster.general.id);
    applyDamage(ctx, holder, 100, foe, 'strategy', 'skill');
    expect(holder.troops).toBe(10000 - 90);
  });
});
