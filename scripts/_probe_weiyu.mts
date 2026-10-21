/**
 * 探针：未雨绸缪「再次发动」到底有没有触发。
 * 用法：npx tsx scripts/_probe_weiyu.mts
 */
import { triggerActiveSkill, type CombatContext } from '../src/engine/action';
import type { BattleEvent, General, Position, Skill, UnitState } from '../src/engine/types';
import { SKILL_REGISTRY } from '../src/data/skills';
import { Rng } from '../src/engine/rng';

function general(id: string, position: Position, patch: Partial<General> = {}): General {
  return {
    id, name: id, rarity: '5星', cost: 3, faction: '汉', tags: [], mutualExclusionGroup: null,
    troopType: 'cavalry', position, attack: 90, defense: 80, strategy: 95, speed: 90, attackRange: 5,
    maxTroops: 10000, mainSkillName: '', skillDesc: '', activeSkillIds: [], passiveSkillIds: [],
    commandSkillIds: [], pursuitSkillIds: [], morale: 100, ...patch,
  } as General;
}

function unit(g: General, side: 'my' | 'enemy'): UnitState {
  return { general: g, side, troops: g.maxTroops, wounded: 0, totalDead: 0, alive: true, statuses: [], preparations: [] } as UnitState;
}

function makeCtx(my: UnitState[], enemy: UnitState[], seed = 7): CombatContext {
  return {
    rng: new Rng(seed), myTeam: my, enemyTeam: enemy, events: [] as BattleEvent[],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [], stackBuffs: [], currentRound: 1,
  } as unknown as CombatContext;
}

const marker = {
  type: 'repeat_strategy' as const,
  remaining: 2,
  appliedRound: 1,
  sourceSkillType: 'active' as const,
  sourceSkillId: 'weiyu_choumou',
};

function probe(skillId: string) {
  const caster = unit(general('caster', '中军'), 'my');
  const enemy = unit(general('enemy', '中军'), 'enemy');
  const ctx = makeCtx([caster], [enemy]);
  caster.statuses.push({ ...marker } as UnitState['statuses'][number]);
  const base = SKILL_REGISTRY[skillId] as Extract<Skill, { type: 'active' }>;
  const skill = { ...base, triggerRate: 1 } as Skill;
  triggerActiveSkill(ctx, caster, skill, ctx.enemyTeam, ctx.myTeam, [...ctx.myTeam, ...ctx.enemyTeam]);
  const casts = ctx.events.filter((e) => e.type === 'skill_cast' && (e as { skillId?: string }).skillId === skillId).length;
  const dmg = ctx.events.filter((e) => e.type === 'damage').length;
  const cond = (base.output ?? []).map((o) => o.kind).join(',');
  const stillHas = caster.statuses.some((s) => s.type === 'repeat_strategy');
  console.log(`${skillId.padEnd(22)} casts=${casts} damage=${dmg} markerLeft=${stillHas} outputs=[${cond}]`);
}

console.log('== 直接带 strategy_damage 的主动战法');
probe('luolei');
probe('luoshi');
// 嵌套：光武中兴 的伤害藏在 random_pick → combo_tag 里
probe('guangwu_zhongxing');

console.log('\n== 扫描：注册表里所有带策略伤害（含嵌套）的主动战法');
function hasStrategy(out: unknown[]): boolean {
  return out.some((raw) => {
    const o = raw as { kind: string; outputs?: unknown[]; options?: unknown[][] };
    if (o.kind === 'strategy_damage') return true;
    if (Array.isArray(o.outputs) && hasStrategy(o.outputs)) return true;
    if (Array.isArray(o.options) && o.options.some((g) => Array.isArray(g) && hasStrategy(g))) return true;
    return false;
  });
}
function hasTopLevelStrategy(out: unknown[]): boolean {
  return out.some((raw) => (raw as { kind: string }).kind === 'strategy_damage');
}
let nested = 0;
let direct = 0;
const nestedIds: string[] = [];
for (const [id, sk] of Object.entries(SKILL_REGISTRY)) {
  const s = sk as Skill;
  if (s.type !== 'active') continue;
  const out = (s as { output?: unknown[] }).output ?? [];
  if (hasTopLevelStrategy(out)) direct++;
  else if (hasStrategy(out)) {
    nested++;
    nestedIds.push(id);
  }
}
console.log(`直接段 ${direct} 个；仅嵌套段 ${nested} 个（这些目前不会触发再发动）`);
console.log('嵌套样例:', nestedIds.slice(0, 12).join(', '));

