/**
 * 「再次发动战法」也算一次【发动战法】（用户 2026-10-20 报障 2/3）。
 *
 * 报障原话：
 *  - ②「关银屏通过刘禅再次发动战法的效果没有触发宝物【金鸠】的发动战法叠加增伤，
 *      战报描述里面两次战法描述只触发一次增伤」；
 *  - ③「乘间击隙在战报统计中有伤害统计，但详细战报里面翻遍了没有乘间击隙 3 次释放战法从而发动一次攻击，
 *      注意再次发动战法的效果也是属于【发动战法】，要触发发动战法的特效」。
 *
 * 根因：`triggerAllyRecastCommands`（赐剑长驱 / 正始之变）的再次发动直接调 `executeSkillWithTargets`，
 *   **没有重走「成功发动主动战法后」的钩子链**（宝物·鸠佑叠层、乘间击隙计数、奉令护蜀叠层、归心计数…）
 *   → 一次行动里两次发动只算一次。
 *
 * 口径（本测试钉死）：
 *  - 再次发动 = 一次真实发动：钩子链全走（`runPostActiveCastHooks`），但**不许再触发再次发动**
 *    （`allowRecast: false`，否则 正始之变 `everyCast` 无限递归）；
 *  - 乘间击隙的计数因此把再次发动算进去：主动主战法 1 次 + 再次发动 1 次 = 2 层；
 *  - 满层出伤这一次必须打 `skill_cast`（详细战报里要能看见「发动【乘间击隙】」）。
 */
import { describe, it, expect } from 'vitest';
import { Rng } from '../src/engine/rng';
import { inflictStatus, triggerActiveSkill, type CombatContext } from '../src/engine/action';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';

function gen(id: string, position: Position, extra: Partial<General> = {}): General {
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

/** 赐剑长驱式「再次发动」桩：友军每次成功发动主动后 100% 再次发动（factor 0.5） */
const RECAST_CMD: Skill = {
  id: 'test_recast_cmd',
  name: '测试再次发动',
  type: 'command',
  phase: 'prep',
  range: 3,
  triggerRate: 1,
  targetMode: 'self',
  tags: [],
  output: [],
  allyRecast: { rate: 100, factor: 0.5 },
};

/**
 * 场景：关银屏位带 乘间击隙 + 主战法，另有一名友军带「再次发动」指挥；关银屏身上带宝物·金鸠（鸠佑）。
 * `withRecast: false` = 对照组（没有再次发动）。
 */
function scene(opts: { withRecast?: boolean } = {}) {
  const withRecast = opts.withRecast ?? true;
  const caster = unit(
    gen('u', '前锋', {
      mainSkillId: MAIN_ACTIVE.id,
      activeSkillIds: [MAIN_ACTIVE.id],
      commandSkillIds: ['chengjian_jixi'],
      troopType: 'infantry',
    }),
    'my'
  );
  const helpers = [
    unit(gen('h', '大营', { commandSkillIds: withRecast ? [RECAST_CMD.id] : [] }), 'my'),
  ];
  const foes = [
    unit(gen('e1', '前锋'), 'enemy'),
    unit(gen('e2', '中军'), 'enemy'),
    unit(gen('e3', '大营'), 'enemy'),
  ];
  const ctx: CombatContext = {
    rng: new Rng(7),
    myTeam: [caster, ...helpers],
    enemyTeam: foes,
    events: [],
    skills: new Map<string, Skill>([
      ...Object.entries(SKILL_REGISTRY),
      [MAIN_ACTIVE.id, MAIN_ACTIVE],
      [RECAST_CMD.id, RECAST_CMD],
    ]),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
  // 宝物·金鸠【鸠佑】：主动武将主战法发动后，自身造成攻击伤害提高 6%（可叠加，上限 10 层）
  // 宝物状态登记的 sourceSkillType 固定为 'passive'（与 src/engine/treasure.ts 的 TREASURE_SOURCE_TYPE 一致）
  inflictStatus(
    ctx,
    caster,
    { type: 'treasure_after_main', perStack: 0.06, maxStacks: 10, duration: 999 },
    'passive',
    'treasure:jinjiu:1',
    caster.general.id
  );
  return { ctx, caster, foes };
}

const cast = (ctx: CombatContext, caster: UnitState, foes: UnitState[]) =>
  triggerActiveSkill(ctx, caster, MAIN_ACTIVE, foes, ctx.myTeam, foes);

const casts = (ctx: CombatContext, skillId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'skill_cast' }> =>
      e.type === 'skill_cast' && (e as { skillId?: string }).skillId === skillId
  );

const jixiDamage = (ctx: CombatContext) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> =>
      e.type === 'damage' && (e as { skillId?: string }).skillId === 'chengjian_jixi'
  );

const jiuYouStacks = (u: UnitState) =>
  (u.statuses.find((s) => s.type === 'treasure_after_main') as { stacks?: number } | undefined)?.stacks ?? 0;

describe('再次发动 = 一次真实发动（钩子链全走）', () => {
  it('宝物·金鸠【鸠佑】一次行动两次发动 → 叠 2 层（旧实现只叠 1 层）', () => {
    const { ctx, caster, foes } = scene();
    expect(jiuYouStacks(caster)).toBe(0);

    cast(ctx, caster, foes);

    // 原始发动 + 再次发动 = 两次【发动战法】→ 鸠佑 2 层
    expect(casts(ctx, MAIN_ACTIVE.id)).toHaveLength(2);
    expect(jiuYouStacks(caster)).toBe(2);
  });

  it('对照组：没有再次发动时只叠 1 层（防止把一次发动记成两次）', () => {
    const { ctx, caster, foes } = scene({ withRecast: false });
    cast(ctx, caster, foes);
    expect(casts(ctx, MAIN_ACTIVE.id)).toHaveLength(1);
    expect(jiuYouStacks(caster)).toBe(1);
  });

  it('乘间击隙把再次发动计入层数：一次行动 = 2 层（旧实现 1 层）', () => {
    const { ctx, caster, foes } = scene();
    cast(ctx, caster, foes);
    expect(ctx.mainActiveCastCounters!.get('u:chengjian_jixi')).toBe(2);
  });

  it('满层出伤那一次带 skill_cast（详细战报能看见「发动【乘间击隙】」）', () => {
    const { ctx, caster, foes } = scene();
    cast(ctx, caster, foes); // 2 层
    ctx.currentRound = 2; // 赐剑长驱「每回合首次」→ 换回合才再判定
    cast(ctx, caster, foes); // 3 层 → 出伤并清零，再次发动再记 1 层

    const burst = jixiDamage(ctx);
    expect(burst.length).toBeGreaterThan(0);
    // 出伤这一刻有「发动【乘间击隙】！」事件（用户报障 3：统计有伤害、详细战报翻不到这一步）
    expect(casts(ctx, 'chengjian_jixi').length).toBeGreaterThan(0);
    expect(ctx.mainActiveCastCounters!.get('u:chengjian_jixi')).toBe(1);
  });

  it('再次发动不再触发再次发动（allowRecast:false，正始之变 everyCast 不递归）', () => {
    const { ctx, caster, foes } = scene();
    cast(ctx, caster, foes);
    // 只追加 1 次再次发动，不会 2→4→8 连锁
    expect(casts(ctx, MAIN_ACTIVE.id)).toHaveLength(2);
  });
});
