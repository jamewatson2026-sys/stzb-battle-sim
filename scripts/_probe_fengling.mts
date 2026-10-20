/** 探针：奉令护蜀「三段示例」（用户 2026-10-20 追问）—— 3 层 → 普攻只清增伤 → 队友再叠层是否 = 1 增伤 / 4 减伤 */
import { Rng } from '../src/engine/rng';
import { actUnit, applyDamage, triggerAllyActStacks, type CombatContext } from '../src/engine/action';
import { SKILL_REGISTRY } from '../src/data/skills';
import type { General, Position, Skill, Status, UnitState } from '../src/engine/types';

function gen(id: string, position: Position): General {
  return { id, name: id, rarity: '5星', cost: 3, faction: '蜀', tags: [], mutualExclusionGroup: null,
    troopType: 'cavalry', position, attack: 150, defense: 150, strategy: 80, speed: 60, attackRange: 2,
    maxTroops: 10000, mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
    commandSkillIds: [], pursuitSkillIds: [], morale: 100 };
}
const unit = (g: General, side: 'my' | 'enemy'): UnitState =>
  ({ general: g, side, troops: g.maxTroops, wounded: 0, totalDead: 0, alive: true, statuses: [], preparations: [] } as UnitState);
const dump = (tag: string, u: UnitState): string => {
  const st = u.statuses.find((s): s is Extract<Status, { type: 'pending_stacks' }> => s.type === 'pending_stacks');
  const s = st ? `增伤 ${st.boostStacks} / 减伤 ${st.reduceStacks}` : '(无状态)';
  console.log(`  ${tag}: ${s}`);
  return s;
};

const ma = unit(gen('h615', '前锋'), 'my');
ma.general.passiveSkillIds = ['fengling_hushu'];
const ally = unit(gen('ally', '中军'), 'my');
const foe = unit(gen('foe', '前锋'), 'enemy');
const ctx = {
  rng: new Rng(7), myTeam: [ma, ally], enemyTeam: [foe], events: [],
  skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)), lockedCommands: [], stackBuffs: [], currentRound: 1,
} as unknown as CombatContext;

console.log('① 队友 3 次发动 → 3 层');
for (let i = 0; i < 3; i++) triggerAllyActStacks(ctx, ally);
dump('3 层', ma);

console.log('② 马岱普通攻击（应吃 3 层增伤，只清增伤层）');
actUnit(ctx, ma);
dump('普攻后', ma);
const hitEv = ctx.events.find((e) => e.type === 'attack_hit') as { damage?: number; modifiers?: { caused?: unknown[]; reduce?: unknown[] } } | undefined;
console.log('  普攻伤害:', hitEv?.damage, '｜ caused:', JSON.stringify(hitEv?.modifiers?.caused));

console.log('③ 队友再发动 1 次（应 1 增伤 / 4 减伤）');
triggerAllyActStacks(ctx, ally);
dump('再叠层', ma);

console.log('④ 马岱受 1 次伤害（应吃 4 层减伤，清减伤）');
applyDamage(ctx, ma, 800, foe, 'physical', 'basic', undefined, { damageSource: 'basic', damageType: 'physical' });
dump('受击后', ma);
void foe;
