/**
 * 临时探针 —— 肉鸽方案 §8.1 实测项（用完可删，属 scripts/_* 临时脚本惯例）
 * ---------------------------------------------------------------------------
 * 回答两个问题：
 *   ① 斩首通常在第几回合发生？（分布 —— 数 round_start 事件，不用 RunRaw.rounds，
 *      后者返回的是配置的 maxRounds，恒等于 8，测不出提前结束）
 *   ② draw（打满 8 回合）的实际占比？其中「真平」（兵力比完全相同）有多少？
 * 数据源：web/data/opponent_benchmark.json 的真实阵容配置（非自造阵容）。
 * 口径：全部复用生产代码 —— generalsOf 构建 + runBattle 结算 + judgeOutcome 实战判定。
 *
 * 用法：npx tsx scripts/_rogue_probe.mts [每对场次，默认 100]
 */
import fs from 'node:fs';
import path from 'node:path';
import type { General } from '../src/engine/types';
import { runBattle } from '../src/engine/combat';
import { generalsOf } from '../web/teamConfig';
import { judgeOutcome } from '../web/battleSim';

const root = process.cwd();
const bench = JSON.parse(
  fs.readFileSync(path.join(root, 'web/data/opponent_benchmark.json'), 'utf8')
) as { version: string; entries: Array<{ id: string; note?: string; cfg: any }> };

const RUNS = Number(process.argv[2] ?? 100);
const MAX_ROUNDS = 8;
const BASE_SEED = 20260922;

const teams = bench.entries.map((e) => ({
  id: e.id,
  note: e.note ?? e.id,
  gens: generalsOf(e.cfg, e.cfg.morale ?? 120),
}));

console.log(`benchmark 版本 ${bench.version}｜队伍 ${teams.length} 支｜每对 ${RUNS} 场`);

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const cap = (g: General[]) => sum(g.map((x) => x.maxTroops));

let decapWin = 0;
let decapLoss = 0;
let troopsWin = 0;
let troopsLoss = 0;
let trueDraw = 0;
let total = 0;
let ratioSum = 0;
const roundHist = new Map<number, number>();
let seedIdx = 0;

for (let i = 0; i < teams.length; i++) {
  for (let j = 0; j < teams.length; j++) {
    if (i === j) continue;
    const myCap = cap(teams[i].gens);
    const enCap = cap(teams[j].gens);
    for (let r = 0; r < RUNS; r++) {
      const report = runBattle({
        myTeam: teams[i].gens,
        enemyTeam: teams[j].gens,
        seed: BASE_SEED + seedIdx++,
        maxRounds: MAX_ROUNDS,
      });
      const roundsPlayed = report.events.filter((e) => e.type === 'round_start').length;
      const myRatio = sum(report.finalMyTroops) / myCap;
      const enRatio = sum(report.finalEnemyTroops) / enCap;
      const judged = judgeOutcome(report.result, myRatio, enRatio);

      total++;
      roundHist.set(roundsPlayed, (roundHist.get(roundsPlayed) ?? 0) + 1);
      ratioSum += myRatio - enRatio;

      if (judged.draw) trueDraw++;
      else if (judged.kind === 'decap') judged.win ? decapWin++ : decapLoss++;
      else judged.win ? troopsWin++ : troopsLoss++;
    }
  }
}

const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
const avgRounds = [...roundHist.entries()].reduce((a, [rd, n]) => a + rd * n, 0) / total;
const decapAll = decapWin + decapLoss;
const troopsAll = troopsWin + troopsLoss;
const avgRoundsDecap = decapAll
  ? [...roundHist.entries()].reduce((a, [rd, n]) => a + Math.min(rd, MAX_ROUNDS) * n, 0) / total
  : 0;

console.log(`\n总场次 ${total}`);
console.log(`斩首结束（大营阵亡）      ${decapAll} 场 = ${pct(decapAll)}  （胜 ${pct(decapWin)} / 负 ${pct(decapLoss)}）`);
console.log(`打满 8 回合 → 兵力比判定  ${troopsAll} 场 = ${pct(troopsAll)}  （胜 ${pct(troopsWin)} / 负 ${pct(troopsLoss)}）`);
console.log(`真平（兵力比完全相同）    ${trueDraw} 场 = ${pct(trueDraw)}`);
console.log(`先手方胜率                ${pct(decapWin + troopsWin)}`);
console.log(`平均实际回合数            ${avgRounds.toFixed(2)}（上限 ${MAX_ROUNDS}）`);
console.log(`平均兵力比差（我-敌）     ${(ratioSum / total).toFixed(3)}`);

console.log('\n实际回合数分布（数 round_start 事件）：');
for (let rd = 0; rd <= MAX_ROUNDS; rd++) {
  const n = roundHist.get(rd) ?? 0;
  if (!n) continue;
  const bar = '█'.repeat(Math.max(1, Math.round((n / total) * 60)));
  console.log(`  ${String(rd).padStart(2)} 回合  ${String(n).padStart(5)}  ${pct(n).padStart(6)}  ${bar}`);
}
