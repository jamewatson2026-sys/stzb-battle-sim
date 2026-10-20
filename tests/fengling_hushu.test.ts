/**
 * 奉令护蜀（马岱 h615·被动 A）——增伤段 / 减伤段**分开计算**（用户 2026-10-19 报障）。
 *
 * 官方：「战斗中，任意友军发动普通攻击、主动战法、追击战法后，马岱的下 1 次普通攻击造成的伤害提升 35.0%
 * （受攻击属性影响），下 1 次受到的所有伤害降低 20.0%（受防御属性影响），以上效果可叠加 5 次」
 *
 * 报障（原话）：「队友进行普攻、主动、追击时马岱的层数加了，但是却没有实际增伤/减伤，
 * 下一次普通攻击时也没有正确把所有层数消耗，而是叠到五层才能消耗。应该是下一次普通吃到所有层数的增伤，
 * 下一次受到所有伤害时吃到所有减伤，且二者分开计算。」
 *
 * 口径（本测试钉死）：
 *  - 叠层来源 = **任意友军**（不含马岱自身）的普攻 / 主动 / 追击；每次触发**增伤层与减伤层各 +1**（各封顶 5）；
 *  - 下 1 次**普通攻击**：伤害 + 每层增伤 × 增伤层数（全部层数），打出后**只清增伤层**；
 *  - 下 1 次**受到伤害**：减伤 = 每层减伤 × 减伤层数（全部层数），实际扣兵后**只清减伤层**；
 *  - 两段互不消耗；都归零才移除状态。
 *  - 成长率（包内 21086501 / 21086502+03）：0.2 / 点攻击、0.125 / 点防御（与 skills.ts 数据一致）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Rng } from '../src/engine/rng';
import {
  actUnit,
  applyDamage,
  sumReduce,
  triggerAllyActStacks,
  type CombatContext,
} from '../src/engine/action';
import { runBattle } from '../src/engine/combat';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB, HERO_REGISTRY, level40 } from '../src/data/heroes';
import type { BattleEvent, General, Position, Skill, Status, UnitState } from '../src/engine/types';

beforeAll(async () => {
  await initHeroDB();
});

type PendingStacks = Extract<Status, { type: 'pending_stacks' }>;

const pending = (u: UnitState): PendingStacks | undefined =>
  u.statuses.find((s): s is PendingStacks => s.type === 'pending_stacks');

function gen(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '蜀',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'cavalry',
    position,
    attack: 150,
    defense: 150,
    strategy: 80,
    speed: 60,
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

function makeCtx(myTeam: UnitState[], enemyTeam: UnitState[], seed = 7): CombatContext {
  return {
    rng: new Rng(seed),
    myTeam,
    enemyTeam,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

const maDai = (): General => gen('h615', '前锋', { faction: '蜀', passiveSkillIds: ['fengling_hushu'] });
const allyGen = (id: string): General => gen(id, '中军');
const enemyGen = (id: string): General => gen(id, '前锋', { faction: '魏' });

/** 搭一套「马岱 + 1 友军 vs 1 木桩」的确定性上下文 */
function scene(seed = 7) {
  const ma = unit(maDai(), 'my');
  const ally = unit(allyGen('ally-mid'), 'my');
  const foe = unit(enemyGen('foe-front'), 'enemy');
  const ctx = makeCtx([ma, ally], [foe], seed);
  return { ctx, ma, ally, foe };
}

const attackHits = (ctx: CombatContext, sourceId: string) =>
  ctx.events.filter(
    (e): e is Extract<BattleEvent, { type: 'attack_hit' }> =>
      e.type === 'attack_hit' && e.sourceId === sourceId
  );

