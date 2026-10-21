import { SKILL_REGISTRY } from '../src/data/skills';
import type { Skill } from '../src/engine/types';

function walk(node: unknown, hit: () => void): void {
  if (Array.isArray(node)) { for (const n of node) walk(n, hit); return; }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (o.kind === 'strategy_damage') hit();
    for (const v of Object.values(o)) walk(v, hit);
  }
}
function hasNested(out: unknown[]): boolean {
  let found = false;
  walk(out, () => { found = true; });
  return found;
}
function hasTop(out: unknown[]): boolean {
  return out.some((o) => (o as { kind?: string }).kind === 'strategy_damage');
}
const nestedOnly: string[] = [];
const both: string[] = [];
let withAny = 0;
for (const [id, sk] of Object.entries(SKILL_REGISTRY)) {
  const s = sk as Skill;
  const out = (s as { output?: unknown[] }).output ?? [];
  if (!hasNested(out)) continue;
  withAny++;
  if (hasTop(out)) both.push(id); else nestedOnly.push(`${id}(${s.type}${(s as { prepare?: boolean }).prepare ? '·准备' : ''})`);
}
console.log('带策略伤害的注册战法', withAny, '个；其中顶层直接段', both.length, '嵌套-only', nestedOnly.length);
console.log('嵌套-only 清单:', nestedOnly.join(', '));
