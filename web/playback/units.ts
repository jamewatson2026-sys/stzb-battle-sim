/**
 * 推演模拟 · 立绘与势力图标解析
 * ---------------------------------------------------------------------------
 * `beats.ts` 保持「无资源依赖」（可在 node 里直接单测），立绘解析放这里。
 *
 * ⚠️ 必须用 `heroId ?? id` 查图：`runBattle` 会把红蓝两队里同一名武将的
 * 第二份单位 id 改写成 `原id#2`（`src/engine/types.ts` 的 General.id 注释），
 * 拿 `id` 直接查立绘会 404。
 */
import { avatarSrc, factionIconSrc, portraitSrc } from '../heroes';
import type { BattleReport } from '../../src/engine/types';

export interface UnitAssets {
  /** 大立绘（播片区） */
  portrait: string;
  /** 小头像（HUD 卡） */
  avatar: string;
  /** 势力图标 */
  factionIcon: string;
}

export function unitAssets(report: BattleReport): Record<string, UnitAssets> {
  const out: Record<string, UnitAssets> = {};
  for (const g of [...report.myTeam, ...report.enemyTeam]) {
    const heroId = g.heroId ?? g.id;
    out[g.id] = {
      portrait: portraitSrc(heroId),
      avatar: avatarSrc(heroId),
      factionIcon: factionIconSrc(g.faction),
    };
  }
  return out;
}