describe('奉令护蜀：叠层来源与上限', () => {
  it('任意友军发动后叠 1 层（增伤层 / 减伤层各 +1），马岱自身行动不叠', () => {
    const { ctx, ma, ally } = scene();

    triggerAllyActStacks(ctx, ma); // 马岱自己发动 → 官方「任意友军」不含自身
    expect(pending(ma)).toBeUndefined();

    triggerAllyActStacks(ctx, ally);
    const st = pending(ma)!;
    expect(st.boostStacks).toBe(1);
    expect(st.reduceStacks).toBe(1);
    // 每层数值按生效攻击 / 生效防御缩放后冻结：攻击 150 → 35 + 0.2×(150-80) = 49%
    expect(st.perLayerBoost).toBeCloseTo(0.49, 5);
    // 防御 150 → 20 + 0.125×(150-80) = 28.75 → 八舍九入 28%
    expect(st.perLayerReduce).toBeCloseTo(0.28, 5);
  });

  it('两段各自封顶 5 层（第 6、7 次发动不再增长）', () => {
    const { ctx, ma, ally } = scene();
    for (let i = 0; i < 7; i++) triggerAllyActStacks(ctx, ally);
    const st = pending(ma)!;
    expect(st.boostStacks).toBe(5);
    expect(st.reduceStacks).toBe(5);
  });
});

describe('奉令护蜀：下一次普通攻击吃满增伤层，且只清增伤层', () => {
  /** 同一 seed 跑两次：一次 0 层、一次 3 层，比较普攻「非兵力基础」部分 */
  function attackWith(stacks: number, seed = 7) {
    const { ctx, ma, ally } = scene(seed);
    for (let i = 0; i < stacks; i++) triggerAllyActStacks(ctx, ally);
    const perLayer = pending(ma)?.perLayerBoost ?? 0.49;
    actUnit(ctx, ma);
    const hit = attackHits(ctx, ma.general.id)[0];
    return { ctx, ma, hit, perLayer };
  }

  it('增伤按「每层 × 全部层数」生效，第 3 层全部吃到', () => {
    const base = attackWith(0);
    const boosted = attackWith(3);
    expect(base.hit).toBeTruthy();
    expect(boosted.hit).toBeTruthy();

    // 兵力基础段不乘增减伤（calcDamage 口径），只比属性段 + 主要段
    const scaled = (h: typeof base.hit) => h.damage - h.breakdown.troopBase;
    const ratio = scaled(boosted.hit) / scaled(base.hit);
    expect(ratio).toBeCloseTo(1 + boosted.perLayer * 3, 1);
    expect(boosted.hit.damage).toBeGreaterThan(base.hit.damage);
  });

  it('普攻打出后只清增伤层，减伤层原样保留（旧实现把两段一起清空）', () => {
    const { ctx, ma, ally } = scene();
    triggerAllyActStacks(ctx, ally);
    triggerAllyActStacks(ctx, ally);
    expect(pending(ma)!.boostStacks).toBe(2);

    actUnit(ctx, ma);

    const st = pending(ma)!;
    expect(st.boostStacks).toBe(0);
    expect(st.reduceStacks).toBe(2);
    // 消耗有可见战报行（「普攻消耗 N 层增伤（剩余减伤 N 层）」）
    const changed = ctx.events.filter((e) => e.type === 'status_changed');
    expect(changed.some((e) => 'detail' in e && String(e.detail).includes('普攻消耗'))).toBe(true);
  });

  it('三段示例（用户 2026-10-20 追问）：3 层 → 普攻只清增伤 → 队友再叠 1 次 = **1 增伤 / 4 减伤**', () => {
    const { ctx, ma, ally } = scene();
    for (let i = 0; i < 3; i++) triggerAllyActStacks(ctx, ally);
    expect(pending(ma)!.boostStacks).toBe(3);
    expect(pending(ma)!.reduceStacks).toBe(3);

    actUnit(ctx, ma); // 普攻：吃 3 层增伤，只清增伤段
    expect(pending(ma)!.boostStacks).toBe(0);
    expect(pending(ma)!.reduceStacks).toBe(3);

    triggerAllyActStacks(ctx, ally); // 队友继续发动 → 两段各 +1
    const st = pending(ma)!;
    expect(st.boostStacks).toBe(1);
    expect(st.reduceStacks).toBe(4);
  });

  it('反方向同样独立：3 层 → 受击只清减伤 → 队友再叠 1 次 = **4 增伤 / 1 减伤**', () => {
    const { ctx, ma, ally, foe } = scene();
    for (let i = 0; i < 3; i++) triggerAllyActStacks(ctx, ally);
    applyDamage(ctx, ma, 500, foe, 'physical', 'basic');
    expect(pending(ma)!.boostStacks).toBe(3);
    expect(pending(ma)!.reduceStacks).toBe(0);

    triggerAllyActStacks(ctx, ally);
    const st = pending(ma)!;
    expect(st.boostStacks).toBe(4);
    expect(st.reduceStacks).toBe(1);
  });

  it('战报能看到「奉令护蜀」的增伤归因（3 层 = 每层 × 3）', () => {
    const { ctx, ma, ally } = scene();
    for (let i = 0; i < 3; i++) triggerAllyActStacks(ctx, ally);
    const perLayer = pending(ma)!.perLayerBoost;
    actUnit(ctx, ma);
    const hit = attackHits(ctx, ma.general.id)[0];
    const entry = (hit.modifiers?.caused ?? []).find((m) => m.skillName === '奉令护蜀');
    expect(entry).toBeDefined();
    expect(entry!.rate).toBeCloseTo(perLayer * 3, 6);
  });

  it('两层都归零后移除状态', () => {
    const { ctx, ma, ally, foe } = scene();
    triggerAllyActStacks(ctx, ally);
    actUnit(ctx, ma); // 清增伤层（减伤层 1 剩）
    expect(pending(ma)!.reduceStacks).toBe(1);
    applyDamage(ctx, ma, 300, foe, 'physical', 'basic'); // 清减伤层
    expect(pending(ma)).toBeUndefined();
    expect(ctx.events.some((e) => e.type === 'status_expired' && e.statusType === 'pending_stacks')).toBe(true);
  });
});

