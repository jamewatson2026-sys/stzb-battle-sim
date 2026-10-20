/**
 * 免疫优先于控制（用户 2026-10-19 报障 2）：
 *
 * 报障（原话）：「免疫怯战效果出错，当疾战释放时获得免疫怯战效果，却仍然受到了战必的怯战影响。
 *   免疫效果是免除自己受到的控制效果，这个优先级要在指挥等控制之上。同样的问题在武将凌统也有体现
 *   有免疫还是受战必控制。」
 *
 * 根因：免疫只在 `inflictStatus` **入口拦截之后施加**的控制；而战必断金是一类指挥 `roundRepeat`——
 *   在**目标行动开始时**按 `ctx.lockedCommands` 顺序施加怯战。若免疫是同一行动内更晚获得
 *   （疾战在本将行动中释放 / 国士无双的洞察判定排在战必之后），旧实现先落怯战 → 再挂免疫 →
 *   本轮照样被控。
 *
 * 口径：**获得免疫的瞬间**，把已被控住、且被本免疫覆盖的控制解除（发 `status_expired`）；
 *   覆盖范围严格按免疫自身口径 —— 洞察 = 混乱/怯战/暴走/犹豫/挑衅，免疫怯战 = 只怯战，
 *   宝物「坚毅」等 `control_immune` = 其 `types`。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Rng } from '../src/engine/rng';
import {
  actUnit,
  hasStatus,
  inflictStatus,
  triggerPreparedEffectOnAct,
  type CombatContext,
  type LockedCommand,
} from '../src/engine/action';
import { SKILL_REGISTRY } from '../src/data/skills';
import { initHeroDB } from '../src/data/heroes';
import type {
  BattleEvent,
  CommandSkill,
  CreateStatus,
  General,
  Position,
  Skill,
  Status,
  UnitState,
} from '../src/engine/types';

beforeAll(async () => {
  await initHeroDB();
});

function gen(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id,
    name: id,
    rarity: '5星',
    cost: 3,
    faction: '吴',
    tags: [],
    mutualExclusionGroup: null,
    troopType: 'archer',
    position,
    attack: 100,
    defense: 100,
    strategy: 100,
    speed: 50,
    attackRange: 3,
    maxTroops: 10000,
    mainSkillName: '',
    skillDesc: '',
    activeSkillIds: [],
    passiveSkillIds: [],
    commandSkillIds: [],
    pursuitSkillIds: [],
    morale: 100,
    ...extra,
  };
}

function unit(g: General, side: 'my' | 'enemy'): UnitState {
  return {
    general: g,
    side,
    troops: g.maxTroops,
    wounded: 0,
    totalDead: 0,
    alive: true,
    statuses: [],
    preparations: [],
  };
}

function makeCtx(myTeam: UnitState[], enemyTeam: UnitState[]): CombatContext {
  return {
    // chance(0.9) → true；其余几率判定同样按 next < p 稳定命中
    rng: new Rng(11),
    myTeam,
    enemyTeam,
    events: [],
    skills: new Map<string, Skill>(Object.entries(SKILL_REGISTRY)),
    lockedCommands: [],
    stackBuffs: [],
    currentRound: 1,
  };
}

function scene() {
  const ally = unit(gen('ally', '中军'), 'my');
  const foe = unit(gen('foe', '前锋', { faction: '魏', troopType: 'cavalry' }), 'enemy');
  const ctx = makeCtx([ally], [foe]);
  return { ctx, ally, foe };
}

const has = (u: UnitState, t: Status['type']) => u.statuses.some((s) => s.type === t);
const expiredTypes = (ctx: CombatContext, unitId: string): string[] =>
  ctx.events
    .filter((e): e is Extract<BattleEvent, { type: 'status_expired' }> => e.type === 'status_expired')
    .filter((e) => e.unitId === unitId)
    .map((e) => e.statusType as string);

describe('免疫优先：获得免疫时解除已被控住的、被覆盖的控制', () => {
  it('洞察（凌统·国士无双）：先吃战必的怯战，再获得洞察 → 怯战立即解除', () => {
    const { ctx, ally, foe } = scene();
    inflictStatus(ctx, ally, { type: 'cowardice', duration: 2 }, 'command', 'zhanbi_duanjin', foe.general.id);
    event0(ctx);
    expect(has(ally, 'cowardice')).toBe(true);

    inflictStatus(ctx, ally, { type: 'insight', duration: 1 }, 'command', 'guoshi_wushuang', ally.general.id);

    expect(has(ally, 'cowardice')).toBe(false);
    expect(has(ally, 'insight')).toBe(true);
    expect(expiredTypes(ctx, ally.general.id)).toContain('cowardice');
    // 不是「拦截」事件（那是之后施加控制的路径），而是清掉已生效的
    expect(ctx.events.some((e) => e.type === 'insight_blocked')).toBe(false);
  });

  it('免疫怯战（疾战）：只解除怯战，不动混乱/暴走/犹豫', () => {
    const { ctx, ally, foe } = scene();
    inflictStatus(ctx, ally, { type: 'cowardice', duration: 2 }, 'command', 'zhanbi_duanjin', foe.general.id);
    inflictStatus(ctx, ally, { type: 'confusion', duration: 2 }, 'active', 'qizuo_guimou', foe.general.id);
    inflictStatus(ctx, ally, { type: 'hesitation', duration: 2 }, 'active', 'qiangshi', foe.general.id);

    inflictStatus(ctx, ally, { type: 'cowardice_immune', duration: 1 }, 'active', 'jizhan', ally.general.id);

    expect(has(ally, 'cowardice')).toBe(false);
    expect(has(ally, 'confusion')).toBe(true);
    expect(has(ally, 'hesitation')).toBe(true);
  });

  it('宝物「坚毅」类 control_immune：只解除 types 列出的控制', () => {
    const { ctx, ally, foe } = scene();
    inflictStatus(ctx, ally, { type: 'cowardice', duration: 2 }, 'command', 'zhanbi_duanjin', foe.general.id);
    inflictStatus(ctx, ally, { type: 'confusion', duration: 2 }, 'active', 'qizuo_guimou', foe.general.id);

    inflictStatus(
      ctx,
      ally,
      { type: 'control_immune', types: ['confusion'], duration: 2 },
      'passive',
      'treasure_jianyi',
      ally.general.id
    );

    expect(has(ally, 'confusion')).toBe(false);
    expect(has(ally, 'cowardice')).toBe(true); // 不在 types 里 → 保留
  });
});

/** 一个小工具：清空事件（只保留「施加前」的状态，便于断言本次施加产生的事件） */
function event0(ctx: CombatContext): void {
  ctx.events.length = 0;
}

