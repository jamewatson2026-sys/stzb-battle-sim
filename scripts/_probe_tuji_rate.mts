/**
 * 临时探针（只读）：实盘测量「全军突击」的真实发动率。
 * 用法：npx tsx scripts/_probe_tuji_rate.mts
 *
 * 背景：B 站评论反馈「全军突击发动率好像是 100%」。
 * 官方/调研口径 = 主动 A 级 35%（`src/data/skills.ts` quanjun_tuji.triggerRate = 0.35），
 * 士气 120 → 系数 1.12 → 期望「当前生效几率」= 39%。
 *
 * 本探针只读事件流：
 *   · skill_trigger（skillId = quanjun_tuji）→ 判定次数 / 成功次数 / 观测发动率 / rate 分布
 *   · skill_cast（skillId = quanjun_tuji）→ 实际释放次数（应与成功次数一致）
 */
import { runBattle } from '../src/engine/combat';
import { initHeroDB, getGeneral, level40, withSkills } from '../src/data/heroes';
import type { BattleConfig, General, BattleReport } from '../src/engine/types';

const RUNS = Number(process.argv[2] ?? '2000');
const MORALE = Number(process.argv[3] ?? '120');

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

function hero(id: string, position: '前锋' | '中军' | '大营', extra: string[]): General {
  const base = getGeneral(id);
  const leveled = withSkills(base, { activeSkillIds: [...base.activeSkillIds, ...extra] });
  return { ...level40(leveled, {}, 9000), position, morale: MORALE };
}

async function main() {
  await initHeroDB();

  const team: General[] = [hero('h476', '前锋', ['quanjun_tuji']), hero('h477', '中军', []), hero('h478', '大营', [])];

  let attempts = 0;
  let successes = 0;
  let casts = 0;
  const rateHist = new Map<number, number>();
  const baseHist = new Map<number, number>();

  for (let i = 0; i < RUNS; i++) {
    const cfg: BattleConfig = { myTeam: team, enemyTeam: enemies(), seed: 900000 + i, maxRounds: 8 };
    const rep = runBattle(cfg) as BattleReport;
    for (const e of rep.events) {
      const ev = e as unknown as { type: string; skillId?: string; success?: boolean; rate?: number; baseRate?: number };
      if (ev.skillId !== 'quanjun_tuji') continue;
      if (ev.type === 'skill_trigger') {
        attempts += 1;
        if (ev.success) successes += 1;
        if (typeof ev.rate === 'number') rateHist.set(ev.rate, (rateHist.get(ev.rate) ?? 0) + 1);
        if (typeof ev.baseRate === 'number') baseHist.set(ev.baseRate, (baseHist.get(ev.baseRate) ?? 0) + 1);
      } else if (ev.type === 'skill_cast') {
        casts += 1;
      }
    }
  }

  const pct = (n: number) => `${((n / attempts) * 100).toFixed(2)}%`;
  console.log(`=== 全军突击 发动率探针（士气 ${MORALE}，${RUNS} 场）===`);
  console.log(`判定次数 ${attempts}｜成功 ${successes}｜观测发动率 ${pct(successes)}｜skill_cast ${casts}`);
  console.log('rate 分布：', [...rateHist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}%×${v}`).join(' '));
  console.log('baseRate 分布：', [...baseHist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}%×${v}`).join(' '));
}

main().catch((e) => { console.error(e); process.exit(1); });
