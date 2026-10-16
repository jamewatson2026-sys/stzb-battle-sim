// @vitest-environment jsdom
/**
 * 陈寿·纵横 在「部队加成」弹窗的口径回归（用户 2026-10-16 报的 bug）。
 *
 * 现象：XP关兴＆张苞 带「纵横·魏」时，**战斗内正确**（魏 3 人 → 10% 加成），
 * 但「部队加成」弹窗里它自己那一行是 0、同队的张辽/曹操也只按 2 人 8% 计。
 *
 * 根因：`openTroopBonusPanel` 组装 General 时没传 `chenshou`，且调 `computeTroopBonuses`
 * 前没走 `applyChenshouPrepass`（阵营改写发生在 prepass，晚了就按旧阵营计数）。
 *
 * 本测试钉住：弹窗口径必须与 `runBattle` 一致。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openTroopBonusPanel, emptySlot, type SlotState } from '../web/teamEditor';

const slot = (heroId: string, chenshou?: SlotState['chenshou']): SlotState => ({
  ...emptySlot(),
  heroId,
  ...(chenshou ? { chenshou } : {}),
});

/** 取「阵营加成」卡（弹窗第一张卡）里某一武将行的加成单元格 */
function factionRowOf(namePart: string): Element {
  const factionCard = document.querySelectorAll('.bm-card')[0];
  expect(factionCard).toBeTruthy();
  const rows = [...factionCard.querySelectorAll('.bm-hero')];
  const row = rows.find((r) => (r.querySelector('.bm-hero-name')?.textContent ?? '').includes(namePart));
  expect(row).toBeTruthy();
  return row!;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('部队加成弹窗 · 陈寿·纵横', () => {
  it('纵横改魏后：本人吃到魏阵营加成（不再是 0）', () => {
    openTroopBonusPanel('红队', [
      slot('h27'), // 张辽（魏）
      slot('h23'), // 曹操（魏）
      slot('h653', { featureId: 'cs_106003', value: 0, faction: '魏' }), // XP关兴＆张苞：蜀 → 魏
    ]);
    const gx = factionRowOf('关兴');
    // 修复前：整行 4 格全是灰的 0（无 .on）
    expect(gx.querySelectorAll('.bm-stat.on').length).toBeGreaterThan(0);
  });

  it('纵横改魏后：同队魏将按 3 人 10% 计（张辽攻击 177 → +18）', () => {
    openTroopBonusPanel('红队', [
      slot('h27'),
      slot('h23'),
      slot('h653', { featureId: 'cs_106003', value: 0, faction: '魏' }),
    ]);
    const zl = factionRowOf('张辽');
    const nums = [...zl.querySelectorAll('.bm-stat i')].map((i) => Number((i.textContent ?? '').replace('+', '')));
    // 张辽（h27, 40 级）：攻 177 / 防 183 / 谋 124 / 速 211 → 10% = 18 / 18 / 12 / 21
    expect(nums).toEqual([18, 12, 18, 21]); // 顺序：攻 / 谋 / 防 / 速
  });

  it('反向对照：不带纵横时，蜀将吃不到魏阵营加成', () => {
    openTroopBonusPanel('红队', [slot('h27'), slot('h23'), slot('h653')]);
    const gx = factionRowOf('关兴');
    expect(gx.querySelectorAll('.bm-stat.on').length).toBe(0);
  });
});
