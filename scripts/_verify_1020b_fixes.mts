/**
 * 验收脚本（2026-10-20 用户三连报障）：
 *  ① 【始计】只有前 4 回合：第 5~8 回合**不得**出现 `skill_trigger` / `skill_cast`（"第七回合还在施加"）
 *  ② 【金鸠·鸠佑】一次行动里「再次发动」（赐剑长驱）也算发动 → 同回合两次【巾帼战阵】= 叠 2 层
 *  ③ 【乘间击隙】满 3 层那一次在**详细战报事件流**里看得见（有 `skill_cast`），不只是统计里有伤害
 * 用法：npx tsx scripts/_verify_1020b_fixes.mts
 */
import { runBattle } from '../src/engine/combat';
import type { BattleEvent, General } from '../src/engine/types';

const gen = (p: Partial<General> & { id: string; position: General['position'] }): General => ({
  id: p.id,
  name: p.name ?? p.id,
  rarity: '5星',
  cost: 3,
  faction: '蜀',
  tags: [],
  mutualExclusionGroup: null,
  troopType: 'infantry',
  attack: p.attack ?? 120,
  defense: p.defense ?? 120,
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
  morale: 100,
  ...p,
});

const dummy = (id: string, position: General['position']) =>
  gen({ id, position, attack: 100, defense: 120, strategy: 90, speed: 40 });

const foes = (maxTroops: number) => [
  gen({ id: 'ef', position: '前锋', attack: 40, defense: 100, speed: 20, maxTroops }),
  gen({ id: 'em', position: '中军', attack: 40, defense: 100, speed: 20, maxTroops }),
  gen({ id: 'eb', position: '大营', attack: 40, defense: 100, speed: 20, maxTroops }),
];

const roundOf = (ctxRoundEvents: { round: number }[], i: number): number => ctxRoundEvents[i].round;

/** ① 始计：前 4 回合窗口 */
function scenarioShiji() {
  let castsInWindow = 0;
  let castsOutOfWindow = 0;
  let outOfWindowRounds: number[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const my = [
      gen({ id: 'u', position: '中军', mainSkillId: 'shiji', commandSkillIds: ['shiji'], strategy: 180 }),
      dummy('a1', '前锋'),
      dummy('a2', '大营'),
    ];
    const rep = runBattle({ myTeam: my, enemyTeam: foes(20000), seed, maxRounds: 8 });
    let round = 0;
    for (const ev of rep.events as BattleEvent[]) {
      if (ev.type === 'round_start') round = (ev as { round: number }).round;
      if (ev.type !== 'skill_trigger' && ev.type !== 'skill_cast') continue;
      if ((ev as { skillId?: string }).skillId !== 'shiji') continue;
      if (round <= 4) castsInWindow += 1;
      else {
        castsOutOfWindow += 1;
        outOfWindowRounds.push(round);
      }
    }
  }
  return { castsInWindow, castsOutOfWindow, outOfWindowRounds: [...new Set(outOfWindowRounds)] };
}

