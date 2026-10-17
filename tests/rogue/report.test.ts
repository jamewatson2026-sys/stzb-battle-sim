import { describe, expect, it } from 'vitest';
import type { BattleEvent, BattleReport, General } from '../../src/engine/types';
import { decapHeadline, timelineChunks } from '../../web/rogue/report';

/**
 * 只填斩首判断用得到的字段。
 * @param id 单位 id
 * @param name 名字
 * @param position 站位
 */
function camp(id: string, name: string, position: General['position']): General {
  return { id, name, position } as General;
}

describe('战报摘要', () => {
  it('大营阵亡记在所在回合', () => {
    const report = {
      rounds: 3,
      myTeam: [camp('mb', '刘备', '大营')],
      enemyTeam: [camp('eb', '关羽', '大营')],
      events: [
        { type: 'round_start', round: 1 },
        { type: 'round_start', round: 3 },
        { type: 'unit_dead', unitId: 'eb', name: '关羽', side: 'enemy' },
      ] as BattleEvent[],
    } as Pick<BattleReport, 'myTeam' | 'enemyTeam' | 'events' | 'rounds'>;
    expect(decapHeadline(report)).toBe('斩首于第 3 回合（敌方大营 关羽）');
  });

  it('没有大营阵亡就是打满后按兵力判定', () => {
    const report = {
      rounds: 8,
      myTeam: [camp('mb', '刘备', '大营')],
      enemyTeam: [camp('eb', '关羽', '大营')],
      events: [{ type: 'round_start', round: 8 }] as BattleEvent[],
    } as Pick<BattleReport, 'myTeam' | 'enemyTeam' | 'events' | 'rounds'>;
    expect(decapHeadline(report)).toBe('打满 8 回合，按兵力判定');
  });

  it('快进只看选中的那一回合', () => {
    const chunks = timelineChunks([
      { type: 'preparation_end' },
      { type: 'round_start', round: 1 },
      { type: 'no_attack_target', unitId: 'a', name: '甲', reason: '仅第一回合' },
      { type: 'round_start', round: 2 },
    ]);
    expect(chunks.map((chunk) => chunk.label)).toEqual(['准备', '第1回合', '第2回合']);
    expect(chunks[0]?.text).toContain('准备阶段结束');
    expect(chunks[1]?.text).toContain('仅第一回合');
    expect(chunks[2]?.text).not.toContain('仅第一回合');
  });
});
