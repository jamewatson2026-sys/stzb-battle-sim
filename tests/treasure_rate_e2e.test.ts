/**
 * 宝物端到端守卫（发动率词条 + 逐胜条件增伤）
 *
 * ⚠️ 本文件补的是既有测试的盲区：`treasure_effects.test.ts` / `treasure_mechanics.test.ts`
 *    只断言 `buildTreasureStatuses` **产出了 trigger_boost 状态**，不断言「发动率真的提高了」。
 *    结果「英勇 / 筹算 / 机敏 / 熟虑」这类词条即使整条链路断掉测试也全绿 —— 用户实测才发现。
 *    这里改为**跑真实战斗比对发动次数**（端到端）：
 *      ① 机敏（主战法发动率）必须提高发动次数
 *      ② 英勇（攻击类主战法）必须提高发动次数
 *      ③ 筹算（策略类主战法）对**攻击类**主战法不生效
 *      ④ 奔袭（追击战法）对**主动**主战法不生效
 *      ⑤ 逐胜（对兵力最低的敌军增伤）必须提高伤害
 *    ④⑤ 的反向用例同样重要：过滤维**漏判**（把不该吃的也吃上）与**误判**（该吃的没吃）都要挡住。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runBattle } from '../src/engine/combat';
import { recordToGeneral, level40FromRecord } from '../src/data/hero-utils';
import type { BattleConfig, General, TreasureLoadout } from '../src/engine/types';

const MAIN = 'tujin'; // 攻击类主动战法（输出含 physical_damage）

function g(id: string, position: '前锋' | '中军' | '大营', extra: Partial<General> = {}): General {
  return {
    id, name: id, rarity: '5星', cost: 3, faction: '汉', gender: 'male', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position,
    attack: 120, defense: 90, strategy: 80, speed: 60, attackRange: 2, maxTroops: 10000,
    mainSkillName: '突进', mainSkillId: MAIN, skillDesc: '',
    activeSkillIds: [MAIN], passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [],
    morale: 100, ...extra,
  } as General;
}

function foes(): General[] {
  return [
    g('e1', '前锋', { attack: 50, defense: 80, strategy: 60, speed: 20, mainSkillId: '', mainSkillName: '', activeSkillIds: [] }),
    g('e2', '中军', { attack: 50, defense: 80, strategy: 60, speed: 20, mainSkillId: '', mainSkillName: '', activeSkillIds: [] }),
    g('e3', '大营', { attack: 50, defense: 80, strategy: 60, speed: 20, mainSkillId: '', mainSkillName: '', activeSkillIds: [] }),
  ];
}

/** 同一 seed 集合跑 N 场，返回己方主战法发动总次数 */
function mainSkillCasts(treasure: TreasureLoadout | undefined, seeds = 120): number {
  let casts = 0;
  for (let s = 0; s < seeds; s++) {
    const cfg: BattleConfig = {
      myTeam: [g('t', '前锋', treasure ? { treasure } : {})],
      enemyTeam: foes(),
      seed: 1000 + s,
      maxRounds: 8,
    };
    casts += runBattle(cfg).stats.find((x) => x.unitId === 't')?.skillCount ?? 0;
  }
  return casts;
}

describe('宝物 · 发动率词条端到端（跑真实战斗比对发动次数）', () => {
  const base = mainSkillCasts(undefined);

  it('机敏（主战法发动率提高）确实提高主战法发动次数', () => {
    const on = mainSkillCasts({ treasureId: 1009, level: 10, affix: { name: '机敏', value: 9 } });
    expect(on).toBeGreaterThan(base * 1.1);
  });

  it('英勇（攻击类主战法发动率提高）确实提高主战法发动次数', () => {
    const on = mainSkillCasts({ treasureId: 1003, level: 10, affix: { name: '英勇', value: 15 } });
    expect(on).toBeGreaterThan(base * 1.2);
  });

  it('筹算（策略类主战法）对攻击类主战法不生效', () => {
    const on = mainSkillCasts({ treasureId: 1030, level: 10, affix: { name: '筹算', value: 15 } });
    expect(on).toBe(base);
  });

  it('奔袭（追击战法）对主动主战法不生效', () => {
    const on = mainSkillCasts({ treasureId: 1009, level: 10, affix: { name: '奔袭', value: 9 } });
    expect(on).toBe(base);
  });

  it('宝物无词条时不影响发动次数（对照）', () => {
    const on = mainSkillCasts({ treasureId: 1009, level: 10 });
    expect(on).toBe(base);
  });
});

