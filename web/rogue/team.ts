import type { GeneralTrait, SecondaryTroopType } from '../../src/engine/secondaryTroop';
import { SKILL_REGISTRY } from '../../src/data/skills';
import type { Position, TreasureLoadout, TroopType } from '../../src/engine/types';
import { skillGrade, SKILL_TYPE_NAME, TROOP_CHAR, getHeroById } from '../heroes';
import { skillMeta } from '../teamEditor';
import type { SkillChoice } from './skillFilter';
import { setBoardDrag, skillBadgeHtml } from './board';
import { esc } from './dom';

/** 一个站位在详情里改过的配点、兵种和宝物。 */
export interface SlotLoadout {
  freePoints: { attack: number; defense: number; strategy: number; speed: number };
  secondaryTroop?: SecondaryTroopType;
  secondaryTraits?: GeneralTrait[];
  treasure: TreasureLoadout | null;
}

/** 还没上阵时的空配置。 */
export function blankLoadout(): SlotLoadout {
  return { freePoints: { attack: 0, defense: 0, strategy: 0, speed: 0 }, treasure: null };
}

const POSITIONS: readonly Position[] = ['大营', '中军', '前锋'];

export interface TeamDraft {
  heroes: string[];
  skills: string[][];
  treasures: string[];
  loadouts: SlotLoadout[];
  query: string;
  grade: string;
  type: string;
  /** `follow` 跟随当前武将；`all` 含兵种不符；其余为指定兵种 */
  troopMode: 'follow' | 'all' | TroopType;
  focusSlot: number;
  focusIndex: number;
}

/**
 * 战法背包。按当前槽位武将的兵种筛选，点一下或拖到左边槽位都能装上。
 * @param root 中间栏
 * @param view 草稿、候选和装上之后的回调
 */
