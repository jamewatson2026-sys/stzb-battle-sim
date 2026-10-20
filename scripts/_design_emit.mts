import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const raw = JSON.parse(readFileSync('design-sets/data/battle.json', 'utf8'));
const FACTION: Record<string, string> = {
  wei: '魏', shu: '蜀', wu: '吴', qun: '群', han: '汉', jin: '晋', '魏': '魏', '蜀': '蜀', '吴': '吴', '群': '群', '汉': '汉', '晋': '晋',
};
const FACTION_FILE: Record<string, string> = {
  '魏': 'wei', '蜀': 'shu', '吴': 'wu', '群': 'qun', '汉': 'han', '晋': 'jin',
  wei: 'wei', shu: 'shu', wu: 'wu', qun: 'qun', han: 'han', jin: 'jin',
};
const TYPE: Record<string, string> = {
  active: '主动', passive: '被动', command: '指挥', pursuit: '追击',
};
const DMG: Record<string, string> = {
  physical: '攻击', strategy: '谋略', true: '真实',
};

type Ev = any;

const unitById: Record<string, any> = {};
for (const u of raw.units) unitById[u.id] = u;
const nameOf = (id?: string) => (id && unitById[id] ? unitById[id].name : '—');
const sideOf = (id?: string) => (id && unitById[id] ? unitById[id].side : null);

// ── 扁平事件流（保留最关键的字段，附带双方兵力快照） ──
const events: Ev[] = [];
let round = 0;
let myTroops = raw.units.filter((u: any) => u.side === 'red').map((u: any) => u.maxTroops);
let enemyTroops = raw.units.filter((u: any) => u.side === 'blue').map((u: any) => u.maxTroops);

function snap() {
  return { my: myTroops.slice(), enemy: enemyTroops.slice() };
}

for (const r of raw.rounds) {
  round = r.round;
  events.push({ t: 'round_start', round, turnOrder: r.turnOrder, snap: snap() });
  for (const e of r.events) {
    const base: any = { round };
    switch (e.type) {
      case 'unit_act_start':
        base.t = 'act';
        base.id = e.unitId; base.name = e.name; base.pos = e.position; base.phase = e.phase;
        break;
      case 'skill_trigger':
        base.t = 'trigger';
        base.id = e.unitId; base.skill = e.skillName; base.skillId = e.skillId;
        base.ok = e.success; base.rate = e.rate ?? null; base.baseRate = e.baseRate ?? null;
        base.morale = e.morale ?? null; base.target = e.targetId ?? null;
        break;
      case 'skill_cast':
        base.t = 'cast';
        base.id = e.unitId; base.skill = e.skillName; base.skillId = e.skillId;
        break;
      case 'skill_target':
        base.t = 'target';
        base.id = e.unitId; base.targets = e.targetIds; base.skill = e.skillName; base.skillId = e.skillId;
        break;
      case 'damage':
      case 'attack_hit':
      case 'split_damage':
      case 'dot_tick': {
        base.t = e.type === 'attack_hit' ? 'attack' : e.type === 'split_damage' ? 'split' : e.type === 'dot_tick' ? 'dot' : 'damage';
        base.from = e.sourceId ?? e.casterId; base.to = e.targetId; base.skill = e.skillName ?? null;
        base.skillId = e.skillId ?? null; base.kind = e.damageType ?? (e.type === 'attack_hit' ? 'physical' : e.dotType ?? null);
        base.dmg = e.damage; base.bd = e.breakdown ?? null;
        base.credit = e.creditToId ?? null;
        base.after = e.afterTroops ?? null;
        base.dist = e.distance ?? null;
        if (e.modifiers) {
          const m = e.modifiers;
          base.mods = {
            caused: (m.caused ?? []).map((x: any) => ({ n: x.skillName, r: x.rate })),
            taken: (m.taken ?? []).map((x: any) => ({ n: x.skillName, r: x.rate })),
            reduce: (m.reduce ?? []).map((x: any) => ({ n: x.skillName, r: x.rate })),
          };
        }
        break;
      }
      case 'heal':
        base.t = 'heal';
        base.id = e.sourceId; base.to = e.targetId; base.skill = e.skillName; base.skillId = e.skillId;
        base.amount = e.amount; base.before = e.before; base.after = e.after;
        break;
      case 'status_inflicted':
        base.t = 'status'; base.id = e.unitId; base.kind = e.statusType; base.detail = e.detail;
        break;
      case 'status_expired':
        base.t = 'expire'; base.id = e.unitId; base.kind = e.statusType;
        break;
      case 'status_changed':
        base.t = 'changed'; base.id = e.unitId; base.kind = e.statusType; base.detail = e.detail;
        break;
      case 'status_conflict':
        base.t = 'conflict'; base.id = e.unitId; base.kind = e.statusType; base.detail = e.detail;
        break;
      case 'cover':
        base.t = 'cover'; base.id = e.unitId; base.to = e.targetId; base.skillId = e.skillId;
        break;
      case 'evasion_blocked':
        base.t = 'evade'; base.id = e.unitId; base.from = e.sourceId;
        break;
      case 'no_attack_target':
        base.t = 'idle'; base.id = e.unitId; base.reason = e.reason;
        break;
      case 'unit_death':
        base.t = 'death'; base.id = e.unitId ?? e.id;
        break;
      case 'round_end':
        myTroops = e.myTroops.slice();
        enemyTroops = e.enemyTroops.slice();
        base.t = 'round_end';
        base.my = e.myTroops; base.enemy = e.enemyTroops;
        base.myW = e.myWounded ?? null; base.enemyW = e.enemyWounded ?? null;
        base.myD = e.myDead ?? null; base.enemyD = e.enemyDead ?? null;
        break;
      case 'battle_end':
        base.t = 'end';
        base.result = e.result; base.my = e.myTroops; base.enemy = e.enemyTroops;
        break;
      default:
        base.t = e.type;
        base.raw = e;
    }
    events.push(base);
    if (base.t === 'damage' || base.t === 'attack' || base.t === 'dot' || base.t === 'split') {
      if (base.after != null) {
        const u = unitById[base.to];
        if (u) {
          const idx = u.slot === '大营' ? 0 : u.slot === '中军' ? 1 : 2;
          if (u.side === 'red') myTroops[idx] = base.after; else enemyTroops[idx] = base.after;
        }
      }
    }
    if (base.t === 'heal' && base.after != null) {
      const u = unitById[base.to];
      if (u) {
        const idx = u.slot === '大营' ? 0 : u.slot === '中军' ? 1 : 2;
        if (u.side === 'red') myTroops[idx] = base.after; else enemyTroops[idx] = base.after;
      }
    }
  }
}

