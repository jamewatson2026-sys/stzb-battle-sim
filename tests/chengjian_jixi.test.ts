/**
 * 乘间击隙（A 一类指挥·距离 4·目标自己）——叠层与增伤冲突**解耦**（用户 2026-10-19 报障 3）。
 *
 * 官方：「自身每发动主动主战法后，使自身造成的攻击伤害提升 15%，最多叠加 3 次；该效果每叠加 3 次后，
 *   对敌军群体发动 1 次攻击（伤害率 240%），发动后攻击伤害提升效果消失」
 *
 * 报障（原话）：「会与始计等增伤冲突，一旦冲突整场无法再叠层和出伤。修正：会和指挥增伤冲突但是不会影响叠层，
 *   满足条件仍旧叠层，三层时出伤并清空层数。且乘间击隙是指挥战法，不应该与被动、主动型增伤冲突才对，
 *   因此关银屏可同时携带击势 + 乘间击隙，三者增伤互不冲突且乘间击隙能正常出伤。」
 *
 * 根因：旧实现用**增伤状态的 `stacks`** 当叠层计数器。乘间击隙是**指挥**战法，其 15% 攻击增伤与
 *   同为指挥的增伤（始计 20%）判「数值取较高」而被拒 → 状态不存在 → 计数器永远读到 0 → 整场不出伤。
 *
 * 口径（本测试钉死）：
 *  - 叠层次数记在 `ctx.mainActiveCastCounters`（与增伤状态无关）：每次发动主动主战法 +1，满 3 次
 *    对敌军群体打出 240% 并清空层数与增伤状态；
 *  - 增伤状态「尽力施加」：与指挥增伤冲突时按冲突规则（取较高）被拒，但**不影响叠层 / 出伤**；
 *  - 与被动 / 主动型增伤不同域（冲突域按战法类型划分），两条增伤并存。
 */
import { describe, it, expect } from 'vitest';
import { Rng } from '../src/engine/rng';
import { inflictStatus, triggerActiveSkill, type CombatContext } from '../src/engine/action';
import { SKILL_REGISTRY } from '../src/data/skills';
import type {
  BattleEvent,
  CreateStatus,
  General,
  Position,
  Skill,
  Status,
  UnitState,
} from '../src/engine/types';

