import { Rng } from '../engine/rng';
import type { General, Position } from '../engine/types';
import { simulateWinRate } from '../../web/winRate';
import { ECONOMY, targetWinRate } from './economy';
import type { EnemySlot } from './types';

export { targetWinRate };

const POSITIONS: readonly Position[] = ['前锋', '中军', '大营'];

/**
 * 敌军随关卡变强：红度与等级走参数，不在流程里写死。
 * @param level 关卡号
 * @param levelCount 总关数
 */
export function enemyGrowth(level: number, levelCount: number = ECONOMY.levelCount): { redness: number; level: number } {
  if (levelCount <= 1) return { redness: 5, level: 50 };
  const t = (Math.min(Math.max(level, 1), levelCount) - 1) / (levelCount - 1);
  if (t >= 1) return { redness: 5, level: 50 };
  if (t >= 0.66) return { redness: 4, level: 40 };
  if (t >= 0.33) return { redness: 2, level: 40 };
  return { redness: 0, level: 40 };
}

/**
 * 按种子和关卡抽出 3 名不重复的敌军。同一组参数结果稳定。
 * @param seed 本局种子
 * @param level 关卡号
 * @param heroIds 可上阵的武将 id
 * @param levelCount 总关数
 */
export function rollEnemySlots(
  seed: number,
  level: number,
  heroIds: readonly string[],
  levelCount: number = ECONOMY.levelCount,
): EnemySlot[] {
  if (heroIds.length < 3) throw new Error('敌方武将池不足 3 人');
  const rng = new Rng((seed + level * 10007) >>> 0);
  const growth = enemyGrowth(level, levelCount);
  const used = new Set<string>();
  const slots: EnemySlot[] = [];
  let guard = 0;
  while (slots.length < 3 && guard < 10000) {
    guard += 1;
    const heroId = heroIds[rng.int(heroIds.length)]!;
    if (used.has(heroId)) continue;
    used.add(heroId);
    slots.push({
      heroId,
      position: POSITIONS[slots.length]!,
      redness: growth.redness,
      level: growth.level,
      skillIds: [],
    });
  }
  if (slots.length < 3) throw new Error('无法抽出 3 名不同敌军');
  return slots;
}

/**
 * 难度阶梯。人数和红度拉开前几档；最后两档加上学习战法，
 * 因为红度拉满之后，胜率还会停在很高的位置。
 */
export const ENEMY_LADDER: readonly LadderRung[] = [
  { count: 1, redness: 0, level: 40, skillIds: [] },
  { count: 2, redness: 0, level: 40, skillIds: [] },
  { count: 3, redness: 0, level: 40, skillIds: [] },
  { count: 3, redness: 2, level: 40, skillIds: [] },
  { count: 3, redness: 4, level: 40, skillIds: [] },
  { count: 3, redness: 5, level: 50, skillIds: [] },
  { count: 3, redness: 5, level: 50, skillIds: ['hunshui_moyu'] },
  { count: 3, redness: 5, level: 50, skillIds: ['hunshui_moyu', 'yiji_dangqian'] },
];

/** 一关抽样场次。页面上 8 档 × 8 场，大约一秒内能出结果。 */
export const LEVEL_PICK_RUNS = 8;

const POS_BY_COUNT: Record<LadderRung['count'], readonly Position[]> = {
  1: ['大营'],
  2: ['中军', '大营'],
  3: ['前锋', '中军', '大营'],
};

/**
 * 我方对敌方的胜率。走生产用的蒙特卡洛：正反站位各半，斩首优先，打满看兵力。
 * @param myTeam 我方
 * @param enemyTeam 敌方
 * @param runs 场次
 * @param baseSeed 起始种子
 */
export function winRateVs(myTeam: General[], enemyTeam: General[], runs: number, baseSeed: number): number {
  if (runs <= 0 || myTeam.length === 0 || enemyTeam.length === 0) return 0;
  return simulateWinRate(myTeam, enemyTeam, { runs, baseSeed, maxRounds: 8, swapSides: true }).winRate;
}

