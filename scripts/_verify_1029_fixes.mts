/**
 * 验收脚本（2026-10-29 用户四连报障修复）：
 *  ① 【奉令护蜀】层数增伤/减伤是否**分开消耗**、且真的改伤害（带 vs 不带同种子对比）
 *  ② 【免疫怯战】凌统【国士无双】/ 疾战 的免疫是否压住战必断金（战必锁在最前时也要清掉）
 *  ③ 【乘间击隙】与【击势】并存时是否照常叠层、3 层出伤（带击势+乘间 vs 只带击势 对比）
 *  ④ 【一夫当关】减伤是否真的随防御缩放（防御 80 → 50%、防御 200 → 95%）
 * 用法：npx tsx scripts/_verify_1029_fixes.mts
 */
import { runBattle } from '../src/engine/combat';
import { computeTroopBonuses } from '../src/engine/troopBonus';
import { roundRate, scaledValue } from '../src/engine/formulas';
import type { BattleEvent, BattleConfig, General } from '../src/engine/types';

const gen = (p: Partial<General> & { id: string; position: General['position'] }): General => ({
  id: p.id,
  name: p.name ?? p.id,
  rarity: '5星',
  cost: 3,
  faction: '汉',
  tags: [],
  mutualExclusionGroup: null,
  troopType: 'infantry',
  attack: p.attack ?? 100,
  defense: p.defense ?? 100,
  strategy: p.strategy ?? 100,
  speed: p.speed ?? 50,
  attackRange: p.attackRange ?? 2,
  maxTroops: p.maxTroops ?? 9000,
  mainSkillName: '',
  skillDesc: '',
  activeSkillIds: p.activeSkillIds ?? [],
  passiveSkillIds: p.passiveSkillIds ?? [],
  commandSkillIds: p.commandSkillIds ?? [],
  pursuitSkillIds: p.pursuitSkillIds ?? [],
  morale: p.morale ?? 100,
  position: p.position,
  // ⚠️ 乘间击隙 / 类似钩子按 `general.mainSkillId` 认主战法，builder 必须透传
  ...(p.mainSkillId ? { mainSkillId: p.mainSkillId } : {}),
});

/** 木桩（无战法、不走位、伤害低） */
const dummy = (id: string, position: General['position'], extra: Partial<General> = {}): General =>
  gen({ id, name: `木桩${id}`, position, attack: 60, defense: 120, strategy: 60, speed: 20, ...extra });

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
/** 敌军总损失兵力（木桩 20000/人 → 用于「带 vs 不带」对比输出） */
const enemyLost = (cfg: BattleConfig) => 20000 * 3 - sum(runBattle(cfg).finalEnemyTroops);

// ───────────────────────── ① 奉令护蜀 ─────────────────────────
function scenarioFengling(seeds = 40) {
  /** 马岱带/不带【奉令护蜀】：其余完全一致（前锋带追击 → 触发「友军造成伤害后叠层」） */
  const team = (withSkill: boolean): General[] => [
    gen({
      id: 'fl-front',
      name: '前锋',
      position: '前锋',
      attack: 260,
      defense: 120,
      speed: 70,
      attackRange: 3,
      pursuitSkillIds: ['wenjiu_zhanjiang'],
    }),
    gen({
      id: 'fl-mid',
      name: '马岱',
      position: '中军',
      attack: 200,
      defense: 200,
      speed: 55,
      passiveSkillIds: withSkill ? ['fengling_hushu'] : [],
    }),
    gen({ id: 'fl-back', name: '大营', position: '大营', attack: 120, defense: 150, strategy: 200, speed: 40 }),
  ];
  const foes = () => [dummy('e-f', '前锋', { maxTroops: 20000 }), dummy('e-m', '中军', { maxTroops: 20000 }), dummy('e-b', '大营', { maxTroops: 20000 })];

  let stackEvents = 0;
  let boostConsumed = 0; // 普攻消耗次数
  let reduceConsumed = 0; // 受击消耗次数
  let boostConsumedWithReduceLeft = 0; // 普攻消耗时「减伤层仍 > 0」→ 证明两段分开
  let reduceConsumedWithBoostLeft = 0; // 受击消耗时「增伤层仍 > 0」
  let dmgWith = 0;
  let dmgWithout = 0;

  for (let seed = 1; seed <= seeds; seed++) {
    const rep = runBattle({ myTeam: team(true), enemyTeam: foes(), seed, maxRounds: 8 });
    for (const ev of rep.events as BattleEvent[]) {
      if (ev.type === 'status_inflicted' && ev.statusType === 'pending_stacks') stackEvents++;
      if (ev.type !== 'status_changed' || ev.statusType !== 'pending_stacks') continue;
      const mBoost = /普攻消耗 (\d+) 层增伤（剩余减伤 (\d+) 层）/.exec(ev.detail);
      if (mBoost) {
        boostConsumed++;
        if (Number(mBoost[2]) > 0) boostConsumedWithReduceLeft++;
        continue;
      }
      const mReduce = /受击消耗 (\d+) 层减伤（剩余增伤 (\d+) 层）/.exec(ev.detail);
      if (mReduce) {
        reduceConsumed++;
        if (Number(mReduce[2]) > 0) reduceConsumedWithBoostLeft++;
      }
    }
    dmgWith += enemyLost({ myTeam: team(true), enemyTeam: foes(), seed, maxRounds: 8 });
    dmgWithout += enemyLost({ myTeam: team(false), enemyTeam: foes(), seed, maxRounds: 8 });
  }

  console.log('① 【奉令护蜀】双计数器（' + seeds + ' 局）');
  console.log(`   叠层事件 ${stackEvents} 次；普攻消耗 ${boostConsumed} 次（其中「减伤层仍 > 0」${boostConsumedWithReduceLeft} 次）`);
  console.log(`   受击消耗 ${reduceConsumed} 次（其中「增伤层仍 > 0」${reduceConsumedWithBoostLeft} 次）`);
  console.log(
    `   对同一支敌军总输出：带奉令护蜀 ${dmgWith} vs 不带 ${dmgWithout}（${(
      ((dmgWith - dmgWithout) / (dmgWithout || 1)) * 100
    ).toFixed(1)}%）`
  );
  return { stackEvents, boostConsumed, reduceConsumed, boostConsumedWithReduceLeft, reduceConsumedWithBoostLeft, dmgWith, dmgWithout };
}

