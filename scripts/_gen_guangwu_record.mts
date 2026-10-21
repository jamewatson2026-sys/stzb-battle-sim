/**
 * 生成一条**真实引擎跑出来**的战报记录（含光武中兴子战法标注），供网页截图脚本使用。
 * 用法：npx tsx scripts/_gen_guangwu_record.mts [输出路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { runBattle } from '../src/engine/combat';
import { initHeroDB } from '../src/data/heroes';
import { buildGeneral } from '../web/heroes';

const out = process.argv[2] ?? 'docs/逆向对拍/baseline/guangwu_record.json';
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

let picked: { report: ReturnType<typeof runBattle>; seed: number } | null = null;
for (let i = 0; i < 40; i++) {
  const seed = 5000 + i;
  const report = runBattle({ myTeam, enemyTeam, seed, maxRounds: 8 });
  const subs = new Set(
    (report.events as any[])
      .filter((e) => e.type === 'damage' && e.skillId === 'guangwu_zhongxing')
      .map((e) => e.subSkill)
  );
  if (subs.size >= 2 && (report.events as any[]).length > 60) {
    picked = { report, seed };
    break;
  }
}
if (!picked) throw new Error('没找到合适的战报样本');

const record = {
  id: 'demo_guangwu',
  ts: Date.now(),
  label: '光武中兴 · 子战法标注',
  result: picked.report.result,
  rounds: picked.report.rounds,
  seed: picked.seed,
  myTeam: myTeam.map((g) => g.name),
  enemyTeam: enemyTeam.map((g) => g.name),
  report: picked.report,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(record));
const labels = new Set(
  (picked.report.events as any[])
    .filter((e) => e.type === 'damage' && e.skillId === 'guangwu_zhongxing' && e.subSkill)
    .map((e) => e.subSkill)
);
console.log('样本 seed', picked.seed, '事件', (picked.report.events as any[]).length, '子战法', [...labels]);
console.log('写入', out, fs.statSync(out).size, 'B');
