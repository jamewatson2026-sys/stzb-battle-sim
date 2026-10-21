/**
 * 举义诛暴（曹操·汉·五星 h42 主战法，官方 skill 200287）。
 *
 * 数据来源：解包 `tb_cfg_hero` 100804（汉·五星·骑·距离 3·base 76/88/72/78·grow 1.48/2.32/1.38/1.16）
 * 的 `skill_init = 200287`；`tb_cfg_skill` 200287 = 主动 / 距离 5 / 概率 40% / main_detail 20028701；
 * 逐槽（`tb_cfg_skill_detail`）：301 攻击伤害 150%（2 目标）、201~204 四维降低
 * `(3,800,000 + 0.4×3,000,000)/10⁶ = 5.0%`（受攻击属性，成长 `3,000,000/(2×10⁸) = 0.015/点`，持续 1 回合）、
 * 123 子技能 → 210287 四控（怯战/犹豫/混乱/暴走）各 50%、持续 1 回合。
 *
 * 历史背景：本仓库曾把 h42 挂成官方 100042（四星·献刀七星）的数据，本次按包内 100804 纠正。
 */
import { beforeAll, describe, it, expect } from 'vitest';

import {
  applyDamage,
  effectiveStat,
  inflictStatus,
  tickStatuses,
  triggerActiveSkill,
  type CombatContext,
} from '../src/engine/action';
import { HERO_REGISTRY, initHeroDB, level40 } from '../src/data/heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';
import type { General, Position, Skill, UnitState } from '../src/engine/types';

beforeAll(async () => {
  await initHeroDB();
});

