/**
 * 探针：光武中兴的「随机派遣」分布（按新加的 `subSkill` 标签直接统计）。
 * 用法：npx tsx scripts/_probe_guangwu_pick.mts [局数]
 */
import { runBattle } from '../src/engine/combat';
import { initHeroDB } from '../src/data/heroes';
import { buildGeneral } from '../web/heroes';

const RUNS = Number(process.argv[2] ?? 120);
await initHeroDB();

const myTeam = [
  buildGeneral('h841', ['bishi_jixu', 'shengqi_lingran'], { strategy: 40 }, '中军', 0, 40, 120),
  buildGeneral('h742', ['bishi_jixu'], {}, '前锋', 0, 40, 120),
  buildGeneral('h811', ['shengqi_lingran'], {}, '大营', 0, 40, 120),
];
const enemyTeam = [
  buildGeneral('h815', [], {}, '前锋', 0, 40, 120),
  buildGeneral('h34', [], {}, '中军', 0, 40, 120),
  buildGeneral('h634', [], {}, '大营', 0, 40, 120),
];

const tally: Record<string, number> = {};
let casts = 0;
let dmg = 0;
let untagged = 0;

for (let i = 0; i < RUNS; i++) {
  const report = runBattle({ myTeam, enemyTeam, seed: 3000 + i, maxRounds: 8 });
  for (const e of report.events as any[]) {
    if (e.type === 'skill_cast' && e.skillId === 'guangwu_zhongxing') casts++;
    if (e.type === 'damage' && e.skillId === 'guangwu_zhongxing') {
      dmg++;
      const label = e.subSkill ?? '(未标注)';
      tally[label] = (tally[label] ?? 0) + 1;
      if (!e.subSkill) untagged++;
    }
  }
}

console.log(JSON.stringify({ RUNS, casts, damageEvents: dmg, bySubSkill: tally, untagged }, null, 1));
