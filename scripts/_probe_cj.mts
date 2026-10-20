import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General } from '../src/engine/types';
const gen = (p: Partial<General> & { id: string; position: General['position'] }): General => ({
  id: p.id, name: p.id, rarity: '5星', cost: 3, faction: '汉', tags: [], mutualExclusionGroup: null,
  troopType: 'infantry', attack: p.attack ?? 100, defense: p.defense ?? 100, strategy: p.strategy ?? 100,
  speed: p.speed ?? 50, attackRange: p.attackRange ?? 2, maxTroops: 9000, mainSkillName: '', skillDesc: '',
  activeSkillIds: p.activeSkillIds ?? [], passiveSkillIds: p.passiveSkillIds ?? [],
  commandSkillIds: p.commandSkillIds ?? [], pursuitSkillIds: p.pursuitSkillIds ?? [], morale: 100,
  position: p.position, ...(p.mainSkillId ? { mainSkillId: p.mainSkillId } : {}),
});
const my = [
  gen({ id: 'g', position: '前锋', attack: 280, defense: 130, speed: 70, attackRange: 3, mainSkillId: 'jinguo_zhanzhen', activeSkillIds: ['jinguo_zhanzhen'], passiveSkillIds: ['jishi'], commandSkillIds: ['chengjian_jixi'] }),
  gen({ id: 'm', position: '中军', attack: 120, defense: 150, speed: 50 }),
  gen({ id: 'b', position: '大营', attack: 100, defense: 150, strategy: 200, speed: 40 }),
];
const foes = ['f','m','b'].map((x) => gen({ id: 'e-'+x, position: (x==='f'?'前锋':x==='m'?'中军':'大营') as any, attack: 60, defense: 120, speed: 20, maxTroops: 20000 }));
const rep = runBattle({ myTeam: my, enemyTeam: foes, seed: 3, maxRounds: 8 });
for (const ev of rep.events as BattleEvent[]) {
  const involved = ('unitId' in ev && ev.unitId === 'g') || ('sourceId' in ev && (ev as any).sourceId === 'g');
  if (involved && ev.type !== 'attack_hit' && ev.type !== 'damage') console.log(JSON.stringify(ev).slice(0, 220));
  if (ev.type === 'skill_cast' && ev.unitId === 'g') console.log(`[r?] cast ${ev.skillName}`);
  if (ev.type === 'status_inflicted' && ev.unitId === 'g' && ev.statusType === 'damage_boost') console.log('  boost+ ', ev.detail);
  if (ev.type === 'status_expired' && ev.unitId === 'g' && ev.statusType === 'damage_boost') console.log('  boost- ', ev.detail ?? '');
  if (ev.type === 'damage' && ev.skillId === 'chengjian_jixi') {
    const cj = (ev.modifiers?.caused ?? []).filter((m) => m.skillName === '乘间击隙').map((m) => m.rate);
    console.log(`  BURST dmg=${ev.damage} 乘间 layers=${JSON.stringify(cj)} allCaused=${JSON.stringify((ev.modifiers?.caused ?? []).map((m) => m.skillName + ':' + m.rate))}`);
  }
}