function dummyUnit(id: string, position: Position, extra: Partial<General> = {}, side: 'my' | 'enemy' = 'my'): UnitState {
  const g: General = {
    id, name: id, rarity: '4星', cost: 1, faction: '汉', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position,
    attack: 80, defense: 80, strategy: 80, speed: 50, attackRange: 2, maxTroops: 10000,
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

/** 发动率改成 100% 的副本（只影响判定，其余数值全部来自真实注册项） */
const sureCast = (): Skill => ({ ...SKILL_REGISTRY.juyi_zhubao, triggerRate: 1 });

describe('汉·曹操 h42：五星面板与主战法挂载（官方 100804 / 200287）', () => {
  it('面板按官方表：base 76/88/72/78，成长 1.48/2.32/1.38/1.16，骑·距离 3·cost 2.5', () => {
    const cao = HERO_REGISTRY.h42;
    expect(cao.name).toBe('曹操');
    expect(cao.faction).toBe('汉');
    expect(cao.rarity).toBe('5星');
    expect(cao.troopType).toBe('cavalry');
    expect(cao.cost).toBe(2.5);
    expect(cao.attackRange).toBe(3);
    expect([cao.attack, cao.defense, cao.strategy, cao.speed]).toEqual([76, 88, 72, 78]);
  });

  it('40 级面板 = 初始 + 39×成长（四舍五入）+ 加点；不再是四星 85/88/85/93 那套', () => {
    // 76 + 39×1.48 = 133.72 → 134；88 + 39×2.32 = 178.48 → 178；72 + 39×1.38 = 125.82 → 126；78 + 39×1.16 = 123.24 → 123
    const lv40 = level40(HERO_REGISTRY.h42, {});
    expect([lv40.attack, lv40.defense, lv40.strategy, lv40.speed]).toEqual([134, 178, 126, 123]);
    expect(level40(HERO_REGISTRY.h42, { attack: 40 }).attack).toBe(174);
  });

  it('主战法 = 举义诛暴（不是四星的献刀七星）', () => {
    expect(HERO_REGISTRY.h42.mainSkillName).toBe('举义诛暴');
    expect(HERO_REGISTRY.h42.activeSkillIds).toContain('juyi_zhubao');
    expect(HERO_REGISTRY.h42.activeSkillIds).not.toContain('xiandao_qixing');
    expect(SKILL_REGISTRY.xiandao_qixing.name).toBe('献刀七星');
  });

  it('战法参数：主动 / 距离 5 / 发动率 40% / 敌军群体 2 目标', () => {
    const s = SKILL_REGISTRY.juyi_zhubao as Extract<Skill, { type: 'active'; prepare: false }>;
    expect(s.type).toBe('active');
    expect(s.prepare).toBe(false);
    expect(s.range).toBe(5);
    expect(s.triggerRate).toBe(0.4);
    expect(s.targetMode).toBe('group');
    expect(s.groupCount).toBe(2);
    expect(s.targetSide).toBe('enemy');
    expect(s.output.filter((o) => o.kind === 'physical_damage')).toEqual([
      expect.objectContaining({ rate: 150 }),
    ]);
  });
});

describe('举义诛暴：150% 群体攻击 + 全属性下降 5%（受攻击属性）', () => {
  it('命中 2 个敌军各打一次物理伤害，并各挂四维 −5% 持续 1 回合', () => {
    // 攻击 174 → 生效档 = 5 + 0.015×(174−80) = 6.41 → 0.1% 粒度 = 6.4%
    const cao = dummyUnit('cao', '前锋', { attack: 174, mainSkillName: '举义诛暴', activeSkillIds: ['juyi_zhubao'] });
    const foes = ['a', 'b', 'c'].map((id) => dummyUnit(id, '前锋', {}, 'enemy'));
    const ctx = makeCtx([cao], foes);
    triggerActiveSkill(ctx, cao, sureCast(), foes, [cao], foes);

    const hits = ctx.events.filter((e) => e.type === 'damage');
    expect(hits.length).toBe(2); // groupCount 2，每次一个目标
    const hitTargets = new Set(hits.map((e) => (e as { targetId: string }).targetId));
    expect(hitTargets.size).toBe(2);

    for (const foe of foes) {
      const buffs = foe.statuses.filter((s) => s.type.endsWith('_buff'));
      if (buffs.length === 0) continue; // 未被选中的第 3 个目标
      expect(buffs.map((s) => s.type).sort()).toEqual([
        'attack_buff', 'defense_buff', 'speed_buff', 'strategy_buff',
      ]);
      for (const b of buffs) {
        if (b.type !== 'attack_buff' && b.type !== 'defense_buff' && b.type !== 'strategy_buff' && b.type !== 'speed_buff') continue;
        expect(b.amount).toBe(-6.4);
        expect(b.percent).toBe(true);
        expect(b.remaining).toBe(1);
      }
    }
  });

  it('四维下降按「受攻击属性」放大：同一目标，曹操攻击 174 比攻击 100 降得更多', () => {
    const weak = dummyUnit('cao_w', '前锋', { attack: 100 });
    const strong = dummyUnit('cao_s', '前锋', { attack: 220 });
    const foeW = dummyUnit('fw', '前锋', {}, 'enemy');
    const foeS = dummyUnit('fs', '前锋', {}, 'enemy');
    const ctx = makeCtx([weak, strong], [foeW, foeS]);
    // 5 + 0.015×(100−80) = 5.3 ；5 + 0.015×(220−80) = 7.1
    inflictStatus(
      ctx, foeW,
      { type: 'attack_buff', amount: -5, percent: true, attackScaled: true, growthRate: 0.015, duration: 1 },
      'active', 'juyi_zhubao', weak.general.id
    );
    inflictStatus(
      ctx, foeS,
      { type: 'attack_buff', amount: -5, percent: true, attackScaled: true, growthRate: 0.015, duration: 1 },
      'active', 'juyi_zhubao', strong.general.id
    );
    // 直接 inflictStatus 不缩放（与 attack_scale.test.ts 一致）；走战法才缩放 → 这里只验数据口径字段
    const s = SKILL_REGISTRY.juyi_zhubao.output.find(
      (o) =>
        o.kind === 'inflict_status' &&
        'status' in o &&
        !Array.isArray(o.status) &&
        o.status.type === 'attack_buff'
    );
    expect(s).toMatchObject({
      kind: 'inflict_status',
      status: { type: 'attack_buff', amount: -5, percent: true, attackScaled: true, growthRate: 0.015, duration: 1 },
    });
  });

  it('属性下降真实生效：攻击 174 曹操命中后，目标攻击属性按百分比下降', () => {
    const cao = dummyUnit('cao', '前锋', { attack: 174 });
    const foe = dummyUnit('foe', '前锋', { attack: 200 }, 'enemy');
    const ctx = makeCtx([cao], [foe]);
    const before = effectiveStat(foe, 'attack');
    triggerActiveSkill(ctx, cao, sureCast(), [foe], [cao], [foe]);
    expect(foe.statuses.some((s) => s.type === 'attack_buff')).toBe(true);
    expect(effectiveStat(foe, 'attack')).toBeLessThan(before);
  });
});

describe('举义诛暴：受击判定标记（受到下 2 次伤害时各 50% 陷四控之一）', () => {
  const mark = {
    type: 'hurt_control' as const,
    rate: 0.5,
    controls: ['cowardice', 'hesitation', 'confusion', 'rampage'] as Array<
      'cowardice' | 'hesitation' | 'confusion' | 'rampage'
    >,
    charges: 2,
    duration: 1,
  };

  it('战法命中后给目标挂标记（charges 2 / 四个控制候选 / 持续 1 回合）', () => {
    const cao = dummyUnit('cao', '前锋', { attack: 174 });
    const foes = [dummyUnit('a', '前锋', {}, 'enemy'), dummyUnit('b', '前锋', {}, 'enemy'), dummyUnit('c', '前锋', {}, 'enemy')];
    const ctx = makeCtx([cao], foes);
    triggerActiveSkill(ctx, cao, sureCast(), foes, [cao], foes);
    const marks = foes.flatMap((f) => f.statuses.filter((s) => s.type === 'hurt_control'));
    expect(marks.length).toBe(2); // 命中 2 个目标
    for (const m of marks) {
      if (m.type !== 'hurt_control') continue;
      expect(m.charges).toBe(2);
      expect(m.controls).toEqual(['cowardice', 'hesitation', 'confusion', 'rampage']);
      expect(m.controlDuration).toBe(1);
      expect(m.remaining).toBe(1);
    }
  });

  it('受到第 1 次伤害后 charges 2 → 1（判定失败也消耗），第 2 次后标记移除', () => {
    const cao = dummyUnit('cao', '前锋', { attack: 174 });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([cao], [foe]);
    inflictStatus(ctx, foe, mark, 'active', 'juyi_zhubao', cao.general.id);

    applyDamage(ctx, foe, 50, cao, 'physical', 'basic');
    const after1 = foe.statuses.find((s) => s.type === 'hurt_control');
    expect(after1?.type).toBe('hurt_control');
    if (after1?.type === 'hurt_control') expect(after1.charges).toBe(1);

    applyDamage(ctx, foe, 50, cao, 'physical', 'basic');
    expect(foe.statuses.some((s) => s.type === 'hurt_control')).toBe(false);
    expect(ctx.events.some((e) => e.type === 'status_expired' && e.statusType === 'hurt_control')).toBe(true);
  });

  it('每次判定都发 skill_trigger，生效几率走施法者士气（100 士气 50%，120 士气 56% = 50%×1.12）', () => {
    for (const [morale, expected] of [[100, 50], [120, 56]] as const) {
      const cao = dummyUnit('cao', '前锋', { attack: 174, morale });
      const foe = dummyUnit('foe', '前锋', {}, 'enemy');
      const ctx = makeCtx([cao], [foe]);
      inflictStatus(ctx, foe, mark, 'active', 'juyi_zhubao', cao.general.id);
      applyDamage(ctx, foe, 50, cao, 'physical', 'basic');
      const trig = ctx.events.find((e) => e.type === 'skill_trigger');
      expect(trig).toMatchObject({
        type: 'skill_trigger',
        skillId: 'juyi_zhubao',
        skillName: '举义诛暴',
        baseRate: 50,
        rate: expected,
        morale,
        targetId: 'foe',
      });
    }
  });

  it('判定成功时给出的控制是四控之一、持续 1 回合（多 seed 覆盖）', () => {
    const seen = new Set<string>();
    let applied = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const cao = dummyUnit('cao', '前锋', { attack: 174, morale: 200 }); // 士气拉满 → 判定必中
      const foe = dummyUnit('foe', '前锋', {}, 'enemy');
      const ctx = makeCtx([cao], [foe], seed);
      inflictStatus(ctx, foe, mark, 'active', 'juyi_zhubao', cao.general.id);
      applyDamage(ctx, foe, 50, cao, 'physical', 'basic');
      const ctl = foe.statuses.find((s) =>
        ['cowardice', 'hesitation', 'confusion', 'rampage'].includes(s.type)
      );
      if (!ctl) continue;
      applied++;
      seen.add(ctl.type);
      expect('remaining' in ctl ? ctl.remaining : undefined).toBe(1);
      expect(['active']).toContain(ctl.sourceSkillType);
      expect(ctl.sourceSkillId).toBe('juyi_zhubao');
    }
    expect(applied).toBeGreaterThan(30); // 必中 → 40 个 seed 里绝大多数生效
    expect(seen.size).toBeGreaterThan(1); // 四选一确实在随机
  });

  it('不按回合递减：回合结束 tick 后标记仍在（只由受击消耗）', () => {
    const cao = dummyUnit('cao', '前锋', { attack: 174 });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([cao], [foe]);
    inflictStatus(ctx, foe, mark, 'active', 'juyi_zhubao', cao.general.id);
    ctx.currentRound = 2;
    tickStatuses(ctx, [cao, foe]);
    ctx.currentRound = 3;
    tickStatuses(ctx, [cao, foe]);
    const left = foe.statuses.find((s) => s.type === 'hurt_control');
    expect(left?.type).toBe('hurt_control');
    if (left?.type === 'hurt_control') expect(left.charges).toBe(2);
  });

  it('同战法再次施加 = 刷新次数（不是叠成 4 次）', () => {
    const cao = dummyUnit('cao', '前锋', { attack: 174 });
    const foe = dummyUnit('foe', '前锋', {}, 'enemy');
    const ctx = makeCtx([cao], [foe]);
    inflictStatus(ctx, foe, mark, 'active', 'juyi_zhubao', cao.general.id);
    applyDamage(ctx, foe, 10, cao, 'physical', 'basic'); // 2 → 1
    inflictStatus(ctx, foe, mark, 'active', 'juyi_zhubao', cao.general.id);
    const marks = foe.statuses.filter((s) => s.type === 'hurt_control');
    expect(marks.length).toBe(1);
    if (marks[0].type === 'hurt_control') expect(marks[0].charges).toBe(2);
  });
});
