/**
 * 验收脚本（2026-10-17 报障复现）：用用户那一队打 200 局，检查
 *  ① 普攻绝不落到攻击者本方阵营（援护选敌修复的硬指标）
 *  ② 典韦【舍身卫主】的受击反击判定/成功/伤害量
 *  ③ 单局（种子 594723）战报与用户截图逐行对齐
 * 用法：npx tsx scripts/_verify_cover_1017.mts
 */
import fs from 'node:fs';
import { recordToGeneral, leveledFromRecord, mainSkillSlot } from '../src/data/hero-utils';
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General } from '../src/engine/types';

const heroes = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8')) as any[];
const byId = new Map<string, any>(heroes.map((h) => [h.id, h]));

function build(id: string, position: General['position'], extras: string[], opts: any = {}): General {
  const rec = byId.get(id)!;
  const g1 = recordToGeneral(rec);
  const lv = leveledFromRecord(g1, rec, 40, {}, 9000);
  const g: any = {
    ...lv,
    position,
    morale: 120,
    ...(opts.troop ? { secondaryTroop: opts.troop } : {}),
    ...(opts.traits ? { secondaryTraits: opts.traits } : {}),
    ...(opts.treasure ? { treasure: { level: 10, ...opts.treasure } } : {}),
  };
  for (const sid of extras) {
    const slot = mainSkillSlot(sid);
    if (!slot) throw new Error('no slot ' + sid);
    g[slot] = [...g[slot], sid];
  }
  return g as General;
}

const red = [
  build('h799', '大营', ['dashang_sanjun', 'xuanquan_erdong'], { troop: '铁骑兵', traits: ['难测', '出奇'], treasure: { treasureId: 1057, affix: { name: '天资', value: 15 } } }),
  build('h790', '中军', ['hezong_lianheng', 'shengdi_yiqiang'], { troop: '禁卫', traits: ['守备', '勇毅'], treasure: { treasureId: 1072, affix: { name: '稳固', value: 20 } } }),
  build('h769', '前锋', ['yifudangguan', 'shiqiang_cuifeng'], { troop: '长枪兵', traits: ['利刃', '勇毅'], treasure: { treasureId: 1108, affix: { name: '不屈', value: 9 } } }),
];
const blue = [
  build('h24', '大营', ['heneishize', 'zhongmou_buxie'], { troop: '轻骑兵', traits: ['疾行', '扰后'], treasure: { treasureId: 1051, affix: { name: '筹算', value: 15 } } }),
  build('h807', '中军', ['shenbing_tianjiang', 'jiuzhan_shumou'], { troop: '白衣死士', traits: ['勇毅', '守备'], treasure: { treasureId: 1057, affix: { name: '天资', value: 15 } } }),
  build('h23', '前锋', ['fanji_zhence', 'danqijiuzhu'], { troop: '重骑兵', traits: ['出奇', '难测'], treasure: { treasureId: 1072, affix: { name: '稳固', value: 20 } } }),
];

const side = new Map<string, 'my' | 'enemy'>();
for (const g of red) side.set(g.id, 'my');
for (const g of blue) side.set(g.id, 'enemy');

let sameSideHits = 0;
let sameSideFromRampage = 0;
let rampageBattles = 0;
let totalHits = 0;
let coverEvents = 0;
let sswzJudge = 0;
let sswzOk = 0;
let sswzDamage = 0;

for (let seed = 1; seed <= 200; seed++) {
  const { events } = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 8 });
  const rampageUntil = new Map<string, number>();
  let round = 0;
  let sawRampage = false;
  for (const ev of events as BattleEvent[]) {
    if (ev.type === 'round_start') round = ev.round;
    if (ev.type === 'status_inflicted' && ev.statusType === 'rampage') {
      sawRampage = true;
      const m = /(\d+)\s*回合/.exec(ev.detail ?? '');
      rampageUntil.set(ev.unitId, round + (m ? Number(m[1]) : 1));
    }
    if (ev.type === 'attack_hit') {
      totalHits++;
      if (side.get(ev.sourceId) === side.get(ev.targetId)) {
        sameSideHits++;
        if ((rampageUntil.get(ev.sourceId) ?? -1) >= round) sameSideFromRampage++;
      }
    } else if (ev.type === 'cover') {
      coverEvents++;
    } else if (ev.type === 'skill_trigger' && ev.skillId === 'sheshen_weizhu') {
      sswzJudge++;
      if (ev.success) sswzOk++;
    } else if (ev.type === 'damage' && ev.skillId === 'sheshen_weizhu') {
      sswzDamage += ev.damage;
    }
  }
  if (sawRampage) rampageBattles++;
}

const single = runBattle({ myTeam: red, enemyTeam: blue, seed: 594723, maxRounds: 8 });
const singleCovers = (single.events as BattleEvent[]).filter((e) => e.type === 'cover');
const singleSame = (single.events as BattleEvent[]).filter(
  (e) => e.type === 'attack_hit' && side.get(e.sourceId) === side.get(e.targetId)
);

console.log('== 200 局（种子 1~200，用户原队伍）==');
console.log(`普攻总数 ${totalHits}，同阵营 ${sameSideHits}（其中暴走造成 ${sameSideFromRampage}；${rampageBattles}/200 局出现过暴走）`);
console.log(`援护代受事件 ${coverEvents}`);
console.log(`舍身卫主判定 ${sswzJudge} 次，成功 ${sswzOk} 次（${((sswzOk / (sswzJudge || 1)) * 100).toFixed(1)}%），反击总伤害 ${sswzDamage}`);
console.log('');
console.log('== 单局（种子 594723，对照用户截图）==');
console.log(`援护事件 ${singleCovers.length}，同阵营普攻 ${singleSame.length}`);
for (const c of singleCovers) {
  if (c.type !== 'cover') continue;
  const nm = (id: string) => [...red, ...blue].find((g) => g.id === id)?.name ?? id;
  console.log(`  援护：${nm(c.unitId)} 为 ${nm(c.targetId)} 抵挡普通攻击`);
}
console.log(`结果：红 ${JSON.stringify(single.finalMyTroops)} / 蓝 ${JSON.stringify(single.finalEnemyTroops)}`);
