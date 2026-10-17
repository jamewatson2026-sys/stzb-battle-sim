/** 枚举所有会施加 damage_reduce 的入口（含 onHurt.output / initialOutput / prepOutput / 嵌套段）。 */
import { SKILL_REGISTRY } from '../src/data/skills';

type Any = Record<string, any>;
const seen: string[] = [];

function walk(skill: Any, path: string, out: Any[]) {
  if (!skill || typeof skill !== 'object') return;
  if (Array.isArray(skill)) { skill.forEach((v, i) => walk(v, `${path}[${i}]`, out)); return; }
  if (skill.status && skill.status.type === 'damage_reduce') {
    out.push({ skill: `${skill.name ?? '?'} (${path})`, id: skill.id, type: skill.type, status: skill.status });
  }
  if (skill.output) walk(skill.output, `${path}.output`, out);
  if (skill.initialOutput) walk(skill.initialOutput, `${path}.initialOutput`, out);
  if (skill.prepOutput) walk(skill.prepOutput, `${path}.prepOutput`, out);
  if (skill.onHurt) walk(skill.onHurt, `${path}.onHurt`, out);
  if (skill.onHurt?.output) walk(skill.onHurt.output, `${path}.onHurt.output`, out);
}

const rows: Any[] = [];
for (const [id, skill] of Object.entries(SKILL_REGISTRY as Any)) {
  const out: Any[] = [];
  walk(skill, id, out);
  for (const r of out) rows.push({ ...r, id });
}
for (const r of rows) {
  const s = r.status;
  console.log(
    [
      r.skill.slice(0, 46).padEnd(46),
      String(r.type).padEnd(8),
      `rate=${s.rate}`,
      `growth=${s.growthRate ?? '-'}`,
      `stack=${s.stack ?? '-'}`,
      `stacks=${s.stacks ?? '-'}`,
      `maxStacks=${s.maxStacks ?? '-'}`,
      `scaled=${s.strategyScaled ? 'strategy' : s.defenseScaled ? 'defense' : s.attackScaled ? 'attack' : '-'}`,
      `dur=${s.duration ?? '-'}`,
    ].join(' '),
  );
}
console.log('\n合计', rows.length, '段');
