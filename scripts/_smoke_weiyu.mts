/**
 * 未雨绸缪端到端冒烟：真实 runBattle 里统计「再次发动」次数与「无视谋略」标注，
 * 并打印一段文本战报片段作为人工复核证据。
 */
import { runBattle } from '../src/engine/combat';
import { reportToText } from '../src/engine/report';
import type { General, Skill } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { readFileSync } from 'node:fs';

const HEROES = JSON.parse(readFileSync('web/data/heroes.json', 'utf8')) as any[];

function heroById(id: string, position: General['position'], skills: string[]): General {
  const h = HEROES.find((x) => x.id === id);
  if (!h) throw new Error('hero not found: ' + id);
  return {
    id: h.id,
    name: h.name,
    rarity: h.rarity,
    cost: h.cost,
    faction: h.faction,
    tags: h.tags ?? [],
    mutualExclusionGroup: h.mutualExclusionGroup ?? null,
    troopType: h.troopType,
    position,
    attack: Math.round(h.baseAttack + 39 * h.growthAttack),
    defense: Math.round(h.baseDefense + 39 * h.growthDefense),
    strategy: Math.round(h.baseStrategy + 39 * h.growthStrategy),
    speed: Math.round(h.baseSpeed + 39 * h.growthSpeed),
    attackRange: h.attackRange,
    maxTroops: 9000,
    mainSkillId: h.mainSkillId,
    mainSkillName: h.mainSkillName ?? '',
    skillDesc: '',
    activeSkillIds: h.mainSkillId ? [h.mainSkillId, ...skills] : skills,
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 120,
  } as General;
}

const bySkill = new Map<string, number>();
const inflicted = new Map<string, number>();
let recasts = 0;
let ignores = 0;
let casts = 0;
let sampleText = '';
const runs = 40;
for (let seed = 1; seed <= runs; seed++) {
  const my = [
    heroById('h841', '大营', ['weiyu_choumou']),
    heroById('h742', '中军', []),
    heroById('h16', '前锋', []),
  ];
  const enemy = [heroById('h815', '大营', []), heroById('h34', '中军', []), heroById('h634', '前锋', [])];
  const report = runBattle({ myTeam: my, enemyTeam: enemy, maxRounds: 8, seed });
  for (const ev of report.events) {
    if (ev.type === 'skill_cast') {
      casts++;
      bySkill.set(ev.skillName, (bySkill.get(ev.skillName) ?? 0) + 1);
      if (ev.recastBy) recasts++;
    }
    if (ev.type === 'status_inflicted') {
      const k = ev.statusType;
      inflicted.set(k, (inflicted.get(k) ?? 0) + 1);
    }
    if (ev.type === 'damage' && ev.ignoreStrategy) ignores++;
  }
  if (!sampleText && recasts > 0 && ignores > 0) {
    sampleText = reportToText(report);
  }
}

console.log(JSON.stringify({ runs, casts, recasts, ignores, bySkill: Object.fromEntries(bySkill), statusTop: Object.fromEntries([...inflicted].sort((a, b) => b[1] - a[1]).slice(0, 8)) }, null, 1));
const lines = sampleText.split('\n');
const idx = lines.findIndex((l) => l.includes('再次发动'));
if (idx >= 0) console.log(lines.slice(Math.max(0, idx - 3), idx + 8).join('\n'));
