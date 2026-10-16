/**
 * 陈寿特性 · 引擎侧单测
 *
 * 数据来源：包内 `tb_cfg_hero` heroid 106001~106017（见 `src/data/chenshouFeatures.ts` 顶部注释）。
 * 覆盖：① 数据表口径（17 条 / heroid 连续 / 区间 / 战斗向旗标）
 *       ② 状态换算（精进 / 昂扬 / 审慎 / 砥砺）
 *       ③ 阵营与统率的 prepass 改写
 *       ④ 端到端：准备阶段挂载、战报文案、昂扬增伤实证、未使用时的反向对照
 */
import { describe, it, expect } from 'vitest';
import type { BattleConfig, General } from '../src/engine/types';
import { buildChenshouStatuses, applyChenshouPrepass, chenshouSourceId, chenshouStatPatch } from '../src/engine/chenshou';
import { CHENSHOU_FEATURES, CHENSHOU_BY_ID, makeChenshouLoadout } from '../src/data/chenshouFeatures';
import { CHENSHOU_CHIZHONG } from '../src/data/chenshouCost';
import { computeTroopBonuses } from '../src/engine/troopBonus';
import { runBattle } from '../src/engine/combat';
import { buildGeneral } from '../web/heroes';

/** 造一个最小可用武将（字段与 tests/fixtures.ts 同口径） */
function mk(partial: Partial<General> = {}): General {
  return {
    id: 'p1',
    name: '测试将',
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position: '前锋',
    attack: 100,
    defense: 100,
    strategy: 100,
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
    ...partial,
  };
}

/** 只取某类型的状态（便于断言） */
const byType = (list: ReturnType<typeof buildChenshouStatuses>, type: string) =>
  list.filter((s) => s.type === type) as Array<Record<string, unknown>>;

function cfg(myTeam: General[], enemyTeam: General[], seed = 20261016): BattleConfig {
  return { myTeam, enemyTeam, seed, maxRounds: 8 };
}

/** 木桩靶子（不还手，纯吃伤害） */
const dummy = (id: string, position: General['position']) =>
  mk({ id, name: `木桩${position}`, position, attack: 50, defense: 80, strategy: 60, speed: 20 });

describe('陈寿特性 · 数据表口径', () => {
  it('共 17 条，heroid 连续覆盖 106001~106017，id 唯一', () => {
    expect(CHENSHOU_FEATURES).toHaveLength(17);
    const ids = CHENSHOU_FEATURES.map((f) => f.heroid).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 17 }, (_, i) => 106001 + i));
    expect(new Set(CHENSHOU_FEATURES.map((f) => f.id)).size).toBe(17);
  });

  it('区间与默认值按包内原文：精进/昂扬/审慎 4~10 默认 5、砥砺 6~12 默认 9', () => {
    for (const id of ['cs_106004', 'cs_106011', 'cs_106012', 'cs_106013', 'cs_106007', 'cs_106008', 'cs_106009', 'cs_106010']) {
      const d = CHENSHOU_BY_ID[id];
      expect([d.min, d.max, d.defaultValue]).toEqual([4, 10, 5]);
      expect(d.unit).toBe('percent');
    }
    expect([CHENSHOU_BY_ID.cs_106005.min, CHENSHOU_BY_ID.cs_106005.max, CHENSHOU_BY_ID.cs_106005.defaultValue]).toEqual([6, 12, 9]);
  });

  it('战斗向 12 条；敏学与征募/长驱/拔城不结算（combat: false，带 note 说明）', () => {
    expect(CHENSHOU_FEATURES.filter((f) => f.combat)).toHaveLength(12);
    for (const id of ['cs_106006', 'cs_106014', 'cs_106015', 'cs_106016', 'cs_106017']) {
      expect(CHENSHOU_BY_ID[id].combat).toBe(false);
      expect(CHENSHOU_BY_ID[id].note).toBeTruthy();
    }
  });

  it('每条都带包内溯源锚点（heroid + 关联 skillId 280002~280018）', () => {
    for (const f of CHENSHOU_FEATURES) {
      expect(f.heroid).toBeGreaterThanOrEqual(106001);
      expect(f.skillId).toBeGreaterThanOrEqual(280002);
      expect(f.skillId).toBeLessThanOrEqual(280018);
      expect(f.desc.length).toBeGreaterThan(0);
    }
  });
});