describe('免疫优先：拦截之后施加的控制（回归，行为不变）', () => {
  it('已有洞察时，战必式怯战照旧被 insight_blocked 拦截', () => {
    const { ctx, ally, foe } = scene();
    inflictStatus(ctx, ally, { type: 'insight', duration: 2 }, 'command', 'guoshi_wushuang', ally.general.id);
    event0(ctx);

    inflictStatus(ctx, ally, { type: 'cowardice', duration: 2 }, 'command', 'zhanbi_duanjin', foe.general.id);

    expect(has(ally, 'cowardice')).toBe(false);
    expect(ctx.events.some((e) => e.type === 'insight_blocked')).toBe(true);
    expect(expiredTypes(ctx, ally.general.id)).not.toContain('cowardice');
  });
});

describe('免疫优先：战必 × 国士无双 的行动开始时序（报障现场）', () => {
  it('战必排在锁定表前面时，国士无双的洞察仍能解掉本轮怯战，凌统照常普攻', () => {
    const lingtong = unit(
      gen('h616', '前锋', {
        faction: '吴',
        troopType: 'archer',
        mainSkillId: 'guoshi_wushuang',
        commandSkillIds: ['guoshi_wushuang'],
      }),
      'my'
    );
    const mate = unit(gen('mate', '中军'), 'my');
    const foe = unit(gen('foe', '前锋', { faction: '魏', troopType: 'cavalry' }), 'enemy');
    const ctx = makeCtx([lingtong, mate], [foe]);

    const zhanbi = SKILL_REGISTRY['zhanbi_duanjin'] as CommandSkill;
    const guoshi = SKILL_REGISTRY['guoshi_wushuang'] as CommandSkill;
    expect(zhanbi.roundRepeat).toBeTruthy();
    expect(guoshi.roundRepeat).toBeTruthy();
    // 锁定顺序 = 准备阶段结算顺序：战必（敌方、施法者更快）在前 → 先落怯战，再挂洞察
    ctx.lockedCommands = [
      { skill: zhanbi, casterId: foe.general.id, targets: [lingtong], currentRate: zhanbi.roundRepeat!.rate },
      { skill: guoshi, casterId: lingtong.general.id, targets: [lingtong], currentRate: guoshi.roundRepeat!.rate },
    ] as LockedCommand[];

    triggerPreparedEffectOnAct(ctx, lingtong);

    expect(has(lingtong, 'cowardice')).toBe(false);
    expect(expiredTypes(ctx, lingtong.general.id)).toContain('cowardice');

    actUnit(ctx, lingtong);
    const hit = ctx.events.find(
      (e): e is Extract<BattleEvent, { type: 'attack_hit' }> =>
        e.type === 'attack_hit' && e.sourceId === lingtong.general.id
    );
    expect(hit).toBeTruthy();
    expect(
      ctx.events.some(
        (e) => e.type === 'no_attack_target' && (e as { reason?: string }).reason?.includes('怯战')
      )
    ).toBe(false);
  });
});

describe('免疫优先：疾战的数据链路（combo → 免疫怯战）', () => {
  it('按 jizhan.output 的顺序施加后，先前吃到的怯战被解掉', () => {
    const { ctx, ally, foe } = scene();
    const jizhan = SKILL_REGISTRY['jizhan'];
    inflictStatus(ctx, ally, { type: 'cowardice', duration: 2 }, 'command', 'zhanbi_duanjin', foe.general.id);
    expect(has(ally, 'cowardice')).toBe(true);

    for (const out of jizhan.output) {
      if (out.kind !== 'inflict_status') continue;
      const list: CreateStatus[] = Array.isArray(out.status) ? out.status : [out.status];
      for (const st of list) inflictStatus(ctx, ally, st, jizhan.type, jizhan.id, ally.general.id);
    }

    expect(has(ally, 'cowardice_immune')).toBe(true);
    expect(has(ally, 'combo')).toBe(true);
    expect(has(ally, 'cowardice')).toBe(false);
  });
});
