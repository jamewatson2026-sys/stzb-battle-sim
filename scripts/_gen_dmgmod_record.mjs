/**
 * 生成一条只有单次受伤的合成战报，专门用来验证「增减伤统计」弹窗口径：
 * 提升 28%（宝器 5% + 兵种特性 23%）/ 降低 117%（白刃 35 + 谋议宏图 46 + 兵种克制 30 + 兵种特性 6）
 * ⇒ 净 −89%，界面行「共计降低 89%」，弹窗两栏照实显示。
 * 用法：node scripts/_gen_dmgmod_record.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const gen = (id, name, position) => ({
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
  mainSkillName: '测试战法',
  skillDesc: '',
  activeSkillIds: [],
  passiveSkillIds: [],
  commandSkillIds: [],
  pursuitSkillIds: [],
  morale: 120,
});

const my1 = gen('my1', '乐进', '前锋');
const my2 = gen('my2', '司马炎', '中军');
const e1 = gen('e1', '庞统', '大营');
const e2 = gen('e2', '刘备', '中军');

const mods = {
  caused: [{ unitId: 'e1', skillId: 'treasure', skillName: 'treasure:1051:2', rate: 0.05, direction: 'caused' }],
  taken: [{ unitId: 'e1', skillId: 'trait', skillName: '兵种特性', rate: 0.23, direction: 'taken' }],
  reduce: [
    { unitId: 'my2', skillId: 'bairi', skillName: '白刃', rate: 0.35, direction: 'reduce' },
    { unitId: 'my2', skillId: 'mouyi', skillName: '谋议宏图', rate: 0.46, direction: 'reduce' },
    { unitId: 'my1', skillId: 'restraint', skillName: '兵种克制', rate: 0.3, direction: 'reduce' },
    { unitId: 'my1', skillId: 'trait', skillName: '兵种特性', rate: 0.06, direction: 'reduce' },
  ],
};

const events = [
  { type: 'battle_start', turnOrder: ['my1', 'my2', 'e1', 'e2'], seed: 7 },
  { type: 'prep_phase', phase: 'formation' },
  { type: 'prep_phase', phase: 'troop' },
  { type: 'prep_phase', phase: 'skill' },
  { type: 'preparation_end' },
  { type: 'round_start', round: 1, turnOrder: ['my1', 'my2', 'e1', 'e2'] },
  { type: 'unit_act_start', unitId: 'e1', name: '庞统', position: '大营', phase: 'basic_attack' },
  { type: 'skill_cast', unitId: 'e1', skillId: 'moulue', skillName: '谋略攻击' },
  {
    type: 'damage',
    sourceId: 'e1',
    targetId: 'my1',
    skillId: 'moulue',
    skillName: '谋略攻击',
    damageType: 'strategy',
    damage: 2140,
    afterTroops: 6860,
    breakdown: { troopBase: 800, base: 700, main: 640 },
    modifiers: mods,
  },
  { type: 'unit_act_end', unitId: 'e1' },
  {
    type: 'round_end',
    round: 1,
    myTroops: [6860, 9000],
    enemyTroops: [9000, 9000],
    myWounded: [0, 0],
    enemyWounded: [0, 0],
    myDead: [0, 0],
    enemyDead: [0, 0],
  },
  { type: 'battle_end', result: 'draw', rounds: 1, myTroops: [6860, 9000], enemyTroops: [9000, 9000] },
];

const report = {
  schemaVersion: '1.0',
  seed: 7,
  maxRounds: 1,
  result: 'draw',
  rounds: 1,
  myTeam: [my1, my2],
  enemyTeam: [e1, e2],
  finalMyTroops: [6860, 9000],
  finalEnemyTroops: [9000, 9000],
  finalMyWounded: [0, 0],
  finalEnemyWounded: [0, 0],
  finalMyDead: [0, 0],
  finalEnemyDead: [0, 0],
  events,
  stats: [],
};

const record = {
  id: 'demo_dmgmod',
  ts: Date.now(),
  label: '增减伤统计 · 弹窗口径',
  result: 'draw',
  rounds: 1,
  seed: 7,
  myTeam: my1.name ? ['乐进', '司马炎'] : [],
  enemyTeam: ['庞统', '刘备'],
  report,
};

const out = path.resolve('docs/逆向对拍/baseline/dmgmod_record.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(record));
console.log('写入', out, fs.statSync(out).size, 'B');
