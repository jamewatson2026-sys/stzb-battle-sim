/** 排查：同仇敌忾的叠层减伤被「减伤冲突，数值取较高 0.05」吞掉，找出冲突对象。 */
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';

function plain(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id, name: id, rarity: '4星', cost: 1, faction: '汉', tags: [], mutualExclusionGroup: null,
    troopType: 'infantry', position, attack: 120, defense: 100, strategy: 80, speed: 60,
    attackRange: 2, maxTroops: 9000, mainSkillName: '', skillDesc: '', activeSkillIds: [],
    passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [], morale: 100, ...extra,
  };
}

const lushu: General = {
  ...plain('lu_su', '前锋', { strategy: 260, attackRange: 3 }),
  mainSkillId: 'tongchou_dikai', mainSkillName: '同仇敌忾',
  passiveSkillIds: ['tongchou_dikai'],
  commandSkillIds: ['biqi_fengmang', 'wuxin_lianzhan'],
};
const simayi: General = {
  ...plain('si_ma_yi', '中军', { strategy: 240 }),
  commandSkillIds: ['shenbing_tianjiang', 'jiuzhan_shumou'],
};
const zhouyu: General = { ...plain('zhou_yu_xp', '大营', { strategy: 220 }), commandSkillIds: [] };

const xunyu: General = { ...plain('xun_yu', '大营', { strategy: 200 }), commandSkillIds: ['zhongmou_buxie'], activeSkillIds: ['quhu_tunlang'] };
const luxun: General = { ...plain('lu_xun', '中军', { strategy: 220 }), activeSkillIds: [] };

const { events } = runBattle({
  myTeam: [lushu, simayi, zhouyu],
  enemyTeam: [plain('e-front', '前锋'), luxun, xunyu],
  seed: 20261018,
  maxRounds: 4,
});

const confl = events.filter((e) => e.type === 'status_conflict');
console.log('status_conflict 总数 =', confl.length);
for (const e of confl) console.log(' ', JSON.stringify(e));
const inf = events.filter((e) => e.type === 'status_inflicted' && /减伤|提高/.test(String((e as any).detail)));
console.log('\nstatus_inflicted(减伤/提高) 前 20：');
for (const e of inf.slice(0, 20)) console.log(' ', JSON.stringify(e));
