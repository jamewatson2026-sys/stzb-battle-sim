import { SKILL_REGISTRY } from '../src/data/skills';
for (const s of Object.values(SKILL_REGISTRY) as any[]) {
  const all: any[] = [
    ...(s.output ?? []),
    ...(s.initialOutput ?? []),
    ...((s.roundStartRepeat?.output as any[]) ?? []),
  ];
  for (const o of all) {
    if (o?.kind !== 'inflict_status') continue;
    const st = o.status;
    if (!st || st.type !== 'damage_reduce' || st.damageType) continue;
    console.log([s.id, s.name, s.type, s.phase ?? '', st.rate, st.growthRate ?? 0, st.stack ?? false, st.maxStacks ?? '-', st.duration].join(' | '));
  }
}
