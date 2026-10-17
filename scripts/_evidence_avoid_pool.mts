/**
 * 取证脚本（一次性）：验证「避锐（avoid_charge）已进入增减伤单一总和池」。
 *
 * 判据：对只吃避锐一项减伤（Σcaused + Σtaken − 1 = 0）的伤害事件，
 *   池化模型 = troopBase + (base + main)（troopBase 不乘 mult，见 formulas.ts calcDamage）
 *   旧独立乘区 = round((troopBase + base + main) × (1 − 避锐率))
 * 即：实际扣兵里 troopBase 那段不再被避锐吃掉 —— 这正是用户报的「独立乘区」差异。
 *
 * 运行：node .\node_modules\tsx\dist\cli.mjs scripts\_evidence_avoid_pool.mts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
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

// 我方大营 = XP陆逊（h791 已下架，直接按战法槽装配）带【疲兵沮意】：一类指挥，我军群体 2 人每回合 +2 层避锐
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
const isDmg = (ev: BattleEvent): ev is DmgEv =>
  ev.type === 'damage' || ev.type === 'attack_hit' || ev.type === 'split_damage';

const rows: Array<Record<string, unknown>> = [];
let avoidHits = 0;
let poolOnlyHits = 0;
let poolMismatch = 0;

for (const ev of events) {
  if (!isDmg(ev)) continue;
  const mods = ev.modifiers;
  if (!mods) continue;
  const avoid = mods.reduce.find((s) => s.skillName === '避锐');
  if (!avoid) continue;
  avoidHits++;

  const caused = mods.caused.reduce((a, s) => a + s.rate, 0);
  const taken = mods.taken.reduce((a, s) => a + s.rate, 0);
  const reduce = mods.reduce.reduce((a, s) => a + s.rate, 0);
  const mult = Math.max(0.1, 1 + caused + taken - reduce);

  // troopBase 段（不乘 mult）+ (base + main)（已乘 mult）
  const expectedPooled = ev.breakdown.troopBase + ev.breakdown.base + ev.breakdown.main;
  const legacyIndependent = Math.max(
    0,
    Math.round((ev.breakdown.troopBase + ev.breakdown.base + ev.breakdown.main) * (1 - avoid.rate))
  );

  const onlyAvoid = Math.abs(caused + taken) < 1e-9;
  if (onlyAvoid) {
    poolOnlyHits++;
    if (expectedPooled !== ev.damage) poolMismatch++;
  }

  if (rows.length < 10) {
    rows.push({
      round: ev.round,
      type: ev.type,
      source: ev.sourceId,
      target: ev.targetId,
      damageType: 'damageType' in ev ? ev.damageType : undefined,
      troopBase: ev.breakdown.troopBase,
      base: ev.breakdown.base,
      main: ev.breakdown.main,
      damage: ev.damage,
      mult: Number(mult.toFixed(4)),
      avoidRate: avoid.rate,
      avoidUnitId: mods.avoidUnitId,
      pooledModel: expectedPooled,
      legacyIndependent,
      deltaByTroopBase: ev.damage - legacyIndependent,
      onlyAvoid,
    });
  }
}

const report = {
  seed: 20261017,
  rounds: 8,
  avoidHits,
  poolOnlyHits,
  poolMismatch,
  conclusion:
    poolMismatch === 0 && poolOnlyHits > 0
      ? 'PASS：只吃避锐的伤害事件 damage = troopBase + (base+main)，troopBase 不再被避锐吃掉（旧独立乘区会额外扣 troopBase×避锐率）'
      : 'FAIL：待查',
  rows,
};

mkdirSync('docs/诊断-2026-10-17', { recursive: true });
writeFileSync('docs/诊断-2026-10-17/避锐入池取证.json', JSON.stringify(report, null, 2), 'utf8');

console.log(`避锐命中事件 ${avoidHits} 条；其中「只吃避锐」${poolOnlyHits} 条；池化算式不符 ${poolMismatch} 条`);
console.table(rows);
console.log(report.conclusion);
