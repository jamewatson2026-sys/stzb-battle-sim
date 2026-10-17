/**
 * 诊断脚本（2026-10-17）：复现用户报障那一局
 * 红队（我方）：大营 马谡 / 中军 袁术 / 前锋 典韦
 * 蓝队（敌方）：大营 荀彧 / 中军 司马懿 / 前锋 曹操
 * 种子 594723，8 回合，士气 120，40 级 40 兵 9000
 */
import fs from 'node:fs';
import { recordToGeneral, leveledFromRecord, mainSkillSlot } from '../src/data/hero-utils';
import { SKILL_REGISTRY } from '../src/data/skills';
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';

const heroes = JSON.parse(fs.readFileSync('web/data/heroes.json', 'utf8')) as any[];
const byId = new Map<string, any>(heroes.map((h) => [h.id, h]));

interface Opts {
  treasure?: { treasureId: number; level?: number; affix?: { name: string; value: number } };
  troop?: string;
  traits?: string[];
  free?: Record<string, number>;
  morale?: number;
}

function build(id: string, position: General['position'], extras: string[], opts: Opts = {}): General {
  const rec = byId.get(id);
  if (!rec) throw new Error('hero not found: ' + id);
  const g1 = recordToGeneral(rec);
  const leveled = leveledFromRecord(g1, rec, 40, opts.free ?? {}, 9000);
  const g: General = {
    ...leveled,
    position,
    morale: opts.morale ?? 120,
    ...(opts.troop ? { secondaryTroop: opts.troop as any } : {}),
    ...(opts.traits ? { secondaryTraits: opts.traits as any } : {}),
    ...(opts.treasure ? { treasure: { level: 10, ...opts.treasure } } : {}),
  } as General;
  for (const sid of extras) {
    const s = SKILL_REGISTRY[sid];
    if (!s) throw new Error('skill not found: ' + sid);
    const slot = mainSkillSlot(sid);
    if (!slot) throw new Error('no slot: ' + sid);
    (g as any)[slot] = [...(g as any)[slot], sid];
  }
  return g;
}

const red: General[] = [
  build('h799', '大营', ['dashang_sanjun', 'xuanquan_erdong'], {
    troop: '铁骑兵',
    traits: ['难测', '出奇'],
    treasure: { treasureId: 1057, affix: { name: '天资', value: 15 } },
  }),
  build('h790', '中军', ['hezong_lianheng', 'shengdi_yiqiang'], {
    troop: '禁卫',
    traits: ['守备', '勇毅'],
    treasure: { treasureId: 1072, affix: { name: '稳固', value: 20 } },
  }),
  build('h769', '前锋', ['yifudangguan', 'shiqiang_cuifeng'], {
    troop: '长枪兵',
    traits: ['利刃', '勇毅'],
    treasure: { treasureId: 1108, affix: { name: '不屈', value: 9 } },
  }),
];

const blue: General[] = [
  build('h24', '大营', ['heneishize', 'zhongmou_buxie'], {
    troop: '轻骑兵',
    traits: ['疾行', '扰后'],
    treasure: { treasureId: 1051, affix: { name: '筹算', value: 15 } },
  }),
  build('h807', '中军', ['shenbing_tianjiang', 'jiuzhan_shumou'], {
    troop: '白衣死士',
    traits: ['勇毅', '守备'],
    treasure: { treasureId: 1057, affix: { name: '天资', value: 15 } },
  }),
  build('h23', '前锋', ['fanji_zhence', 'danqijiuzhu'], {
    troop: '重骑兵',
    traits: ['出奇', '难测'],
    treasure: { treasureId: 1072, affix: { name: '稳固', value: 20 } },
  }),
];

const seed = Number(process.argv[2] ?? 594723);
const report = runBattle({ myTeam: red, enemyTeam: blue, seed, maxRounds: 8 });

const nameOf = new Map<string, string>();
for (const g of [...red, ...blue]) nameOf.set(g.id, g.name);
const nm = (id: string) => nameOf.get(id) ?? id;

for (const ev of report.events as any[]) {
  switch (ev.type) {
    case 'round_start':
      console.log(`\n===== 第 ${ev.round} 回合 =====`);
      break;
    case 'unit_act_start':
      console.log(`\n>>> ${nm(ev.unitId)} [${ev.phase}]`);
      break;
    case 'skill_trigger':
      console.log(`   判定 ${nm(ev.unitId)} ${ev.skillName} ${ev.rate ?? ''}% ${ev.success ? '成功' : '失败'}`);
      break;
    case 'skill_cast':
      console.log(`   发动 【${ev.skillName}】 ${nm(ev.unitId)}`);
      break;
    case 'attack_hit':
      console.log(`   普攻命中「${nm(ev.targetId)}」距离${ev.distance} 伤害${ev.damage} 剩余${ev.afterTroops ?? '-'}`);
      break;
    case 'damage':
      console.log(`   伤害「${nm(ev.targetId)}」${ev.damageType} ${ev.damage} 剩余${ev.afterTroops ?? '-'} 来自【${nm(ev.sourceId)}】${ev.skillName ?? ''}`);
      break;
    case 'cover':
      console.log(`   >>> 援护：${nm(ev.unitId)} 为 ${nm(ev.targetId)} 抵挡 ${ev.skillId ?? ''}`);
      break;
    case 'status_inflicted':
      console.log(`   状态 ${nm(ev.unitId)} 获得：${ev.detail}`);
      break;
    case 'status_conflict':
      console.log(`   冲突 ${nm(ev.unitId)}：${ev.detail ?? ''}`);
      break;
    case 'no_attack_target':
      console.log(`   无法普攻：${ev.reason}`);
      break;
    case 'unit_died':
      console.log(`   *** ${nm(ev.unitId)} 阵亡`);
      break;
    default:
      break;
  }
}

console.log('\n结果：红 剩余', report.finalMyTroops, '蓝 剩余', report.finalEnemyTroops);