function gen(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '魏',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'archer',
    position,
    attack: 180,
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

/** 主战法测试桩：瞬发主动、发动率 100%、无输出（只用来触发「主动主战法发动后」钩子） */
const MAIN_ACTIVE: Skill = {
  id: 'test_main_active',
  name: '测试主战法',
  type: 'active',
  prepare: false,
  range: 3,
  triggerRate: 1,
  targetMode: 'self',
  tags: ['damage'],
  output: [],
};

function scene() {
  const caster = unit(
    gen('u', '中军', { mainSkillId: MAIN_ACTIVE.id, activeSkillIds: [MAIN_ACTIVE.id], commandSkillIds: ['chengjian_jixi'] }),
    'my'
  );
  const foes = [
    unit(gen('e1', '前锋'), 'enemy'),
    unit(gen('e2', '中军'), 'enemy'),
    unit(gen('e3', '大营'), 'enemy'),
  ];
  const ctx: CombatContext = {
    rng: new Rng(3),
    myTeam: [caster],
    enemyTeam: foes,
    events: [],
    skills: new Map<string, Skill>([
      ...Object.entries(SKILL_REGISTRY),
      [MAIN_ACTIVE.id, MAIN_ACTIVE],
    ]),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
  return { ctx, caster, foes };
}

const cast = (ctx: CombatContext, caster: UnitState, foes: UnitState[]) =>
  triggerActiveSkill(ctx, caster, MAIN_ACTIVE, foes, [caster], foes);

const jixiDamage = (ctx: CombatContext) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> =>
      e.type === 'damage' && (e as { skillId?: string }).skillId === 'chengjian_jixi'
  );

const jixiBoost = (u: UnitState) =>
  u.statuses.find(
    (s): s is Extract<Status, { type: 'damage_boost' }> =>
      s.type === 'damage_boost' && s.sourceSkillId === 'chengjian_jixi'
  );

describe('乘间击隙：无冲突时 3 层出伤', () => {
  it('前两次只叠增伤（15% → 30%），第 3 次打出群体 240% 并清空层数与状态', () => {
    const { ctx, caster, foes } = scene();

    cast(ctx, caster, foes);
    expect(ctx.mainActiveCastCounters!.get('u:chengjian_jixi')).toBe(1);
    expect(jixiBoost(caster)!.rate).toBeCloseTo(0.15, 6);
    expect(jixiDamage(ctx)).toHaveLength(0);

    cast(ctx, caster, foes);
    expect(ctx.mainActiveCastCounters!.get('u:chengjian_jixi')).toBe(2);
    expect(jixiBoost(caster)!.rate).toBeCloseTo(0.3, 6);
    expect(jixiDamage(ctx)).toHaveLength(0);

    cast(ctx, caster, foes);
    expect(jixiDamage(ctx).length).toBeGreaterThan(0);
    // 对手是 3 个在距离 4 内的敌军 → 群体 3 目标
    expect(jixiDamage(ctx).length).toBe(3);
    expect(jixiBoost(caster)).toBeUndefined();
    expect(ctx.mainActiveCastCounters!.get('u:chengjian_jixi')).toBe(0);
  });

  it('第 3 次出伤那一刻增伤层仍生效（45% 先算伤害再清空）', () => {
    const { ctx, caster, foes } = scene();
    cast(ctx, caster, foes);
    cast(ctx, caster, foes);
    expect(jixiBoost(caster)!.rate).toBeCloseTo(0.3, 6);
    cast(ctx, caster, foes);
    // 清空后重新计数，但本次伤害已按 45% 结算（若先清空则 3 层攻击会少一段增伤）
    const dmg = jixiDamage(ctx)[0];
    expect(dmg.damage).toBeGreaterThan(0);
    // 官方「发动 1 次**攻击**（伤害率 240%）」→ 段级 asAttack：本段自己吃到 3 层 45% 的 attackOnly 增伤
    const selfBoost = (dmg.modifiers?.caused ?? []).find((m) => m.skillName === '乘间击隙');
    expect(selfBoost).toBeDefined();
    expect(selfBoost!.rate).toBeCloseTo(0.45, 6);
    expect(jixiBoost(caster)).toBeUndefined();
  });
});

describe('乘间击隙：与指挥增伤冲突不吃掉叠层（报障现场）', () => {
  it('始计式 20% 指挥增伤在场时，15% 增伤被「取较高」拒绝，但层照叠、3 层照出伤', () => {
    const { ctx, caster, foes } = scene();
    // 先挂一条指挥增伤（同战法类型 + 同分类键「全域|无」→ 与乘间击隙冲突）
    const shijiBoost: CreateStatus = { type: 'damage_boost', rate: 0.2, duration: 999, direction: 'caused' };
    inflictStatus(ctx, caster, shijiBoost, 'command', 'shiji', caster.general.id);
    expect(
      caster.statuses.filter((s) => s.type === 'damage_boost' && s.sourceSkillId === 'chengjian_jixi')
    ).toHaveLength(0);

    cast(ctx, caster, foes);
    expect(ctx.mainActiveCastCounters!.get('u:chengjian_jixi')).toBe(1);
    expect(jixiBoost(caster)).toBeUndefined(); // 冲突被拒
    expect(ctx.events.some((e) => e.type === 'status_conflict')).toBe(true);

    cast(ctx, caster, foes);
    expect(ctx.mainActiveCastCounters!.get('u:chengjian_jixi')).toBe(2);

    cast(ctx, caster, foes);
    expect(jixiDamage(ctx).length).toBeGreaterThan(0); // 旧实现这里一条伤害都不会有
    expect(ctx.mainActiveCastCounters!.get('u:chengjian_jixi')).toBe(0);
    // 始计的增伤不受影响（取较高：20% 胜出）
    expect(
      caster.statuses.some(
        (s) => s.type === 'damage_boost' && s.sourceSkillId === 'shiji' && s.rate === 0.2
      )
    ).toBe(true);
  });

  it('与被动型增伤（击势 50%）不同域：两条增伤并存，乘间击隙照常叠层出伤', () => {
    const { ctx, caster, foes } = scene();
    const jishiBoost: CreateStatus = {
      type: 'damage_boost',
      rate: 0.5,
      duration: 1,
      direction: 'caused',
      damageType: 'physical',
    };
    inflictStatus(ctx, caster, jishiBoost, 'passive', 'jishi', caster.general.id);

    cast(ctx, caster, foes);
    expect(jixiBoost(caster)).toBeTruthy(); // 不与被动冲突
    expect(jixiBoost(caster)!.rate).toBeCloseTo(0.15, 6);
    expect(
      caster.statuses.some((s) => s.type === 'damage_boost' && s.sourceSkillId === 'jishi')
    ).toBe(true);

    cast(ctx, caster, foes);
    cast(ctx, caster, foes);
    expect(jixiDamage(ctx).length).toBeGreaterThan(0);
  });
});
