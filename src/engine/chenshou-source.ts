/**
 * 陈寿特性状态来源标识（独立小模块，避免 `action.ts ⇄ chenshou.ts` 循环引用）。
 *
 * 口径：陈寿特性与宝物同理 —— **纯提升、与任何来源都不冲突**（官方：「对武将使用陈寿特性后，将激活不同的效果」，
 * 一名武将仅一种特性，不存在同源叠加）。`inflictStatus` 见到本前缀直接入栈、跳过全部冲突判定。
 */
import { CHENSHOU_BY_ID } from '../data/chenshouFeatures';

export const CHENSHOU_SOURCE_PREFIX = 'chenshou:';

/** 该 `sourceSkillId` 是否为陈寿特性来源 */
export const isChenshouSource = (sourceSkillId: string): boolean =>
  sourceSkillId.startsWith(CHENSHOU_SOURCE_PREFIX);

/** 陈寿特性来源 id → 展示名（战报用）：`chenshou:cs_106004` → 「精进·攻」 */
export function chenshouLabel(sourceSkillId: string): string {
  if (!isChenshouSource(sourceSkillId)) return '';
  return CHENSHOU_BY_ID[sourceSkillId.slice(CHENSHOU_SOURCE_PREFIX.length)]?.shortName ?? '';
}