// ───────────────────────── ② 免疫怯战 ─────────────────────────
function scenarioImmunity(seeds = 40) {
  /** 凌统【国士无双】（免疫 + 洞察） vs 战必断金；对照：同位置换白板 → 必须被怯战 */
  const mine = (withGuoshi: boolean): General[] => [
    gen({
      id: 'im-front',
      name: '凌统',
      position: '前锋',
      attack: 200,
      defense: 200,
      speed: 60,
      attackRange: 2,
      commandSkillIds: withGuoshi ? ['guoshi_wushuang'] : [],
      activeSkillIds: ['jizhan'],
    }),
    gen({ id: 'im-mid', name: '中军', position: '中军', attack: 150, defense: 150, speed: 50 }),
    gen({ id: 'im-back', name: '大营', position: '大营', attack: 120, defense: 150, speed: 40 }),
  ];
  const foes = () => [
    dummy('z-f', '前锋', { speed: 20 }),
    dummy('z-m', '中军', { speed: 20 }),
    dummy('z-b', '大营', { speed: 20 }),
  ].map((g) => ({ ...g, commandSkillIds: ['zhanbi_duanjin'] })); // 三方都带战必 → 三次锁定

  let blockedWith = 0; // 凌统被怯战挡掉普攻（no_attack_target / reason 「怯战」）
  let blockedBaseline = 0; // 对照：同队同种子、凌统不带【国士无双】
  let cowardiceApplied = 0; // 怯战施加次数（可以被免疫随即清掉，仅作观察）
  let purgedByInsight = 0; // 被免疫清掉的怯战（status_expired）
  let frontHits = 0;
  const isCowardiceBlock = (ev: BattleEvent) =>
    ev.type === 'no_attack_target' && ev.unitId === 'im-front' && /怯战/.test(ev.reason ?? '');
  for (let seed = 1; seed <= seeds; seed++) {
    const rep = runBattle({ myTeam: mine(true), enemyTeam: foes(), seed, maxRounds: 8 });
    for (const ev of rep.events as BattleEvent[]) {
      if (isCowardiceBlock(ev)) blockedWith++;
      if (ev.type === 'status_inflicted' && ev.statusType === 'cowardice' && ev.unitId === 'im-front') cowardiceApplied++;
      if (ev.type === 'status_expired' && ev.statusType === 'cowardice' && ev.unitId === 'im-front') purgedByInsight++;
      if (ev.type === 'attack_hit' && ev.sourceId === 'im-front') frontHits++;
    }
    const base = runBattle({ myTeam: mine(false), enemyTeam: foes(), seed, maxRounds: 8 });
    for (const ev of base.events as BattleEvent[]) if (isCowardiceBlock(ev)) blockedBaseline++;
  }
  console.log('② 【免疫怯战】国士无双 / 疾战 vs 战必断金（' + seeds + ' 局）');
  console.log(`   凌统被怯战挡掉的普攻：带国士无双 ${blockedWith} 次 vs 白板对照 ${blockedBaseline} 次`);
  console.log(`   怯战施加 ${cowardiceApplied} 次，其中被免疫当场清掉 ${purgedByInsight} 次；凌统普攻命中 ${frontHits} 次`);
  return { blockedWith, blockedBaseline, cowardiceApplied, purgedByInsight, frontHits };
}

