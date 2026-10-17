/**
 * 临时探针（只读）：观察孙权「九锡黄龙」授予规避的层数变化。
 * 用法：npx tsx scripts/_probe_evasion.mts [fixture名] [跑次数]
 *
 * 层数近似模型：status_inflicted「规避 +N 层」累加、evasion_blocked 每次 −1
 * （规避为层数制、不按回合递减，引擎同源重复施放走 stacks += ）
 */
import { runBattle } from '../src/engine/combat';
import { buildAllFixtures } from '../tests/fixtures';
import { initHeroDB } from '../src/data/heroes';
import type { BattleReport } from '../src/engine/types';

const fixtureName = process.argv[2] ?? 'T8_WU_TRIO_L40';
const runs = Number(process.argv[3] ?? '1');

async function main() {
  await initHeroDB();
  const fixtures = buildAllFixtures() as Record<string, unknown>;
  const cfg = fixtures[fixtureName];
  if (!cfg) {
    console.log('未找到 fixture:', fixtureName, '可选:', Object.keys(fixtures).join(', '));
    process.exit(1);
  }

  const peaks: number[] = [];
  const castCounts: number[] = [];
  let firstLog = true;

  for (let r = 0; r < runs; r++) {
    const rep = runBattle(cfg as never) as BattleReport;
    const cur = new Map<string, number>();
    const peak = new Map<string, number>();
    let casts = 0;

    for (const e of rep.events) {
      const ev = e as { type: string; unitId?: string; detail?: string; skillId?: string };
      if (ev.type === 'skill_cast') casts++;
      if (ev.type === 'status_inflicted' && ev.unitId && (ev.detail ?? '').includes('规避')) {
        const m = /\+(\d+)/.exec(ev.detail ?? '');
        const n = m ? Number(m[1]) : 1;
        const now = (cur.get(ev.unitId) ?? 0) + n;
        cur.set(ev.unitId, now);
        peak.set(ev.unitId, Math.max(peak.get(ev.unitId) ?? 0, now));
        if (firstLog) console.log(`  [run0] ${ev.unitId} 获得规避 +${n} → 当前 ${now}`);
      }
      if (ev.type === 'evasion_blocked' && ev.unitId) {
        cur.set(ev.unitId, Math.max(0, (cur.get(ev.unitId) ?? 0) - 1));
      }
    }
    const p = Math.max(0, ...peak.values());
    peaks.push(p);
    castCounts.push(casts);
    if (r === 0) firstLog = false;
  }

  const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
  console.log(`\nfixture=${fixtureName} runs=${runs}`);
  console.log(`规避层数峰值: min=${Math.min(...peaks)} max=${Math.max(...peaks)} avg=${avg(peaks)}`);
  console.log(`峰值分布: ${JSON.stringify(peaks.reduce<Record<number, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {}))}`);
  console.log(`总 skill_cast 次数: avg=${avg(castCounts)}`);
}

void main();
