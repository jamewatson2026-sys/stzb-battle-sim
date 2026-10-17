/**
 * 探针（2026-10-17 / m00521 用户质疑）：舍身卫主的「反击判定」到底吃哪些伤害？
 *
 * 用户口径：「全队受到的攻击伤害都由典韦承担」+「只要典韦受到了伤害（伤害包括攻击伤害和谋略伤害）
 * 就会触发反击判定」—— 不是只有普攻。
 *
 * 四个场景，每个跑「带 舍身卫主」与「不带（对照）」两臂，各 40 个种子：
 *  S1 谋略战法（驱虎吞狼：策略 153%，敌军全体）
 *  S2 物理战法（一骑当千：物理 280%，敌军全体）→ 前 3 回合应被「承担」改判到典韦
 *  S3 谋略持续伤害（密谋定蜀·恐慌 DoT 跳伤）
 *  S4 普攻（兜底）
 *
 * 事件流里普攻是 `attack_hit`、战法是 `damage`、DoT 是 `dot_tick`，三者都要按「打到典韦」统计，
 * 并记录「每次舍身卫主判定之前，典韦最后吃到的是哪一类伤害」。
 */
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General, Position } from '../src/engine/types';

function mk(id: string, name: string, position: Position, opts: {
  attack?: number; defense?: number; strategy?: number; speed?: number; attackRange?: number;
  maxTroops?: number; active?: string[]; passive?: string[]; command?: string[];
} = {}): General {
  return {
    id, name, rarity: '4星', cost: 1, faction: '汉', tags: [],
    mutualExclusionGroup: null, troopType: 'infantry', position,
    attack: opts.attack ?? 60, defense: opts.defense ?? 100, strategy: opts.strategy ?? 60,
    speed: opts.speed ?? 50, attackRange: opts.attackRange ?? 2, maxTroops: opts.maxTroops ?? 20000,
    mainSkillName: '', skillDesc: '',
    activeSkillIds: opts.active ?? [], passiveSkillIds: opts.passive ?? [],
    commandSkillIds: opts.command ?? [], pursuitSkillIds: [],
    morale: 100,
  };
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const DW = 'dw';

interface Acc {
  hits: Map<string, number>;        // 典韦实际吃到的伤害：`类型|战法` → 次数
  triggers: number;
  prevByTrigger: Map<string, number>;
  counterHits: number;
  bySkillTarget: Map<string, Map<string, number>>; // 战法 → 目标 → 次数
  bySkillRound: Map<string, Map<string, number>>;  // `战法@回合` → 目标 → 次数
}

function newAcc(): Acc {
  return {
    hits: new Map(), triggers: 0, prevByTrigger: new Map(), counterHits: 0,
    bySkillTarget: new Map(), bySkillRound: new Map(),
  };
}

function runArm(opts: {
  withSheshen: boolean;
  enemyPattern: (mk1: (id: string, name: string, pos: Position) => General) => General[];
}): Acc {
  const acc = newAcc();
  for (const seed of SEEDS) {
    const mine: General[] = [
      mk('r1', '甲', '大营', { strategy: 100 }),
      mk('r2', '乙', '中军', { strategy: 100 }),
      mk(DW, '典韦', '前锋', { ...(opts.withSheshen ? { passive: ['sheshen_weizhu'] } : {}) }),
    ];
    const foes = opts.enemyPattern((id, name, pos) => mk(id, name, pos, { strategy: 120, attack: 120 }));
    const report = runBattle({ myTeam: mine, enemyTeam: foes, seed, maxRounds: 8 });
    let round = 0;
    let lastHit: string | null = null;
    const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
    for (const ev of report.events as BattleEvent[]) {
      if (ev.type === 'round_start') { round = ev.round; continue; }
      // ── 典韦吃到的伤害（三类事件）
      if (ev.type === 'attack_hit') {
        bump(acc.bySkillTarget, 'attack_hit', ev.targetId);
        const br = acc.bySkillRound.get(`attack_hit@${round}`) ?? new Map<string, number>();
        br.set(ev.targetId, (br.get(ev.targetId) ?? 0) + 1);
        acc.bySkillRound.set(`attack_hit@${round}`, br);
        if (ev.targetId === DW) { bump(acc.hits, 'basic|普攻'); lastHit = 'basic|普攻'; }
        continue;
      }
      if (ev.type === 'damage') {
        const targetMap = acc.bySkillTarget.get(ev.skillId) ?? new Map<string, number>();
        targetMap.set(ev.targetId, (targetMap.get(ev.targetId) ?? 0) + 1);
        acc.bySkillTarget.set(ev.skillId, targetMap);
        const rk = `${ev.skillId}@${round}`;
        const br = acc.bySkillRound.get(rk) ?? new Map<string, number>();
        br.set(ev.targetId, (br.get(ev.targetId) ?? 0) + 1);
        acc.bySkillRound.set(rk, br);
        if (ev.targetId === DW) { const k = `${ev.damageType}|${ev.skillId}`; bump(acc.hits, k); lastHit = k; }
        if (ev.sourceId === DW && ev.skillId === 'sheshen_weizhu') acc.counterHits++;
        continue;
      }
      if (ev.type === 'dot_tick') {
        const targetMap = acc.bySkillTarget.get(`dot:${ev.skillId}`) ?? new Map<string, number>();
        targetMap.set(ev.targetId, (targetMap.get(ev.targetId) ?? 0) + 1);
        acc.bySkillTarget.set(`dot:${ev.skillId}`, targetMap);
        if (ev.targetId === DW) { const k = `dot|${ev.dotType}`; bump(acc.hits, k); lastHit = k; }
        continue;
      }
      if (ev.type === 'skill_trigger' && ev.skillId === 'sheshen_weizhu') {
        acc.triggers++;
        bump(acc.prevByTrigger, lastHit ?? '(无前置伤害)');
      }
    }
  }
  return acc;
}

const fmt = (m: Map<string, number>, n = 6) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}×${v}`).join('  ') || '(无)';
const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

function report(title: string, a: Acc, b: Acc) {
  console.log(`\n=== ${title} ===`);
  console.log(`[带舍身卫主] 典韦受击 ${total(a.hits)} 次 → ${fmt(a.hits)}`);
  console.log(`  判定 ${a.triggers} 次 / 反击命中 ${a.counterHits} 次`);
  console.log(`  每次判定前最后一次受击: ${fmt(a.prevByTrigger, 8)}`);
  console.log(`[对照 无舍身卫主] 典韦受击 ${total(b.hits)} 次 → ${fmt(b.hits)}；判定 ${b.triggers} 次`);
}

// S1 谋略战法：敌前锋 驱虎吞狼（策略 153%，敌军全体）
{
  const pat = (m: (id: string, name: string, pos: Position) => General) => [
    m('e1', '敌1', '大营'), m('e2', '敌2', '中军'),
    { ...m('e3', '荀彧', '前锋'), activeSkillIds: ['quhu_tunlang'] } as General,
  ];
  const a = runArm({ withSheshen: true, enemyPattern: pat });
  const b = runArm({ withSheshen: false, enemyPattern: pat });
  report('S1 谋略战法（驱虎吞狼·策略伤害）', a, b);
}

// S2 物理战法：敌大营 一骑当千（物理 280%，敌军全体，1 回合准备）
{
  const pat = (m: (id: string, name: string, pos: Position) => General) => [
    m('e1', '敌1', '大营'),
    { ...m('e2', '吕布', '中军'), activeSkillIds: ['yiji_dangqian'] } as General,
    m('e3', '敌3', '前锋'),
  ];
  const a = runArm({ withSheshen: true, enemyPattern: pat });
  const b = runArm({ withSheshen: false, enemyPattern: pat });
  report('S2 物理战法（一骑当千·物理伤害；施法者中军=距离2，落在舍身卫主 2 距离内）', a, b);
  const per = (acc: Acc, skill: string) => {
    const out: string[] = [];
    for (const r of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const m = acc.bySkillRound.get(`${skill}@${r}`);
      if (m) out.push(`R${r}: ${fmt(m, 4)}`);
    }
    return out.join(' | ');
  };
  console.log('  一骑当千逐回合命中 [带舍身]:', per(a, 'yiji_dangqian'));
  console.log('  一骑当千逐回合命中 [对照  ]:', per(b, 'yiji_dangqian'));
}

// S3 谋略持续伤害：敌前锋 密谋定蜀（恐慌 143% DoT）
{
  const pat = (m: (id: string, name: string, pos: Position) => General) => [
    m('e1', '敌1', '大营'), m('e2', '敌2', '中军'),
    { ...m('e3', '庞统', '前锋'), activeSkillIds: ['mimou_dingshu'] } as General,
  ];
  const a = runArm({ withSheshen: true, enemyPattern: pat });
  const b = runArm({ withSheshen: false, enemyPattern: pat });
  report('S3 谋略持续伤害（密谋定蜀·恐慌 DoT）', a, b);
}

// S4 普攻兜底：敌方无战法
{
  const pat = (m: (id: string, name: string, pos: Position) => General) => [
    m('e1', '敌1', '大营'), m('e2', '敌2', '中军'), m('e3', '敌3', '前锋'),
  ];
  const a = runArm({ withSheshen: true, enemyPattern: pat });
  const b = runArm({ withSheshen: false, enemyPattern: pat });
  report('S4 普攻（兜底）', a, b);
}
