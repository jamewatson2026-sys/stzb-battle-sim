import { TREASURES } from '../../src/data/treasures';
import { SKILL_REGISTRY } from '../../src/data/skills';
import type { TeamTuning } from '../../src/rogue/loop';
import type { General, Position, TroopType } from '../../src/engine/types';
import type { EnemySlot } from '../../src/rogue/types';
import { ECONOMY, skillsOfGrades } from '../../src/rogue/economy';
import {
  HEROES,
  HERO_RECORDS,
  SKILL_GRADES,
  buildGeneral,
  defaultFreePoints,
  getHeroById,
  isLearnableSkillListed,
  isMainSkill,
  portraitSrc,
} from '../heroes';
import { SKILL_OPTIONS } from '../teamConfig';
import { filterSkills, type SkillChoice, type SkillRow } from './skillFilter';
import { soldierTypeOf } from './soldierFit';

const TYPE_LABEL: Record<string, string> = {
  active: '主动',
  passive: '被动',
  command: '指挥',
  pursuit: '追击',
};

/**
 * 战法类型的中文名。
 * @param type 引擎里的类型
 */
export function skillTypeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

/**
 * 可被五连抽抽到的武将：与配将台上架池相同。
 */
export function gachaHeroIds(): string[] {
  return HEROES.map((hero) => hero.id);
}

/**
 * 武将展示名。找不到时退回 id。
 * @param heroId 武将 id
 */
export function heroName(heroId: string): string {
  return HERO_RECORDS[heroId]?.name ?? HEROES.find((hero) => hero.id === heroId)?.name ?? heroId;
}

/**
 * 画像地址。没有素材时返回空串。
 * @param heroId 武将 id
 */
export function portraitOf(heroId: string): string {
  return portraitSrc(heroId);
}

/**
 * 开局背包：品级表里的 D/C/B。
 */
export function initialSkillIds(): string[] {
  return skillsOfGrades(SKILL_GRADES, ECONOMY.freeGrades);
}

function toRow(skillId: string, grade: string): SkillRow | null {
  const skill = SKILL_REGISTRY[skillId];
  if (!skill || isMainSkill(skillId) || !isLearnableSkillListed(skillId)) return null;
  return { id: skillId, name: skill.name, grade, type: skill.type };
}

/**
 * 背包里实际可以装配的战法。
 * @param skillIds 已拥有的战法 id
 */
export function equippableRows(skillIds: readonly string[]): SkillRow[] {
  const rows: SkillRow[] = [];
  for (const skillId of skillIds) {
    const row = toRow(skillId, SKILL_GRADES[skillId] ?? '');
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * 商店目录：已实现、可学习、不是主战法的 A/S。
 */
export function shopRows(): SkillRow[] {
  const rows: SkillRow[] = [];
  for (const [skillId, grade] of Object.entries(SKILL_GRADES)) {
    if (grade !== 'A' && grade !== 'S') continue;
    const row = toRow(skillId, grade);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * 通关掉落与购买用的品级目录。
 */
export function gradeCatalogue(): Array<{ skillId: string; grade: string }> {
  return shopRows().map((row) => ({ skillId: row.id, grade: row.grade }));
}

/**
 * 可掉落的宝物 id。
 */
export function treasureIds(): string[] {
  return TREASURES.map((treasure) => String(treasure.id));
}

/**
 * 宝物下拉选项。
 */
export function treasureOptions(): Array<{ id: string; name: string }> {
  return TREASURES.map((treasure) => ({ id: String(treasure.id), name: treasure.name }));
}

/**
 * 按卡池上的红度、等级构建可战斗武将。
 * @param heroId 武将 id
 * @param skillIds 学习战法
 * @param position 站位
 * @param redness 红度
 * @param level 等级
 * @param treasureId 宝物 id
 * @param tuning 详情里的配点、兵种和锻造宝物；不传则用默认配点
 */
export function makeGeneral(
  heroId: string,
  skillIds: string[],
  position: Position,
  redness: number,
  level: number,
  treasureId?: string,
  tuning?: TeamTuning,
): General {
  const treasure =
    tuning?.treasure !== undefined ? tuning.treasure : treasureId ? { treasureId: Number(treasureId), level: 10 } : null;
  return buildGeneral(
    heroId,
    skillIds,
    tuning?.freePoints ?? defaultFreePoints(heroId, redness, level),
    position,
    redness,
    level,
    120,
    tuning?.secondaryTroop,
    tuning?.secondaryTraits,
    treasure,
  );
}

/**
 * 把存档里的敌军槽位建成引擎武将。
 * @param slots 敌军槽位
 */
export function enemyFromSlots(slots: readonly EnemySlot[]): General[] {
  return slots.map((slot) => makeGeneral(slot.heroId, slot.skillIds, slot.position, slot.redness, slot.level));
}

const SKILL_MATCH = new Map<string, string>();
const SKILL_RANK = new Map<string, number>();
SKILL_OPTIONS.forEach((option, index) => {
  SKILL_MATCH.set(option.id, option.match);
  SKILL_RANK.set(option.id, index);
});

/**
 * 武将自带主战法名。学习槽不记在卡池上，组队时再配。
 * @param heroId 武将 id
 */
export function mainSkillName(heroId: string): string {
  return getHeroById(heroId)?.mainSkillName || '未记录';
}

/**
 * 组队页的战法候选。搜索串和出手位顺序复用配将台的战法表。
 * @param owned 已拥有战法
 * @param query 搜索
 * @param grade 品级
 * @param type 类型
 * @param troop 当前兵种；空则不标可装备
 * @param equippableOnly 为真时只留该兵种可装配的战法
 */
export function skillChoices(
  owned: readonly string[],
  query: string,
  grade: string,
  type: string,
  troop: TroopType | null = null,
  equippableOnly = false,
): SkillChoice[] {
  return filterSkills(equippableRows(owned), query, grade, type, 24, {
    troop,
    equippableOnly,
    soldierOf: (row) => soldierTypeOf(row.name),
    matchOf: (row) => SKILL_MATCH.get(row.id) ?? `${row.name} ${row.id} ${row.grade}`,
    rankOf: (row) => SKILL_RANK.get(row.id) ?? Number.MAX_SAFE_INTEGER,
  });
}

export { HERO_RECORDS };
