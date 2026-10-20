import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runBattle } from '../src/engine/combat';
import { buildGeneral } from '../web/heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import { computeDetailedStats, computeStats } from '../src/engine/stats';
import type { General } from '../src/engine/types';

const presets = JSON.parse(readFileSync('web/data/hot_presets.json', 'utf8')).entries;
const porta = JSON.parse(readFileSync('web/data/portraits.json', 'utf8'));
const heroMeta = JSON.parse(readFileSync('web/data/hero_meta.json', 'utf8'));

function teamOf(id: string, morale: number): General[] {
  const p = presets.find((e: any) => e.id === id);
  return p.slots.map((s: any, i: number) =>
    buildGeneral(s.heroId, s.extraSkillIds, s.freePoints, ['大营', '中军', '前锋'][i] as any, s.redness, s.level, morale, s.secondaryTroop, s.secondaryTraits, s.treasure, s.chenshou)
  );
}

const RED = 'hot-caochun-zhangliao-wenyang';
const BLUE = 'hot-pangtong-xpchengyu-liubei';
const red = teamOf(RED, 120);
const blue = teamOf(BLUE, 120);

function evaluate(rep: any) {
  const dmg = rep.events.filter((e: any) => e.type === 'damage' || e.type === 'attack_hit' || e.type === 'dot_tick' || e.type === 'split_damage');
  const total = dmg.reduce((a: number, e: any) => a + (e.damage || 0), 0);
  const alive = [...rep.finalMyTroops, ...rep.finalEnemyTroops].filter((t) => t > 0).length;
  const actualRounds = rep.events.filter((e: any) => e.type === 'round_start').length;
  const backAlive = rep.finalMyTroops[0] > 0 && rep.finalEnemyTroops[0] > 0;
  const casts = rep.events.filter((e: any) => e.type === 'skill_cast' || e.type === 'attack_hit').length;
  return { total, alive, rounds: actualRounds, result: rep.result, backAlive, casts, events: rep.events.length };
}

let best: any = null;
let bestScore = -1;
for (let seed = 1; seed <= 3000; seed++) {
  const rep = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 8 });
  const ev = evaluate(rep);
  const score = ev.rounds * 1000 + (ev.backAlive ? 300 : 0) + (ev.result === 'draw' ? 100 : 0) + ev.casts * 2 + ev.alive * 5 + (ev.total % 1000) / 1000;
  if (score > bestScore) { bestScore = score; best = { seed, rep, ev }; }
}
const { seed, rep, ev } = best;
console.log('picked seed', seed, ev, 'score', bestScore);

function skillInfo(id: string) {
  const s = SKILL_REGISTRY[id];
  return s ? { id, name: s.name, type: s.type, grade: (s as any).grade ?? null, range: (s as any).range ?? null } : { id, name: id, type: 'unknown' };
}

function unit(g: General, side: 'red' | 'blue', idx: number, troops: number, maxTroops: number, wounded = 0, dead = 0) {
  const pid = g.heroId ?? g.id;
  const p = porta[pid] ?? {};
  const meta = heroMeta[pid] ?? {};
  const extra = [
    ...g.activeSkillIds.map(skillInfo),
    ...g.pursuitSkillIds.map(skillInfo),
    ...g.passiveSkillIds.map(skillInfo),
    ...g.commandSkillIds.map(skillInfo),
  ];
  return {
    id: g.id, heroId: pid, name: g.name, side, slot: ['大营', '中军', '前锋'][idx], position: g.position,
    faction: g.faction, troopType: g.troopType, secondaryTroop: g.secondaryTroop ?? null,
    rarity: g.rarity, cost: g.cost, level: g.level ?? 40, redness: g.redness ?? 0, morale: g.morale,
    attack: g.attack, defense: g.defense, strategy: g.strategy, speed: g.speed, attackRange: g.attackRange,
    troops, maxTroops, wounded, dead,
    portrait: p.portrait ?? '', avatar: p.avatar ?? '',
    mainSkill: { id: g.mainSkillId ?? '', name: g.mainSkillName, desc: g.skillDesc },
    extraSkills: extra,
    treasure: g.treasure ?? null,
    traits: g.secondaryTraits ?? [],
  };
}

const last = rep.events.filter((e: any) => e.type === 'round_end').at(-1) as any;
const units = [
  ...rep.myTeam.map((g, i) => unit(g, 'red', i, rep.finalMyTroops[i], g.maxTroops, rep.finalMyWounded[i], rep.finalMyDead[i])),
  ...rep.enemyTeam.map((g, i) => unit(g, 'blue', i, rep.finalEnemyTroops[i], g.maxTroops, rep.finalEnemyWounded[i], rep.finalEnemyDead[i])),
];

const ROUND_EVENTS = new Set([
  'round_start', 'unit_act_start', 'skill_trigger', 'skill_cast', 'skill_target', 'damage', 'attack_hit',
  'dot_tick', 'split_damage', 'heal', 'status_inflicted', 'status_conflict', 'status_expired', 'status_changed',
  'cover', 'evasion_blocked', 'no_attack_target', 'unit_death', 'effect_execute', 'seal_settle', 'round_end', 'battle_end',
  'counter_attack', 'redirect', 'taunt', 'summon', 'skill_effect',
]);
const events = rep.events.filter((e: any) => ROUND_EVENTS.has(e.type));
const rounds: any[] = [];
let cur: any = null;
for (const e of rep.events as any[]) {
  if (e.type === 'round_start') { cur = { round: e.round, events: [], turnOrder: e.turnOrder ?? [] }; rounds.push(cur); }
  if (cur && e.type !== 'round_start' && e.type !== 'round_end') cur.events.push(e);
  if (e.type === 'round_end') {
    cur.end = {
      myTroops: e.myTroops, enemyTroops: e.enemyTroops, myWounded: e.myWounded, enemyWounded: e.enemyWounded,
      myDead: e.myDead, enemyDead: e.enemyDead,
    };
  }
}

const data = {
  meta: { seed, maxRounds: rep.maxRounds, result: rep.result, rounds: rounds.length, redName: '曹纯 · 张辽 · 文鸯', blueName: '庞统 · 程昱 · 刘备', redTag: '魏·晋 骑锋', blueTag: '蜀·魏 谋阵' },
  units,
  rounds,
  stats: computeStats(rep.events, (rep as any).units ?? []),
  battle: { seed: rep.seed, result: rep.result, rounds: rounds.length, finalMyTroops: rep.finalMyTroops, finalEnemyTroops: rep.finalEnemyTroops, finalMyWounded: rep.finalMyWounded, finalEnemyWounded: rep.finalEnemyWounded, finalMyDead: rep.finalMyDead, finalEnemyDead: rep.finalEnemyDead },
  events,
};
mkdirSync('design-sets/data', { recursive: true });
writeFileSync('design-sets/data/battle.json', JSON.stringify(data, null, 1));
console.log('wrote', data.events.length, 'events', rounds.length, 'rounds', units.map(u => `${u.name}:${u.troops}`).join(' '));
