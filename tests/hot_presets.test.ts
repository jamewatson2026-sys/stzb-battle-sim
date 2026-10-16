/**
 * 热门预设（内置固定层，`web/data/hot_presets.json`）：数据合法性 + 「删不掉改不了」的读取语义。
 *
 * 这批队伍是要发给玩家用的，**不许编造**：每个武将 / 装配战法 / 二级兵种 / 兵系特性 / 宝物 / 锻造词条
 * 都必须能在库里查到，且组合要真能用（转换方向、词条池、词条数值区间），否则玩家点了配不出来、引擎跑不通。
 * 用户口径 2026-10-16：「预设」改名「热门预设」，固定一批热门队伍（名单由用户提供），自己加预设的功能不变。
 */
import { describe, expect, it } from 'vitest';
import hotJson from '../web/data/hot_presets.json';
import { HOT_ID_PREFIX, hotVersion, isHotId, loadHotPresets } from '../web/hotPresets';
import { HERO_RECORDS } from '../web/heroes';
import { SKILL_REGISTRY } from '../src/data/skills';
import { SECONDARY_TROOPS, traitsFor } from '../src/engine/secondaryTroop';
import { HERO_SECONDARY_TROOPS } from '../src/data/secondaryTroops';
import { AFFIXES, TREASURES_BY_ID } from '../src/data/treasures';
import type { SlotState } from '../web/teamEditor';

const FILE = hotJson as { version: string; entries: Array<{ id: string; name: string; side: string; slots: SlotState[] }> };

describe('热门预设 · 数据文件', () => {
  it('带版本号（改动数据后要往上提）', () => {
    expect(typeof FILE.version).toBe('string');
    expect(FILE.version.length).toBeGreaterThan(0);
    expect(hotVersion()).toBe(FILE.version);
    expect(Array.isArray(FILE.entries)).toBe(true);
  });

  it('id 以 hot- 开头且唯一、预设名非空、红蓝边合法', () => {
    const ids = FILE.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of FILE.entries) {
      expect(e.id.startsWith(HOT_ID_PREFIX)).toBe(true);
      expect(e.name.trim().length).toBeGreaterThan(0);
      expect(['red', 'blue']).toContain(e.side);
    }
  });

  it('每条都是满 3 将，武将 / 战法 / 二级兵种 + 特性 / 宝物 + 词条全在库内且组合合法', () => {
    for (const e of FILE.entries) {
      const slots = loadHotPresets().find((p) => p.id === e.id)?.slots ?? [];
      expect(slots.length, `${e.id} 槽位数`).toBe(3);
      for (const [i, s] of slots.entries()) {
        const at = `${e.id} 第 ${i + 1} 槽`;
        expect(s.heroId, `${at} 武将不能为空`).toBeTruthy();
        expect(HERO_RECORDS[s.heroId as string], `${at} 武将 ${s.heroId} 不在武将库`).toBeTruthy();
        expect((s.extraSkillIds ?? []).length, `${at} 装配战法最多 2 个`).toBeLessThanOrEqual(2);
        for (const id of s.extraSkillIds ?? []) {
          expect(SKILL_REGISTRY[id], `${at} 战法 ${id} 不在战法库`).toBeTruthy();
        }
        const troop = s.secondaryTroop;
        if (troop) {
          expect(SECONDARY_TROOPS[troop], `${at} 二级兵种 ${troop} 不在库内`).toBeTruthy();
          // 该武将的转换方向里必须真有这个兵种（面板只列可转方向，录错会让玩家根本配不出来）
          const dirs = (HERO_SECONDARY_TROOPS as Record<string, string[] | undefined>)[s.heroId as string] ?? [];
          expect(dirs, `${at} 武将 ${s.heroId} 的转换方向里没有 ${troop}`).toContain(troop);
          const pool = traitsFor(troop);
          for (const t of s.secondaryTraits ?? []) {
            expect(pool.includes(t), `${at} 特性 ${t} 不属于 ${troop}`).toBe(true);
          }
        } else {
          expect(s.secondaryTraits?.length ?? 0, `${at} 未转换二级兵种就不该有兵系特性`).toBe(0);
        }
        if (s.treasure) {
          const t = TREASURES_BY_ID[s.treasure.treasureId];
          expect(t, `${at} 宝物 ${s.treasure.treasureId} 不在宝物库`).toBeTruthy();
          if (s.treasure.affix) {
            const { name, value } = s.treasure.affix;
            expect(
              (t as { affixPool?: string[] }).affixPool ?? [],
              `${at} 宝物「${t.name}」的词条池里没有「${name}」`
            ).toContain(name);
            const def = AFFIXES[name];
            expect(def, `${at} 词条「${name}」不在词条表`).toBeTruthy();
            if (def) {
              expect(value, `${at} 词条「${name}」数值 ${value} 低于官方下限 ${def.min}`).toBeGreaterThanOrEqual(def.min);
              expect(value, `${at} 词条「${name}」数值 ${value} 高于官方上限 ${def.max}`).toBeLessThanOrEqual(def.max);
            }
          }
        }
        expect(s.level).toBeGreaterThanOrEqual(40);
        expect(s.level).toBeLessThanOrEqual(50);
        expect(s.redness).toBeGreaterThanOrEqual(0);
        expect(s.redness).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe('热门预设 · 读取语义（固定层，删不掉也改不了）', () => {
  it('每次返回新拷贝：页面上的编辑动不到原件', () => {
    const a = loadHotPresets();
    a.forEach((p) => p.slots.forEach((s) => { s.heroId = null; }));
    const b = loadHotPresets();
    expect(b.map((p) => p.id)).toEqual(a.map((p) => p.id));
    for (const p of b) expect(p.slots.some((s) => s.heroId)).toBe(true);
  });

  it('不编号（编号是用户存档的单调水位，内置条目不借用）且不带时间戳', () => {
    for (const p of loadHotPresets()) {
      expect(p.no).toBe(0);
      expect(p.createdAt).toBe(0);
      expect(p.updatedAt).toBe(0);
    }
  });

  it('isHotId 只认 hot- 前缀（用户预设是 p_…，两边不会撞）', () => {
    expect(isHotId('hot-abc')).toBe(true);
    expect(isHotId('p_1_2')).toBe(false);
    expect(isHotId('')).toBe(false);
  });
});
