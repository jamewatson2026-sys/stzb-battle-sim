import { runBattle } from '../src/engine/combat';
import { reportToText } from '../src/engine/report';
import type { General } from '../src/engine/types';

function mk(id: string, patch: Partial<General> = {}): General {
  return {
    id, name: id, rarity: '5星', cost: 3, faction: '汉', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position: '前锋',
    attack: 100, defense: 80, strategy: 80, speed: 50, attackRange: 3,
    maxTroops: 9000, mainSkillName: '', skillDesc: '',
    activeSkillIds: [], passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [], morale: 100,
    ...patch,
  };
}

function run(attack: number, strategy: number) {
  return runBattle({
    myTeam: [mk('a', { activeSkillIds: ['sishuiguan'], attack, strategy })],
    enemyTeam: [mk('e', { defense: 80, maxTroops: 30000 })],
    seed: 1,
    maxRounds: 8,
  });
}

const a = run(300, 50);
const b = run(300, 400);
const c = run(600, 50);
const firstTick = (r: ReturnType<typeof run>) =>
  r.events.find((e) => e.type === 'dot_tick' && e.dotType === 'unrest');
const ta = firstTick(a) as { damage: number; breakdown: { base: number } };
const tb = firstTick(b) as { damage: number; breakdown: { base: number } };
const tc = firstTick(c) as { damage: number; breakdown: { base: number } };
console.log(JSON.stringify({
  attack300Strategy50: { damage: ta.damage, base: ta.breakdown.base },
  attack300Strategy400: { damage: tb.damage, base: tb.breakdown.base },
  attack600Strategy50: { damage: tc.damage, base: tc.breakdown.base },
  unrestInflicted: a.events.filter((e) => e.type === 'status_inflicted' && 'statusType' in e && e.statusType === 'unrest').length,
  panicInflicted: a.events.filter((e) => e.type === 'status_inflicted' && 'statusType' in e && e.statusType === 'panic').length,
}, null, 2));
const text = reportToText(a);
console.log('--- text lines with 动摇/恐慌 ---');
for (const line of text.split('\n')) {
  if (line.includes('动摇') || line.includes('恐慌')) console.log(line);
}