// ── 聚合 ──
const agg: Record<string, any> = {};
for (const u of raw.units) {
  agg[u.id] = { dealt: 0, taken: 0, healed: 0, attacks: 0, hits: 0, casts: 0, crits: 0, maxHit: 0, firstAct: null as any };
}
for (const e of events) {
  if (['damage', 'attack', 'dot', 'split'].includes(e.t)) {
    const owner = e.credit ?? e.from;
    if (agg[owner]) { agg[owner].dealt += e.dmg; if (e.dmg > agg[owner].maxHit) agg[owner].maxHit = e.dmg; }
    if (agg[e.to]) agg[e.to].taken += e.dmg;
    if (e.t === 'attack' && agg[e.from]) { agg[e.from].attacks++; agg[e.from].hits++; }
    if (e.t === 'dot') { /* dot 归属施法者 */ }
  }
  if (e.t === 'heal' && agg[e.id]) agg[e.id].healed += e.amount;
  if (e.t === 'cast' && agg[e.id]) agg[e.id].casts++;
  if (e.t === 'act' && agg[e.id] && agg[e.id].firstAct == null) agg[e.id].firstAct = e.round;
}

// 每回合兵力序列（第 0 回合 = 满兵）
const series: any[] = [];
series.push({ round: 0, my: raw.units.filter((u: any) => u.side === 'red').map((u: any) => u.maxTroops), enemy: raw.units.filter((u: any) => u.side === 'blue').map((u: any) => u.maxTroops) });
for (const r of raw.rounds) {
  if (r.end) series.push({ round: r.round, my: r.end.myTroops, enemy: r.end.enemyTroops, myW: r.end.myWounded, enemyW: r.end.enemyWounded, myD: r.end.myDead, enemyD: r.end.enemyDead });
}

// 战法谱：按 skillId 汇总
const skillAgg: Record<string, any> = {};
for (const e of events) {
  if (!e.skillId) continue;
  const key = e.skillId;
  const s = (skillAgg[key] ??= { id: key, name: e.skill ?? key, casts: 0, triggers: 0, hits: 0, damage: 0, heal: 0 });
  if (e.t === 'cast') s.casts++;
  if (e.t === 'trigger') { s.triggers++; if (e.skill) s.name = e.skill; }
  if (['damage', 'attack', 'dot', 'split'].includes(e.t)) { s.hits++; s.damage += e.dmg; }
  if (e.t === 'heal') s.heal += e.amount;
}

const skillName: Record<string, string> = {};
for (const u of raw.units) {
  skillName[u.mainSkill.id] = u.mainSkill.name;
  for (const s of u.extraSkills) skillName[s.id] = s.name;
}
for (const k of Object.keys(skillAgg)) if (skillName[k]) skillAgg[k].name = skillName[k];
// 名称清理：宝物 / 兵种 等内部 id
for (const s of Object.values(skillAgg) as any[]) {
  if (/^treasure:/.test(s.name) || /^troop_/.test(s.name) || s.name === '兵种特性' || s.name === '兵种克制') {
    s.system = true;
    if (/^treasure:/.test(s.name)) s.name = '宝物词条';
    if (s.name === 'troop_trait' || s.name === '兵种特性') s.name = '兵种特性';
    if (s.name === 'troop_counter' || s.name === '兵种克制') s.name = '兵种克制';
  }
}

const out = {
  meta: {
    ...raw.meta,
    resultLabel: raw.meta.result === 'win' ? '胜' : raw.meta.result === 'loss' ? '败' : '平',
    generatedAt: '2026-10-20',
    engine: 'STZB Engine · v1.13',
    morale: 120,
    seed: raw.meta.seed,
  },
  units: raw.units.map((u: any) => ({
    ...u,
    factionLabel: FACTION[u.faction] ?? u.faction,
    factionIcon: `../public/skills/faction-${FACTION_FILE[u.faction] ?? 'qun'}.png`,
    portrait: (u.portrait || '').replace(/^\//, '../public/'),
    avatar: (u.avatar || '').replace(/^\//, '../public/'),
    agg: agg[u.id],
    maxTroops: u.maxTroops,
  })),
  series,
  skillAgg: Object.values(skillAgg).sort((a: any, b: any) => b.damage - a.damage),
  events,
  battle: raw.battle,
  labels: { FACTION, TYPE, DMG },
};

mkdirSync('design-sets/data', { recursive: true });
writeFileSync('design-sets/data/battle.js', 'window.BATTLE = ' + JSON.stringify(out) + ';\n');
console.log('wrote battle.js bytes', JSON.stringify(out).length, 'events', out.events.length, 'skills', out.skillAgg.length);
