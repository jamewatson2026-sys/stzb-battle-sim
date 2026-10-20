/**
 * 一夫当关（A 一类指挥·距离 3·目标自己）——受防御属性影响（用户 2026-10-19 报障 4）。
 *
 * 官方：「战斗开始后前 2 回合，援护友军全体，使自身受到攻击时的伤害降低 50%（受防御属性影响），
 *   仅对自身处于前锋位置时生效」
 *
 * 报障（原话）：「一夫当关受防御属性影响，其成长率从包内拿，并实装到模拟器，目前一夫当关固定 50% 减伤。」
 *
 * 包内数据（tb_cfg_skill_detail 子技能 `21067401`，effect 522「受到攻击伤害降低」，attri_type 2 = 防御）：
 *   constant_param 20 + intel_param 75 → 满级值 = 20 + 0.4×75 = 50%（防御 80 的基值）；
 *   成长率 = intel_param ÷ 200 = **0.375 / 点防御** → 防御 200 时 20 + 75×1.2 = 95%；
 *   init_effect_ratio 50 = 1 级 25%（与官方 1 级 25% 一致）；available_round 2 = 前 2 回合。
 */
import { describe, it, expect } from 'vitest';
import { Rng } from '../src/engine/rng';
import { sumReduce, triggerCommandSkills, type CombatContext } from '../src/engine/action';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { General, Position, Skill, Status, UnitState } from '../src/engine/types';

function gen(id: string, position: Position, defense: number, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '蜀',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 100,
    strategy: 80,
    defense,
    speed: 50,
    attackRange: 2,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...extra,
  };
}

function unit(g: General, side: 'my' | 'enemy'): UnitState {
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

function makeCtx(myTeam: UnitState[], enemyTeam: UnitState[]): CombatContext {
  return {
    rng: new Rng(5),
    myTeam,
    enemyTeam,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 0,
  };
}

const attacker = (): UnitState =>
  unit(gen('foe', '前锋', 100, { faction: '魏', troopType: 'cavalry' }), 'enemy');

const reduceOf = (u: UnitState) =>
  u.statuses.find((s): s is Extract<Status, { type: 'damage_reduce' }> => s.type === 'damage_reduce');

const HIT = { damageSource: 'basic', damageType: 'physical' } as const;

const yifu = (defense: number, position: Position = '前锋'): UnitState =>
  unit(gen('u', position, defense, { mainSkillName: '一夫当关', commandSkillIds: ['yifudangguan'] }), 'my');

describe('一夫当关：数据口径', () => {
  const skill = SKILL_REGISTRY['yifudangguan'];
  it('减伤段带 defenseScaled + 包内成长率 0.375，且只压攻击伤害、前 2 回合、仅前锋生效', () => {
    expect(skill.type).toBe('command');
    if (skill.type !== 'command') return;
    expect(skill.phase).toBe('prep');
    expect(skill.casterPositions).toEqual(['前锋']);
    const out = skill.output.find(
      (o) =>
        o.kind === 'inflict_status' && !Array.isArray(o.status) && o.status.type === 'damage_reduce'
    );
    expect(out).toBeTruthy();
    if (out?.kind === 'inflict_status' && !Array.isArray(out.status) && out.status.type === 'damage_reduce') {
      expect(out.status.rate).toBe(0.5);
      expect(out.status.growthRate).toBe(0.375);
      expect(out.status.defenseScaled).toBe(true);
      expect(out.status.damageType).toBe('physical');
      expect(out.status.duration).toBe(2);
    }
    // 援护友军全体仍在（cover 挂自身、无 protectId）
    expect(
      skill.output.some(
        (o) => o.kind === 'inflict_status' && !Array.isArray(o.status) && o.status.type === 'cover'
      )
    ).toBe(true);
  });
});

describe('一夫当关：减伤随防御缩放（实装到模拟器）', () => {
  // 口径：50% 是**防御 80 处**的基准值（仓库既有口径，同金匮要略 20.4% 为谋略 80 处），
  // 成长率 0.375/点从 80 起算（包内 intel_param 75 ÷ 200）
  it('防御 80 → 50%（基准）；防御 200 → 95%（50 + 0.375×120）', () => {
    for (const [def, expected] of [
      [80, 0.5],
      [200, 0.95],
    ] as const) {
      const u = yifu(def);
      const foe = attacker();
      const ctx = makeCtx([u], [foe]);
      triggerCommandSkills(ctx, u);
      const dr = reduceOf(u);
      expect(dr, `防御 ${def}`).toBeTruthy();
      expect(dr!.rate).toBeCloseTo(expected, 6);
      expect(dr!.remaining).toBe(2); // 前 2 回合
      expect(sumReduce(ctx, u, HIT, foe)).toBeCloseTo(expected, 6);
      // 只压攻击伤害：策略伤害不吃这条减伤
      expect(sumReduce(ctx, u, { damageSource: 'skill', damageType: 'strategy' }, foe)).toBe(0);
    }
  });

  it('中线防御（150）→ 50 + 0.375×70 = 76.25% → 1% 粒度八舍九入 76%', () => {
    const u = yifu(150);
    const ctx = makeCtx([u], [attacker()]);
    triggerCommandSkills(ctx, u);
    expect(reduceOf(u)!.rate).toBeCloseTo(0.76, 6);
  });

  it('非前锋位不生效（casterPositions 站位条件）', () => {
    const u = yifu(200, '大营');
    const ctx = makeCtx([u], [attacker()]);
    triggerCommandSkills(ctx, u);
    expect(reduceOf(u)).toBeUndefined();
  });
});
