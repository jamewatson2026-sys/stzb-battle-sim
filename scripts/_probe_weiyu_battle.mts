/**
 * 探针：未雨绸缪 在**真实战斗**里的再次发动（跨回合）。
 * 用法：npx tsx scripts/_probe_weiyu_battle.mts
 */
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';

function mk(id: string, name: string, position: Position, opts: Partial<General> = {}): General {
  return {
    id, name, rarity: '4星', cost: 1, faction: '汉', tags: [], mutualExclusionGroup: null,
    troopType: 'infantry', position, attack: 60, defense: 100, strategy: 160, speed: 50, attackRange: 2,
    maxTroops: 20000, mainSkillName: '', skillDesc: '', commandSkillIds: [], activeSkillIds: [],
    passiveSkillIds: [], pursuitSkillIds: [], morale: 100, ...opts,
  };
}

function side(): [General[], General[]] {
  const my = [
    mk('my-back', '我方大营', '大营', { activeSkillIds: ['weiyu_choumou', 'luolei'] }),
    mk('my-mid', '我方中军', '中军'),
    mk('my-front', '我方前锋', '前锋'),
  ];
  const enemy = [
    mk('en-back', '敌方大营', '大营'),
    mk('en-mid', '敌方中军', '中军'),
    mk('en-front', '敌方前锋', '前锋'),
  ];
  return [my, enemy];
}

let totalCasts = 0;
let totalSuccess = 0;
let totalRecast = 0;
let markerApplied = 0;
for (let seed = 1; seed <= 30; seed++) {
  const [my, enemy] = side();
  const { events } = runBattle({ myTeam: my, enemyTeam: enemy, seed, maxRounds: 8 });
  const casts = events.filter((e) => e.type === 'skill_cast');
  const triggers = events.filter((e) => e.type === 'skill_trigger');
  const wyCasts = casts.filter((e) => (e as { skillId?: string }).skillId === 'weiyu_choumou');
  const wyOk = triggers.filter((e) => (e as { skillId?: string }).skillId === 'weiyu_choumou' && (e as { success?: boolean }).success);
  const llCasts = casts.filter((e) => (e as { skillId?: string }).skillId === 'luolei');
  const llOk = triggers.filter((e) => (e as { skillId?: string }).skillId === 'luolei' && (e as { success?: boolean }).success);
  totalCasts += llCasts.length;
  totalSuccess += llOk.length;
  markerApplied += wyOk.length;
  if (llCasts.length > llOk.length) totalRecast += llCasts.length - llOk.length;
}

console.log('30 局 × 8 回合：未雨绸缪成功发动', markerApplied, '次');
console.log('落雷 skill_trigger 成功', totalSuccess, '次 / skill_cast', totalCasts, '次 → 再次发动', totalRecast, '次');

// 再看：标记实际存在的回合分布（status_inflicted repeat_strategy）
{
  const [my, enemy] = side();
  const { events } = runBattle({ myTeam: my, enemyTeam: enemy, seed: 3, maxRounds: 8 });
  const stamped = events.filter((e) => e.type === 'status_inflicted' &&
    (e as { detail?: string }).detail?.includes('未雨绸缪'));
  console.log('seed=3 未雨绸缪状态施加事件', stamped.length, '条');
  const casts = events.filter((e) => e.type === 'skill_cast').map((e) => (e as { skillId?: string }).skillId);
  console.log('skill_cast 序列:', casts.join(' '));
}