export function renderSkillBag(
  root: HTMLElement,
  view: {
    nameOf: (heroId: string) => string;
    choices: (
      query: string,
      grade: string,
      type: string,
      troop: TroopType | null,
      equippableOnly: boolean,
    ) => SkillChoice[];
    draft: TeamDraft;
    onAssign: (skillId: string) => void;
    onBack: () => void;
  },
): void {
  const chip = (kind: 'grade' | 'type', value: string, label: string) =>
    `<button type="button" class="tagf rg-${kind}" data-${kind}="${value}">${label}</button>`;
  root.innerHTML = `
    <section id="rg-skills">
      <p class="rg-note">拖到左边的战法槽，或点一条装进当前槽。主战法自动携带。<button type="button" class="btn ghost" id="rg-nav-pool">返回卡池</button></p>
      <p id="rg-focus-note" class="rg-note"></p>
      <div class="rg-filters">
        <input id="rg-skill-q" type="search" placeholder="搜索战法名…" value="${esc(view.draft.query)}" />
        ${[
          ['follow', '当前兵种'],
          ['all', '全部兵种'],
          ['cavalry', '骑兵'],
          ['infantry', '步兵'],
          ['archer', '弓兵'],
        ]
          .map(([mode, label]) => `<button type="button" class="rg-troop" data-troop="${mode}">${label}</button>`)
          .join('')}
      </div>
      <div class="skill-filter">
        <div class="filter-row">
          <span class="hf-label">品级</span>
          ${chip('grade', 'ALL', '全部')}
          ${['S', 'A', 'B', 'C'].map((grade) => chip('grade', grade, grade)).join('')}
        </div>
        <div class="filter-row">
          <span class="hf-label">类别</span>
          ${chip('type', 'ALL', '全部')}
          ${[
            ['passive', '被动'],
            ['command', '指挥'],
            ['active', '主动'],
            ['pursuit', '追击'],
          ]
            .map(([type, label]) => chip('type', type, label))
            .join('')}
        </div>
      </div>
      <div id="rg-skill-list"></div>
    </section>`;

  const heroIdAt = (index: number) => view.draft.heroes[index] ?? '';
  const troopAt = (index: number): TroopType | null => {
    const troop = getHeroById(heroIdAt(index))?.troopType;
    if (troop === 'cavalry' || troop === 'infantry' || troop === 'archer') return troop;
    return null;
  };
  const paintList = () => {
    const list = root.querySelector('#rg-skill-list');
    if (!list) return;
    const heroTroop = troopAt(view.draft.focusSlot);
    const mode = view.draft.troopMode;
    const troop = mode === 'all' ? heroTroop : mode === 'follow' ? heroTroop : mode;
    const equippableOnly = mode !== 'all' && troop != null;
    const rows = view.choices(view.draft.query, view.draft.grade, view.draft.type, troop, equippableOnly);
    const who = view.nameOf(heroIdAt(view.draft.focusSlot));
    const troopName = heroTroop ? (TROOP_CHAR[heroTroop] ?? '') : '';
    const note = root.querySelector('#rg-focus-note');
    if (note) {
      const filter =
        mode === 'all' ? '含兵种不符' : mode === 'follow' ? `只显示${troopName || '当前'}兵可装配` : `按${TROOP_CHAR[mode] ?? ''}兵筛选`;
      note.textContent = `${POSITIONS[view.draft.focusSlot] ?? ''} · ${who}${troopName ? ` · ${troopName}` : ''}。${filter}，最多 24 条。`;
    }
    root.querySelectorAll<HTMLButtonElement>('.rg-troop').forEach((button) => {
      button.classList.toggle('rg-on', button.dataset.troop === mode);
    });
    root.querySelectorAll<HTMLButtonElement>('.rg-grade').forEach((button) => {
      button.classList.toggle('rg-on', button.dataset.grade === view.draft.grade);
    });
    root.querySelectorAll<HTMLButtonElement>('.rg-type').forEach((button) => {
      button.classList.toggle('rg-on', button.dataset.type === view.draft.type);
    });
    root.ownerDocument.querySelectorAll<HTMLButtonElement>('.rg-skill-slot').forEach((button) => {
      const on = Number(button.dataset.slot) === view.draft.focusSlot && Number(button.dataset.idx) === view.draft.focusIndex;
      button.classList.toggle('rg-on', on);
    });
    list.innerHTML = rows
      .map((row) => {
        const skill = SKILL_REGISTRY[row.id];
        const mark = row.fits ? '可装备' : '兵种不符';
        const unfit = row.fits ? '' : ' rg-unfit';
        const meta = skill ? skillMeta(skill) : SKILL_TYPE_NAME[row.type] ?? row.type;
        const grade = skillGrade(row.id);
        return `<button type="button" class="rg-skill-pick skill-pick-item${unfit}" data-skill="${esc(row.id)}"><div class="pick-line">${skillBadgeHtml(row.id, 46)}<div class="pick-info"><div class="sn">${esc(row.name)}<i class="grade grade-${grade.toLowerCase()}">${esc(grade)}</i></div><div class="sm">${esc(meta)} · ${mark}</div></div></div></button>`;
      })
      .join('') || '<p>没有符合筛选的战法</p>';
    list.querySelectorAll<HTMLButtonElement>('.rg-skill-pick').forEach((button) => {
      const skillId = button.dataset.skill ?? '';
      button.draggable = true;
      button.addEventListener('dragstart', (event) => setBoardDrag(event, { kind: 'skill', skillId }));
      button.addEventListener('click', () => view.onAssign(skillId));
    });
  };
  paintList();
  root.querySelector('#rg-nav-pool')!.addEventListener('click', view.onBack);
  root.querySelectorAll<HTMLButtonElement>('.rg-troop').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.troop ?? 'follow';
      view.draft.troopMode =
        mode === 'all' || mode === 'cavalry' || mode === 'infantry' || mode === 'archer' ? mode : 'follow';
      paintList();
    });
  });
  root.querySelector('#rg-skill-q')!.addEventListener('input', (event) => {
    view.draft.query = (event.target as HTMLInputElement).value;
    paintList();
  });
  root.querySelectorAll<HTMLButtonElement>('.rg-grade').forEach((button) => {
    button.addEventListener('click', () => {
      view.draft.grade = button.dataset.grade ?? 'ALL';
      paintList();
    });
  });
  root.querySelectorAll<HTMLButtonElement>('.rg-type').forEach((button) => {
    button.addEventListener('click', () => {
      view.draft.type = button.dataset.type ?? 'ALL';
      paintList();
    });
  });
}

export { POSITIONS };
