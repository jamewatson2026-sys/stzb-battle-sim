/**
 * 百家词条战法化：21 条普通战法可进战法池、可装槽、靖边 50% 且移除有害效果必定生效。
 * 旧「副将五件套」装配仅作为兼容入口保留（applyBaijia），不再作为主路径。
 */
import { describe, expect, it } from 'vitest';
import { BAIJIA_HEROES, BAIJIA_SKILLS, BAIJIA_SKILL_META } from '../src/data/baijia';
import { applyBaijia } from '../src/engine/baijia';
import { runBattle } from '../src/engine/combat';
import type { General } from '../src/engine/types';

function host(patch: Partial<General> = {}): General {
  return {
    id: 'host',
    name: '夏侯渊',
    rarity: '5星',
    cost: 4,
    faction: '魏',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'cavalry',
    position: '大营',
    attack: 100,
    defense: 80,
    strategy: 80,
    speed: 90,
    attackRange: 3,
    maxTroops: 9000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...patch,
  };
}

describe('百家词条战法化', () => {
  it('21 条词条全部是普通战法，按 5 将分组，靖边 50%', () => {
    const ids = Object.keys(BAIJIA_SKILLS);
    expect(ids).toHaveLength(21);
    expect(new Set(ids).size).toBe(21);

    const grouped = Object.values(BAIJIA_HEROES).map((h) => h.sets.length);
    expect(grouped).toEqual([5, 5, 3, 3, 5]);
    const listed = Object.values(BAIJIA_HEROES).flatMap((h) => h.sets.flatMap((s) => s.skillIds));
    expect(listed.sort()).toEqual(ids.sort());

    // 背包分组顺序（用户 2026-10-20：张恭第一行）；数字键对象不能靠书写顺序，必须显式排序。
    const heroNames = [...new Set(Object.values(BAIJIA_SKILL_META).map((m) => m.heroName))];
    expect(heroNames).toEqual(['张恭', '朱士行', '麦子', '九色鹿', '陶渊明']);

    const jingbian = BAIJIA_SKILLS.bj_550008;
    expect(jingbian.type).toBe('active');
    if (jingbian.type === 'active') {
      expect(jingbian.triggerRate).toBe(0.5);
      expect(jingbian.range).toBe(5);
    }
    // 用户 2026-10-20：战法名 = 原主战法“西陲立功”，红色标签 = 具体词条“靖边”
    expect(jingbian.name).toBe('西陲立功');
    expect(BAIJIA_SKILL_META.bj_550008).toMatchObject({
      mainSkillName: '西陲立功',
      setName: '靖边',
    });
    expect(BAIJIA_SKILLS.bj_550009).toBeUndefined();
  });

  it('靖边：移除有害效果是必定生效（不写内层概率）', () => {
    const jingbian = BAIJIA_SKILLS.bj_550008;
    expect(jingbian.type).toBe('active');
    if (jingbian.type !== 'active') return;

    const remove = jingbian.output.find((o) => o.kind === 'remove_debuffs');
    expect(remove).toBeTruthy();
    if (remove) {
      // 官方描述「移除我军全体有害效果」没有概率，缺省即必发；
      // `remove_debuffs` 的类型本身也没有 chance 字段。
      expect('chance' in remove).toBe(false);
    }
  });

  it('战法池 / 战法数据里能按 id 找到全部 21 条', async () => {
    const { SKILL_REGISTRY } = await import('../src/data/skills');
    for (const id of Object.keys(BAIJIA_SKILLS)) {
      expect(SKILL_REGISTRY[id], id).toBeTruthy();
      expect(SKILL_REGISTRY[id].name).toBeTruthy();
    }
  });

  it('慈悲是第4回合起的持续休整，汪只有词条效果、不凭空造攻城', () => {
    const rest = BAIJIA_SKILLS.bj_550002;
    expect(rest.type).toBe('command');
    if (rest.type !== 'command') return;
    const out = rest.output[0];
    expect(out.kind).toBe('inflict_status');
    if (out.kind !== 'inflict_status') return;
    expect(out.status).toMatchObject({ type: 'rest', rate: 120, startRound: 4 });

    expect(BAIJIA_HEROES['140003'].sets.find((s) => s.id === 'wang')!.skillIds).toEqual(['bj_550019']);
    expect(BAIJIA_SKILLS.bj_550019.type).toBe('passive');
  });

  it('装配到普通战法槽：靖边进 activeSkillIds，不改变面板', () => {
    const g = applyBaijia(host({ baijia: { heroId: '140002', setId: 'jingbian' } }));
    expect(g.activeSkillIds).toEqual(['bj_550008']);
    expect(g.commandSkillIds).toEqual([]);
    expect(g.attack).toBe(100);
  });

  it('给出百分比才混合原基础属性', () => {
    const hero = BAIJIA_HEROES['140002'];
    const g = applyBaijia(host({
      baijia: { heroId: '140002', setId: 'jingbian', mainStatPct: 80, deputyStatPct: 20 },
    }));
    expect(g.attack).toBeCloseTo(100 * 0.8 + hero.attack * 0.2);
    expect(g.speed).toBeCloseTo(90 * 0.8 + hero.speed * 0.2);
  });

  it('阵营、兵种、同名不能任命', () => {
    expect(() => applyBaijia(host({ faction: '蜀', baijia: { heroId: '140002', setId: 'jingbian' } }))).toThrow(/阵营/);
    expect(() => applyBaijia(host({ troopType: 'infantry', baijia: { heroId: '140002', setId: 'jingbian' } }))).toThrow(/兵种/);
    expect(() => applyBaijia(host({ name: '张恭', baijia: { heroId: '140002', setId: 'jingbian' } }))).toThrow(/副将/);
  });

  it('被动词条进战斗：麦子的分兵会在准备阶段挂上', () => {
    const report = runBattle({
      myTeam: [host({ passiveSkillIds: ['bj_550021'] })],
      enemyTeam: [host({ id: 'foe', name: '张辽', faction: '魏', position: '大营' })],
      seed: 1,
      maxRounds: 1,
    });
    const hit = report.events.some(
      (e) => e.type === 'status_inflicted' && e.detail.includes('分兵')
    );
    expect(hit).toBe(true);
  });
});
