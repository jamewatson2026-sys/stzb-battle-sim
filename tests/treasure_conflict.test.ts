/**
 * 宝物 / 陈寿特性「与任何来源都不冲突」的**对称性**（2026-10-17 报障钉死）
 *
 * 报障：鲁肃【同仇敌忾】（被动·每层减伤 3%）触发时，战报出现
 * 「鲁肃 减伤冲突，数值取较高 0.05」「XP周瑜 减伤冲突，数值取较高 0.05」——
 * 因为两人身上带着宝物词条「济世」产生的一条 `damage_reduce 5%`（`treasure:affix:济世`）。
 * 原实现只在**宝物作为施加方**时跳过冲突；宝物作为**既有状态**时仍参与 `sameType` 判定，
 * 于是战法的叠层减伤被「取较高」吞掉，永远叠不上去。
 *
 * 口径：宝物/陈寿特性的状态双向都不参与冲突 —— 既不被别人冲突，也不去冲突别人；
 * 两者都进同一个增减伤加算池（`sumReduce`）。
 */
import { describe, it, expect } from 'vitest';
import { inflictStatus, sumReduce } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';

function makeUnit(id: string, side: 'my' | 'enemy' = 'my'): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '吴',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'archer',
      position: '前锋',
      attack: 100,
      defense: 100,
      strategy: 100,
      speed: 50,
      attackRange: 3,
      maxTroops: 10000,
      mainSkillName: '',
      skillDesc: '',
      activeSkillIds: [],
      passiveSkillIds: [],
      commandSkillIds: [],
      pursuitSkillIds: [],
      morale: 100,
    },
    side,
    troops: 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  } as unknown as UnitState;
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(1),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  } as unknown as CombatContext;
}

const reduceCount = (u: UnitState) => u.statuses.filter((s) => s.type === 'damage_reduce').length;

describe('宝物 / 陈寿特性减伤不参与冲突判定（双向）', () => {
  it('济世 5%（宝物）在前、同仇敌忾 3%（被动战法）在后 → 共存，池 8%', () => {
    const ctx = makeCtx();
    const lushu = makeUnit('lu_su');
    ctx.myTeam = [lushu];

    // 宝物「济世」：被恢复者获得一条「受到伤害降低」（treasure 来源）
    inflictStatus(ctx, lushu, { type: 'damage_reduce', rate: 0.05, duration: 999, stack: true }, 'passive', 'treasure:affix:济世', 'lu_su');
    // 同仇敌忾：同类型（passive）、同分类（全域）的另一来源
    inflictStatus(ctx, lushu, { type: 'damage_reduce', rate: 0.03, duration: 999, stack: true }, 'passive', 'tongchou_dikai', 'lu_su');

    expect(ctx.events.filter((e) => e.type === 'status_conflict')).toHaveLength(0);
    expect(reduceCount(lushu)).toBe(2);
    expect(sumReduce(ctx, lushu)).toBeCloseTo(0.08, 10);
  });

  it('陈寿特性减伤（chenshou 来源）在前、战法减伤在后 → 共存，池相加', () => {
    const ctx = makeCtx();
    const unit = makeUnit('u');
    ctx.myTeam = [unit];

    inflictStatus(ctx, unit, { type: 'damage_reduce', rate: 0.04, duration: 999 }, 'passive', 'chenshou:cs_106004', 'u');
    inflictStatus(ctx, unit, { type: 'damage_reduce', rate: 0.11, duration: 999, stack: true }, 'passive', 'bubu_weiyin', 'u');

    expect(ctx.events.filter((e) => e.type === 'status_conflict')).toHaveLength(0);
    expect(reduceCount(unit)).toBe(2);
    expect(sumReduce(ctx, unit)).toBeCloseTo(0.15, 10);
  });

  it('回归：两条普通被动战法减伤仍然「同类型不同战法 → 数值取较高」', () => {
    const ctx = makeCtx();
    const unit = makeUnit('u');
    ctx.myTeam = [unit];

    inflictStatus(ctx, unit, { type: 'damage_reduce', rate: 0.11, duration: 999, stack: true }, 'passive', 'bubu_weiyin', 'u');
    inflictStatus(ctx, unit, { type: 'damage_reduce', rate: 0.18, duration: 999 }, 'passive', 'tiebi', 'u');

    const conflicts = ctx.events.filter((e) => e.type === 'status_conflict');
    expect(conflicts).toHaveLength(1);
    expect(reduceCount(unit)).toBe(1);
    expect(sumReduce(ctx, unit)).toBeCloseTo(0.18, 10);
  });

  it('同仇敌忾同源重复施加仍然累加层数（stack:true 走同源，不受本次改动影响）', () => {
    const ctx = makeCtx();
    const unit = makeUnit('u');
    ctx.myTeam = [unit];

    inflictStatus(ctx, unit, { type: 'damage_reduce', rate: 0.03, duration: 999, stack: true }, 'passive', 'tongchou_dikai', 'u');
    inflictStatus(ctx, unit, { type: 'damage_reduce', rate: 0.03, duration: 999, stack: true }, 'passive', 'tongchou_dikai', 'u');

    expect(ctx.events.filter((e) => e.type === 'status_conflict')).toHaveLength(0);
    expect(reduceCount(unit)).toBe(1);
    expect(sumReduce(ctx, unit)).toBeCloseTo(0.06, 10);
  });
});
