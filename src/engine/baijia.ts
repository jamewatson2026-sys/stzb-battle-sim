/**
 * 百家副将装配：同阵营、同兵种、不可同名，一名。
 * 主将学会该词条五件套。属性混合百分比缺省时不改面板。
 */
import { BAIJIA_HEROES, BAIJIA_SKILLS } from '../data/baijia';
import type { General } from './types';

/**
 * 把副将五件套写进主将技能列表。没有副将时原样返回。
 * @param g 主将
 */
export function applyBaijia(g: General): General {
  const ap = g.baijia;
  if (!ap) return g;
  const hero = BAIJIA_HEROES[ap.heroId];
  if (!hero) throw new Error(`百家副将不存在：${ap.heroId}`);
  const set = hero.sets.find((s) => s.id === ap.setId);
  if (!set) throw new Error(`${hero.name}没有词条：${ap.setId}`);
  if (g.faction !== hero.faction) throw new Error(`${hero.name}与主将阵营不同`);
  if (g.troopType !== hero.troopType) throw new Error(`${hero.name}与主将兵种不同`);
  if (g.name === hero.name) throw new Error(`不能把${hero.name}任命为自己的副将`);

  const mp = ap.mainStatPct;
  const dp = ap.deputyStatPct;
  const mix = (main: number, deputy: number) =>
    mp != null && dp != null ? (main * mp + deputy * dp) / 100 : main;

  const active: string[] = [];
  const pursuit: string[] = [];
  const command: string[] = [];
  const passive: string[] = [];
  for (const id of set.skillIds) {
    const skill = BAIJIA_SKILLS[id];
    if (!skill) continue;
    if (skill.type === 'passive') passive.push(id);
    else if (skill.type === 'active') active.push(id);
    else if (skill.type === 'pursuit') pursuit.push(id);
    else command.push(id);
  }
  return {
    ...g,
    attack: mix(g.attack, hero.attack),
    defense: mix(g.defense, hero.defense),
    strategy: mix(g.strategy, hero.strategy),
    speed: mix(g.speed, hero.speed),
    activeSkillIds: [...g.activeSkillIds, ...active],
    pursuitSkillIds: [...g.pursuitSkillIds, ...pursuit],
    commandSkillIds: [...g.commandSkillIds, ...command],
    passiveSkillIds: [...g.passiveSkillIds, ...passive],
  };
}