describe('奉令护蜀：下一次受到伤害吃满减伤层，且只清减伤层', () => {
  it('任何伤害类型都吃减伤，且按「每层 × 全部层数」计入减伤合计', () => {
    const { ctx, ma, ally, foe } = scene();
    for (let i = 0; i < 3; i++) triggerAllyActStacks(ctx, ally);
    const st = pending(ma)!;

    const reduceBasic = sumReduce(ctx, ma, { damageSource: 'basic', damageType: 'physical' }, foe);
    const reduceStrategy = sumReduce(ctx, ma, { damageSource: 'skill', damageType: 'strategy' }, foe);
    expect(reduceBasic).toBeCloseTo(st.perLayerReduce * 3, 6);
    expect(reduceStrategy).toBeCloseTo(st.perLayerReduce * 3, 6);

    applyDamage(ctx, ma, 800, foe, 'physical', 'basic');

    expect(pending(ma)!.reduceStacks).toBe(0);
    expect(pending(ma)!.boostStacks).toBe(3); // 增伤层不受影响
    // 本次伤害已经吃到减伤（下一次读取归零前的合计不再计入）
    expect(sumReduce(ctx, ma, { damageSource: 'skill', damageType: 'strategy' }, foe)).toBe(0);
    const changed = ctx.events.filter((e) => e.type === 'status_changed');
    expect(changed.some((e) => 'detail' in e && String(e.detail).includes('受击消耗'))).toBe(true);
  });
});

describe('奉令护蜀：真实战斗里两段各自结算', () => {
  it('8 回合内日志同时出现「普攻消耗增伤层」与「受击消耗减伤层」（互不吞并）', () => {
    const ma = level40({ ...HERO_REGISTRY['h615'] }, { attack: 20 });
    const myTeam: General[] = [{ ...ma, position: '前锋' }, gen('a-mid', '中军'), gen('a-back', '大营')];
    const enemyTeam: General[] = [
      gen('e-front', '前锋', { faction: '魏' }),
      gen('e-mid', '中军', { faction: '魏' }),
      gen('e-back', '大营', { faction: '魏' }),
    ];

    const details: string[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const report = runBattle({ seed, maxRounds: 8, myTeam, enemyTeam });
      for (const e of report.events) {
        if (e.type === 'status_changed' && 'detail' in e) details.push(String(e.detail));
      }
    }
    expect(details.some((d) => d.includes('普攻消耗'))).toBe(true);
    expect(details.some((d) => d.includes('受击消耗'))).toBe(true);
    // 数据结构本身含两段计数（增伤层 / 减伤层），不再共用一个 stacks 字段
    const st = runBattle({ seed: 1, maxRounds: 3, myTeam, enemyTeam })
      .events.some((e) => e.type === 'status_inflicted' && e.statusType === 'pending_stacks');
    expect(st).toBe(true);
  });
});
