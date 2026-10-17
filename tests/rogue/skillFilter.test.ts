import { describe, expect, it } from 'vitest';
import { filterSkills, type SkillRow } from '../../web/rogue/skillFilter';
import { fitsSoldier, soldierTypeOf } from '../../web/rogue/soldierFit';

const rows: SkillRow[] = Array.from({ length: 166 }, (_, index) => ({
  id: `s${index}`,
  name: `战法${index}`,
  grade: index % 2 === 0 ? 'B' : 'A',
  type: index % 3 === 0 ? 'active' : 'command',
}));

describe('战法筛选', () => {
  it('浑水摸鱼按官方兵种三系可装', () => {
    expect(soldierTypeOf('浑水摸鱼')).toBe('弓步骑');
    expect(fitsSoldier(soldierTypeOf('浑水摸鱼'), 'archer')).toBe(true);
    expect(fitsSoldier('弓', 'infantry')).toBe(false);
    expect(fitsSoldier(undefined, 'cavalry')).toBe(true);
  });

  it('不把整个背包一次铺开', () => {
    expect(filterSkills(rows, '', 'ALL', 'ALL').length).toBeLessThanOrEqual(24);
    expect(rows.length).toBe(166);
  });

  it('按名称和品级过滤', () => {
    const found = filterSkills(rows, '战法12', 'ALL', 'ALL');
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((row) => row.name.includes('战法12'))).toBe(true);
    expect(filterSkills(rows, '', 'S', 'ALL')).toEqual([]);
  });

  it('可装备排在前面，仅可装备时丢掉兵种不符', () => {
    const sample = [
      { id: 'foot', name: '只步', grade: 'B', type: 'active' },
      { id: 'bow', name: '只弓', grade: 'B', type: 'active' },
    ];
    const soldierOf = (row: SkillRow) => (row.id === 'bow' ? '弓' : '步');
    const marked = filterSkills(sample, '', 'ALL', 'ALL', 24, {
      troop: 'archer',
      equippableOnly: false,
      soldierOf,
      rankOf: (row) => (row.id === 'bow' ? 5 : 0),
    });
    expect(marked.map((row) => row.id)).toEqual(['bow', 'foot']);
    expect(marked[0]?.fits).toBe(true);
    expect(marked[1]?.fits).toBe(false);
    expect(filterSkills(sample, '', 'ALL', 'ALL', 24, { troop: 'archer', equippableOnly: true, soldierOf }).map((row) => row.id)).toEqual(['bow']);
  });

  it('出手位顺序优先于名称', () => {
    const sample = [
      { id: 'b', name: '甲', grade: 'B', type: 'active' },
      { id: 'a', name: '乙', grade: 'B', type: 'active' },
    ];
    const ordered = filterSkills(sample, '', 'ALL', 'ALL', 24, { rankOf: (row) => (row.id === 'a' ? 0 : 9) });
    expect(ordered.map((row) => row.id)).toEqual(['a', 'b']);
  });
});
