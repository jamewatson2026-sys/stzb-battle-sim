/**
 * 光武中兴（刘秀 h841 · 汉骑 · 主动 S）—— 数据口径 + 两项新引擎能力。
 *
 * 官方描述（包内 tb_cfg_skill 200302）：为我军兵力最低的单体恢复 2 次兵力（恢复率 225%，
 * 受谋略属性影响），每次目标独立判定；随后对 5 距离内敌方目标随机发动落雷、落石、绝水遏敌中的 1 个战法
 * （跳过准备回合），每当【光武中兴】造成恢复效果时，有 30% 几率（受谋略属性影响）额外随机发动 1 个上述战法；
 * 单回合内上述 3 个战法均发动后，使敌军全体降低 20 士气。
 *
 * 本文件守住的机制：
 *  ① 数据：恢复 225% / 成长 1.00；三子战法 148(1.35) 混乱、92.2(0.89) 防御 −5.2、230(2.25) 围困；
 *  ② `heal.onHealCast`：**本战法自身**恢复段触发的额外派遣，几率 = 30% + 0.1%/点谋略，走士气修正；
 *  ③ `combo_tag` + `skill.roundCombo`：同回合内集齐 3 个子战法 → 敌军全体士气 −20，回合切换重置。
 */
import { describe, it, expect } from 'vitest';
import { triggerActiveSkill, type CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';
import { reportToText } from '../src/engine/report';

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

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 7): CombatContext {
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

const baseSkill = SKILL_REGISTRY.guangwu_zhongxing as Extract<Skill, { type: 'active' }>;

/** 必定发动的光武中兴（去掉 45% 发动率对断言的影响） */
const sure = (patch: Partial<Skill> = {}): Skill => ({ ...baseSkill, triggerRate: 1, ...patch }) as Skill;

function cast(ctx: CombatContext, caster: UnitState, skill: Skill) {
  triggerActiveSkill(ctx, caster, skill, ctx.enemyTeam, ctx.myTeam, [...ctx.myTeam, ...ctx.enemyTeam]);
}

describe('光武中兴 · 数据口径', () => {
  it('战法面板与官方数值一致', () => {
    expect(baseSkill.name).toBe('光武中兴');
    expect(baseSkill.type).toBe('active');
    expect(baseSkill.range).toBe(5);
    expect(baseSkill.triggerRate).toBe(0.45);
    expect(baseSkill.tags).toContain('heal');
    expect(baseSkill.tags).toContain('confusion');

    const heals = baseSkill.output.filter((o) => o.kind === 'heal');
    expect(heals).toHaveLength(2); // 「恢复 2 次兵力，每次目标独立判定」
    for (const h of heals) {
      if (h.kind !== 'heal') continue;
      expect(h.rate).toBe(225);
      expect(h.growthRate).toBe(1);
      expect(h.targetPick).toBe('lowest_troops_ally');
      expect(h.onHealCast?.chance).toBe(0.3);
      expect(h.onHealCast?.growthRate).toBe(0.001);
    }
  });

  it('三个子战法数值与状态挂载正确', () => {
    const pick = baseSkill.output.find((o) => o.kind === 'random_pick');
    expect(pick?.kind).toBe('random_pick');
    if (pick?.kind !== 'random_pick') return;
    expect(pick.options).toHaveLength(3);
    const tags = pick.options.map((o) => {
      const t = o[0];
      expect(t.kind).toBe('combo_tag');
      return t.kind === 'combo_tag' ? t : undefined;
    });
    expect(tags.map((t) => t?.key)).toEqual(['luolei', 'luoshi', 'jueshui']);

    const rateOf = (key: string) => {
      const t = tags.find((x) => x?.key === key);
      const dmg = t?.outputs.find((o) => o.kind === 'strategy_damage');
      return dmg?.kind === 'strategy_damage' ? { rate: dmg.rate, growth: dmg.growthRate } : undefined;
    };
    expect(rateOf('luolei')).toEqual({ rate: 148, growth: 1.35 });
    expect(rateOf('luoshi')).toEqual({ rate: 92.2, growth: 0.89 });
    expect(rateOf('jueshui')).toEqual({ rate: 230, growth: 2.25 });

    const statusOf = (key: string) => {
      const t = tags.find((x) => x?.key === key);
      const st = t?.outputs.find((o) => o.kind === 'inflict_status');
      return st?.kind === 'inflict_status' ? st.status : undefined;
    };
    expect(statusOf('luolei')).toEqual({ type: 'confusion', duration: 1 });
    expect(statusOf('luoshi')).toEqual({ type: 'defense_buff', amount: -5.2, duration: 1 });
    expect(statusOf('jueshui')).toEqual({ type: 'siege', duration: 1 });
  });
});

describe('光武中兴 · 恢复段', () => {
  it('为我军兵力最低者恢复，且两次独立结算（恢复率受谋略缩放 225+1.00/点）', () => {
    const low = unit(general('low', '前锋'), 'my');
    low.troops = 3000;
    low.wounded = 4000;
    const mid = unit(general('mid', '中军'), 'my');
    mid.troops = 6000;
    mid.wounded = 4000;
    const high = unit(general('high', '大营'), 'my');
    high.troops = 9000;
    high.wounded = 4000;
    const caster = unit(general('liuxiu', '中军'), 'my');
    caster.troops = 7000;
    caster.wounded = 4000;
    const foes = [unit(general('e1', '前锋'), 'enemy'), unit(general('e2', '大营'), 'enemy')];
    const ctx = makeCtx([low, mid, caster, high], foes, 11);

    cast(ctx, caster, sure());
    const heals = ctx.events.filter((e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal');
    expect(heals).toHaveLength(2);
    // 首段必定打兵力最低者；第二段按恢复后的兵力重新取最低
    expect(heals[0].targetId).toBe('low');
    expect(heals[0].skillId).toBe('guangwu_zhongxing');
  });
});

describe('光武中兴 · 额外派遣（heal.onHealCast）', () => {
  it('每次恢复后按 30%+0.1%/点谋略（受士气修正）判定一次', () => {
    const caster = unit(general('liuxiu', '中军'), 'my');
    caster.troops = 7000;
    caster.wounded = 9000;
    const ally = unit(general('ally', '前锋'), 'my');
    ally.troops = 2000;
    ally.wounded = 9000;
    const foes = [unit(general('e1', '前锋'), 'enemy'), unit(general('e2', '大营'), 'enemy')];
    const ctx = makeCtx([caster, ally], foes, 3);

    cast(ctx, caster, sure());
    const triggers = ctx.events.filter(
      (e): e is Extract<BattleEvent, { type: 'skill_trigger' }> =>
        e.type === 'skill_trigger' && e.skillId === 'guangwu_zhongxing' && e.targetId != null
    );
    // 两段恢复各一次判定；谋略 95 → 30% + 0.1×15 = 31.5% → 32%
    expect(triggers).toHaveLength(2);
    for (const t of triggers) {
      expect(t.baseRate).toBe(32);
      expect(t.rate).toBe(32); // 士气 100 → 系数 1
    }
  });

  it('命中时额外多派遣 1 个子战法（同次发动可出现 2 组伤害）', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const caster = unit(general('liuxiu', '中军'), 'my');
      caster.troops = 7000;
      caster.wounded = 9000;
      const ally = unit(general('ally', '前锋'), 'my');
      ally.troops = 2000;
      ally.wounded = 9000;
      const foes = [unit(general('e1', '前锋'), 'enemy'), unit(general('e2', '大营'), 'enemy')];
      const ctx = makeCtx([caster, ally], foes, seed);
      cast(ctx, caster, sure());
      const extra = ctx.events.filter(
        (e) => e.type === 'skill_trigger' && e.skillId === 'guangwu_zhongxing' && e.targetId != null && e.success
      ).length;
      counts.add(extra);
    }
    // 至少出现过「两段恢复都触发额外派遣」与「都没触发」两种情形
    expect(counts.has(0)).toBe(true);
    expect([...counts].some((c) => c >= 1)).toBe(true);
  });
});

describe('光武中兴 · 回合内集齐三子战法（combo_tag + roundCombo）', () => {
  /** 把三个 combo_tag 拆成同一次发动的三段输出（等价于「同一回合内三个子战法都发动了」） */
  const allThree = (): Skill => {
    const dispatch = baseSkill.output.find((o) => o.kind === 'random_pick');
    if (dispatch?.kind !== 'random_pick') throw new Error('缺少 random_pick 段');
    const tags = dispatch.options.map((o) => o[0]);
    return sure({ output: tags });
  };

  it('集齐 3 个 → 敌军全体士气 −20 并清空集合', () => {
    const caster = unit(general('liuxiu', '中军'), 'my');
    const foes = [
      unit(general('e1', '前锋'), 'enemy'),
      unit(general('e2', '中军'), 'enemy'),
      unit(general('e3', '大营'), 'enemy'),
    ];
    const ctx = makeCtx([caster], foes, 5);

    cast(ctx, caster, allThree());
    for (const foe of foes) {
      const morale = foe.statuses.find((s) => s.type === 'morale_boost');
      expect(morale, `${foe.general.id} 应获得士气降低`).toBeDefined();
      expect((morale as { amount: number }).amount).toBe(-20);
    }
    // 集齐后集合清空：同回合再集齐需要重新累计
    expect(ctx.roundComboKeys?.size ?? 0).toBe(0);
  });

  it('同回合只发动 2 个不触发；跨回合重置后不累计', () => {
    const caster = unit(general('liuxiu', '中军'), 'my');
    const foes = [unit(general('e1', '前锋'), 'enemy'), unit(general('e2', '大营'), 'enemy')];
    const ctx = makeCtx([caster], foes, 9);
    const dispatch = baseSkill.output.find((o) => o.kind === 'random_pick');
    if (dispatch?.kind !== 'random_pick') throw new Error('缺少 random_pick 段');
    const [luolei, luoshi, jueshui] = dispatch.options.map((o) => o[0]);

    // ① 同回合只有落雷 + 落石 → 不触发
    cast(ctx, caster, sure({ output: [luolei, luoshi] }));
    expect(foes.some((f) => f.statuses.some((s) => s.type === 'morale_boost'))).toBe(false);

    // ② 下一回合只有绝水遏敌 → 上一回合的集合已作废，仍不触发
    ctx.currentRound = 2;
    cast(ctx, caster, sure({ output: [jueshui] }));
    expect(foes.some((f) => f.statuses.some((s) => s.type === 'morale_boost'))).toBe(false);

    // ③ 同回合补齐另外两个 → 集齐触发
    cast(ctx, caster, sure({ output: [luolei, luoshi] }));
    expect(foes.every((f) => f.statuses.some((s) => s.type === 'morale_boost'))).toBe(true);
  });
});

describe('光武中兴 · 子战法标注（subSkill）', () => {
  const dispatchOf = () => {
    const d = baseSkill.output.find((o) => o.kind === 'random_pick');
    if (d?.kind !== 'random_pick') throw new Error('缺少 random_pick 段');
    return d;
  };

  it('派到哪个子战法，事件就打上哪个名字（三个都能派到，且不漏标）', () => {
    const seen = new Set<string>();
    let untagged = 0;
    for (let i = 0; i < 40; i++) {
      const caster = unit(general('liuxiu', '中军'), 'my');
      const foes = [unit(general('e1', '前锋'), 'enemy'), unit(general('e2', '中军'), 'enemy'), unit(general('e3', '大营'), 'enemy')];
      const ctx = makeCtx([caster], foes, 100 + i);
      cast(ctx, caster, sure());
      for (const ev of ctx.events) {
        if (ev.type !== 'damage' || ev.skillId !== 'guangwu_zhongxing') continue;
        if (!ev.subSkill) untagged++;
        else seen.add(ev.subSkill);
      }
    }
    expect(untagged).toBe(0);
    expect([...seen].sort()).toEqual(['绝水遏敌', '落石', '落雷'].sort());
  });

  it('只派落雷时，混乱与伤害都标 落雷；只派落石时状态文案写「光武中兴·落石」', () => {
    const [luolei] = dispatchOf().options.map((o) => o[0]);
    const c1 = unit(general('liuxiu', '中军'), 'my');
    const f1 = [unit(general('e1', '前锋'), 'enemy')];
    const ctx1 = makeCtx([c1], f1, 21);
    cast(ctx1, c1, sure({ output: [luolei] }));
    const dmg1 = ctx1.events.filter((e) => e.type === 'damage' && e.skillId === 'guangwu_zhongxing');
    expect(dmg1.length).toBeGreaterThan(0);
    expect(dmg1.every((e) => (e as { subSkill?: string }).subSkill === '落雷')).toBe(true);

    const [, luoshi] = dispatchOf().options.map((o) => o[0]);
    const c2 = unit(general('liuxiu', '中军'), 'my');
    const f2 = [unit(general('e1', '前锋'), 'enemy'), unit(general('e2', '大营'), 'enemy')];
    const ctx2 = makeCtx([c2], f2, 22);
    cast(ctx2, c2, sure({ output: [luoshi] }));
    const statuses = ctx2.events.filter((e) => e.type === 'status_inflicted' && e.statusType === 'defense_buff');
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((e) => String((e as { detail?: string }).detail).includes('光武中兴·落石'))).toBe(true);
  });

  it('文本战报给伤害行加〈落雷〉前缀', () => {
    const [luolei] = dispatchOf().options.map((o) => o[0]);
    const caster = unit(general('liuxiu', '中军'), 'my');
    const foes = [unit(general('e1', '前锋'), 'enemy')];
    const ctx = makeCtx([caster], foes, 31);
    cast(ctx, caster, sure({ output: [luolei] }));
    const text = reportToText({
      events: ctx.events,
      myTeam: [caster.general],
      enemyTeam: foes.map((f) => f.general),
      seed: 31,
      maxRounds: 1,
      result: 'win',
      rounds: 1,
      finalMyTroops: [caster.troops],
      finalEnemyTroops: foes.map((f) => f.troops),
      finalMyWounded: [0],
      finalEnemyWounded: [0],
      finalMyDead: [0],
      finalEnemyDead: [0],
      stats: [],
    } as unknown as Parameters<typeof reportToText>[0]);
    expect(text).toContain('〈落雷〉');
  });
});