// ───────────────────────── ③ 乘间击隙 ─────────────────────────
function scenarioChengjian(seeds = 40) {
  /** 关银屏：击势 + 乘间击隙（两者并存）vs 只带击势 —— 主战法 100% 发动，每回合叠 1 层 */
  const team = (withChengjian: boolean): General[] => [
    gen({
      id: 'cj-front',
      name: '关银屏',
      position: '前锋',
      attack: 280,
      defense: 130,
      speed: 70,
      attackRange: 3,
      // 主战法【巾帼战阵】：主动、100% 发动 → 每回合稳定触发「发动主动战法后叠层」
      // ⚠️ 乘间击隙的钩子要求 `castSkill.id === general.mainSkillId`（mainSkillId 必须是主战法）
      mainSkillId: 'jinguo_zhanzhen',
      activeSkillIds: ['jinguo_zhanzhen'],
      passiveSkillIds: ['jishi'],
      commandSkillIds: withChengjian ? ['chengjian_jixi'] : [],
    }),
    gen({ id: 'cj-mid', name: '中军', position: '中军', attack: 120, defense: 150, speed: 50 }),
    gen({ id: 'cj-back', name: '大营', position: '大营', attack: 100, defense: 150, strategy: 200, speed: 40 }),
  ];
  const foes = () => [dummy('c-f', '前锋', { maxTroops: 20000 }), dummy('c-m', '中军', { maxTroops: 20000 }), dummy('c-b', '大营', { maxTroops: 20000 })];

  let layerMaxRate = 0; // 单次攻击里「乘间击隙」增伤合计率的最大值（0.15/层 → 3 层 0.45）
  let coexistHits = 0; // 同一次攻击里【击势】与【乘间击隙】增伤同时生效
  let burstDamage = 0;
  let burstHits = 0;
  let dmgWith = 0;
  let dmgWithout = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const rep = runBattle({ myTeam: team(true), enemyTeam: foes(), seed, maxRounds: 8 });
    for (const ev of rep.events as BattleEvent[]) {
      if (ev.type === 'damage' && ev.skillId === 'chengjian_jixi') {
        burstHits++;
        burstDamage += ev.damage;
      }
      if (ev.type !== 'attack_hit' && ev.type !== 'damage') continue;
      const caused = ev.modifiers?.caused ?? [];
      const cjRate = caused.filter((m) => m.skillName === '乘间击隙').reduce((a, m) => a + m.rate, 0);
      if (cjRate > layerMaxRate) layerMaxRate = cjRate;
      if (cjRate > 0 && caused.some((m) => m.skillName === '击势')) coexistHits++;
    }
    dmgWith += enemyLost({ myTeam: team(true), enemyTeam: foes(), seed, maxRounds: 8 });
    dmgWithout += enemyLost({ myTeam: team(false), enemyTeam: foes(), seed, maxRounds: 8 });
  }
  console.log('③ 【乘间击隙】指挥增伤 + 击势并存（' + seeds + ' 局）');
  console.log(
    `   单次攻击里乘间击隙增伤最高合计 ${(layerMaxRate * 100).toFixed(0)}%（每层 15% → 叠满 3 层 45%）；与击势同框的命中 ${coexistHits} 次`
  );
  console.log(`   3 层出伤 ${burstHits} 次，合计伤害 ${burstDamage}`);
  console.log(`   总输出：击势+乘间 ${dmgWith} vs 只带击势 ${dmgWithout}（${(((dmgWith - dmgWithout) / (dmgWithout || 1)) * 100).toFixed(1)}%）`);
  return { layerMaxRate, coexistHits, burstHits, burstDamage, dmgWith, dmgWithout };
}

// ───────────────────────── ④ 一夫当关 ─────────────────────────
/**
 * 减伤 = 包内公式 roundRate(scaledValue(50, 0.375, **生效防御**)) / 100。
 * ⚠️ 生效防御 ≠ 面板防御：`computeTroopBonuses`（阵营/称号/兵种）在准备阶段写入 `formationBonus`，
 *    三将同阵营同兵种时防御 +20%（80 → 96）——期望值必须按生效防御算，否则会误判成引擎错。
 */