console.log('\n== 真实链路：先发未雨绸缪，再发策略战法');
{
  const caster = unit(general('caster2', '中军'), 'my');
  const enemy = unit(general('enemy2', '中军'), 'enemy');
  const ctx = makeCtx([caster], [enemy]);
  const wy = { ...(SKILL_REGISTRY.weiyu_choumou as Extract<Skill, { type: 'active' }>), triggerRate: 1 } as Skill;
  triggerActiveSkill(ctx, caster, wy, ctx.enemyTeam, ctx.myTeam, [...ctx.myTeam, ...ctx.enemyTeam]);
  console.log('未雨绸缪后状态:', caster.statuses.map((s) => `${s.type}/${(s as { remaining?: number }).remaining}`));
  const luolei = { ...(SKILL_REGISTRY.luolei as Extract<Skill, { type: 'active' }>), triggerRate: 1 } as Skill;
  triggerActiveSkill(ctx, caster, luolei, ctx.enemyTeam, ctx.myTeam, [...ctx.myTeam, ...ctx.enemyTeam]);
  const casts = ctx.events.filter((e) => e.type === 'skill_cast').map((e) => (e as { skillId?: string }).skillId);
  console.log('同回合连发 skill_cast 序列:', casts.join(' → '));
  console.log('落雷伤害段数:', ctx.events.filter((e) => e.type === 'damage').length);
}

console.log('\n== 修复后：嵌套伤害战法也该再发动，且策略伤害带 ignoreStrategy');
{
  const caster = unit(general('caster3', '中军'), 'my');
  const enemy = unit(general('enemy3', '中军'), 'enemy');
  const ctx = makeCtx([caster], [enemy]);
  caster.statuses.push({ ...marker } as UnitState['statuses'][number]);
  const gw = { ...(SKILL_REGISTRY.guangwu_zhongxing as Extract<Skill, { type: 'active' }>), triggerRate: 1 } as Skill;
  triggerActiveSkill(ctx, caster, gw, ctx.enemyTeam, ctx.myTeam, [...ctx.myTeam, ...ctx.enemyTeam]);
  const casts = ctx.events.filter((e) => e.type === 'skill_cast');
  const dmgs = ctx.events.filter((e) => e.type === 'damage') as Array<{ ignoreStrategy?: { pct: number } }>;
  console.log('光武中兴 skill_cast', casts.length, '次；伤害段', dmgs.length, '；ignoreStrategy', dmgs.map((d) => d.ignoreStrategy?.pct).join('/') || '无');
  const castEv = casts[casts.length - 1] as { recastBy?: string; recastRate?: number };
  console.log('再次发动标注:', castEv.recastBy, castEv.recastRate);

  const ctx2 = makeCtx([unit(general('c4', '中军'), 'my')], [unit(general('e4', '中军'), 'enemy')]);
  const c2 = ctx2.myTeam[0];
  c2.statuses.push({ ...marker } as UnitState['statuses'][number]);
  const dx = { ...(SKILL_REGISTRY.daoxing_xianzu as Extract<Skill, { type: 'active' }>), triggerRate: 1 } as Skill;
  triggerActiveSkill(ctx2, c2, dx, ctx2.enemyTeam, ctx2.myTeam, [...ctx2.myTeam, ...ctx2.enemyTeam]);
  const d2 = ctx2.events.filter((e) => e.type === 'damage') as Array<{ damageType: string; ignoreStrategy?: { pct: number } }>;
  console.log('道行险阻 伤害段', d2.length, '；strategy ignore', d2.filter((d) => d.damageType === 'strategy').map((d) => d.ignoreStrategy?.pct).join('/') || '无');
}
