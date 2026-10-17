import type { TroopType } from '../../src/engine/types';
import { fitsSoldier } from './soldierFit';

export interface SkillRow {
  id: string;
  name: string;
  grade: string;
  type: string;
}

/** 筛过并标过「能否装配」的一条战法。 */
export interface SkillChoice extends SkillRow {
  /** 相对当前兵种是否可装配；未知兵种视为可装配 */
  fits: boolean;
}

export interface SkillFilterOpts {
  /** 用来判断可装备的兵种；缺省则全部视为可装配 */
  troop?: TroopType | null;
  /** 为真时丢掉兵种不符的战法 */
  equippableOnly?: boolean;
  /** 战法 id → 官方兵种串；缺省时按战法名查 */
  soldierOf?: (row: SkillRow) => string | undefined;
  /** 搜索匹配串。缺省用名称、id、品级、类型 */
  matchOf?: (row: SkillRow) => string;
  /** 越小越靠前，与配将台出手位顺序一致 */
  rankOf?: (row: SkillRow) => number;
}

/**
 * 战法筛选。默认最多 24 条。可装备的排在前面，其次按出手位，再按名称。
 * 搜索与配将台相同：空白分词，每个词都要命中。
 * @param rows 候选
 * @param query 搜索词，空串表示不过滤
 * @param grade 品级；`ALL` 表示全部
 * @param type 战法类型；`ALL` 表示全部
 * @param limit 返回条数上限
 * @param opts 兵种与排序
 */
export function filterSkills(
  rows: readonly SkillRow[],
  query: string,
  grade: string,
  type: string,
  limit = 24,
  opts: SkillFilterOpts = {},
): SkillChoice[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const troop = opts.troop ?? null;
  const matched = rows.flatMap((row) => {
    if (grade !== 'ALL' && row.grade !== grade) return [];
    if (type !== 'ALL' && row.type !== type) return [];
    const hay = (opts.matchOf?.(row) ?? `${row.name} ${row.id} ${row.grade} ${row.type}`).toLowerCase();
    if (words.some((word) => !hay.includes(word))) return [];
    const soldier = opts.soldierOf?.(row);
    const fits = troop ? fitsSoldier(soldier, troop) : true;
    if (opts.equippableOnly && troop && !fits) return [];
    return [{ ...row, fits }];
  });
  matched.sort(
    (a, b) =>
      Number(b.fits) - Number(a.fits) ||
      (opts.rankOf?.(a) ?? 0) - (opts.rankOf?.(b) ?? 0) ||
      a.name.localeCompare(b.name, 'zh'),
  );
  return matched.slice(0, limit);
}
