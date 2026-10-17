/**
 * 探针 2：①一夫当关（援护友军全体）+ 连击第二刀；②舍身卫主（承担攻击伤害）+ 追击目标是否跟随。
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

const PURSUIT = ['fangzhen_tuji', 'shengqi_hengling', 'shichou'];

// ── A：一夫当关（蓝前锋援护全体 2 回合）+ 红前锋连击 ──
const redA: General[] = [
  mk('red-back', '红大营', '大营'),
  mk('red-mid', '红中军', '中军'),
  mk('red-front', '红前锋', '前锋', { attack: 200, speed: 200, attackRange: 5, passiveSkillIds: ['hongyan_tieqi'] }),
];
const blueA: General[] = [
  mk('blue-back', '蓝大营', '大营', { defense: 50 }),
  mk('blue-mid', '蓝中军', '中军', { defense: 50 }),
  mk('blue-front', '蓝前锋', '前锋', { defense: 50, commandSkillIds: ['yifudangguan'] }),
];

let aHits = 0, aOffGuard = 0, aOffGuardRound12 = 0;
for (let seed = 1; seed <= 20; seed++) {
  const { events } = runBattle({ myTeam: redA, enemyTeam: blueA, seed, maxRounds: 4 });
  let round = 0;
  for (const ev of events) {
    if (ev.type === 'round_start') { round = (ev as any).round; continue; }
    if (ev.type === 'attack_hit' && ev.sourceId === 'red-front') {
      aHits++;
      if (ev.targetId !== 'blue-front') {
        aOffGuard++;
        if (round <= 2) aOffGuardRound12++;
      }
    }
  }
}
console.log(`[A 一夫当关] 红前锋普攻 ${aHits}，未落在援护者 ${aOffGuard}（其中前2回合 ${aOffGuardRound12}）`);

// ── B：舍身卫主（蓝前锋承担攻击伤害）+ 红前锋追击 ──
const redB: General[] = [
  mk('red-back', '红大营', '大营'),
  mk('red-mid', '红中军', '中军'),
  mk('red-front', '红前锋', '前锋', {
    attack: 200, speed: 200, attackRange: 5, pursuitSkillIds: PURSUIT,
  }),
];
const blueB: General[] = [
  mk('blue-back', '蓝大营', '大营', { defense: 50 }),
  mk('blue-mid', '蓝中军', '中军', { defense: 50 }),
  mk('blue-front', '典韦', '前锋', { defense: 50, passiveSkillIds: ['sheshen_weizhu'] }),
];

let bHits = 0, bPursuit = 0, bPursuitOff = 0;
const samples: string[] = [];
for (let seed = 1; seed <= 20; seed++) {
  const { events } = runBattle({ myTeam: redB, enemyTeam: blueB, seed, maxRounds: 4 });
  let round = 0;
  let lastBasic: string | null = null;
  for (const ev of events) {
    if (ev.type === 'round_start') { round = (ev as any).round; continue; }
    if (ev.type === 'attack_hit' && ev.sourceId === 'red-front') {
      bHits++;
      lastBasic = ev.targetId;
      if (samples.length < 12 && ev.targetId !== 'blue-front') samples.push(`R${round} 普攻 -> ${ev.targetId}`);
    }
    if (ev.type === 'damage' && (ev as any).skillId && PURSUIT.includes((ev as any).skillId) && ev.sourceId === 'red-front') {
      bPursuit++;
      if (lastBasic && ev.targetId !== lastBasic) {
        bPursuitOff++;
        if (samples.length < 12) samples.push(`  R${round} 追击 -> ${ev.targetId}（普攻目标 ${lastBasic}）`);
      }
    }
  }
}
console.log(`[B 舍身卫主] 红前锋普攻 ${bHits}，追击命中 ${bPursuit}，追击目标≠本刀普攻目标 ${bPursuitOff}`);
console.log(samples.join('\n'));
