import { SKILL_REGISTRY } from '../src/data/skills';
for (const [id, s] of Object.entries(SKILL_REGISTRY as any)) {
  const outs = JSON.stringify(s.output ?? []);
  if (outs.includes('"heal"')) {
    const targetMode = s.targetMode, side = s.targetSide ?? 'ally';
    if (s.type === 'passive' || s.type === 'command') console.log(id.padEnd(24), s.type.padEnd(8), s.name, '| target', side, targetMode);
  }
}
