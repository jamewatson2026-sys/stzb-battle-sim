import { diagnoseBattle } from '../../src/engine/diagnosis';
import { renderEventLines } from '../../src/engine/report';
import { computeContributionShares, computeDetailedStats } from '../../src/engine/stats';
import { SKILL_REGISTRY } from '../../src/data/skills';
import type { BattleEvent, BattleReport, General, UnitState } from '../../src/engine/types';
import type { Outcome } from '../../src/rogue/types';
import { esc } from './dom';

export interface TimelineChunk {
  id: string;
  label: string;
  text: string;
}

/**
 * 斩首发生在哪一回合。没有大营阵亡时，说明是打满后按兵力判定。
 * @param report 本场战报
 */
export function decapHeadline(report: Pick<BattleReport, 'myTeam' | 'enemyTeam' | 'events' | 'rounds'>): string {
  const backs = new Map<string, string>();
  for (const general of report.myTeam) {
    if (general.position === '大营') backs.set(general.id, `我方大营 ${general.name}`);
  }
  for (const general of report.enemyTeam) {
    if (general.position === '大营') backs.set(general.id, `敌方大营 ${general.name}`);
  }
  let round = 0;
  for (const event of report.events) {
    if (event.type === 'round_start') round = event.round;
    if (event.type === 'unit_dead' && backs.has(event.unitId)) {
      const when = round > 0 ? `第 ${round} 回合` : '准备阶段';
      return `斩首于${when}（${backs.get(event.unitId)}）`;
    }
  }
  return `打满 ${report.rounds} 回合，按兵力判定`;
}

/**
 * 把战报事件切成准备阶段和每一回合，供战报页快进。
 * @param events 引擎事件
 */
export function timelineChunks(events: readonly BattleEvent[]): TimelineChunk[] {
  const buckets = new Map<string, string[]>();
  const labels = new Map<string, string>([['prep', '准备']]);
  const order: string[] = [];
  let current = 'prep';
  const take = (id: string) => {
    if (!buckets.has(id)) {
      buckets.set(id, []);
      order.push(id);
    }
    return buckets.get(id)!;
  };
  for (const event of events) {
    if (event.type === 'round_start') {
      current = `r${event.round}`;
      labels.set(current, `第${event.round}回合`);
    }
    take(current).push(...renderEventLines(event));
  }
  return order
    .filter((id) => (buckets.get(id)?.length ?? 0) > 0)
    .map((id) => ({ id, label: labels.get(id) ?? id, text: buckets.get(id)!.join('\n') }));
}

/**
 * 统计函数要的单位壳。只带武将和阵营，兵力不参与汇总。
 * @param general 武将
 * @param side 阵营
 */
function unitStub(general: General, side: 'my' | 'enemy'): UnitState {
  return {
    general,
    side,
    troops: 0,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

const OUTCOME_LABEL: Record<Outcome, string> = { win: '胜', lose: '败', draw: '平' };

/**
 * 战报页：胜负、斩首回合、兵力、败因、贡献占比、战法杀伤和可快进的回合记录。
 * @param root 挂载点
 * @param view 本场战报与继续回调
 */
export function renderReport(
  root: HTMLElement,
  view: { report: BattleReport; outcome: Outcome; elite: boolean; onNext: () => void },
): void {
  const { report, outcome } = view;
  const bars = report.myTeam
    .map((general, index) => {
      const left = report.finalMyTroops[index] ?? 0;
      const max = Math.max(1, general.maxTroops);
      const pct = Math.max(0, Math.min(100, Math.round((left / max) * 100)));
      return `<div class="rg-troop"><span>${esc(general.name)} ${left}/${general.maxTroops}</span><div class="rg-bar"><i style="width:${pct}%"></i></div></div>`;
    })
    .join('');
  const units = [
    ...report.myTeam.map((general) => unitStub(general, 'my')),
    ...report.enemyTeam.map((general) => unitStub(general, 'enemy')),
  ];
  const shares = computeContributionShares(report.events, units)
    .filter((row) => row.side === 'my')
    .map((row) => `<li>${esc(row.name)}：伤害 ${row.damagePct}% · 治疗 ${row.healPct}% · 控制 ${row.controlPct}%</li>`)
    .join('');
  const detailed = computeDetailedStats(report.events, units);
  const casts = detailed
    .flatMap((unit) => unit.skills.filter((skill) => skill.castCount > 0 || skill.damage > 0).map((skill) => {
      const name = SKILL_REGISTRY[skill.skillId]?.name ?? skill.skillId;
      const via = skill.killers
        .filter((killer) => killer.name !== unit.name && killer.damage > 0)
        .map((killer) => `${killer.name} ${Math.round(killer.damage)}`)
        .join('、');
      const extra = via ? `，经 ${via}` : '';
      return `<li>${esc(unit.name)} · ${esc(name)}：出手 ${skill.castCount} 次，伤害 ${Math.round(skill.damage)}${esc(extra)}</li>`;
    }))
    .slice(0, 12)
    .join('');
  const chunks = timelineChunks(report.events);
  const timelineText = chunks.map((chunk) => chunk.text).join('\n');
  let cause = '';
  try {
    const diagnosis = diagnoseBattle(report);
    const lines = diagnosis.issues.map((issue) => `${issue.label}：${issue.detail}`);
    cause = lines.length > 0 ? lines.join('\n') : diagnosis.verdict.summary;
  } catch (error) {
    cause = error instanceof Error ? error.message : '败因分析失败';
  }
  root.innerHTML = `
    <section id="rg-report">
      <h2>战报 · ${OUTCOME_LABEL[outcome]} · 第 ${report.rounds} 回合结束</h2>
      <p id="rg-decap">${esc(decapHeadline(report))}</p>
      ${view.elite ? '<p class="rg-note">幕末精英关：突破奖励本版未开放。</p>' : ''}
      <div id="rg-troops">${bars}</div>
      <h3>${outcome === 'lose' ? '败因' : '战况'}</h3>
      <pre id="rg-cause">${esc(cause)}</pre>
      <h3>贡献</h3>
      <ul>${shares}</ul>
      <h3>战法统计</h3>
      <ul>${casts || '<li>本场没有记到战法出手</li>'}</ul>
      <h3>逐回合</h3>
      <div class="rg-filters" id="rg-rounds">
        <button type="button" id="rg-round-all" data-round="all">全部</button>
        ${chunks.map((chunk) => `<button type="button" data-round="${esc(chunk.id)}">${esc(chunk.label)}</button>`).join('')}
      </div>
      <pre id="rg-timeline"></pre>
      <button id="rg-next" type="button">继续</button>
    </section>`;
  const timeline = root.querySelector('#rg-timeline');
  const showTimeline = (id: string) => {
    if (!timeline) return;
    timeline.textContent = id === 'all' ? timelineText : (chunks.find((chunk) => chunk.id === id)?.text ?? '');
    root.querySelectorAll<HTMLButtonElement>('#rg-rounds button').forEach((button) => {
      button.classList.toggle('rg-on', button.dataset.round === id);
    });
  };
  showTimeline('all');
  root.querySelectorAll<HTMLButtonElement>('#rg-rounds button').forEach((button) => {
    button.addEventListener('click', () => showTimeline(button.dataset.round ?? 'all'));
  });
  root.querySelector('#rg-next')!.addEventListener('click', view.onNext);
}
