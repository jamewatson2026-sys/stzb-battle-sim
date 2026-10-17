import { describe, expect, it } from 'vitest';
import { addHero, createPool } from '../../src/rogue/pool';
import { gachaHtml } from '../../web/rogue/gacha';
import { poolHtml } from '../../web/rogue/pool';
import { rednessStars } from '../../web/heroes';

describe('卡面红度', () => {
  it('卡池画出当前红星，并写上本关学习战法', () => {
    const pool = addHero(createPool({ heroes: ['h479'] }), 'h479').pool;
    const html = poolHtml({
      pool,
      nameOf: () => '吕布',
      portraitOf: () => '',
      mainSkillOf: () => '辕门射戟',
      learnedOf: () => '学习战法未配置',
    });
    expect(html).toContain(rednessStars(2));
    expect(html).toContain('2 红 · 40 级');
    expect(html).toContain('还差 2 次满红');
    expect(html).toContain('主战法 辕门射戟');
    expect(html).toContain('学习战法未配置');
  });

  it('五选一点下去之前就能看到升红结果', () => {
    const html = gachaHtml({
      pull: { shown: ['h479'], picked: null, bonus: 'h16' },
      canPay: true,
      feedback: '',
      nameOf: () => '吕布',
      portraitOf: () => '',
      previewOf: () => ({ redness: 4, text: '吕布 2 红 → 4 红：属性点 +20' }),
    });
    expect(html).toContain('吕布 2 红 → 4 红：属性点 +20');
    expect(html).toContain(rednessStars(4));
  });
});
