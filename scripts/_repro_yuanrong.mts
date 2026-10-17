/**
 * 临时复现脚本（debug，前缀 _ 表示非正式产物）：
 *   宝物「元戎」(1102) 三阶特效「迸发」在 黄盖（主战法 烈火焚舟 = 追击）身上是否落下额外目标？
 *
 * 官方文案：首次发动追击主战法时，额外选取攻击距离内 1 个目标
 * 引擎实现：src/engine/treasure.ts（迸发 → treasure_extra_pursuit_target 标记，准备阶段施加）
 *           src/engine/action.ts triggerPursuitSkill（消费标记 + 攻击距离内额外目标）
 *
 * 跑法：npx tsx scripts/_repro_yuanrong.mts
 */
import { runBattle } from '../src/engine/combat';
import { HERO_REGISTRY, initHeroDB, level40 } from '../src/data/heroes';
import type { BattleConfig, General, Side } from '../src/engine/types';

// HERO_REGISTRY 为空表，须先灌数据（MySQL 不可达时自动回退 web/data/heroes.json）
await initHeroDB();

type Pos = '前锋' | '中军' | '大营';

const SEED = 20261015;

function dummy(id: string, position: Pos): General {
  return {
    id,
    name: `木桩-${id}`,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'infantry',
    position,
    attack: 50,
    defense: 80,
    strategy: 60,
    speed: 20,
    attackRange: 2,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
  };
}

/** 黄盖（h783）：主战法 烈火焚舟（追击·100% 发动·DoT）＋ 佩戴元戎 1102（10 级 = 三阶全开） */
function huanggai(position: Pos, secondaryTroop?: string): General {
  const g = level40(HERO_REGISTRY['h783'], { attack: 40 });
  return {
    ...g,
    id: 'huanggai',
    name: '黄盖',
    position,
    ...(secondaryTroop ? { secondaryTroop: secondaryTroop as General['secondaryTroop'] } : {}),
    treasure: { treasureId: 1102, level: 10 },
  };
}

function countBy(ids: string[]): string {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return [...m.entries()].map(([k, v]) => `${k}×${v}`).join(' ') || '无';
}

function scenario(
  label: string,
  myTeam: General[],
  enemyTeam: General[],
  extra: Partial<BattleConfig> = {},
  dumpFirstEvents = false
): void {
  const rep = runBattle({ myTeam, enemyTeam, seed: SEED, maxRounds: 8, ...extra });
  const ev = rep.events;
  const mark = ev.filter((e) => e.type === 'status_inflicted' && e.statusType === 'treasure_extra_pursuit_target');
  const triggers = ev.filter((e) => e.type === 'skill_trigger' && e.skillId === 'liehuo_fenzhou');
  const targets = ev.filter((e) => e.type === 'skill_target' && e.skillId === 'liehuo_fenzhou');
  const burns = ev.filter((e) => e.type === 'status_inflicted' && e.statusType === 'burning');
  const dots = ev.filter((e) => e.type === 'dot_tick' && e.skillId === 'liehuo_fenzhou');
  const huanggaiActs = ev.filter((e) => e.type === 'unit_act_start' && e.unitId === 'huanggai' && e.phase === 'normal_attack');

  console.log(`\n=== ${label} ===`);
  console.log(`  黄盖普攻回合数        : ${huanggaiActs.length}`);
  console.log(`  迸发标记施加          : ${mark.length ? mark.map((e) => e.unitId).join(',') : '无'}`);
  console.log(`  烈火焚舟发动判定      : ${triggers.length} 次（成功 ${triggers.filter((e) => e.success).length}）`);
  console.log(`  烈火焚舟目标选择      : ${targets.map((e) => `第${ev.indexOf(e)}事件→[${e.targetIds.join(',')}]`).join(' | ') || '无'}`);
  console.log(`  燃烧施加（按目标）    : ${countBy(burns.map((e) => e.unitId))}`);
  console.log(`  燃烧跳伤（dot_tick）  : ${dots.length} 次`);

  if (dumpFirstEvents) {
    console.log('  —— 前 30 条相关事件 ——');
    const relevant = ev.filter(
      (e) =>
        (e.type === 'status_inflicted' && (e.statusType === 'burning' || e.statusType === 'treasure_extra_pursuit_target')) ||
        (e.type === 'skill_trigger' && e.skillId === 'liehuo_fenzhou') ||
        (e.type === 'skill_target' && e.skillId === 'liehuo_fenzhou') ||
        (e.type === 'skill_cast' && e.skillId === 'liehuo_fenzhou') ||
        (e.type === 'unit_act_start' && e.unitId === 'huanggai')
    );
    for (const e of relevant.slice(0, 30)) {
      const bits = [e.type, 'unitId' in e ? e.unitId : ''];
      if (e.type === 'skill_target') bits.push(`→[${e.targetIds.join(',')}]`);
      if (e.type === 'skill_trigger') bits.push(`success=${e.success} rate=${e.rate}`);
      if (e.type === 'status_inflicted') bits.push(`${e.statusType}｜${e.detail}`);
      if (e.type === 'unit_act_start') bits.push(`phase=${e.phase}`);
      console.log(`    ${bits.filter(Boolean).join(' ')}`);
    }
  }
}

const enemies3 = (): General[] => [dummy('e-front', '前锋'), dummy('e-mid', '中军'), dummy('e-back', '大营')];
const allies = (): General[] => [dummy('a-mid', '中军'), dummy('a-back', '大营')];

// ① 基准：黄盖 前锋（攻击距离 2）＋ 2 友军 vs 3 敌军 → 攻击距离内应有第二个目标（敌中军，距离 2）
scenario('① 黄盖·前锋（长枪兵·攻击距离2） vs 3 敌军', [huanggai('前锋'), ...allies()], enemies3(), {}, true);

// ② 中军站位：黄盖 中军（攻击距离 2）→ 距离内只有敌前锋（距离 2，= 命中目标）→ 无第二目标
scenario('② 黄盖·中军（攻击距离2） vs 3 敌军', [dummy('a-front', '前锋'), huanggai('中军'), dummy('a-back', '大营')], enemies3());

// ③ 二级兵种 死士：官方「攻击距离固定 1」→ 前锋位只有敌前锋在距离内（= 命中目标）→ 无第二目标
scenario('③ 黄盖·前锋·死士（攻击距离1） vs 3 敌军', [huanggai('前锋', '死士'), ...allies()], enemies3());

// ④ 单敌：距离内只有唯一的敌人（= 命中目标）→ 无第二目标
scenario('④ 黄盖·前锋 vs 单敌', [huanggai('前锋'), ...allies()], [dummy('e-front', '前锋')]);

// ⑤ 两敌：距离内有敌中军（距离 2）→ 应有第二个目标
scenario('⑤ 黄盖·前锋 vs 2 敌军', [huanggai('前锋'), ...allies()], [dummy('e-front', '前锋'), dummy('e-mid', '中军')]);

// ⑥ 木桩不还手（L2 测评口径）：黄盖 前锋 vs 3 木桩 → 应仍有第二个目标
scenario('⑥ 黄盖·前锋 vs 3 木桩（inertSides=敌军）', [huanggai('前锋'), ...allies()], enemies3(), {
  inertSides: ['enemy' as Side],
});