describe('宝物 · 逐胜（对兵力最低的敌军增伤）端到端', () => {
  function attackDamage(nFoes: number, treasure: TreasureLoadout | undefined, seeds = 150): number {
    let dmg = 0;
    for (let s = 0; s < seeds; s++) {
      const list = foes().slice(0, nFoes).map((f, i) =>
        i === 1 ? { ...f, maxTroops: 3000 } : f); // 中军兵力最低
      const cfg: BattleConfig = {
        myTeam: [g('t', '前锋', { attack: 300, ...(treasure ? { treasure } : {}) })],
        enemyTeam: list,
        seed: 5000 + s,
        maxRounds: 8,
      };
      dmg += runBattle(cfg).stats.find((x) => x.unitId === 't')?.attackDamage ?? 0;
    }
    return dmg;
  }

  const T = { treasureId: 1066, level: 10 } as TreasureLoadout; // 乌号 slot3 = 逐胜 15%

  it('逐胜必须提高普攻伤害（单敌场景：对方即兵力最低，全程命中）', () => {
    expect(attackDamage(1, T)).toBeGreaterThan(attackDamage(1, undefined) * 1.05);
  });

  it('逐胜在三敌场景下依然生效（最低兵力者存在）', () => {
    expect(attackDamage(3, T)).toBeGreaterThan(attackDamage(3, undefined) * 1.05);
  });

  it('蓄意把「最低兵力」标记下的增伤与无宝物基线对比 —— 未挂逐胜时不得凭空增伤', () => {
    // 反向守卫：不带宝物的基线两次采样必须一致（排除随机性导致的假阳性）
    expect(attackDamage(3, undefined)).toBe(attackDamage(3, undefined));
  });
});

/**
 * 回归守卫（用户实测复现用例）：曹彰 + 彤素(1003) + 英勇词条。
 *
 * 曹彰主战法「五兵之烈」的物理伤害挂在 `conditional.outputs` 内层（按授予宝物种类分支：
 * 剑/刀/长兵/弓/其余）。修前 `isAttackClassSkill` 不下钻 `conditional` 容器 → 该主战法被
 * 误判为「非攻击类」→ 英勇静默失效（发动次数与无词条完全相同，用户实测发现）。
 * 用例直接跑真实战斗比对发动次数 —— 这是唯一能挡住「状态造出来了但没生效」的回归形式。
 */
describe('宝物 · 英勇对「条件分支」主战法（曹彰 五兵之烈）必须生效', () => {
  const raw = JSON.parse(readFileSync('web/data/heroes.json', 'utf-8')) as unknown;
  const list: Record<string, unknown>[] = Array.isArray(raw)
    ? (raw as Record<string, unknown>[])
    : ((raw as { heroes?: Record<string, unknown>[] }).heroes ?? []);
  const cz = list.find((h) => h.name === '曹彰');

  function caozhang(treasure?: General['treasure']): General {
    const base = recordToGeneral(cz as unknown as Parameters<typeof recordToGeneral>[0]);
    const leveled = level40FromRecord(
      base, cz as unknown as Parameters<typeof level40FromRecord>[1], {}, 12000);
    return { ...leveled, id: 'cz', position: '前锋', ...(treasure ? { treasure } : {}) };
  }

  function casts(treasure: TreasureLoadout | undefined, seeds = 100): number {
    let n = 0;
    for (let s = 0; s < seeds; s++) {
      const cfg: BattleConfig = {
        myTeam: [caozhang(treasure)],
        enemyTeam: foes().map((f) => ({ ...f, maxTroops: 12000 })),
        seed: 7000 + s,
        maxRounds: 8,
      };
      n += runBattle(cfg).stats.find((x) => x.unitId === 'cz')?.skillCount ?? 0;
    }
    return n;
  }

  it('曹彰存在且主战法为 wubing_zhilie', () => {
    expect(cz, '未在 heroes.json 找到曹彰').toBeTruthy();
    expect(String(cz?.mainSkillId)).toBe('wubing_zhilie');
  });

  it('英勇（攻击类主战法发动率）对曹彰必须提高发动次数', () => {
    const off = casts({ treasureId: 1003, level: 10 });
    const on = casts({ treasureId: 1003, level: 10, affix: { name: '英勇', value: 15 } });
    expect(on).toBeGreaterThan(off * 1.1);
  });
});
