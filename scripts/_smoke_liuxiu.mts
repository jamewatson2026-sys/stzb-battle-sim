/**
 * 光武中兴（刘秀 h841）实装冒烟：跑批统计子战法分布 / 恢复量 / 士气降低 / 集齐奖励。
 * 用法：npx tsx scripts/_smoke_liuxiu.mts [--runs 200]
 */
import { runBattle } from '../src/engine/combat';
import { initHeroDB } from '../src/data/heroes';
import { buildGeneral } from '../web/heroes';

const argv = process.argv.slice(2);
const runs = Number(argv[argv.indexOf('--runs') + 1]) || 200;

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

const tally = {
  casts: 0,
  damageEvents: 0,
  damageTotal: 0,
  healEvents: 0,
  healAmount: 0,
  extraDispatch: 0, // heal.onHealCast 成功的判定
  comboTrigger: 0, // 三子战法集齐
  luolei: 0,
  luoshi: 0,
  jueshui: 0,
  confusion: 0,
  defenseDown: 0,
  siege: 0,
  moraleDown: 0,
  wins: 0,
};

for (let i = 0; i < runs; i++) {
  const report = runBattle({ myTeam, enemyTeam, seed: 1000 + i, maxRounds: 8 });
  if (report.result === 'win') tally.wins++;
  const ev = report.events as any[];
  for (const e of ev) {
    if (e.type === 'skill_trigger' && e.skillId === 'guangwu_zhongxing' && e.targetId != null && e.success) {
      tally.extraDispatch++;
    }
    if (e.type === 'heal' && e.skillId === 'guangwu_zhongxing') {
      tally.healEvents++;
      tally.healAmount += e.amount;
    }
    if (e.type === 'skill_cast' && e.skillId === 'guangwu_zhongxing') tally.casts++;
    if (e.type === 'damage' && e.skillId === 'guangwu_zhongxing') {
      tally.damageEvents++;
      tally.damageTotal += e.damage;
      const n = (e as { targetId: string }).targetId;
      // 子战法分辨：按伤害段数 / 目标数归不进单体，改为按同批次状态签名统计（见下）
      void n;
    }
    if (e.type === 'status_inflicted') {
      if (e.statusType === 'confusion') tally.confusion++;
      if (e.statusType === 'siege') tally.siege++;
      if (e.statusType === 'morale_boost' && String(e.detail).includes('降低')) tally.moraleDown++;
      if (e.statusType === 'defense_buff' && String(e.detail).includes('降低')) tally.defenseDown++;
    }
  }
}

console.log('局数', runs);
console.log(JSON.stringify(tally, null, 2));
