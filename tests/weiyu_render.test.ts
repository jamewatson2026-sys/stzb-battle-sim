// @vitest-environment jsdom
/**
 * 未雨绸缪的**战报可读性**回归（用户 m01313 报障 ②「战报中也没有体现」）：
 *  ① `skill_cast` 带 `recastBy` 时标注「（未雨绸缪：再次发动，效果 50%）」，
 *     否则同一战法连出两条「发动」会被读成 bug；
 *  ② 策略伤害带 `ignoreStrategy` 时行尾追加「（未雨绸缪：无视目标 32% 谋略属性）」。
 *
 * 用合成 BattleReport 钉文案，不依赖引擎随机；引擎侧行为由 tests/weiyu_choumou.test.ts 守。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createBattleView } from '../web/battleView';
import type { BattleEvent, BattleReport, General } from '../src/engine/types';

function makeGeneral(id: string, name: string, position: General['position']): General {
  return {
    id,
    name,
    rarity: '5星',
    cost: 3,
    faction: '汉',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'cavalry',
    position,
    attack: 100,
    defense: 100,
    strategy: 100,
    speed: 100,
    attackRange: 2,
    maxTroops: 9000,
    mainSkillName: '未雨绸缪',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 120,
  };
}

function makeReport(): BattleReport {
  const my1 = makeGeneral('my1', '刘秀', '大营');
  const my2 = makeGeneral('my2', '贾诩', '中军');
  const enemy1 = makeGeneral('enemy1', '敌甲', '大营');

  const events: BattleEvent[] = [
    { type: 'battle_start', turnOrder: ['my2', 'my1', 'enemy1'], seed: 1 },
    { type: 'prep_phase', phase: 'formation' },
    { type: 'prep_phase', phase: 'troop' },
    { type: 'prep_phase', phase: 'skill' },
    { type: 'preparation_end' },
    { type: 'round_start', round: 1, turnOrder: ['my2', 'my1', 'enemy1'] },
    { type: 'unit_act_start', unitId: 'my2', name: '贾诩', position: '中军', phase: 'active_skill' },
    { type: 'skill_cast', unitId: 'my2', skillId: 'luolei', skillName: '落雷' },
    {
      type: 'damage',
      sourceId: 'my2',
      targetId: 'enemy1',
      skillId: 'luolei',
      skillName: '落雷',
      damageType: 'strategy',
      damage: 2100,
      breakdown: { troopBase: 800, base: 600, main: 700 },
    },
    {
      type: 'skill_cast',
      unitId: 'my2',
      skillId: 'luolei',
      skillName: '落雷',
      recastBy: '未雨绸缪',
      recastRate: 0.5,
    },
    {
      type: 'damage',
      sourceId: 'my2',
      targetId: 'enemy1',
      skillId: 'luolei',
      skillName: '落雷',
      damageType: 'strategy',
      damage: 1300,
      breakdown: { troopBase: 800, base: 420, main: 80 },
      ignoreStrategy: { pct: 32, skillId: 'weiyu_choumou', skillName: '未雨绸缪' },
    },
    { type: 'unit_act_end', unitId: 'my2' },
    {
      type: 'round_end',
      round: 1,
      myTroops: [9000, 9000],
      enemyTroops: [6800],
      myWounded: [0, 0],
      enemyWounded: [0],
      myDead: [0, 0],
      enemyDead: [0],
    },
    {
      type: 'battle_end',
      result: 'win',
      rounds: 1,
      myTroops: [9000, 9000],
      enemyTroops: [6800],
    },
  ];

  return {
    schemaVersion: '1.0',
    seed: 1,
    maxRounds: 8,
    result: 'win',
    rounds: 1,
    myTeam: [my1, my2],
    enemyTeam: [enemy1],
    finalMyTroops: [9000, 9000],
    finalEnemyTroops: [6800],
    finalMyWounded: [0, 0],
    finalEnemyWounded: [0],
    finalMyDead: [0, 0],
    finalEnemyDead: [0],
    events,
    stats: [],
  };
}

function mount() {
  const view = createBattleView(makeReport());
  document.body.append(view.el);
  // 战报按回合分页（默认停在「回合前阶段」），断言伤害行必须先切到第 1 回合
  return view;
}

describe('未雨绸缪 · 战报可读性', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('再次发动的那一行标注来源与效果比例', () => {
    mount().setRound(1);
    const text = document.body.textContent ?? '';
    expect(text).toContain('（未雨绸缪：再次发动，效果 50%）');
    // 第一次发动不带标注（不是再发动）
    const casts = Array.from(document.querySelectorAll('.ev')).filter((el) =>
      (el.textContent ?? '').includes('发动【落雷】')
    );
    expect(casts).toHaveLength(2);
    expect((casts[0].textContent ?? '').includes('再次发动')).toBe(false);
  });

  it('无视谋略属性的伤害行带小字标注', () => {
    mount().setRound(1);
    const text = document.body.textContent ?? '';
    expect(text).toContain('未雨绸缪：无视目标 32% 谋略属性');
    const marked = document.querySelectorAll('.dmg-ignore');
    expect(marked).toHaveLength(1);
  });
});
