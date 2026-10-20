/** 探针：乘间击隙 15% 增伤与「击势式被动 0.5 / 巾帼式主动 0.4」是否互吃 —— 直接看状态表 */
import { Rng } from '../src/engine/rng';
import { inflictStatus, type CombatContext } from '../src/engine/action';
import type { General, Position, Status, UnitState } from '../src/engine/types';

function gen(id: string, position: Position): General {
  return { id, name: id, rarity: '5星', cost: 3, faction: '汉', tags: [], mutualExclusionGroup: null,
    troopType: 'infantry', position, attack: 180, defense: 100, strategy: 100, speed: 50, attackRange: 3,
    maxTroops: 10000, mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
    commandSkillIds: [], pursuitSkillIds: [], morale: 100 };
}
function unit(g: General, side: 'my' | 'enemy'): UnitState {
  return { general: g, side, position: g.position, troops: 10000, maxTroops: 10000, wounded: 0, totalDead: 0,
    alive: true, statuses: [] as Status[] };
}
function dump(tag: string, u: UnitState): void {
  const rows = u.statuses.filter((s) => s.type === 'damage_boost').map((s) => {
    const x = s as unknown as { rate?: number; stacks?: number; maxStacks?: number; direction?: string; attackOnly?: boolean; sourceSkillId?: string };
    return `${x.sourceSkillId}:${x.direction}${x.attackOnly ? '(atk)' : ''} rate=${x.rate} stacks=${x.stacks}/${x.maxStacks}`;
  });
  console.log(`  ${tag}: ${rows.length ? rows.join(' | ') : '(无 damage_boost)'}`);
}

const a = unit(gen('a', '前锋'), 'my');
const e = unit(gen('e', '前锋'), 'enemy');
const ctx = {
  rng: new Rng(1), units: [a, e], myTeam: [a], enemyTeam: [e], events: [],
  currentRound: 1, currentActorId: 'a',
} as unknown as CombatContext;

const CJ = { type: 'damage_boost', rate: 0.15, duration: 999, direction: 'caused', attackOnly: true, stacks: 1, maxStacks: 3 } as const;
const JISHI = { type: 'damage_boost', rate: 0.5, duration: 1, direction: 'caused', attackOnly: true } as const;
const JINGUO = { type: 'damage_boost', rate: 0.4, duration: 1, direction: 'caused', attackOnly: true } as const;

inflictStatus(ctx, a, CJ as never, 'command', 'chengjian_jixi');
dump('乘间 第1层', a);
inflictStatus(ctx, a, CJ as never, 'command', 'chengjian_jixi');
dump('乘间 第2层', a);
inflictStatus(ctx, a, CJ as never, 'command', 'chengjian_jixi');
dump('乘间 第3层', a);
inflictStatus(ctx, a, JISHI as never, 'passive', 'jishi');
dump('+击势 0.5(被动)', a);
inflictStatus(ctx, a, JINGUO as never, 'active', 'jinguo_zhanzhen');
dump('+巾帼 0.4(主动)', a);
console.log('  事件:', JSON.stringify((ctx.events as unknown[]).map((x) => x)));