describe('陈寿特性 · 状态换算', () => {
  it('精进·攻（玩家选 7）→ attack_buff 百分比 +7', () => {
    const list = buildChenshouStatuses({ featureId: 'cs_106004', value: 7 });
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('attack_buff');
    expect((list[0] as { amount: number }).amount).toBe(7);
    expect((list[0] as { percent?: boolean }).percent).toBe(true);
  });

  it('昂扬·谋 → damage_boost 造成策略伤害 +6%（direction=caused）', () => {
    const list = buildChenshouStatuses({ featureId: 'cs_106008', value: 6 });
    const b = byType(list, 'damage_boost');
    expect(b).toHaveLength(1);
    expect(b[0].rate).toBeCloseTo(0.06, 6);
    expect(b[0].direction).toBe('caused');
    expect(b[0].damageType).toBe('strategy');
  });

  it('审慎·攻 → damage_reduce 受攻击伤害 −9%（限定 physical）', () => {
    const list = buildChenshouStatuses({ featureId: 'cs_106009', value: 9 });
    const r = byType(list, 'damage_reduce');
    expect(r).toHaveLength(1);
    expect(r[0].rate).toBeCloseTo(0.09, 6);
    expect(r[0].damageType).toBe('physical');
  });

  it('砥砺 → 四维点数各按玩家分配，合计 = 总量', () => {
    const list = buildChenshouStatuses({
      featureId: 'cs_106005',
      value: 10,
      alloc: { attack: 3, defense: 3, strategy: 2, speed: 2 },
    });
    const sum = (list as Array<{ amount: number }>).reduce((a, s) => a + s.amount, 0);
    expect(sum).toBe(10);
    expect(byType(list, 'attack_buff')[0].amount).toBe(3);
    expect(byType(list, 'speed_buff')[0].amount).toBe(2);
  });

  it('非战斗条与敏学不产出任何状态（不进战斗结算）', () => {
    for (const id of ['cs_106006', 'cs_106014', 'cs_106015', 'cs_106016', 'cs_106017']) {
      expect(buildChenshouStatuses({ featureId: id, value: 5 })).toEqual([]);
    }
  });

  it('makeChenshouLoadout 默认值 = 包内「简单显示」列；砥砺默认均分且合计 = 总量', () => {
    expect(makeChenshouLoadout('cs_106004').value).toBe(5);
    const d = makeChenshouLoadout('cs_106005');
    expect(d.value).toBe(9);
    const a = d.alloc!;
    expect(a.attack + a.defense + a.strategy + a.speed).toBe(9);
  });

  it('来源 id 前缀可用于战报归属判定', () => {
    expect(chenshouSourceId('cs_106004')).toBe('chenshou:cs_106004');
  });
});

describe('陈寿特性 · 阵营与统率（prepass）', () => {
  it('出师·持重 → 统率 +0.5；争先 → 统率 −0.5（保留 1 位小数）', () => {
    const g1 = mk({ id: 'a', cost: 3, chenshou: { featureId: 'cs_106001', value: 0.5 } });
    const g2 = mk({ id: 'b', cost: 3, chenshou: { featureId: 'cs_106002', value: 0.5 } });
    applyChenshouPrepass([g1, g2]);
    expect(g1.cost).toBe(3.5);
    expect(g2.cost).toBe(2.5);
  });

  it('纵横 → 阵营改写为所选阵营；未选阵营时不改', () => {
    const g1 = mk({ id: 'a', faction: '汉', chenshou: { featureId: 'cs_106003', value: 0, faction: '魏' } });
    const g2 = mk({ id: 'b', faction: '汉', chenshou: { featureId: 'cs_106003', value: 0 } });
    applyChenshouPrepass([g1, g2]);
    expect(g1.faction).toBe('魏');
    expect(g2.faction).toBe('汉');
  });

  it('未使用特性的武将不受影响（反向对照）', () => {
    const g = mk({ id: 'a', faction: '汉', cost: 3 });
    applyChenshouPrepass([g]);
    expect([g.faction, g.cost]).toEqual(['汉', 3]);
  });

  it('纵横改写阵营后，本人与同阵营队友都按新阵营人数计加成（部队加成口径）', () => {
    const gens = [
      mk({ id: 'a', faction: '魏' }),
      mk({ id: 'b', faction: '魏' }),
      mk({ id: 'c', faction: '蜀', chenshou: { featureId: 'cs_106003', value: 0, faction: '魏' } }),
    ];
    applyChenshouPrepass(gens);
    const r = computeTroopBonuses(gens);
    // 改写的本人：吃到了魏阵营加成（3 人 → 10%）
    const own = r.lines.find((l) => l.unitId === 'c' && l.category === 'faction');
    expect(own).toBeTruthy();
    expect(own!.bonuses.attack).toBe(Math.round((100 * 10) / 100));
    // 同队魏将：也按 3 人算（10%），不再是 2 人的 8%
    expect(r.lines.find((l) => l.unitId === 'a' && l.category === 'faction')!.bonuses.attack).toBe(10);
  });

  it('反向对照：不带纵横时，蜀将不入魏阵营（无阵营加成行）', () => {
    const gens = [mk({ id: 'a', faction: '魏' }), mk({ id: 'b', faction: '魏' }), mk({ id: 'c', faction: '蜀' })];
    applyChenshouPrepass(gens);
    const r = computeTroopBonuses(gens);
    expect(r.lines.find((l) => l.unitId === 'c' && l.category === 'faction')).toBeUndefined();
    // 魏只有 2 人 → 8%
    expect(r.lines.find((l) => l.unitId === 'a' && l.category === 'faction')!.bonuses.attack).toBe(8);
  });
});

