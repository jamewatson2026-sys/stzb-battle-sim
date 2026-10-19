import { describe, expect, it } from 'vitest';
import { SKILL_REGISTRY } from '../src/data/skills';
import descJson from '../web/data/skill_desc.json';
import heroesJson from '../web/data/heroes.json';

const descs = descJson as Record<string, { desc: string; desc1: string }>;
const heroes = heroesJson as Array<{ id: string; skillDesc?: string }>;

describe('陆抗·西陵克晋 180% 加强', () => {
  it('攻击与策略两段基础倍率都是 180%', () => {
    const skill = SKILL_REGISTRY.xiling_kejin;
    expect(skill.type).toBe('command');
    const outputs = skill.type === 'command' ? skill.output : [];
    expect(outputs.find((o) => o.kind === 'physical_damage')).toMatchObject({ rate: 180 });
    expect(outputs.find((o) => o.kind === 'strategy_damage')).toMatchObject({ rate: 180 });
  });

  it('网页满级描述 180%、1 级描述 90%', () => {
    expect(descs.xiling_kejin.desc).toContain('伤害率180.0%');
    expect(descs.xiling_kejin.desc1).toContain('伤害率90.0%');
    expect(heroes.find((h) => h.id === 'h574')?.skillDesc).toContain('伤害率180.0%');
  });
});
