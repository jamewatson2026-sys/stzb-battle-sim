/**
 * 临时探针（只读）：实盘观察法正「难知如阴」/ 田丰「尽言直谏」的作用范围。
 * 用法：npx tsx scripts/_probe_slot_scope.mts
 *
 * 关注点：
 *  法正 —— 目标单位每次触发的 boost 只应带 mainSkillOnly（= 只有主战法吃），
 *          且第 1 回合只点 1 名友军（不含自己）、第 3/5/7 回合点全体友军。
 *  田丰 —— status_changed 的 detail 应列出「单位名·战法名」的**槽位**（2 个），
 *          而不是整名友军所有主动战法。
 */
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

function hero(id: string, position: '前锋' | '中军' | '大营', extra: string[]): General {
  const base = getGeneral(id);
  const leveled = withSkills(base, {
    activeSkillIds: [...base.activeSkillIds, ...extra],
  });
  return { ...level40(leveled, {}, 9000), position };
}

function dump(label: string, cfg: BattleConfig, filter: (d: string) => boolean) {
  const rep = runBattle(cfg) as BattleReport;
  console.log(`\n===== ${label} seed=${cfg.seed} =====`);
  for (const e of rep.events) {
    const ev = e as unknown as { type: string; round?: number; unitId?: string; skillId?: string; detail?: string; rate?: number; sourceId?: string };
    if ((ev.type === 'status_changed' || ev.type === 'status_inflicted') && ev.detail && filter(ev.detail)) {
      console.log(` R${ev.round ?? '-'} ${ev.type} ${ev.unitId} :: ${ev.detail}`);
    }
    if (ev.type === 'skill_trigger' && typeof ev.rate === 'number' && ev.skillId) {
      const row = ` R${ev.round ?? '-'} 判定 ${ev.unitId} ${ev.skillId} rate=${ev.rate}`;
      console.log(row);
    }
  }
}

async function main() {
  await initHeroDB();

  // ── 法正：h582 主帅，配两名「主动主战法」友军（郭嘉 h476 / 陆逊 h478）
  const fazhengTeam: General[] = [
    hero('h582', '前锋', []),
    hero('h476', '中军', []),
    hero('h478', '大营', []),
  ];
  dump('法正·难知如阴', { myTeam: fazhengTeam, enemyTeam: enemies(), seed: 20251006, maxRounds: 8 },
    (d) => d.includes('发动率') || d.includes('准备'));

  // ── 田丰：h692，配两名带多主动战法的友军（张辽 h? 用通用战法凑槽位）
  const tianfengTeam: General[] = [
    hero('h692', '前锋', []),
    hero('h476', '中军', ['tujin', 'zaochuan']),
    hero('h478', '大营', ['tujin', 'zaochuan']),
  ];
  dump('田丰·尽言直谏', { myTeam: tianfengTeam, enemyTeam: enemies(), seed: 20251006, maxRounds: 8 },
    (d) => d.includes('发动率') || d.includes('伤害提高') || d.includes('主动战法'));
}

main().catch((e) => { console.error(e); process.exit(1); });
