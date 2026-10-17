/** 临时：上限探针——甘宁【侵掠如火】(主动攻击类 +20%) 带「全军突击」，
 *  看发动率是否为 35%+20% = 55%（士气 120 → 62%），以及是否会被错误抬到 100%。 */
import { runBattle } from '../src/engine/combat';
import { initHeroDB, getGeneral, level40, withSkills } from '../src/data/heroes';
import type { BattleConfig, General, BattleReport } from '../src/engine/types';

function dummy(id: string, position: '前锋' | '中军' | '大营'): General {
  return {
    id, name: `木桩${position}`, rarity: '5星', cost: 3, faction: '汉', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position,
    attack: 50, defense: 80, strategy: 60, speed: 20, attackRange: 2, maxTroops: 10000,
    mainSkillName: '', skillDesc: '',
    activeSkillIds: [], passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [],
    morale: 100,
  };
}

const enemies = () => [dummy('e1', '前锋'), dummy('e2', '中军'), dummy('e3', '大营')];

async function main() {
  await initHeroDB();
  const base = getGeneral('h34'); // 甘宁：主战法 侵掠如火（被动，自身攻击类主动 +20%）
  const carrier = withSkills(base, { activeSkillIds: [...base.activeSkillIds, 'quanjun_tuji'] });
  const team: General[] = [
    { ...level40(carrier, {}, 9000), position: '前锋', morale: 120 },
    { ...level40(getGeneral('h477'), {}, 9000), position: '中军', morale: 120 },
    { ...level40(getGeneral('h478'), {}, 9000), position: '大营', morale: 120 },
  ];
  let attempts = 0;
  let success = 0;
  const hist = new Map<number, number>();
  for (let i = 0; i < 1500; i++) {
    const cfg: BattleConfig = { myTeam: team, enemyTeam: enemies(), seed: 700000 + i, maxRounds: 8 };
    const rep = runBattle(cfg) as BattleReport;
    for (const e of rep.events) {
      const ev = e as unknown as { type: string; skillId?: string; success?: boolean; rate?: number };
      if (ev.type === 'skill_trigger' && ev.skillId === 'quanjun_tuji') {
        attempts += 1;
        if (ev.success) success += 1;
        if (typeof ev.rate === 'number') hist.set(ev.rate, (hist.get(ev.rate) ?? 0) + 1);
      }
    }
  }
  console.log(`甘宁+全军突击：判定 ${attempts}｜成功 ${success}｜观测 ${(success / attempts * 100).toFixed(2)}%`);
  console.log('rate 分布：', [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}%×${v}`).join(' '));
}

main().catch((e) => { console.error(e); process.exit(1); });
