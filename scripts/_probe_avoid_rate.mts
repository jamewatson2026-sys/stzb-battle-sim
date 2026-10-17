import { runBattle } from '../src/engine/combat';
import type { General, Position } from '../src/engine/types';

function plain(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id, name: id, rarity: '4星', cost: 1, faction: '汉', tags: [], mutualExclusionGroup: null,
    troopType: 'infantry', position, attack: 120, defense: 100, strategy: 80, speed: 60,
    attackRange: 2, maxTroops: 9000, mainSkillName: '', skillDesc: '', activeSkillIds: [],
    passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [], morale: 100, ...extra,
  };
}
const luxun: General = { ...plain('lu_xun_xp', '大营'), strategy: 100, mainSkillId: 'pibing_juyi', mainSkillName: '疲兵沮意', commandSkillIds: ['pibing_juyi'] };
const { events } = runBattle({
  myTeam: [plain('m-front', '前锋'), plain('m-mid', '中军'), luxun],
  enemyTeam: [plain('e-front', '前锋'), plain('e-mid', '中军'), plain('e-back', '大营')],
  seed: 20261017, maxRounds: 3,
});
for (const ev of events) {
  if (ev.type === 'status_inflicted' && String(ev.statusType) === 'avoid_charge') {
    console.log(ev.unitId, JSON.stringify(ev.detail));
    break;
  }
}