/** ②③ 关银屏 + 刘禅【赐剑长驱】+ 宝物金鸠 + 乘间击隙 */
function scenarioRecast() {
  let doubleCastRounds = 0; // 同一回合两次【巾帼战阵】（再次发动发生）
  let jiuYouMaxStacks = 0;
  let cjBursts = 0; // 乘间击隙满层出伤次数（按伤害事件组）
  let cjCastLines = 0; // 乘间击隙 skill_cast（详细战报可见性）
  let cjDamage = 0;
  let burstWithCastLine = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const my = [
      gen({
        id: 'gyp',
        position: '前锋',
        attack: 300,
        defense: 140,
        speed: 70,
        attackRange: 3,
        mainSkillId: 'jinguo_zhanzhen',
        activeSkillIds: ['jinguo_zhanzhen'],
        passiveSkillIds: ['jishi'],
        commandSkillIds: ['chengjian_jixi'],
        treasure: { treasureId: 1123, level: 10 }, // 金鸠【鸠佑】
      }),
      gen({ id: 'liushan', position: '中军', mainSkillId: 'cijian_changqu', commandSkillIds: ['cijian_changqu'], strategy: 160 }),
      dummy('a2', '大营'),
    ];
    const rep = runBattle({ myTeam: my, enemyTeam: foes(20000), seed, maxRounds: 8 });
    // 每回合 [巾帼战阵 skill_cast 次数]
    const perRound = new Map<number, number>();
    let round = 0;
    // 乘间击隙：最近一次 skill_cast 后是否已有伤害（用于配对「出伤那一次有发动行」）
    let pendingCjCast = 0;
    for (const ev of rep.events as BattleEvent[]) {
      if (ev.type === 'round_start') round = (ev as { round: number }).round;
      if (ev.type === 'skill_cast') {
        const id = (ev as { skillId?: string }).skillId;
        if (id === 'jinguo_zhanzhen') perRound.set(round, (perRound.get(round) ?? 0) + 1);
        if (id === 'chengjian_jixi') {
          cjCastLines += 1;
          pendingCjCast += 1;
        }
      }
      if (ev.type === 'damage' && (ev as { skillId?: string }).skillId === 'chengjian_jixi') {
        cjDamage += (ev as { damage: number }).damage;
        if (pendingCjCast > 0) {
          burstWithCastLine += 1;
          pendingCjCast = 0;
        }
      }
      // 鸠佑层数：宝物「鸠佑」的增伤在归因里**逐实例**出现（skillId = 'treasure:1123:3'，每条 0.06）
      // → 同一次伤害里该 skillId 的条数就是当时的层数（另一槽位 'treasure:1123:2' 是无视防御，排除）
      if (ev.type === 'damage' && (ev as { sourceId?: string }).sourceId === 'gyp') {
        const caused = (ev as { modifiers?: { caused?: { skillId?: string }[] } }).modifiers?.caused ?? [];
        const n = caused.filter((m) => m.skillId === 'treasure:1123:3').length;
        if (n > 0) jiuYouMaxStacks = Math.max(jiuYouMaxStacks, n);
      }
    }
    for (const n of perRound.values()) if (n >= 2) doubleCastRounds += 1;
  }
  return { doubleCastRounds, jiuYouMaxStacks, cjBursts, cjCastLines, cjDamage, burstWithCastLine };
}

const r1 = scenarioShiji();
const r2 = scenarioRecast();

const fails: string[] = [];
if (r1.castsInWindow === 0) fails.push('始计：前 4 回合里一次都没发动（测不出窗口）');
if (r1.castsOutOfWindow > 0)
  fails.push(
    `始计：窗口外仍在发动 ${r1.castsOutOfWindow} 次（回合 ${r1.outOfWindowRounds.join('/')}）`
  );
if (r2.doubleCastRounds === 0) fails.push('赐剑长驱：40 局里一次「再次发动」都没发生（测不出钩子链）');
if (r2.jiuYouMaxStacks < 2)
  fails.push(`金鸠：一次行动两次发动只叠到 ${r2.jiuYouMaxStacks} 层（应为 2 层）`);
if (r2.cjBursts === 0 && r2.cjDamage === 0) fails.push('乘间击隙：40 局里没有出伤');
if (r2.cjCastLines === 0) fails.push('乘间击隙：满层出伤没有 skill_cast（详细战报里看不见「发动」）');
if (r2.burstWithCastLine === 0) fails.push('乘间击隙：出伤与「发动」行没有配对');

console.log('① 始计窗口：窗口内发动 %d 次 / 窗口外发动 %d 次（越界回合：%s）',
  r1.castsInWindow, r1.castsOutOfWindow, r1.outOfWindowRounds.join('/') || '无');
console.log('② 赐剑长驱：同回合两次巾帼战阵 %d 次；金鸠鸠佑最高 %d 层', r2.doubleCastRounds, r2.jiuYouMaxStacks);
console.log('③ 乘间击隙：skill_cast 行 %d 次、出伤配对 %d 次、伤害合计 %d', r2.cjCastLines, r2.burstWithCastLine, r2.cjDamage);

if (fails.length) {
  console.log('\n❌ FAIL');
  for (const f of fails) console.log('   - ' + f);
  process.exit(1);
}
console.log('\n✅ PASS：始计窗口 / 再次发动算发动 / 乘间击隙出伤可见 三条全部成立');
