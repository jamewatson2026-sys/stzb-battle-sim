/**
 * 取证（2026-10-17 避锐入池）：把「吃到避锐」的伤害事件原样落盘，供战报侧核对 ——
 * `modifiers.reduce` 里必须出现 `{ skillName: '避锐', direction: 'reduce' }`，
 * 且事件带 `modifiers.avoidUnitId === 受击者 id`（战报「此次伤害共计降低 x%」直接读 reduce）。
 * 用法：node .\node_modules\tsx\dist\cli.mjs scripts/_evidence_avoid_event.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
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

const luxun: General = {
  ...plain('lu_xun_xp', '大营'),
  strategy: 100,
  mainSkillId: 'pibing_juyi',
  mainSkillName: '疲兵沮意',
  commandSkillIds: ['pibing_juyi'],
};

const { events } = runBattle({
  myTeam: [plain('m-front', '前锋'), plain('m-mid', '中军'), luxun],
  enemyTeam: [plain('e-front', '前锋'), plain('e-mid', '中军'), plain('e-back', '大营')],
  seed: 20261017,
  maxRounds: 8,
});

type DmgEv = Extract<BattleEvent, { type: 'damage' | 'attack_hit' | 'split_damage' }>;
const hits = events.filter(
  (ev): ev is DmgEv =>
    (ev.type === 'damage' || ev.type === 'attack_hit' || ev.type === 'split_damage') &&
    !!ev.modifiers?.reduce.some((s) => s.skillName === '避锐')
);

const out = {
  seed: 20261017,
  rounds: 8,
  avoidHitEvents: hits.length,
  firstHit: hits[0] ?? null,
  note: 'web/battleView.ts 的「此次伤害共计降低 x%」只读 modifiers.reduce ⇒ 避锐现在自动进该行（此前只走独立乘区、不进战报）',
};
mkdirSync('docs/诊断-2026-10-17', { recursive: true });
writeFileSync('docs/诊断-2026-10-17/避锐事件片段.json', JSON.stringify(out, null, 2), 'utf8');
console.log('avoidHitEvents =', hits.length);
console.log('first.avoidUnitId =', hits[0]?.modifiers?.avoidUnitId);
console.log('first.reduce =', JSON.stringify(hits[0]?.modifiers?.reduce));
