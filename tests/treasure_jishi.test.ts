/**
 * 宝物「济世」减伤 = **无限叠加 + 下一次受伤后全部清空**（用户 2026-10-17 口径）
 *
 * 官方文案（`src/data/treasures.ts`）：「主战法每造成一次恢复效果，效果目标**下一次受到伤害**减少 5%~15%，该效果可叠加」。
 * 口径（用户 2026-10-17 明确）：**可无限叠加**；**下一次受到伤害后清空**（那一次伤害仍照常吃满所有层数）；**只覆盖一次攻击**。
 * 实现：`applyTreasureHealOnTarget` 施加的 `damage_reduce` 带 `consumeOnHurt: true` →
 * `applyDamage` 在扣兵后调用 `consumeNextHitReduce` 把该标记的层数**全部**清空（本次伤害的 sumReduce 早已计入）。
 *
 * 反例守卫：同为宝物词条的【不屈】（`hurt_stack`，官方「本回合受到所有伤害降低」）**不是**「下一次」语义 → 不得被这套清空逻辑误伤。
 */
import { describe, it, expect } from 'vitest';
import { applyDamage, inflictStatus, recoverTroops, sumReduce, type CombatContext } from '../src/engine/action';
import type { BattleEvent, CreateStatus, General, Position, Skill, Status, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

function dummyUnit(id: string, position: Position, extra: Partial<General> = {}, side: 'my' | 'enemy' = 'my'): UnitState {
  const g: General = {
    id, name: id, rarity: '5星', cost: 3, faction: '吴', tags: [],
    mutualExclusionGroup: null, troopType: 'archer', position,
    attack: 100, defense: 100, strategy: 100, speed: 50, attackRange: 3, maxTroops: 10000,
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

/** 宝物「济世」在携带者身上登记的状态（`treasure:affix:济世` 前缀，`applyTreasureEffects` 构造后即此形状） */
const JISHI: CreateStatus = { type: 'heal_trigger_reduce', rate: 0.05, duration: 999 };

const jishiLayers = (u: UnitState) =>
  u.statuses.filter((s): s is Extract<Status, { type: 'damage_reduce' }> =>
    s.type === 'damage_reduce' && s.consumeOnHurt === true,
  );

const expiredEvents = (events: BattleEvent[]) =>
  events.filter((e) => e.type === 'status_expired' && e.statusType === 'damage_reduce').length;

describe('宝物「济世」：无限叠加 + 下一次受伤后清空', () => {
  it('① 每造成一次恢复叠 1 层（无限叠加）：3 次恢复 = 3 条 5% → sumReduce 0.15', () => {
    const caster = dummyUnit('lusu', '大营');
    const target = dummyUnit('ally', '前锋');
    target.troops = 9000;
    const ctx = makeCtx([caster, target], [dummyUnit('foe', '前锋', {}, 'enemy')]);
    inflictStatus(ctx, caster, JISHI, 'passive', 'treasure:affix:济世', caster.general.id);

    for (let i = 0; i < 3; i += 1) recoverTroops(ctx, target, 300, caster);

    expect(jishiLayers(target)).toHaveLength(3);
    expect(sumReduce(ctx, target)).toBeCloseTo(0.15, 5);
  });

  it('② 受到下一次伤害后**全部**层数清空（本次伤害仍吃满：扣兵前 sumReduce 已达 0.15）', () => {
    const caster = dummyUnit('lusu', '大营');
    const target = dummyUnit('ally', '前锋');
    target.troops = 9000;
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster, target], [foe]);
    inflictStatus(ctx, caster, JISHI, 'passive', 'treasure:affix:济世', caster.general.id);
    for (let i = 0; i < 3; i += 1) recoverTroops(ctx, target, 300, caster);

    const before = sumReduce(ctx, target); // 0.15：这一次伤害生效的减伤
    applyDamage(ctx, target, 500, foe, 'physical', 'skill');

    expect(before).toBeCloseTo(0.15, 5);
    expect(jishiLayers(target)).toHaveLength(0);
    expect(sumReduce(ctx, target)).toBe(0);
    expect(expiredEvents(ctx.events)).toBe(3);
  });

  it('③ 清空后再受伤不会复活、也不会重复发 status_expired', () => {
    const caster = dummyUnit('lusu', '大营');
    const target = dummyUnit('ally', '前锋');
    target.troops = 9000;
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster, target], [foe]);
    inflictStatus(ctx, caster, JISHI, 'passive', 'treasure:affix:济世', caster.general.id);
    recoverTroops(ctx, target, 300, caster);
    applyDamage(ctx, target, 500, foe, 'physical', 'skill');
    const expiredAfterFirst = expiredEvents(ctx.events);

    applyDamage(ctx, target, 500, foe, 'physical', 'skill');

    expect(jishiLayers(target)).toHaveLength(0);
    expect(sumReduce(ctx, target)).toBe(0);
    expect(expiredEvents(ctx.events)).toBe(expiredAfterFirst);
  });

  it('④ 新一轮恢复重新叠层：清空后 1 次恢复 = 1 条 5%（不是刷新成 5%）', () => {
    const caster = dummyUnit('lusu', '大营');
    const target = dummyUnit('ally', '前锋');
    target.troops = 8000;
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([caster, target], [foe]);
    inflictStatus(ctx, caster, JISHI, 'passive', 'treasure:affix:济世', caster.general.id);
    recoverTroops(ctx, target, 300, caster);
    recoverTroops(ctx, target, 300, caster);
    applyDamage(ctx, target, 500, foe, 'physical', 'skill');
    recoverTroops(ctx, target, 300, caster);

    expect(jishiLayers(target)).toHaveLength(1);
    expect(sumReduce(ctx, target)).toBeCloseTo(0.05, 5);
  });

  it('反例守卫：【不屈】（hurt_stack·本回合语义）不受清空影响', () => {
    const target = dummyUnit('target', '前锋');
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([target], [foe]);
    inflictStatus(
      ctx,
      target,
      { type: 'hurt_stack', mode: 'reduce', perStack: 0.09, maxStacks: 10, duration: 999 },
      'passive',
      'treasure:affix:不屈',
      target.general.id,
    );
    // 先叠 2 层（每次受伤后 +1；这里直接推到 2 层以简化）
    const st = target.statuses.find((s): s is Extract<Status, { type: 'hurt_stack' }> => s.type === 'hurt_stack')!;
    st.stacks = 2;

    applyDamage(ctx, target, 500, foe, 'physical', 'skill');

    const after = target.statuses.find((s): s is Extract<Status, { type: 'hurt_stack' }> => s.type === 'hurt_stack');
    expect(after).toBeDefined();
    expect(after!.stacks).toBeGreaterThan(0);
  });
});