function scenarioYifu() {
  const parseRate = (detail: string): number => {
    const pct = /降低\s*(\d+(?:\.\d+)?)%/.exec(detail);
    if (pct) return Number(pct[1]) / 100;
    const num = /减伤\s*(\d+(?:\.\d+)?)/.exec(detail);
    return num ? Number(num[1]) : NaN;
  };
  const run = (panelDefense: number) => {
    const my = [
      gen({
        id: 'yf-front',
        position: '前锋',
        attack: 180,
        defense: panelDefense,
        speed: 60,
        commandSkillIds: ['yifudangguan'],
      }),
      gen({ id: 'yf-mid', position: '中军', attack: 120, defense: 150, speed: 50 }),
      gen({ id: 'yf-back', position: '大营', attack: 100, defense: 150, speed: 40 }),
    ];
    const foes = [
      gen({ id: 'y-f', position: '前锋', attack: 60, defense: 120, speed: 20 }),
      gen({ id: 'y-m', position: '中军', attack: 60, defense: 120, speed: 20 }),
      gen({ id: 'y-b', position: '大营', attack: 60, defense: 120, speed: 20 }),
    ];
    const rep = runBattle({ myTeam: my, enemyTeam: foes, seed: 7, maxRounds: 8 });
    const hit = (rep.events as BattleEvent[]).find(
      (ev) => ev.type === 'status_inflicted' && ev.statusType === 'damage_reduce' && ev.unitId === 'yf-front'
    );
    const detail = hit && hit.type === 'status_inflicted' ? hit.detail : '';
    const effDef = panelDefense + (computeTroopBonuses(my).byUnit.get('yf-front')?.defense ?? 0);
    const expected = roundRate(scaledValue(50, 0.375, effDef)) / 100;
    return { panelDefense, effDef, actual: parseRate(detail), expected, detail };
  };
  const rows = [80, 150, 200].map(run);
  console.log('④ 【一夫当关】减伤随防御缩放（包内成长率 0.375/点，防御 80 处基准 50%）');
  for (const r of rows) {
    console.log(
      `   面板防御 ${r.panelDefense} + 阵容加成 → 生效 ${r.effDef}：实际 ${(r.actual * 100).toFixed(0)}% / 期望 ${(
        r.expected * 100
      ).toFixed(0)}%（${r.detail}）`
    );
  }
  const mismatched = rows.filter((r) => Math.abs(r.actual - r.expected) > 1e-9);
  return { rows, mismatched };
}

const r1 = scenarioFengling();
const r2 = scenarioImmunity();
const r3 = scenarioChengjian();
const r4 = scenarioYifu();

// 断言（脚本即验收：任一不满足即非零退出）
const fails: string[] = [];
if (r1.boostConsumed === 0 || r1.reduceConsumed === 0) fails.push('奉令护蜀：增伤/减伤消耗事件缺失');
if (r1.boostConsumedWithReduceLeft === 0 && r1.reduceConsumedWithBoostLeft === 0) fails.push('奉令护蜀：两段未体现出「分开消耗」');
if (!(r1.dmgWith > r1.dmgWithout)) fails.push('奉令护蜀：带战法总输出未提升');
if (r2.blockedBaseline === 0) fails.push('免疫对照失效：白板没被战必怯战，测不出免疫');
// 国士无双的洞察是 90% 判定的「一类指挥」且窗口仅 1~3 回合：落在无洞察回合的怯战按规则照常生效，
// 因此验收口径 = ①免疫清控在真实战斗里确实发生 ②被控次数显著少于白板（不是 0）。
if (r2.purgedByInsight === 0) fails.push('免疫怯战：免疫从未回收过已生效的怯战');
if (!(r2.blockedWith * 2 <= r2.blockedBaseline))
  fails.push(`免疫怯战：被控次数没有显著减少（${r2.blockedWith} vs 白板 ${r2.blockedBaseline}）`);
if (r3.burstHits === 0) fails.push('乘间击隙：3 层出伤缺失');
if (r3.layerMaxRate < 0.3) fails.push('乘间击隙：增伤层数没有叠到 2 层以上（最高 ' + r3.layerMaxRate + '）');
if (r3.coexistHits === 0) fails.push('乘间击隙：与击势没有同时生效');
if (!(r3.dmgWith > r3.dmgWithout)) fails.push('乘间击隙：与击势并存后总输出未提升');
if (r4.mismatched.length > 0) fails.push('一夫当关：实际减伤与包内公式期望不符（' + r4.mismatched.map((m) => m.panelDefense).join('/') + '）');

if (fails.length) {
  console.log('\n❌ FAIL');
  for (const f of fails) console.log('   - ' + f);
  process.exit(1);
}
console.log('\n✅ PASS：四条修复在真实战斗里全部生效');
