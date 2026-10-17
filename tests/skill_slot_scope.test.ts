/**
 * 战法**槽**级作用范围契约（2026-10-06，法正/田丰报障后建立）。
 *
 * ① `trigger_boost.skillIds`：只提升被点名的战法槽（尽言直谏「随机令友方群体 2 个主动战法」）
 * ② `trigger_boost.mainSkillOnly` + `skillTypes:['active']`：只提升**主动主战法**（难知如阴）
 * ③ `jump_prep.mainSkillOnly`：只有**主战法**跳过准备（难知如阴 / 胜兵求战「需要准备的**主战法**」）
 * ④ 二类指挥 `retargetOnAct` + `targetModeByRound` + `excludeSelfTarget`：按回合重选目标
 *    （难知如阴：第 1 回合友军单体、第 3/5/7 回合友军全体）
 * ⑤ `allySlotBoost` 抽的是**战法槽**（2/3 个），不是 2/3 个单位
 *
 * 全部为机制契约断言（直接调 triggerActiveSkill / triggerRoundCommandOnAct），不依赖战法发动率 RNG 结果。
 */
import { describe, it, expect } from 'vitest';
import { inflictStatus, triggerActiveSkill, triggerRoundCommandOnAct } from '../src/engine/action';
import type { CombatContext } from '../src/engine/action';
import type { General, Skill, Status, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

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

function unit(id: string, side: 'my' | 'enemy', patch: Partial<General> = {}): UnitState {
  return {
    general: general(id, patch),
    side,
    troops: 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function ctxOf(my: UnitState[], enemy: UnitState[], seed = 1): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my,
    enemyTeam: enemy,
    events: [],
    skills: new Map(),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 普通主动战法（无输出段，纯发动率载体） */
function activeSkill(id: string, prepare = false): Skill {
  return prepare
    ? { id, name: id, type: 'active', prepare: true, range: 3, triggerRate: 1, targetMode: 'single', targetSide: 'enemy', tags: [], output: [] }
    : { id, name: id, type: 'active', prepare: false, range: 3, triggerRate: 0.35, targetMode: 'single', targetSide: 'enemy', tags: [], output: [] };
}

/** 某次主动判定的生效基础率（trigger_boost 已并入，士气前） */
function baseRateOf(ctx: CombatContext, skillId: string): number | undefined {
  const ev = ctx.events.find((e) => e.type === 'skill_trigger' && e.skillId === skillId);
  return ev && ev.type === 'skill_trigger' ? ev.baseRate : undefined;
}

describe('战法槽级作用范围', () => {
  it('trigger_boost.skillIds：只提升被点名的战法槽', () => {
    const a = unit('a', 'my', { activeSkillIds: ['aa', 'bb'], mainSkillId: 'aa' });
    const e = unit('e', 'enemy');
    const ctx = ctxOf([a], [e]);
    ctx.skills.set('aa', activeSkill('aa'));
    ctx.skills.set('bb', activeSkill('bb'));
    inflictStatus(
      ctx,
      a,
      { type: 'trigger_boost', rate: 1.2, duration: 1, additive: true, skillTypes: ['active'], skillIds: ['bb'] },
      'command',
      'jinyan_zhijian',
      a.general.id
    );
    triggerActiveSkill(ctx, a, ctx.skills.get('aa')!, [e], [a], [e]);
    triggerActiveSkill(ctx, a, ctx.skills.get('bb')!, [e], [a], [e]);
    expect(baseRateOf(ctx, 'aa')).toBe(35); // 未被点名的槽位
    expect(baseRateOf(ctx, 'bb')).toBe(155); // 35 + 120
  });

  it('trigger_boost.mainSkillOnly：只提升携带者的主动主战法，装配的主动战法不吃', () => {
    const a = unit('a', 'my', { activeSkillIds: ['main_active', 'equipped_active'], mainSkillId: 'main_active' });
    const e = unit('e', 'enemy');
    const ctx = ctxOf([a], [e]);
    ctx.skills.set('main_active', activeSkill('main_active'));
    ctx.skills.set('equipped_active', activeSkill('equipped_active'));
    inflictStatus(
      ctx,
      a,
      // 难知如阴：主动主战法发动率 +120%（与基础率直接相加）
      { type: 'trigger_boost', rate: 1.2, duration: 1, additive: true, mainSkillOnly: true, skillTypes: ['active'] },
      'command',
      'nanzhi_ruyin',
      a.general.id
    );
    triggerActiveSkill(ctx, a, ctx.skills.get('main_active')!, [e], [a], [e]);
    triggerActiveSkill(ctx, a, ctx.skills.get('equipped_active')!, [e], [a], [e]);
    expect(baseRateOf(ctx, 'main_active')).toBe(155);
    expect(baseRateOf(ctx, 'equipped_active')).toBe(35);
  });

  it('jump_prep.mainSkillOnly：只有主战法跳过准备，装配的准备主动照常进入准备', () => {
    const a = unit('a', 'my', { activeSkillIds: ['main_prep', 'equipped_prep'], mainSkillId: 'main_prep' });
    const e = unit('e', 'enemy');
    const ctx = ctxOf([a], [e]);
    ctx.skills.set('main_prep', activeSkill('main_prep', true));
    ctx.skills.set('equipped_prep', activeSkill('equipped_prep', true));
    inflictStatus(ctx, a, { type: 'jump_prep', rate: 1, duration: 999, mainSkillOnly: true }, 'command', 'nanzhi_ruyin', a.general.id);

    triggerActiveSkill(ctx, a, ctx.skills.get('equipped_prep')!, [e], [a], [e]);
    expect(ctx.events.some((ev) => ev.type === 'prepare_start' && ev.skillId === 'equipped_prep')).toBe(true);
    expect(ctx.events.some((ev) => ev.type === 'prepare_skip')).toBe(false);

    a.preparations = [];
    triggerActiveSkill(ctx, a, ctx.skills.get('main_prep')!, [e], [a], [e]);
    expect(ctx.events.some((ev) => ev.type === 'prepare_skip' && ev.skillId === 'main_prep')).toBe(true);
  });

  it('尽言直谏：随机 2 个主动战法槽（不是 2 名友军的全部主动战法）', () => {
    const caster = unit('tf', 'my', { commandSkillIds: ['jinyan_zhijian'], position: '前锋' });
    const a = unit('a', 'my', { position: '中军', activeSkillIds: ['a1', 'a2', 'a3'], mainSkillId: 'a1' });
    const b = unit('b', 'my', { position: '大营', activeSkillIds: ['b1', 'b2', 'b3'], mainSkillId: 'b1' });
    const ctx = ctxOf([caster, a, b], [], 7);
    ctx.skills.set('jinyan_zhijian', SKILL_REGISTRY.jinyan_zhijian);

    triggerRoundCommandOnAct(ctx, caster);

    const slots: string[] = [];
    for (const u of [a, b]) {
      for (const s of u.statuses as Status[]) {
        if (s.type !== 'trigger_boost') continue;
        expect(s.skillTypes).toEqual(['active']);
        for (const id of s.skillIds ?? []) {
          expect(u.general.activeSkillIds).toContain(id); // 只点名真实存在的主动战法槽
          slots.push(`${u.general.id}:${id}`);
        }
      }
    }
    expect(slots).toHaveLength(2); // 恰好 2 个槽位（3+3=6 个槽位里抽 2 个，不是 2 个单位全给）
    // 同一单位被抽中多个槽位时合并成一个状态（否则同源刷新会互相顶掉）
    for (const u of [a, b]) {
      expect((u.statuses as Status[]).filter((s) => s.type === 'trigger_boost').length).toBeLessThanOrEqual(1);
      const boost = (u.statuses as Status[]).find((s) => s.type === 'trigger_boost');
      const dmg = (u.statuses as Status[]).find((s) => s.type === 'damage_boost');
      if (boost && dmg) expect(dmg.type === 'damage_boost' && dmg.skillIds).toEqual(boost.type === 'trigger_boost' && boost.skillIds);
    }
  });

  it('难知如阴：第 1 回合友军单体（不含自身），第 3 回合友军全体', () => {
    const fz = unit('fz', 'my', { commandSkillIds: ['nanzhi_ruyin'], position: '前锋' });
    const a = unit('a', 'my', { position: '中军' });
    const b = unit('b', 'my', { position: '大营' });
    const ctx = ctxOf([fz, a, b], [], 3);
    ctx.skills.set('nanzhi_ruyin', SKILL_REGISTRY.nanzhi_ruyin);

    ctx.currentRound = 1;
    triggerRoundCommandOnAct(ctx, fz);
    expect([a, b].filter((u) => u.statuses.some((s) => s.type === 'trigger_boost')).length).toBe(1);
    expect(fz.statuses.some((s) => s.type === 'trigger_boost')).toBe(false); // 友军不含自身

    for (const u of [fz, a, b]) u.statuses = [];
    ctx.currentRound = 3;
    triggerRoundCommandOnAct(ctx, fz);
    expect([a, b].filter((u) => u.statuses.some((s) => s.type === 'trigger_boost')).length).toBe(2);
  });
});
