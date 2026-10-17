/**
 * 报障复现（2026-10-17）：鲁肃身上带宝物词条「济世 5%」（treasure:affix:济世 → damage_reduce 0.05）
 * 时，【同仇敌忾】每层减伤曾被判「减伤冲突，数值取较高 0.05」而叠不上去。
 * 修复后：两者共存进同一个增减伤加算池（0.05 + 0.03 = 0.08 …），不再出现 status_conflict。
 */
import { runBattle } from '../src/engine/combat';
import { TREASURES_BY_ID } from '../src/data/treasures';
import type { General, Position } from '../src/engine/types';

function plain(id: string, position: Position, extra: Partial<General> = {}): General {
  return {
    id, name: id, rarity: '4星', cost: 1, faction: '汉', tags: [], mutualExclusionGroup: null,
    troopType: 'infantry', position, attack: 120, defense: 100, strategy: 80, speed: 60,
    attackRange: 2, maxTroops: 9000, mainSkillName: '', skillDesc: '', activeSkillIds: [],
    passiveSkillIds: [], commandSkillIds: [], pursuitSkillIds: [], morale: 100, ...extra,
  };
}

const treasureId = Number(Object.keys(TREASURES_BY_ID)[0]);

const lushu: General = {
  ...plain('lu_su', '前锋', { strategy: 133, attackRange: 3 }),
  mainSkillId: 'tongchou_dikai', mainSkillName: '同仇敌忾',
  passiveSkillIds: ['tongchou_dikai', 'qingnang_miyao'],
  treasure: { treasureId, level: 10, affix: { name: '济世', value: 5 } },
};

const { events } = runBattle({
  myTeam: [lushu, plain('m2', '中军'), plain('m3', '大营')],
  enemyTeam: [plain('e1', '前锋', { attack: 300 }), plain('e2', '中军', { attack: 300 }), plain('e3', '大营', { attack: 300 })],
  seed: 424242,
  maxRounds: 4,
});

const conflicts = events.filter((e) => e.type === 'status_conflict');
console.log('宝物来源 =', `treasure:${treasureId}`, '+ affix 济世 5%');
console.log('status_conflict 总数 =', conflicts.length);
for (const e of conflicts) console.log('  ', JSON.stringify(e));

console.log('\n鲁肃的 damage_reduce 施加记录：');
for (const e of events) {
  if (e.type !== 'status_inflicted') continue;
  if ((e as any).unitId !== 'lu_su') continue;
  if ((e as any).statusType !== 'damage_reduce') continue;
  console.log('  ', JSON.stringify(e));
}

// ── 2026-10-17 追加：「济世」层数消耗口径（无限叠加 + 下一次受伤后清空）────────────────
// 逐事件回放，维护 鲁肃身上「济世类」减伤层数（consumeOnHurt 类的施加 / 过期），
// 用来确认「叠得上、只覆盖一次攻击、受击后清零」。
let layers = 0;
let maxLayers = 0;
let consumed = 0;
for (const e of events) {
  const any = e as any;
  if (any.unitId !== 'lu_su') continue;
  if (e.type === 'status_inflicted' && any.statusType === 'damage_reduce' && String(any.detail).includes('下一次受到伤害后失效')) {
    layers += 1;
    maxLayers = Math.max(maxLayers, layers);
  } else if (e.type === 'status_expired' && any.statusType === 'damage_reduce') {
    layers = Math.max(0, layers - 1);
    consumed += 1;
  }
}
console.log('\n济世口径核对：');
console.log('  同时存在的最大层数 =', maxLayers, '（取决于「两次恢复之间是否夹一次命中」，本局每层都被下一次命中吃掉；上限验证见 tests/treasure_jishi.test.ts ①：3 层并存 = sumReduce 0.15）');
console.log('  受击后清空的层数合计 =', consumed);
console.log('  战斗结束残留层数 =', layers);
