/**
 * 暴走（rampage）目标池契约（2026-10-18，用户报障后建立）。
 *
 * 用户口径（原话）：「暴走是使敌方敌我不分，普攻和主动战法都是距离内敌我随机选取，
 * 但实测普攻随机选取，主动战法却还是只打我方」。
 *
 * 根因：`executeSkillWithTargets` 的战法级目标池是三目链 `targetPool==='mixed' ? … : targetSide==='enemy' ? enemies : …
 * : rampage ? attackPool : …` —— 只要战法声明了 `targetSide`（绝大多数伤害 / 减益战法的写法），
 * `rampage` 分支永远走不到；段级 `out.targetSide` 的目标池同样无视暴走。
 *
 * 现口径（本文件守住）：
 *  ① 暴走者的**进攻侧**目标池 = 敌我全体（不含自己）——含战法级 `targetSide:'enemy'` 与段级 `out.targetSide:'enemy'`；
 *  ② 显式 `targetSide:'ally'`（治疗 / 增益）与纯增益战法（selfBuff 启发式）**不受影响**，仍作用于友军；
 *  ③ 未暴走时行为不变（只打敌方）。
 *
 * 断言全部确定性（固定种子 + `targetMode:'all'` 让目标池一次全出，不依赖随机抽签）。
 */
import { describe, it, expect } from 'vitest';
import { triggerActiveSkill, inflictStatus } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { General, Skill, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';

function general(id: string, patch: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '群',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'cavalry',
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
    ...patch,
  };
}

function unit(id: string, side: 'my' | 'enemy'): UnitState {
  return {
    general: general(id),
    side,
    troops: 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function ctxOf(my: UnitState[], enemy: UnitState[], seed = 7): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my,
    enemyTeam: enemy,
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  } as CombatContext;
}

/** 造 4 人场：施法者 A（我方） + 友军 B + 敌军 C/D；可选先给 A 挂暴走 */
function setup(rampaged: boolean) {
  const a = unit('A', 'my');
  const b = unit('B', 'my');
  const c = unit('C', 'enemy');
  const d = unit('D', 'enemy');
  const ctx = ctxOf([a, b], [c, d]);
  if (rampaged) inflictStatus(ctx, a, { type: 'rampage', duration: 3 }, 'active', 'test_rampage', 'X');
  return { ctx, a, b, c, d, enemies: [c, d], allies: [a, b], attackPool: [b, c, d] };
}

function damageTargets(ctx: CombatContext): string[] {
  return ctx.events
    .filter((e): e is Extract<typeof e, { type: 'damage' }> => e.type === 'damage')
    .map((e) => e.targetId);
}

function attackSkill(id: string, extra: Partial<Skill> = {}): Skill {
  return {
    id,
    name: id,
    type: 'active',
    prepare: false,
    range: 10,
    triggerRate: 1,
    targetMode: 'all',
    targetSide: 'enemy',
    tags: ['damage'],
    output: [{ kind: 'physical_damage', rate: 100 }],
    ...extra,
  } as Skill;
}

describe('暴走（rampage）目标池：主动战法同样敌我不分', () => {
  it('战法级 targetSide:enemy + 暴走 → 友军也会被打（用户报障的核心场景）', () => {
    const { ctx, a, b, enemies, allies, attackPool } = setup(true);
    const skill = attackSkill('t_active_enemy');
    ctx.skills.set(skill.id, skill);
    triggerActiveSkill(ctx, a, skill, enemies, allies, attackPool);

    const hits = damageTargets(ctx);
    expect(hits).toContain('C');
    expect(hits).toContain('D');
    expect(hits).toContain('B'); // 暴走：友军 B 进入目标池
    expect(hits).not.toContain('A'); // 不含自己
  });

  it('未暴走时同一战法只打敌方（回归守卫）', () => {
    const { ctx, a, b, enemies, allies, attackPool } = setup(false);
    const skill = attackSkill('t_active_enemy_plain');
    ctx.skills.set(skill.id, skill);
    triggerActiveSkill(ctx, a, skill, enemies, allies, attackPool);

    const hits = damageTargets(ctx);
    expect(new Set(hits)).toEqual(new Set(['C', 'D']));
  });

  it('段级 targetSide:enemy 覆盖（乱政式逐段选目标）在暴走时同样并入友军', () => {
    const { ctx, a, b, enemies, allies, attackPool } = setup(true);
    const skill = attackSkill('t_seg_enemy', {
      targetSide: undefined,
      targetMode: 'single',
      output: [
        { kind: 'inflict_status', targetSide: 'enemy', targetMode: 'all', status: { type: 'confusion', duration: 2 } },
      ],
    } as Partial<Skill>);
    ctx.skills.set(skill.id, skill);
    triggerActiveSkill(ctx, a, skill, enemies, allies, attackPool);

    const afflicted = ctx.events
      .filter((e): e is Extract<typeof e, { type: 'status_inflicted' }> => e.type === 'status_inflicted')
      .map((e) => e.unitId);
    expect(afflicted).toContain('B');
    expect(afflicted).toContain('C');
  });

  it('治疗 / 增益段（targetSide:ally）不受暴走影响，仍只作用于友军', () => {
    const { ctx, a, b, enemies, allies, attackPool } = setup(true);
    // 治疗需要有兵力缺口才会产生 heal 事件
    a.troops = 5000;
    b.troops = 5000;
    const skill = attackSkill('t_heal', {
      targetSide: undefined,
      targetMode: 'single',
      tags: ['heal'],
      output: [
        { kind: 'heal', targetSide: 'ally', targetMode: 'all', rate: 100, growthRate: 0 },
      ],
    } as Partial<Skill>);
    ctx.skills.set(skill.id, skill);
    triggerActiveSkill(ctx, a, skill, enemies, allies, attackPool);

    const healed = ctx.events
      .filter((e): e is Extract<typeof e, { type: 'heal' }> => e.type === 'heal')
      .map((e) => e.targetId);
    expect(healed.length).toBeGreaterThan(0);
    expect(healed.every((id) => id === 'A' || id === 'B')).toBe(true);
  });
});
