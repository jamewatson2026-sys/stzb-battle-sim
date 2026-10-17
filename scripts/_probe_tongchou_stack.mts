/** 同仇敌忾：同一施法者连续触发是否累加；谋略对应的增伤/减伤数值是否一致。 */
import { runBattle } from '../src/engine/combat';
import type { General, Position } from '../src/engine/types';

function plain(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id, name: id, rarity: '4星', cost: 1, faction: '汉', tags: [], mutualExclusionGroup: null,
    troopType: 'infantry', position, attack: 120, defense: 100, strategy: 267, speed: 60,
    attackRange: 2, maxTroops: 9000, mainSkillName: '', skillDesc: '', activeSkillIds: [],
    passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [], morale: 100, ...extra,
  };
}

const lushu: General = {
  ...plain('lu_su', '前锋', { strategy: 267, attackRange: 3 }),
  mainSkillId: 'tongchou_dikai', mainSkillName: '同仇敌忾',
  passiveSkillIds: ['tongchou_dikai'],
  commandSkillIds: ['biqi_fengmang'],
};
const mate: General = { ...plain('mate', '中军', { strategy: 267 }) };
const mate2: General = { ...plain('mate2', '大营', { strategy: 267 }) };
const enemy: General = { ...plain('e', '大营', { strategy: 200 }), commandSkillIds: [], activeSkillIds: [] };

// 让木桩每回合都挨打：我方只用普攻（attack 高、range 2）
const { events } = runBattle({
  myTeam: [lushu, mate, mate2],
  enemyTeam: [plain('e-front', '前锋'), plain('e-mid', '中军'), enemy],
  seed: 7,
  maxRounds: 5,
});

console.log('—— 同仇敌忾 相关 status_inflicted（全部）——');
for (const e of events) {
  if (e.type !== 'status_inflicted') continue;
  const d = String((e as any).detail ?? '');
  if (!/0\.0|减伤|提高/.test(d)) continue;
  if (!['lu_su', 'mate', 'mate2'].includes((e as any).unitId)) continue;
  console.log(' ', JSON.stringify(e));
}
console.log('\n—— status_conflict ——');
for (const e of events.filter((x) => x.type === 'status_conflict')) console.log(' ', JSON.stringify(e));
