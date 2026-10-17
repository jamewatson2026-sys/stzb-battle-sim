/**
 * 临时探针 v2（只读）：干净场景下复现「孙权九锡黄龙重复施放 → 规避层数累加」。
 * 队：孙权(带九锡黄龙) + 太史慈 + 周瑜（后两者不带任何战法）vs 3 木桩（纯普攻）。
 * 用法：npx tsx scripts/_probe_evasion2.mts [起始seed] [跑次数]
 */
import { runBattle } from '../src/engine/combat';
import { buildAllFixtures } from '../tests/fixtures';
import { initHeroDB, HERO_REGISTRY, withSkills, level40 } from '../src/data/heroes';
import type { BattleConfig, BattleReport } from '../src/engine/types';

const startSeed = Number(process.argv[2] ?? '10008');
const runs = Number(process.argv[3] ?? '20');

async function main() {
  await initHeroDB();
  const t8 = (buildAllFixtures() as Record<string, BattleConfig>)['T8_WU_TRIO_L40'];

  for (let i = 0; i < runs; i++) {
    const cfg: BattleConfig = {
      myTeam: [
        withSkills(level40(HERO_REGISTRY.sunquan, { defense: 40 }), { activeSkillIds: ['jiuxi_huanglong'] }),
        withSkills(level40(HERO_REGISTRY.taishici, { attack: 40 }), {}),
        withSkills(level40(HERO_REGISTRY.zhouyu, { strategy: 40 }), {}),
      ],
      enemyTeam: t8.enemyTeam,
      seed: startSeed + i,
      maxRounds: 8,
    };
    const rep = runBattle(cfg) as BattleReport;
    const evts = rep.events.filter((e) => {
      const t = (e as { type: string }).type;
      return t === 'skill_cast' || t === 'evasion_blocked' || t === 'status_inflicted' || t === 'status_conflict';
    });
    const casts = evts.filter(
      (e) => (e as { type: string; skillId?: string }).type === 'skill_cast' &&
        /九锡|jiuxi/.test(JSON.stringify(e)),
    ).length;
    if (casts < 2) continue;
    console.log(`\n===== seed=${startSeed + i} 九锡黄龙施放 ${casts} 次 =====`);
    for (const e of evts) console.log('  ' + JSON.stringify(e));
    if (i > startSeed - 10008 + 3) break;
  }
}

void main();