/**
 * 从候选阵容里挑一支玩家胜率最接近目标的。候选为空时抛错。
 * @param playerTeam 玩家当前阵容
 * @param candidates 候选敌军
 * @param target 目标胜率
 * @param opts 抽样场次与种子
 */
export function pickEnemy(
  playerTeam: General[],
  candidates: General[][],
  target: number,
  opts: { runs?: number; baseSeed?: number } = {},
): { team: General[]; winRate: number } {
  if (candidates.length === 0) throw new Error('pickEnemy：候选阵容为空');
  const runs = opts.runs ?? 20;
  const baseSeed = opts.baseSeed ?? 20261007;
  let best = { team: candidates[0]!, winRate: winRateVs(playerTeam, candidates[0]!, runs, baseSeed) };
  for (const team of candidates.slice(1)) {
    const winRate = winRateVs(playerTeam, team, runs, baseSeed);
    if (Math.abs(winRate - target) < Math.abs(best.winRate - target)) best = { team, winRate };
  }
  return best;
}

/** 阶梯上的一档：上几个人、什么红度、带什么学习战法。 */
export interface LadderRung {
  count: 1 | 2 | 3;
  redness: number;
  level: number;
  skillIds: readonly string[];
}

/**
 * 把已经抽出的武将排成某一档。不足 3 人时仍然留着大营，否则斩首判定对不上。
 * @param heroIds 至少 3 个，按顺序取前 count 个
 * @param rung 难度档
 */
export function slotsForRung(heroIds: readonly string[], rung: LadderRung): EnemySlot[] {
  const positions = POS_BY_COUNT[rung.count];
  return positions.map((position, index) => ({
    heroId: heroIds[index]!,
    position,
    redness: rung.redness,
    level: rung.level,
    skillIds: [...rung.skillIds],
  }));
}

function rollDistinct(rosterKey: number, heroIds: readonly string[], count: number): string[] {
  if (heroIds.length < count) throw new Error('敌方武将池不足');
  const rng = new Rng(rosterKey >>> 0);
  const used = new Set<string>();
  const picked: string[] = [];
  let guard = 0;
  while (picked.length < count && guard < 10000) {
    guard += 1;
    const heroId = heroIds[rng.int(heroIds.length)]!;
    if (used.has(heroId)) continue;
    used.add(heroId);
    picked.push(heroId);
  }
  if (picked.length < count) throw new Error('无法抽出足够的敌军');
  return picked;
}

/**
 * 按本关目标胜率，从难度阶梯里挑一档敌军。
 * 同一组脸（rosterKey）只变强度，方便比较第 1 关和第 12 关。
 * @param playerTeam 用来衡量的我方，一般是卡池里红度最高的 3 人
 * @param heroIds 可上阵的敌军武将
 * @param seed 本局种子
 * @param level 关卡号
 * @param build 把槽位建成引擎武将
 * @param opts 抽样、脸的种子、自定义阶梯
 */
export function pickEnemyForLevel(
  playerTeam: General[],
  heroIds: readonly string[],
  seed: number,
  level: number,
  build: (slot: EnemySlot) => General,
  opts: { runs?: number; baseSeed?: number; rosterKey?: number; ladder?: readonly LadderRung[]; levelCount?: number } = {},
): { slots: EnemySlot[]; winRate: number; target: number } {
  if (playerTeam.length === 0) throw new Error('没有用来衡量胜率的我方阵容');
  const ladder = opts.ladder ?? ENEMY_LADDER;
  if (ladder.length === 0) throw new Error('难度阶梯为空');
  const rosterKey = opts.rosterKey ?? ((seed + level * 10007) >>> 0);
  const faces = rollDistinct(rosterKey, heroIds, 3);
  const groups = ladder.map((rung) => slotsForRung(faces, rung));
  const teams = groups.map((slots) => slots.map(build));
  const target = targetWinRate(level, opts.levelCount ?? ECONOMY.levelCount);
  const picked = pickEnemy(playerTeam, teams, target, {
    runs: opts.runs ?? LEVEL_PICK_RUNS,
    baseSeed: opts.baseSeed ?? ((seed + level * 17) >>> 0),
  });
  const index = teams.indexOf(picked.team);
  return { slots: groups[index]!, winRate: picked.winRate, target };
}
