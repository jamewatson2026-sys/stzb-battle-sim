/**
 * 未雨绸缪（通用·主动 A）—— 再发动判定 + 机制 161「无视敌方属性」。
 *
 * 官方（包内 tb_cfg_skill 200301，9.2.2）：下回合开始后 2 回合内，自身下一次造成策略伤害的主动战法
 *   发动后可再次发动一次（跳过准备回合），造成原战法 50.0% 的伤害和恢复效果，
 *   该战法造成的伤害无视目标 30.0% 的谋略属性（受谋略属性影响）。
 *
 * 本文件守住两处用户报障（m01313）的回归：
 *  ① 再发动**必须递归识别策略伤害**——光武中兴的伤害在 `random_pick → combo_tag` 里、
 *     道行险阻在 `schedule_strike` 里，旧实现只看顶层，这两类永远不会再发动；
 *  ② 机制 161 既要在引擎里生效（目标谋略被折减），也要在事件流里可观测（`damage.ignoreStrategy`）。
 */
import { describe, it, expect } from 'vitest';
import { triggerActiveSkill, type CombatContext } from '../src/engine/action';
import type { General, Position, Skill, SkillOutput, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';

function general(id: string, position: Position, patch: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'cavalry',
    position,
    attack: 90,
    defense: 80,
    strategy: 95,
    speed: 90,
    attackRange: 5,
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

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 11): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam: my,
    enemyTeam: enemy,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 必发动的战法副本（去掉发动率对断言的影响） */
const sure = (id: string, patch: Partial<Skill> = {}): Skill =>
  ({ ...(SKILL_REGISTRY[id] as Skill), triggerRate: 1, ...patch }) as Skill;

/** 未雨绸缪给的标记：`repeat_strategy` duration 2 */
const marker = {
  type: 'repeat_strategy',
  duration: 2,
  remaining: 2,
  appliedRound: 0,
  sourceSkillType: 'passive',
  sourceSkillId: 'weiyu_choumou',
} as UnitState['statuses'][number];

function cast(ctx: CombatContext, caster: UnitState, skill: Skill) {
  triggerActiveSkill(ctx, caster, skill, ctx.enemyTeam, ctx.myTeam, [...ctx.myTeam, ...ctx.enemyTeam]);
}

const casts = (ctx: CombatContext) => ctx.events.filter((e) => e.type === 'skill_cast');
const damages = (ctx: CombatContext) =>
  ctx.events.filter((e) => e.type === 'damage') as Array<{
    damageType: string;
    damage: number;
    ignoreStrategy?: { pct: number };
  }>;

describe('未雨绸缪 · 数据口径', () => {
  it('战法面板：主动 · 距离 1 · 45% · 无准备 · 给自己挂 repeat_strategy(duration 2)', () => {
    const s = SKILL_REGISTRY.weiyu_choumou as Extract<Skill, { type: 'active' }>;
    expect(s.name).toBe('未雨绸缪');
    expect(s.type).toBe('active');
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(1);
    expect(s.triggerRate).toBe(0.45);
    expect(s.targetMode).toBe('self');
    const st = s.output.find((o) => o.kind === 'inflict_status');
    expect(st?.kind).toBe('inflict_status');
    if (st?.kind !== 'inflict_status') return;
    expect(st.status).toMatchObject({ type: 'repeat_strategy', duration: 2 });
  });
});

describe('未雨绸缪 · 再发动（报障 ①）', () => {
  it('顶层带策略伤害的主动战法：再发动一次', () => {
    const caster = unit(general('c1', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e1', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('luolei'));
    expect(casts(ctx).map((e) => (e as { skillId: string }).skillId)).toEqual(['luolei', 'luolei']);
    expect(damages(ctx)).toHaveLength(2);
  });

  it('伤害藏在 random_pick → combo_tag 里（光武中兴）同样再发动', () => {
    const caster = unit(general('c2', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e2', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('guangwu_zhongxing'));
    expect(casts(ctx)).toHaveLength(2);
    const flag = casts(ctx)[1] as { recastBy?: string; recastRate?: number };
    expect(flag.recastBy).toBe('未雨绸缪');
    expect(flag.recastRate).toBe(0.5);
  });

  it('伤害藏在 schedule_strike 里（道行险阻）也算「造成策略伤害的战法」', () => {
    const caster = unit(general('c3', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e3', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('daoxing_xianzu'));
    // 延迟结算，本次行动没有伤害段，但「再次发动」必须已经发生
    expect(casts(ctx)).toHaveLength(2);
    expect(caster.statuses.some((s) => s.type === 'repeat_strategy')).toBe(false);
  });

  it('不含策略伤害的主动战法不再发动，标记保留', () => {
    const caster = unit(general('c4', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e4', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    // 只有攻击伤害的主动战法（复用落雷的外壳，换成 pure physical）
    const physicalOnly = sure('luolei', {
      output: [{ kind: 'physical_damage', rate: 100 }],
    } as Partial<Skill>);
    cast(ctx, caster, physicalOnly);
    expect(casts(ctx)).toHaveLength(1);
    expect(caster.statuses.some((s) => s.type === 'repeat_strategy')).toBe(true);
  });

  it('标记只消费一次：第三次发动不再追加', () => {
    const caster = unit(general('c5', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e5', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('luolei'));
    cast(ctx, caster, sure('luolei'));
    expect(casts(ctx)).toHaveLength(3); // 第 1 次 2 发 + 第 2 次 1 发
  });

  it('未雨绸缪自己不会触发再发动', () => {
    const caster = unit(general('c6', '中军'), 'my');
    const ctx = makeCtx([caster], [unit(general('e6', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('weiyu_choumou'));
    expect(casts(ctx)).toHaveLength(1);
  });
});

describe('未雨绸缪 · 机制 161 无视敌方属性（报障 ②）', () => {
  it('再发动的那份策略伤害带 ignoreStrategy：30% + 0.15/点谋略（谋略 95 → 32%）', () => {
    const caster = unit(general('c7', '中军', { strategy: 95 }), 'my');
    const ctx = makeCtx([caster], [unit(general('e7', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('luolei'));
    const [first, second] = damages(ctx);
    expect(first.ignoreStrategy).toBeUndefined();
    expect(second.ignoreStrategy?.pct).toBe(32);
  });

  it('谋略越高折减越多：谋略 200 → 30 + 0.15×120 = 48%', () => {
    const caster = unit(general('c8', '中军', { strategy: 200 }), 'my');
    const ctx = makeCtx([caster], [unit(general('e8', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('luolei'));
    expect(damages(ctx)[1].ignoreStrategy?.pct).toBe(48);
  });

  it('机制生效：同一发策略伤害，挂 ignoreStrategy 的比不挂的打得多', () => {
    const plain: SkillOutput = { kind: 'strategy_damage', rate: 200, strategyScaled: false };
    const ignoring: SkillOutput = {
      kind: 'strategy_damage',
      rate: 200,
      strategyScaled: false,
      ignoreStrategyPct: 30,
      ignoreStrategyGrowthRate: 0.15,
    };
    const base = SKILL_REGISTRY.luolei as Extract<Skill, { type: 'active' }>;
    const run = (output: SkillOutput[]) => {
      const caster = unit(general('c9', '中军', { strategy: 95 }), 'my');
      const ctx = makeCtx([caster], [unit(general('e9', '中军', { strategy: 200 }), 'enemy')]);
      cast(ctx, caster, { ...base, triggerRate: 1, output } as Skill);
      return damages(ctx)[0];
    };
    const a = run([plain]);
    const b = run([ignoring]);
    expect(a.ignoreStrategy).toBeUndefined();
    expect(b.ignoreStrategy?.pct).toBe(32);
    expect(b.damage).toBeGreaterThan(a.damage);
  });

  it('再发动按 50% 结算：第二次伤害低于第一次', () => {
    const caster = unit(general('c10', '中军', { strategy: 95 }), 'my');
    const ctx = makeCtx([caster], [unit(general('e10', '中军'), 'enemy')]);
    caster.statuses.push({ ...marker });
    cast(ctx, caster, sure('luolei'));
    const [first, second] = damages(ctx);
    expect(second.damage).toBeLessThan(first.damage);
  });
});
