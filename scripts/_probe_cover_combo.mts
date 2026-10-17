/**
 * 探针：援护（cover）在「连击第二刀」与「追击战法」上的目标口径。
 * 用法：npx tsx scripts/_probe_cover_combo.mts > tmp/probe.txt
 */
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';

function mk(id: string, name: string, position: Position, o: Partial<General> = {}): General {
  return {
    id, name, rarity: '4星', cost: 1, faction: '汉', tags: [], mutualExclusionGroup: null,
    troopType: 'infantry', position,
    attack: 60, defense: 100, strategy: 60, speed: 50, attackRange: 2, maxTroops: 20000,
    mainSkillName: '', skillDesc: '',
    commandSkillIds: [], activeSkillIds: [], passiveSkillIds: [], pursuitSkillIds: [],
    morale: 100,
    ...o,
  } as General;
}

// 红：前锋 连击（红颜铁骑：每回合开始给自己连击 1 回合）+ 追击（方阵突击 30%），攻击距离 5
const red: General[] = [
  mk('red-back', '红大营', '大营'),
  mk('red-mid', '红中军', '中军'),
  mk('red-front', '红前锋', '前锋', {
    attack: 200, defense: 100, speed: 200, attackRange: 5,
    passiveSkillIds: ['hongyan_tieqi'],
    pursuitSkillIds: ['fangzhen_tuji', 'shengqi_hengling', 'shichou'],
  }),
];
// 蓝：中军 大将（护主：前 2 回合援护我军大营 = blue-back）
const blue: General[] = [
  mk('blue-back', '蓝大营', '大营', { defense: 50 }),
  mk('blue-mid', '蓝中军', '中军', { defense: 50, treasure: { treasureId: 1072, level: 10 } }),
  mk('blue-front', '蓝前锋', '前锋', { defense: 50 }),
];

let basicHits = 0;
let hitsOnProtected = 0;
let pursuitHits = 0;
let pursuitOffTarget = 0;

for (let seed = 1; seed <= 20; seed++) {
  const { events } = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 4 });
  let lastBasicTarget: string | null = null;
  const lines: string[] = [];
  for (const ev of events) {
    const e = ev as BattleEvent & Record<string, unknown>;
    if (e.type === 'round_start') lines.push(`--- 第 ${(e as any).round} 回合`);
    if (e.type === 'cover') lines.push(`  [cover] ${e.unitId} 为 ${e.targetId}`);
    if (e.type === 'attack_hit') {
      basicHits++;
      lastBasicTarget = e.targetId as string;
      if (e.targetId === 'blue-back') hitsOnProtected++;
      lines.push(`  [普攻] ${e.sourceId} -> ${e.targetId} dmg=${e.damage}`);
    }
    if (e.type === 'damage' && (e as any).skillId && ['fangzhen_tuji', 'shengqi_hengling', 'shichou'].includes((e as any).skillId)) {
      pursuitHits++;
      if (lastBasicTarget && e.targetId !== lastBasicTarget) pursuitOffTarget++;
      lines.push(`  [追击] ${(e as any).skillId} ${e.sourceId} -> ${e.targetId} (普攻目标=${lastBasicTarget})`);
    }
  }
  if (seed <= 3) console.log(`\n===== seed ${seed} =====\n` + lines.join('\n'));
}

console.log(`\n[汇总] 普攻命中 ${basicHits}，其中打中被保护的大营 ${hitsOnProtected}`);
console.log(`[汇总] 追击命中 ${pursuitHits}，其中目标≠本刀普攻目标 ${pursuitOffTarget}`);
