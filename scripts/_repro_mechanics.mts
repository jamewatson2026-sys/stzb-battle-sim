/**
 * 临时复现脚本（诊断用，跑完可删）：按 JSON 配置跑一场战斗，只打印「机制类」事件，
 * 用来核对援护（cover）/ 伤害承担（share_damage / seal_settle）/ 受击反击（onHurt）/ 围困等链路。
 *
 * 用法：
 *   npx tsx scripts/_repro_mechanics.mts                    # 内置默认阵容（红：曹操/袁术/典韦）
 *   npx tsx scripts/_repro_mechanics.mts spec.json          # 自定义阵容
 *   npx tsx scripts/_repro_mechanics.mts spec.json --all    # 打印全部事件
 *
 * spec.json 形状：
 * {
 *   "seed": 594723,
 *   "maxRounds": 8,
 *   "my":    [{ "hero": "h23", "position": "大营", "skills": ["大赏三军"], "treasure": 1072 }],
 *   "enemy": [{ "hero": "h790", "position": "中军", "skills": ["合纵连横"] }]
 * }
 * hero / skills / treasure 都可以用库内 id 或中文名。
 */
import { readFileSync } from 'node:fs';
import heroesJson from '../web/data/heroes.json';
import { SKILL_REGISTRY } from '../src/data/skills';
import { TREASURES_BY_ID } from '../src/data/treasures';
import { recordToGeneral, leveledFromRecord, mainSkillSlot } from '../src/data/hero-utils';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position, SkillType } from '../src/engine/types';

type UnitSpec = {
  hero: string;
  position: Position;
  skills?: string[];
  treasure?: number | string;
  treasureLevel?: number;
  secondaryTroop?: string;
  traits?: string[];
  morale?: number;
  level?: number;
  troops?: number;
};

type Spec = { seed: number; maxRounds: number; my: UnitSpec[]; enemy: UnitSpec[] };

const DEFAULT_SPEC: Spec = {
  seed: 594723,
  maxRounds: 8,
  my: [
    { hero: 'h23', position: '大营', skills: ['大赏三军'], treasure: 1072 },
    { hero: 'h790', position: '中军', skills: ['合纵连横'] },
    { hero: 'h769', position: '前锋', skills: ['一夫当关', '恃强淬锋'] },
  ],
  enemy: [
    { hero: 'h750', position: '大营', skills: ['众谋不懈', '河内世泽'] },
    { hero: 'h750', position: '中军', skills: ['其徐如林', '神兵天降', '久战熟谋'] },
    { hero: 'h750', position: '前锋', skills: ['单骑救主', '反计之策'] },
  ],
};

const heroes = heroesJson as unknown as Array<Record<string, unknown>>;

function resolveHero(key: string): Record<string, unknown> {
  const hit = heroes.find((h) => h.id === key) ?? heroes.find((h) => h.name === key);
  if (!hit) throw new Error(`武将不在库内：${key}`);
  return hit;
}

function resolveSkill(key: string): { id: string; name: string; type: SkillType } {
  const byId = SKILL_REGISTRY[key];
  if (byId) return byId;
  const found = Object.values(SKILL_REGISTRY).find((s) => s.name === key);
  if (!found) throw new Error(`战法不在库内：${key}`);
  return found;
}

function buildUnit(spec: UnitSpec): General {
  const rec = resolveHero(spec.hero) as never;
  const g = leveledFromRecord(
    recordToGeneral(rec),
    rec,
    spec.level ?? 40,
    {},
    spec.troops ?? (spec.level ?? 40) * 100 + 5000
  );
  g.position = spec.position;
  g.morale = spec.morale ?? 120;
  if (spec.secondaryTroop) g.secondaryTroop = spec.secondaryTroop as General['secondaryTroop'];
  if (spec.traits) g.secondaryTraits = spec.traits as General['secondaryTraits'];
  for (const key of spec.skills ?? []) {
    const skill = resolveSkill(key);
    const slot = mainSkillSlot(skill.id);
    if (!slot) continue;
    // 主战法可能恰好与装配战法同名：同 id 去重
    if (!g[slot].includes(skill.id)) g[slot].push(skill.id);
  }
  if (spec.treasure != null) {
    const treasureId = typeof spec.treasure === 'number' ? spec.treasure : Number(spec.treasure);
    if (!TREASURES_BY_ID[treasureId]) throw new Error(`宝物不在库内：${spec.treasure}`);
    g.treasure = { treasureId, level: spec.treasureLevel ?? 10 };
  }
  return g;
}

