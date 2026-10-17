/** 临时：把截图里的名字批量翻成库内 id（武将 / 战法 / 宝物 / 锻造词条）。跑完可留可删。 */
import hot from '../web/data/heroes.json';
import { SKILL_REGISTRY } from '../src/data/skills';
import { TREASURES_BY_ID, AFFIXES } from '../src/data/treasures';

const wantHeroes = ['庞统', 'XP程昱', '刘备', '荀彧', '司马懿', '曹操', '刘徽', '吕蒙', '黄盖'];
const wantSkills = [
  // 主战法（校验用）
  '密谋定蜀', '审时定计', '皇裔流离', '驱虎吞狼', '其徐如林', '魏武之世', '敛微穷极', '白衣渡江', '烈火焚舟',
  // 装配战法（要 id）
  '火烧连营', '三术奇谋', '无心恋战', '避其锋芒', '以诱待来', '垒实迎击', '河内世泽', '众谋不懈',
  '神兵天降', '久战熟谋', '反计之策', '单骑救主', '七擒七纵', '先驱突击', '势无虚动',
];
const wantTreasures = ['游飘', '星汉', '博浪', '徐氏匕首', '大将', '承影', '元戎'];
const wantAffixes = ['筹算', '济世', '仁心', '天资', '稳固', '选锋', '骁锐'];

const heroes = hot as Array<Record<string, unknown>>;
console.log('=== 武将 ===');
for (const n of wantHeroes) {
  const hits = heroes.filter((h) => h.name === n);
  console.log(hits.length ? hits.map((h) => `${h.id} | ${h.name} | ${h.troopType} | 主战法 ${h.mainSkillId}`).join(' ; ') : `!! ${n} 不在武将库`);
}

console.log('=== 战法 ===');
for (const n of wantSkills) {
  const hits = Object.entries(SKILL_REGISTRY as Record<string, { name?: string }>).filter(([, s]) => s.name === n);
  console.log(hits.length ? hits.map(([id, s]) => `${id} | ${s.name}`).join(' ; ') : `!! ${n} 不在战法库`);
}

console.log('=== 宝物 ===');
for (const n of wantTreasures) {
  const hits = Object.entries(TREASURES_BY_ID as Record<string, { name?: string; type?: string }>).filter(([, t]) => t.name === n);
  console.log(hits.length ? hits.map(([id, t]) => `${id} | ${t.name} | ${t.type}`).join(' ; ') : `!! ${n} 不在宝物库`);
}

console.log('=== 锻造词条 ===');
for (const n of wantAffixes) {
  const a = (AFFIXES as Record<string, { desc?: string; unit?: string }>)[n];
  console.log(a ? `${n} | ${a.desc} | unit=${a.unit}` : `!! ${n} 不在词条表`);
}
