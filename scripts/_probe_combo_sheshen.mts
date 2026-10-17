import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';
function mk(id: string, name: string, position: Position, o: Partial<General> = {}): General {
  return { id, name, rarity: '4星', cost: 1, faction: '汉', tags: [], mutualExclusionGroup: null,
    troopType: 'infantry', position, attack: 60, defense: 100, strategy: 60, speed: 50, attackRange: 2,
    maxTroops: 20000, mainSkillName: '', skillDesc: '', commandSkillIds: [], activeSkillIds: [],
    passiveSkillIds: [], pursuitSkillIds: [], morale: 100, ...o } as General;
}
const red: General[] = [
  mk('red-back','红大营','大营'),
  mk('red-mid','红中军','中军'),
  mk('red-front','红前锋','前锋',{ attack:200, speed:200, attackRange:5, passiveSkillIds:['hongyan_tieqi'] }),
];
const blue: General[] = [
  mk('blue-back','蓝大营','大营',{ defense:50 }),
  mk('blue-mid','蓝中军','中军',{ defense:50 }),
  mk('blue-front','典韦','前锋',{ defense:50, passiveSkillIds:['sheshen_weizhu'] }),
];
let secondOff = 0, pairs = 0;
const samples: string[] = [];
for (let seed = 1; seed <= 30; seed++) {
  const { events } = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 3 });
  let round = 0; const perRound: string[] = [];
  for (const ev of events) {
    if (ev.type === 'round_start') { round = (ev as any).round; perRound.length = 0; continue; }
    if (ev.type === 'attack_hit' && ev.sourceId === 'red-front') {
      perRound.push(ev.targetId);
      if (perRound.length === 2) {
        pairs++;
        if (perRound[1] !== 'blue-front') { secondOff++; if (samples.length<10) samples.push(`seed${seed} R${round} 两刀 = ${perRound.join(' / ')}`); }
      }
    }
  }
}
console.log(`[连击+舍身卫主] 两刀成对 ${pairs}，第二刀未落在典韦 ${secondOff}`);
console.log(samples.join('\n'));