describe('陈寿特性 · 端到端', () => {
  const enemy = () => [dummy('enemy-front', '前锋'), dummy('enemy-mid', '中军'), dummy('enemy-back', '大营')];

  it('使用精进·攻 → 事件流出现 prep_phase chenshou 与百分比攻击加成状态', () => {
    const report = runBattle(cfg([mk({ id: 'a', chenshou: { featureId: 'cs_106004', value: 10 } })], enemy()));
    const evs = report.events;
    expect(evs.some((e) => e.type === 'prep_phase' && e.phase === 'chenshou')).toBe(true);
    const hit = evs.find((e) => e.type === 'status_inflicted' && e.statusType === 'attack_buff');
    expect(hit).toBeTruthy();
    // 面板 100 → +10% = 110；文案走属性类专用分支（与宝物同口径：只有通用兜底分支带「宝物【】」式来源前缀）
    expect((hit as { detail: string }).detail).toContain('攻击属性提高');
  });

  it('未使用特性 → 事件流没有 chenshou 阶段、也没有相关状态（反向对照）', () => {
    const report = runBattle(cfg([mk({ id: 'a' })], enemy()));
    expect(report.events.some((e) => e.type === 'prep_phase' && e.phase === 'chenshou')).toBe(false);
    expect(report.events.some((e) => e.type === 'status_inflicted' && e.detail.includes('陈寿特性'))).toBe(false);
  });

  it('昂扬·攻（玩家选满 10%）确实提高普攻伤害（同种子对比基线）', () => {
    const totalHit = (r: ReturnType<typeof runBattle>): number =>
      r.events.filter((e) => e.type === 'attack_hit').reduce((a, e) => a + ((e as { damage: number }).damage ?? 0), 0);

    const base = runBattle(cfg([mk({ id: 'a', attack: 120 })], enemy()));
    const buffed = runBattle(cfg([mk({ id: 'a', attack: 120, chenshou: { featureId: 'cs_106007', value: 10 } })], enemy()));
    expect(totalHit(buffed)).toBeGreaterThan(totalHit(base));
  });

  it('审慎·攻（玩家选满 10%）确实降低承受的攻击伤害（同种子对比基线）', () => {
    const takenDamage = (r: ReturnType<typeof runBattle>): number =>
      r.events
        .filter((e) => e.type === 'attack_hit' && (e as { targetId: string }).targetId === 'a')
        .reduce((a, e) => a + ((e as { damage: number }).damage ?? 0), 0);

    // 敌方正常还手（非木桩），我方被打
    const foes = () => [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')];
    const base = runBattle(cfg([mk({ id: 'a', attack: 120, defense: 100 })], foes()));
    const buffed = runBattle(
      cfg([mk({ id: 'a', attack: 120, defense: 100, chenshou: { featureId: 'cs_106009', value: 10 } })], foes()),
    );
    expect(takenDamage(buffed)).toBeLessThan(takenDamage(base));
  });

  it('砥砺分配为纯攻击时，输出高于纯速度分配（同种子）', () => {
    const totalHit = (r: ReturnType<typeof runBattle>): number =>
      r.events.filter((e) => e.type === 'attack_hit').reduce((a, e) => a + ((e as { damage: number }).damage ?? 0), 0);

    const atk = runBattle(
      cfg([mk({ id: 'a', attack: 120, chenshou: { featureId: 'cs_106005', value: 12, alloc: { attack: 12, defense: 0, strategy: 0, speed: 0 } } })], enemy()),
    );
    const spd = runBattle(
      cfg([mk({ id: 'a', attack: 120, chenshou: { featureId: 'cs_106005', value: 12, alloc: { attack: 0, defense: 0, strategy: 0, speed: 12 } } })], enemy()),
    );
    expect(totalHit(atk)).toBeGreaterThan(totalHit(spd));
  });
});

describe('陈寿·出师·持重（统率提升 → 属性 / 成长率）', () => {
  const CHIZHONG = { featureId: 'cs_106001', value: 0.5 };

  it('数据表覆盖 150+ 名武将，且增量只落在攻击 / 防御 / 谋略（速度恒 0）', () => {
    const ids = Object.keys(CHENSHOU_CHIZHONG);
    expect(ids.length).toBeGreaterThan(150);
    let sawSpeedDelta = 0;
    for (const id of ids) {
      const v = CHENSHOU_CHIZHONG[id];
      if (v.base[3] !== 0 || v.grow[3] !== 0) sawSpeedDelta += 1;
      expect(v.base[0] + v.base[1] + v.base[2]).toBeGreaterThan(0);
      expect(v.cost % 0.5).toBe(0); // 统率按 0.5 步进
    }
    expect(sawSpeedDelta).toBe(0);
  });

  it('chenshouStatPatch 只对「持重」生效；非持重 / 未收录武将返回 null', () => {
    expect(chenshouStatPatch('h4', CHIZHONG)).toBeTruthy();
    expect(chenshouStatPatch('h4', { featureId: 'cs_106004', value: 5 })).toBeNull();
    expect(chenshouStatPatch('h4')).toBeNull();
    expect(chenshouStatPatch('hero-not-in-table', CHIZHONG)).toBeNull();
  });

  it('buildGeneral：蔡文姬带持重 → 统率 2→2.5，攻/防/谋 提升，速度不变', () => {
    const plain = buildGeneral('h4', [], {}, '前锋', 0, 40, 120, undefined, undefined, null, undefined);
    const withCs = buildGeneral('h4', [], {}, '前锋', 0, 40, 120, undefined, undefined, null, CHIZHONG);
    expect(plain.cost).toBe(2);
    expect(withCs.cost).toBe(2.5);
    expect(withCs.attack).toBeGreaterThan(plain.attack);
    expect(withCs.defense).toBeGreaterThan(plain.defense);
    expect(withCs.strategy).toBeGreaterThan(plain.strategy);
    expect(withCs.speed).toBe(plain.speed);
    // 包内持重后档案：base 65/78/96/85、成长 0.94/0.93/1.5/0.95（40 级 = base + 39×成长，逐项四舍五入）
    expect(withCs.attack).toBe(Math.round(65 + 39 * 0.94));
    expect(withCs.defense).toBe(Math.round(78 + 39 * 0.93));
    expect(withCs.strategy).toBe(Math.round(96 + 39 * 1.5));
  });

  it('prepass 幂等：构造期已应用后不再二次 +0.5', () => {
    const g = buildGeneral('h4', [], {}, '前锋', 0, 40, 120, undefined, undefined, null, CHIZHONG);
    expect(g.cost).toBe(2.5);
    applyChenshouPrepass([g]);
    expect(g.cost).toBe(2.5);
  });

  it('引擎未收录该武将时兜底：属性不变，统率仍按 +0.5 结算', () => {
    const g = mk({ id: '未收录将', heroId: '未收录将', cost: 3, chenshou: CHIZHONG });
    applyChenshouPrepass([g]);
    expect(g.cost).toBe(3.5);
  });

  it('未使用持重时 buildGeneral 面板与原值一致（反向对照）', () => {
    const plain = buildGeneral('h4', [], {}, '前锋', 0, 40, 120, undefined, undefined, null, undefined);
    const other = buildGeneral('h4', [], {}, '前锋', 0, 40, 120, undefined, undefined, null, { featureId: 'cs_106004', value: 10 });
    expect(other.cost).toBe(plain.cost);
    expect(other.attack).toBe(plain.attack);
    expect(other.strategy).toBe(plain.strategy);
  });
});