function buildTeam(specs: UnitSpec[]): General[] {
  return specs.map(buildUnit);
}

const args = process.argv.slice(2);
const specPath = args.find((a) => !a.startsWith('--'));
const showAll = args.includes('--all');
const seedArg = args.find((a) => a.startsWith('--seed='));
const spec: Spec = specPath
  ? (JSON.parse(readFileSync(specPath, 'utf8')) as Spec)
  : { ...DEFAULT_SPEC, ...(seedArg ? { seed: Number(seedArg.slice(7)) } : {}) };
if (seedArg && specPath) spec.seed = Number(seedArg.slice(7));

const myTeam = buildTeam(spec.my);
const enemyTeam = buildTeam(spec.enemy);
const report = runBattle({ myTeam, enemyTeam, seed: spec.seed, maxRounds: spec.maxRounds });

const nameOf = new Map<string, string>();
for (const u of [...myTeam, ...enemyTeam]) nameOf.set(u.id, `${u.name}(${u.position})`);
const nm = (id?: string) => (id ? (nameOf.get(id) ?? id) : '-');

const INTERESTING = new Set([
  'cover',
  'share_damage',
  'seal_settle',
  'skill_trigger',
  'status_inflicted',
  'status_expired',
  'skill_exec',
  'damage',
  'attack_hit',
  'dot_tick',
  'unit_dead',
  'round_start',
  'battle_start',
]);

function fmt(ev: BattleEvent): string | null {
  if (!showAll && !INTERESTING.has(ev.type)) return null;
  switch (ev.type) {
    case 'round_start':
      return `\n===== 第 ${ev.round} 回合 =====`;
    case 'battle_start':
      return `战斗开始（种子 ${ev.seed}）`;
    case 'cover':
      return `援护：${nm(ev.unitId)} 为 ${nm(ev.targetId)} 抵挡普通攻击（skill=${ev.skillId ?? '-'}）`;
    case 'share_damage':
      return `分摊：${nm(ev.unitId)} 为 ${nm(ev.targetId)} 承担 ${ev.amount}（${ev.skillId}）`;
    case 'seal_settle':
      return `玉玺结转：${nm(ev.unitId)} 上一回合承担 ${ev.carried}，按 ${Math.round(ev.ratio * 100)}% 损失 ${ev.damage}`;
    case 'skill_trigger':
      return `判定：${nm(ev.targetId)} ← ${nm(ev.unitId)}【${ev.skillName}】${ev.success ? '成功' : '失败'}（${ev.rate}% / 基础 ${ev.baseRate}%）`;
    case 'status_inflicted':
      return `状态：${nm(ev.unitId)} 获得【${ev.statusType}】${ev.detail}`;
    case 'status_expired':
      return `状态到期：${nm(ev.unitId)} 的 ${ev.statusType}`;
    case 'skill_exec':
      return `执行：${ev.detail}`;
    case 'attack_hit':
      return `普攻：${nm(ev.sourceId)} → ${nm(ev.targetId)}（距离 ${ev.distance}）${ev.damage}`;
    case 'damage':
      return `伤害：${nm(ev.sourceId)} → ${nm(ev.targetId)} ${ev.damageType} ${ev.damage}`;
    case 'dot_tick':
      return `DoT：${nm(ev.casterId)} → ${nm(ev.targetId)} ${ev.dotType} ${ev.damage}`;
    case 'unit_dead':
      return `阵亡：${nm(ev.unitId)}`;
    default:
      return `${ev.type} ${JSON.stringify(ev).slice(0, 160)}`;
  }
}

console.log(`seed=${spec.seed} rounds=${spec.maxRounds}`);
console.log(`红队：${myTeam.map((u) => `${u.name}(${u.position})`).join(' / ')}`);
console.log(`蓝队：${enemyTeam.map((u) => `${u.name}(${u.position})`).join(' / ')}`);
for (const ev of report.events) {
  const line = fmt(ev);
  if (line) console.log(line);
}
console.log(
  `\n结果：${report.winner}｜红剩余 ${report.finalMyTroops.join('/')}｜蓝剩余 ${report.finalEnemyTroops.join('/')}`
);
