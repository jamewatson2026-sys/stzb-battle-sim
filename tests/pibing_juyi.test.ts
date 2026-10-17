/**
 * 疲兵沮意（XP陆逊）· 避锐层数减伤 —— 消耗式层数 + 增减伤池口径回归。
 *
 * 口径（用户 2026-10-16 拍板 A 案 + 2026-10-17 修「独立乘区」）：
 *   ① 每回合开始时避锐**刷新为 2 层**（上限 maxStacks），**不跨回合累加**；
 *   ② 每次受到伤害**消耗 1 层**，该次伤害只吃**一层**的减伤（不按层数叠加）；
 *   ③ 减伤分两档（客户端是两个独立机制位 522 受攻击伤害降低 / 524 受策略攻击伤害降低）：
 *      攻击伤害吃 perStackRate、策略伤害吃 perStackRateStrategy；
 *   ④ **减伤属增减伤字段**（`buffMult` 单一总和池 `max(10%, 1+Σ增伤−Σ减伤)`），不是独立乘区：
 *      `sumReduce` 计入该层档位、`collectDamageModifiers` 归因（reduce 里 skillName='避锐'）并打
 *      `avoidUnitId`；applyDamage 见到 `avoidUnitId` 只扣层数、不再乘算。非池化路径（DoT 冻结跳伤 /
 *      伤害分摊 / 延迟结算 / 直调）没有该标记，保留旧口径单独乘算（下方 ②③ 用直调覆盖回退分支）。
 *
 * dummyUnit / makeCtx 拷自 tests/attack_scale.test.ts（同款最小上下文）。
 */
import { describe, it, expect } from 'vitest';
import { applyDamage, avoidChargeRateOf, inflictStatus, sumReduce, type CombatContext } from '../src/engine/action';
import { buffMult } from '../src/engine/formulas';
import type { BattleEvent, CreateStatus, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { runBattle } from '../src/engine/combat';
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

  it('④ 增减伤池：sumReduce 计入避锐档位（攻击/策略分档），与增伤加算而非独立乘算', () => {
    const caster = dummyUnit('caster', '前锋');
    const holder = dummyUnit('holder', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster, holder], [foe]);
    inflictStatus(ctx, holder, AVOID, 'command', 'pibing_juyi', caster.general.id);

    const physHit = { damageSource: 'skill' as const, damageType: 'physical' as const, skillType: 'active' as const };
    const stratHit = { ...physHit, damageType: 'strategy' as const };
    expect(avoidChargeRateOf(holder, physHit)).toBeCloseTo(0.1, 10);
    expect(avoidChargeRateOf(holder, stratHit)).toBeCloseTo(0.4, 10);
    expect(sumReduce(ctx, holder, physHit, foe)).toBeCloseTo(0.1, 10);
    expect(sumReduce(ctx, holder, stratHit, foe)).toBeCloseTo(0.4, 10);

    // 受到伤害提高 20%（taken）与避锐 10% **加算**：1 + 0.2 − 0.1 = 1.1；
    // 若是旧口径「独立乘区」则是 1.2 × 0.9 = 1.08。
    expect(buffMult(1, 1.2, sumReduce(ctx, holder, physHit, foe))).toBeCloseTo(1.1, 10);

    // 10% 伤害下限：减伤合计超过 90% 时钳到 0.1（单一总和模型）
    expect(buffMult(1, 1, 0.95)).toBe(0.1);
  });

  it('④ applyDamage：带 avoidUnitId 的伤害已在池内结算 → 只消耗 1 层，不再二次乘算', () => {
    const caster = dummyUnit('caster', '前锋');
    const holder = dummyUnit('holder', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster, holder], [foe]);
    inflictStatus(ctx, holder, AVOID, 'command', 'pibing_juyi', caster.general.id);

    // 真实伤害路径由 collectDamageModifiers 产出该标记（此处手工构造等价归因）
    const mods = {
      caused: [],
      taken: [],
      reduce: [{ unitId: caster.general.id, skillId: 'pibing_juyi', skillName: '避锐', rate: 0.1, direction: 'reduce' as const }],
      avoidUnitId: holder.general.id,
    };
    applyDamage(ctx, holder, 100, foe, 'physical', 'skill', mods);
    expect(holder.troops).toBe(10000 - 100); // 已入池：不再 ×0.9
    expect(avoidOf(holder)?.stacks).toBe(1);
  });

  it('④ 战报取证：真实战斗里命中我方（避锐携带者）的伤害事件在增减伤归因中带「避锐」', () => {
    const plain = (id: string, position: Position): General => ({
      id, name: id, rarity: '4星', cost: 1, faction: '汉', tags: [], mutualExclusionGroup: null,
      troopType: 'infantry', position, attack: 90, defense: 90, strategy: 70, speed: 50,
      attackRange: 2, maxTroops: 9000, mainSkillName: '', skillDesc: '', activeSkillIds: [],
      passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [], morale: 100,
    });
    // XP陆逊（h791 已下架、无 panel 记录 → 此处直接按战法槽装配）带疲兵沮意：
    // 一类指挥 prep，为我军群体 2 人每回合 +2 层避锐。
    const luxun: General = {
      ...plain('m-back', '大营'),
      strategy: 100,
      mainSkillId: 'pibing_juyi',
      mainSkillName: '疲兵沮意',
      commandSkillIds: ['pibing_juyi'],
    };

    const { events } = runBattle({
      myTeam: [plain('m-front', '前锋'), plain('m-mid', '中军'), luxun],
      enemyTeam: [plain('e-front', '前锋'), plain('e-mid', '中军'), plain('e-back', '大营')],
      seed: 20261017,
      maxRounds: 8,
    });

    const hits = events.filter(
      (ev): ev is Extract<BattleEvent, { type: 'damage' | 'attack_hit' | 'split_damage' }> =>
        (ev.type === 'damage' || ev.type === 'attack_hit' || ev.type === 'split_damage') &&
        (ev.modifiers?.reduce.some((s) => s.skillName === '避锐') ?? false)
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const ev of hits) {
      const mods = ev.modifiers!;
      // 归因里的避锐必须标记「已入池」，且归属本次受击者
      expect(mods.avoidUnitId).toBe(ev.targetId);
      const avoid = mods.reduce.find((s) => s.skillName === '避锐');
      expect(avoid?.skillId).toBe('pibing_juyi');
      expect(avoid?.direction).toBe('reduce');
      expect(avoid!.rate).toBeGreaterThan(0);
    }
  });
});
