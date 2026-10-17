/**
 * 动摇（unrest）机制契约测试（2026-10-17）
 *  背景：用户报障「汜水关造成的是物理持续性伤害动摇，但是却挂成了恐慌」。
 *  口径（调研《战斗伤害公式调研》§2）：动摇 = 物理 DoT —— 兵力基础 ×1/3、攻击基础 = 攻击 ×0.4（无随机）、
 *  主要伤害走攻防差；恐慌/燃烧/妖术 = 谋略 DoT（谋略 ×0.25）。袭屯夺气官方原文为「恐慌」，保持 panic。
 *  本测试只锁机制契约，不逐战法写数值断言。
 */
import { describe, it, expect } from 'vitest';
import { actUnit, inflictStatus, type CombatContext } from '../src/engine/action';
import type { BattleEvent, Position, UnitState } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { SKILL_REGISTRY } from '../src/data/skills';

function makeUnit(
  id: string,
  opts: {
    side?: 'my' | 'enemy';
    position?: Position;
    attack?: number;
    defense?: number;
    strategy?: number;
    troops?: number;
  } = {}
): UnitState {
  return {
    general: {
      id,
      name: id,
      rarity: '5星',
      cost: 3,
      faction: '汉',
      tags: [],
      mutualExclusionGroup: null,
      troopType: 'infantry',
      position: opts.position ?? '前锋',
      attack: opts.attack ?? 100,
      defense: opts.defense ?? 100,
      strategy: opts.strategy ?? 80,
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
    side: opts.side ?? 'my',
    troops: opts.troops ?? 10000,
    alive: true,
    wounded: 0,
    totalDead: 0,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(): CombatContext {
  return {
    rng: new Rng(7),
    myTeam: [],
    enemyTeam: [],
    events: [],
    skills: new Map<string, import('../src/engine/types').Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

/** 施法者 caster（我方前锋）+ 目标 enemy（敌方前锋，防御 80） */
function field(casterStat: { attack?: number; strategy?: number } = {}) {
  const ctx = makeCtx();
  const caster = makeUnit('caster', { attack: casterStat.attack ?? 200, strategy: casterStat.strategy ?? 80 });
  const enemy = makeUnit('enemy', { side: 'enemy', defense: 80 });
  ctx.myTeam = [caster];
  ctx.enemyTeam = [enemy];
  return { ctx, caster, enemy };
}

type DotEvent = Extract<BattleEvent, { type: 'dot_tick' }>;
const dotTicks = (ctx: CombatContext, targetId: string): DotEvent[] =>
  ctx.events.filter((e): e is DotEvent => e.type === 'dot_tick' && e.targetId === targetId);

const byName = (name: string) => {
  const skill = Object.values(SKILL_REGISTRY).find((s) => s.name === name);
  expect(skill, `战法 ${name} 应存在`).toBeTruthy();
  return skill!;
};

describe('动摇（unrest）机制契约', () => {
  it('数据层：七条动摇战法全部改用 unrest，袭屯夺气保持恐慌', () => {
    for (const name of ['汜水关', '险途暗渡', '游击', '浴血', '雪奋短兵', '威震逍遥', '九变之利']) {
      const skill = byName(name);
      expect(skill.tags, `${name} tags 应含 unrest`).toContain('unrest');
      expect(JSON.stringify(skill), `${name} 输出应含 type:unrest`).toContain('"type":"unrest"');
      expect(JSON.stringify(skill), `${name} 不应再挂 type:panic`).not.toContain('"type":"panic"');
    }
    const xitun = byName('袭屯夺气');
    expect(JSON.stringify(xitun), '袭屯夺气官方为恐慌，保持 panic').toContain('"type":"panic"');
    expect(JSON.stringify(xitun), '袭屯夺气不是动摇').not.toContain('"type":"unrest"');
    expect(JSON.stringify(xitun), '袭屯夺气保留属性下降触发').toContain('"triggerOnAttrDown":true');
  });

  it('行动跳伤：dotType=unrest，伤害按物理口径（不受施法者谋略影响）', () => {
    const low = field({ strategy: 80 });
    inflictStatus(low.ctx, low.enemy, { type: 'unrest', rate: 100, duration: 2, sourceAttack: 200 }, 'active', 'sishuiguan', 'caster');
    actUnit(low.ctx, low.enemy);
    const lowTick = dotTicks(low.ctx, 'enemy')[0];
    expect(lowTick, '应有动摇跳伤').toBeTruthy();
    expect(lowTick.dotType).toBe('unrest');

    const high = field({ strategy: 400 });
    inflictStatus(high.ctx, high.enemy, { type: 'unrest', rate: 100, duration: 2, sourceAttack: 200 }, 'active', 'sishuiguan', 'caster');
    actUnit(high.ctx, high.enemy);
    const highTick = dotTicks(high.ctx, 'enemy')[0];
    expect(highTick.dotType).toBe('unrest');
    // 物理 DoT：攻击基础固定 0.4，谋略不参与 → 施法者谋略 80 / 400 跳伤相同
    expect(highTick.damage).toBe(lowTick.damage);
  });

  it('物理口径：属性基础 = 攻击 × 0.4 × 伤害率（无随机）', () => {
    const f = field({ attack: 300 });
    inflictStatus(
      f.ctx,
      f.enemy,
      { type: 'unrest', rate: 130, duration: 2, sourceAttack: 300 },
      'active',
      'sishuiguan',
      'caster'
    );
    actUnit(f.ctx, f.enemy);
    const tick = dotTicks(f.ctx, 'enemy')[0];
    expect(tick, '应有动摇跳伤').toBeTruthy();
    // 攻击 300 × 0.4 = 120；伤害率 130% → 156（物理 DoT 的攻击基础不掷随机系数）
    expect(tick.breakdown.base).toBe(156);
    expect(tick.damage).toBe(tick.breakdown.troopBase + tick.breakdown.base + tick.breakdown.main);
  });

  it('恐慌仍为谋略 DoT（不受攻击影响）', () => {
    const low = field({ attack: 1, strategy: 100 });
    inflictStatus(low.ctx, low.enemy, { type: 'panic', rate: 100, duration: 2, growthRate: 0, sourceStrategy: 100 }, 'active', 'chuange', 'caster');
    actUnit(low.ctx, low.enemy);
    const lowTick = dotTicks(low.ctx, 'enemy')[0];
    expect(lowTick.dotType).toBe('panic');

    const high = field({ attack: 9999, strategy: 100 });
    inflictStatus(high.ctx, high.enemy, { type: 'panic', rate: 100, duration: 2, growthRate: 0, sourceStrategy: 100 }, 'active', 'chuange', 'caster');
    actUnit(high.ctx, high.enemy);
    const highTick = dotTicks(high.ctx, 'enemy')[0];
    expect(highTick.dotType).toBe('panic');
    expect(highTick.damage).toBe(lowTick.damage);
  });

  it('汜水关【追加】关羽：动摇跳伤时移除目标有益效果', () => {
    const f = field();
    inflictStatus(f.ctx, f.enemy, { type: 'attack_buff', amount: 20, duration: 3 }, 'active', 'test_buff', 'caster');
    expect(f.enemy.statuses.some((s) => s.type === 'attack_buff')).toBe(true);
    inflictStatus(
      f.ctx,
      f.enemy,
      { type: 'unrest', rate: 130, duration: 3, sourceAttack: 200, clearBuffsOnTick: true },
      'active',
      'sishuiguan',
      'caster'
    );
    actUnit(f.ctx, f.enemy);
    expect(dotTicks(f.ctx, 'enemy')[0], '应有动摇跳伤').toBeTruthy();
    expect(f.enemy.statuses.some((s) => s.type === 'attack_buff'), '有益效果应被移除').toBe(false);
  });

  it('威震逍遥：普攻触发动摇，ignoresEvasionOnTick 时不消耗规避', () => {
    // 不无视规避：普攻命中（攻击者带 ignore_evasion，避免普攻本身被规避）→ 消耗规避，无跳伤
    const a = field();
    inflictStatus(a.ctx, a.caster, { type: 'ignore_evasion', duration: 999 }, 'passive', 'test_ignore_evasion');
    inflictStatus(a.ctx, a.enemy, { type: 'evasion', stacks: 1 }, 'passive', 'test_evasion');
    inflictStatus(
      a.ctx,
      a.enemy,
      { type: 'unrest', rate: 100, duration: 2, sourceAttack: 100, triggerOnBasic: true, charges: 2 },
      'active',
      'weizhen_xiaoyao',
      'caster'
    );
    actUnit(a.ctx, a.caster);
    expect(dotTicks(a.ctx, 'enemy').length, '被规避时不应跳伤').toBe(0);

    // 无视规避：普攻命中（攻击者带 ignore_evasion）→ 跳伤，且规避不被消耗
    const b = field();
    inflictStatus(b.ctx, b.caster, { type: 'ignore_evasion', duration: 999 }, 'passive', 'test_ignore_evasion');
    inflictStatus(b.ctx, b.enemy, { type: 'evasion', stacks: 1 }, 'passive', 'test_evasion');
    inflictStatus(
      b.ctx,
      b.enemy,
      {
        type: 'unrest',
        rate: 100,
        duration: 2,
        sourceAttack: 100,
        triggerOnBasic: true,
        charges: 2,
        ignoresEvasionOnTick: true,
      },
      'active',
      'weizhen_xiaoyao',
      'caster'
    );
    actUnit(b.ctx, b.caster);
    expect(dotTicks(b.ctx, 'enemy').length, '无视规避时应跳伤').toBe(1);
    expect(
      b.enemy.statuses.some((s) => s.type === 'evasion' && s.stacks === 1),
      '无视规避时不消耗规避层数'
    ).toBe(true);
  });
});
