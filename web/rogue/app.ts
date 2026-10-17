import '../styles.css';
import { Rng } from '../../src/engine/rng';
import type { BattleReport, General } from '../../src/engine/types';
import { ECONOMY, canAfford, createWallet, priceOf, targetWinRate } from '../../src/rogue/economy';
import { beginPull, claimBonus, pickFromPull } from '../../src/rogue/gacha';
import { addHero, createPool } from '../../src/rogue/pool';
import { formatRecruit } from '../../src/rogue/recruit';
import { applyClearReward, isEliteLevel, rollClearReward } from '../../src/rogue/rewards';
import { createRun } from '../../src/rogue/run';
import { buySkill } from '../../src/rogue/shop';
import { SAVE_KEY, loadRun, saveRun, type SaveData, type StorageLike } from '../../src/rogue/save';
import { LEVEL_PICK_RUNS, pickEnemyForLevel } from '../../src/rogue/enemy';
import { buildMyTeam, settleLevel, type TeamChoice } from '../../src/rogue/loop';
import type { ClearReward } from '../../src/rogue/rewards';
import type { Outcome } from '../../src/rogue/types';
import { asset } from '../assets';
import { defaultFreePoints, freePointBudget } from '../heroes';
import { showNotice } from '../notice';
import { openHeroDetail, type EditorHandlers, type SlotState } from '../teamEditor';
import { readBoardDrag, renderEnemySlots, renderOwnedGrid, renderSlots, setBoardDrag } from './board';
import { gachaHtml, type RevealCard } from './gacha';
import { renderReport } from './report';
import { renderShop, setShopMessage } from './shop';
import { blankLoadout, POSITIONS, renderSkillBag, type SlotLoadout, type TeamDraft } from './team';
import { browserStorage } from './storage';
import { esc } from './dom';
import {
  HERO_RECORDS,
  enemyFromSlots,
  gachaHeroIds,
  gradeCatalogue,
  heroName,
  initialSkillIds,
  makeGeneral,
  mainSkillName,
  portraitOf,
  shopRows,
  skillChoices,
  treasureIds,
  treasureOptions,
} from './catalogue';
import { SKILL_REGISTRY } from '../../src/data/skills';

const deps = { buildGeneral: makeGeneral };

type CenterMode = 'pool' | 'skills' | 'treasures' | 'buffs' | 'shop' | 'gacha' | 'report' | 'reward' | 'end';

/**
 * 挂上肉鸽这一局。存储可以注入，测试因此不必碰浏览器存储。
 * @param root 页面根节点
 * @param opts 存储与开局种子
 */
export function mountRogue(root: HTMLElement, opts: { storage?: StorageLike; seed?: number } = {}): void {
  const storage = opts.storage ?? browserStorage();
  const heroIds = gachaHeroIds();
  const shopCatalogue = gradeCatalogue();
  const allShopRows = shopRows();
  const rewardCatalogue = { skills: shopCatalogue, treasures: treasureIds() };
  const restored = loadRun(storage);
  let data = restored ?? createFresh(opts.seed ?? (Date.now() % 100000 || 1));
  let feedback = '';
  let reveal: RevealCard | null = null;
  let draft = emptyDraft();
  let settling = false;
  let mode: CenterMode = 'pool';
  let poolQuery = '';

  if (!restored) saveRun(storage, data);

  const skillName = (skillId: string) => SKILL_REGISTRY[skillId]?.name ?? skillId;
  const pointsOf = (heroId: string) => (redness: number, level: number) => freePointBudget(heroId, redness, level);
  const treasureName = (treasureId: string) => treasureOptions().find((treasure) => treasure.id === treasureId)?.name ?? treasureId;

  function createFresh(seed: number): SaveData {
    return {
      run: createRun(seed, ECONOMY.levelCount, ECONOMY.lives),
      pool: createPool({ skills: initialSkillIds() }),
      wallet: createWallet(),
      gacha: null,
      enemy: null,
      enemyLevel: null,
      enemyWinRate: null,
      nonce: 0,
    };
  }

  function freshLoadout(heroId: string): SlotLoadout {
    const owned = data.pool.heroes.find((hero) => hero.heroId === heroId);
    return {
      freePoints: defaultFreePoints(heroId, owned?.redness ?? 0, owned?.level ?? 40),
      treasure: null,
    };
  }

  function emptyDraft(): TeamDraft {
    const heroes = data.pool.heroes.slice(0, 3).map((hero) => hero.heroId);
    while (heroes.length < 3) heroes.push('');
    return {
      heroes,
      skills: [['', ''], ['', ''], ['', '']],
      treasures: ['', '', ''],
      loadouts: heroes.map((heroId) => (heroId ? freshLoadout(heroId) : blankLoadout())),
      query: '',
      grade: 'ALL',
      type: 'ALL',
      troopMode: 'follow',
      focusSlot: 0,
      focusIndex: 0,
    };
  }

  function persist(): void {
    saveRun(storage, data);
  }

  function peekRng(): Rng {
    return new Rng((data.run.seed + data.nonce * 100003) >>> 0);
  }

  root.innerHTML = `
    <div class="app-shell rg-app">
      <header class="app">
        <img class="rate-logo" src="${esc(asset('/rate-logo.png'))}" alt="率" />
        <p class="rg-status" id="rg-status"></p>
        <div class="pool-search" id="pool-search-slot">
          <div class="toolbar"><input id="rg-pool-q" type="text" placeholder="搜索卡池武将" /></div>
        </div>
        <nav class="app-nav" aria-label="功能">
          <button type="button" class="nav-link" data-center="gacha" id="rg-nav-gacha">招募</button>
          <button type="button" class="nav-link" data-center="skills" id="rg-nav-skills">战法背包</button>
          <button type="button" class="nav-link" data-center="treasures" id="rg-nav-treasures">宝物背包</button>
          <button type="button" class="nav-link" data-center="buffs" id="rg-nav-buffs">已选强化</button>
          <button type="button" class="nav-link" data-center="shop" id="rg-nav-shop">商店</button>
        </nav>
      </header>
      <main>
        <div class="team-editor">
          <aside class="team-panel red">
            <div class="team-head">
              <h2>我方</h2>
              <div class="team-head-actions">
                <button type="button" class="btn ghost" id="rg-clear-team">清空本队</button>
              </div>
            </div>
            <div class="slots" id="rg-slots"></div>
            <p id="rg-team-error"></p>
          </aside>
          <section class="hero-pool" id="rg-center"></section>
          <aside class="team-panel blue">
            <div class="team-head">
              <h2>蓝队</h2>
            </div>
            <div class="slots" id="rg-enemy-slots"></div>
          </aside>
        </div>
      </main>
      <footer class="control-bar">
        <span id="rg-intel-line"></span>
        <span class="spacer"></span>
        <button type="button" class="btn" id="rg-fight">出战</button>
      </footer>
    </div>`;
  root.setAttribute('data-rogue-ready', '1');

  const center = () => root.querySelector('#rg-center') as HTMLElement;

  function refreshStatus(): void {
    const status = root.querySelector('#rg-status');
    if (status) status.textContent = `第 ${data.run.level} 关 · 命数 ${data.run.lives} · 玉符 ${data.wallet.jade}`;
    const line = root.querySelector('#rg-intel-line');
    if (!line) return;
    const rate = Math.round(targetWinRate(data.run.level, data.run.levelCount) * 100);
    const elite = isEliteLevel(data.run.level) ? ' · 幕末精英关，突破奖励未开放' : '';
    const estimated = data.enemyWinRate == null ? '' : ` · 按卡池红度估算 ${Math.round(data.enemyWinRate * 100)}%`;
    line.textContent = `目标胜率 ${rate}%${estimated}${elite}`;
  }

  function markNav(): void {
    root.querySelectorAll<HTMLButtonElement>('.nav-link').forEach((button) => {
      button.classList.toggle('on', button.dataset.center === mode);
    });
  }

  function heroRecord(heroId: string) {
    return data.pool.heroes.find((hero) => hero.heroId === heroId);
  }

  function refreshSlots(): void {
    const host = root.querySelector('#rg-slots') as HTMLElement;
    renderSlots(
      host,
      {
        labels: POSITIONS,
        heroes: draft.heroes,
        skills: draft.skills,
        treasures: draft.treasures,
        loadouts: draft.loadouts,
        focusSlot: draft.focusSlot,
        focusIndex: draft.focusIndex,
        nameOf: heroName,
        skillName,
        treasureName,
        rednessOf: (heroId) => heroRecord(heroId)?.redness ?? 0,
        levelOf: (heroId) => heroRecord(heroId)?.level ?? 40,
      },
      {
        onFocus: (index, skillIndex) => {
          draft.focusSlot = index;
          draft.focusIndex = skillIndex;
          refreshSlots();
        },
        onOpen: openDetail,
        onSkillSlot: (index, skillIndex) => {
          draft.focusSlot = index;
          draft.focusIndex = skillIndex;
          showSkills();
        },
        onHero: placeHero,
        onMove: moveSlot,
        onSkill: (index, skillId) => {
          draft.focusSlot = index;
          assignSkill(skillId);
        },
        onTreasure: (index, treasureId) => {
          if (!data.pool.treasures.includes(treasureId)) return;
          draft.treasures[index] = treasureId;
          draft.focusSlot = index;
          refreshSlots();
        },
        onClear: clearSlot,
      },
    );
  }

  function showError(text: string): void {
    const node = root.querySelector('#rg-team-error');
    if (node) node.textContent = text;
  }

  function placementError(heroes: readonly string[]): string | null {
    const ids = heroes.filter((id) => id.length > 0);
    if (new Set(ids).size !== ids.length) return '同一名武将不能占两个位置';
    const groups = ids
      .map((id) => HERO_RECORDS[id]?.mutualExclusionGroup)
      .filter((group): group is string => Boolean(group));
    if (new Set(groups).size !== groups.length) return '互斥武将不能同时上阵';
    return null;
  }

  function placeHero(index: number, heroId: string): void {
    if (!heroRecord(heroId)) return;
    const next = draft.heroes.slice();
    const from = next.indexOf(heroId);
    if (from === index) return;
    if (from >= 0) {
      const displaced = next[index] ?? '';
      next[from] = displaced;
      const skills = draft.skills[from] ?? ['', ''];
      draft.skills[from] = draft.skills[index] ?? ['', ''];
      draft.skills[index] = skills;
      const treasure = draft.treasures[from] ?? '';
      draft.treasures[from] = draft.treasures[index] ?? '';
      draft.treasures[index] = treasure;
      const loadout = draft.loadouts[from] ?? blankLoadout();
      draft.loadouts[from] = draft.loadouts[index] ?? blankLoadout();
      draft.loadouts[index] = loadout;
    } else {
      draft.skills[index] = ['', ''];
      draft.treasures[index] = '';
      draft.loadouts[index] = freshLoadout(heroId);
    }
    next[index] = heroId;
    const error = placementError(next);
    if (error) {
      showError(error);
      return;
    }
    draft.heroes = next;
    draft.focusSlot = index;
    showError('');
    refreshSlots();
    if (mode === 'pool') renderPool();
    if (mode === 'skills') showSkills();
  }

  function moveSlot(from: number, to: number): void {
    if (from === to) return;
    const swap = <T>(list: T[]): void => {
      const saved = list[from]!;
      list[from] = list[to]!;
      list[to] = saved;
    };
    swap(draft.heroes);
    swap(draft.skills);
    swap(draft.treasures);
    swap(draft.loadouts);
    draft.focusSlot = to;
    showError('');
    refreshSlots();
    if (mode === 'pool') renderPool();
  }

  function clearSlot(index: number): void {
    draft.heroes[index] = '';
    draft.skills[index] = ['', ''];
    draft.treasures[index] = '';
    draft.loadouts[index] = blankLoadout();
    refreshSlots();
    if (mode === 'pool') renderPool();
  }

  /**
   * 打开和主站相同的武将详情。配点、战法、兵种、宝物写回当前站位。
   * 红度和等级仍由卡池的重复获得决定。
   * @param index 站位
   */
  function openDetail(index: number): void {
    const heroId = draft.heroes[index] ?? '';
    if (!heroId) return;
    draft.focusSlot = index;
    const owned = heroRecord(heroId);
    const loadout = draft.loadouts[index] ?? freshLoadout(heroId);
    draft.loadouts[index] = loadout;
    const slot: SlotState = {
      heroId,
      extraSkillIds: (draft.skills[index] ?? []).filter((id) => id.length > 0),
      freePoints: loadout.freePoints,
      redness: owned?.redness ?? 0,
      level: owned?.level ?? 40,
      secondaryTroop: loadout.secondaryTroop,
      secondaryTraits: loadout.secondaryTraits,
      treasure: loadout.treasure,
    };
    const syncSkills = (): void => {
      draft.skills[index] = [slot.extraSkillIds[0] ?? '', slot.extraSkillIds[1] ?? ''];
    };
    const handlers: EditorHandlers = {
      onPickHero: () => undefined,
      onMoveSlot: () => undefined,
      onAddSkill: (_team, _idx, skillId) => {
        if (!data.pool.skills.includes(skillId)) {
          showNotice('背包里还没有这个战法');
          return;
        }
        if (slot.extraSkillIds.includes(skillId) || slot.extraSkillIds.length >= 2) return;
        slot.extraSkillIds = [...slot.extraSkillIds, skillId];
        syncSkills();
        refreshSlots();
      },
      onRemoveSkill: (_team, _idx, skillId) => {
        slot.extraSkillIds = slot.extraSkillIds.filter((id) => id !== skillId);
        syncSkills();
        refreshSlots();
      },
      onSetFreePoints: (_team, _idx, key, value) => {
        const budget = freePointBudget(heroId, slot.redness, slot.level);
        const others = (Object.keys(slot.freePoints) as Array<keyof SlotState['freePoints']>)
          .filter((stat) => stat !== key)
          .reduce((sum, stat) => sum + slot.freePoints[stat], 0);
        slot.freePoints[key] = Math.max(0, Math.min(budget - others, Math.floor(value) || 0));
        loadout.freePoints = slot.freePoints;
        refreshSlots();
      },
      onSetRedness: () => showNotice('红度随重复获得提升'),
      onSetLevel: () => showNotice('等级随重复获得提升'),
      onSetSecondaryTroop: (_team, _idx, troop) => {
        slot.secondaryTroop = troop;
        slot.secondaryTraits = troop ? [] : undefined;
        loadout.secondaryTroop = troop;
        loadout.secondaryTraits = slot.secondaryTraits;
        refreshSlots();
      },
      onSetSecondaryTrait: (_team, _idx, traitSlot, trait) => {
        const learned = [...(slot.secondaryTraits ?? [])];
        if (trait) learned[traitSlot] = trait;
        else learned.splice(traitSlot, 1);
        slot.secondaryTraits = learned.filter((item) => Boolean(item)).slice(0, 2);
        loadout.secondaryTraits = slot.secondaryTraits;
        refreshSlots();
      },
      onSetTreasure: (_team, _idx, treasure) => {
        if (treasure && !data.pool.treasures.includes(String(treasure.treasureId))) {
          showNotice('背包里还没有这件宝物');
          return;
        }
        slot.treasure = treasure;
        loadout.treasure = treasure;
        draft.treasures[index] = treasure ? String(treasure.treasureId) : '';
        refreshSlots();
      },
      onRemoveHero: () => clearSlot(index),
      onClearTeam: () => undefined,
    };
    openHeroDetail(heroId, { placed: { team: 'red', idx: index, slot }, handlers });
  }

  function assignSkill(skillId: string): void {
    const slot = draft.skills[draft.focusSlot] ?? ['', ''];
    if (slot.includes(skillId)) return;
    slot[draft.focusIndex] = skillId;
    draft.skills[draft.focusSlot] = slot;
    refreshSlots();
    if (mode === 'skills') showSkills();
  }

  function dismissGachaLayer(): void {
    reveal = null;
    root.querySelector('#rg-gacha-layer')?.remove();
  }

  function refreshEnemy(): void {
    const host = root.querySelector('#rg-enemy-slots');
    if (!(host instanceof HTMLElement)) return;
    let slots = data.enemy ?? [];
    if (data.run.status === 'playing') {
      try {
        slots = ensureEnemy() ?? [];
      } catch {
        slots = data.enemy ?? [];
      }
    }
    renderEnemySlots(host, {
      slots,
      nameOf: heroName,
      skillName,
      mainSkillOf: mainSkillName,
    });
  }

  function renderPool(): void {
    dismissGachaLayer();
    mode = 'pool';
    markNav();
    refreshEnemy();
    const node = center();
    node.innerHTML = '<div class="hero-grid" id="rg-hero-grid"></div>';
    renderOwnedGrid(
      node.querySelector('#rg-hero-grid') as HTMLElement,
      {
        heroes: data.pool.heroes,
        query: poolQuery,
        picked: new Set(draft.heroes.filter((id) => id.length > 0)),
        nameOf: heroName,
        mainSkillOf: mainSkillName,
      },
      (heroId) => placeHero(draft.focusSlot, heroId),
    );
    node.ondragover = (event) => {
      event.preventDefault();
      node.classList.add('drag-over');
    };
    node.ondragleave = () => node.classList.remove('drag-over');
    node.ondrop = (event) => {
      event.preventDefault();
      node.classList.remove('drag-over');
      const payload = readBoardDrag(event);
      if (payload?.kind === 'slot') clearSlot(payload.index);
    };
  }

  function backButton(): string {
    return '<p><button type="button" class="btn ghost" id="rg-nav-pool">返回卡池</button></p>';
  }

  function bindBack(): void {
    center().querySelector('#rg-nav-pool')?.addEventListener('click', renderPool);
  }

  function showSkills(): void {
    dismissGachaLayer();
    mode = 'skills';
    markNav();
    refreshSlots();
    renderSkillBag(center(), {
      nameOf: heroName,
      choices: (query, grade, type, troop, equippableOnly) =>
        skillChoices(data.pool.skills, query, grade, type, troop, equippableOnly),
      draft,
      onAssign: assignSkill,
      onBack: renderPool,
    });
  }

  function showTreasures(): void {
    dismissGachaLayer();
    mode = 'treasures';
    markNav();
    const owned = treasureOptions().filter((treasure) => data.pool.treasures.includes(treasure.id));
    const cards = owned
      .map(
        (treasure) =>
          `<button type="button" class="rg-skill-pick" draggable="true" data-treasure="${esc(treasure.id)}">${esc(treasure.name)}</button>`,
      )
      .join('') || '<p>还没有宝物。通关有机会掉落。</p>';
    center().innerHTML = `<section id="rg-treasures">${backButton()}<h2>宝物背包</h2><p class="rg-note">拖到左边槽位，或点一下给当前武将佩戴。</p><div id="rg-treasure-list">${cards}</div></section>`;
    bindBack();
    center().querySelectorAll<HTMLButtonElement>('[data-treasure]').forEach((button) => {
      const treasureId = button.dataset.treasure ?? '';
      button.addEventListener('dragstart', (event) => setBoardDrag(event, { kind: 'treasure', treasureId }));
      button.addEventListener('click', () => {
        draft.treasures[draft.focusSlot] = treasureId;
        draft.loadouts[draft.focusSlot].treasure = { treasureId: Number(treasureId), level: 10 };
        refreshSlots();
      });
    });
  }

  function showBuffs(): void {
    dismissGachaLayer();
    mode = 'buffs';
    markNav();
    center().innerHTML = `<section id="rg-buffs">${backButton()}<h2>已选强化</h2><p class="rg-note">本版占位。精英关的突破奖励仍不发放。</p></section>`;
    bindBack();
  }

  function showShop(message = ''): void {
    dismissGachaLayer();
    mode = 'shop';
    markNav();
    const rows = allShopRows.filter((row) => !data.pool.skills.includes(row.id));
    center().innerHTML = `${backButton()}<div id="rg-shop-host"></div>`;
    bindBack();
    const host = center().querySelector('#rg-shop-host') as HTMLElement;
    renderShop(host, {
      rows,
      jade: data.wallet.jade,
      priceOf: (grade) => economyPrice(grade),
      onBuy: (skillId) => {
        const result = buySkill(data.wallet, data.pool, skillId, shopCatalogue);
        if (!result.ok) {
          const text = result.reason === 'broke' ? '玉符不足' : result.reason === 'owned' ? '已经拥有' : '未上架';
          setShopMessage(host, text);
          return;
        }
        data.wallet = result.wallet;
        data.pool = result.pool;
        persist();
        refreshStatus();
        showShop('已买入');
      },
    });
    if (message) setShopMessage(host, message);
  }

  function showGacha(): void {
    mode = 'gacha';
    markNav();
    refreshStatus();
    const shell = root.querySelector('.rg-app');
    if (!shell) return;
    let layer = root.querySelector('#rg-gacha-layer');
    if (!(layer instanceof HTMLElement)) {
      layer = document.createElement('div');
      layer.id = 'rg-gacha-layer';
      shell.appendChild(layer);
    }
    layer.innerHTML = gachaHtml({
      pull: reveal ? null : data.gacha,
      canPay: canAfford(data.wallet, ECONOMY.gachaCost),
      feedback: reveal ? '' : feedback,
      reveal,
      nameOf: heroName,
      portraitOf,
      previewOf: (heroId) => {
        const peeked = addHero(data.pool, heroId);
        return {
          redness: peeked.feedback.after.redness,
          level: peeked.feedback.after.level,
          text: formatRecruit(heroName(heroId), peeked.feedback, pointsOf(heroId)),
        };
      },
    });
    layer.querySelector('#rg-gacha-close')?.addEventListener('click', renderPool);
    layer.querySelector('#rg-pull')?.addEventListener('click', onPull);
    layer.querySelector('#rg-bonus')?.addEventListener('click', onBonus);
    layer.querySelectorAll<HTMLButtonElement>('[id^="rg-card-"]').forEach((button) => {
      button.addEventListener('click', () => onPick(Number(button.id.slice('rg-card-'.length))));
    });
  }

  function onPull(): void {
    if (!data.gacha) {
      const began = beginPull(data.wallet, peekRng(), heroIds);
      if (!began) {
        feedback = '玉符不足';
        showGacha();
        return;
      }
      data.nonce += 1;
      data.wallet = began.wallet;
      data.gacha = began.pull;
      reveal = null;
      feedback = '';
      persist();
    }
    showGacha();
  }

  function onPick(index: number): void {
    if (!data.gacha || data.gacha.picked) return;
    const heroId = data.gacha.shown[index];
    if (!heroId) return;
    data.gacha = pickFromPull(data.gacha, heroId);
    const added = addHero(data.pool, heroId);
    data.pool = added.pool;
    feedback = formatRecruit(heroName(heroId), added.feedback, pointsOf(heroId));
    persist();
    refreshEnemy();
    showGacha();
  }

  function onBonus(): void {
    if (!data.gacha?.picked) {
      feedback = '先点一张选入卡池';
      showGacha();
      return;
    }
    const heroId = claimBonus(data.gacha);
    const added = addHero(data.pool, heroId);
    data.pool = added.pool;
    data.gacha = null;
    feedback = formatRecruit(heroName(heroId), added.feedback, pointsOf(heroId));
    reveal = {
      heroId,
      redness: added.feedback.after.redness,
      level: added.feedback.after.level,
      text: feedback,
    };
    persist();
    refreshEnemy();
    showGacha();
  }

  function bestRoster(): General[] {
    const ranked = [...data.pool.heroes].sort(
      (a, b) => b.redness - a.redness || b.level - a.level || b.troops - a.troops,
    );
    const top = ranked.slice(0, 3);
    if (top.length < 3) return [];
    return top.map((hero, index) => makeGeneral(hero.heroId, [], POSITIONS[index]!, hero.redness, hero.level));
  }

  function ensureEnemy() {
    if (data.enemy && data.enemyLevel === data.run.level) return data.enemy;
    const measure = bestRoster();
    if (measure.length < 3) return null;
    const picked = pickEnemyForLevel(
      measure,
      heroIds,
      data.run.seed,
      data.run.level,
      (slot) => makeGeneral(slot.heroId, slot.skillIds, slot.position, slot.redness, slot.level),
      { runs: LEVEL_PICK_RUNS },
    );
    data.enemy = picked.slots;
    data.enemyLevel = data.run.level;
    data.enemyWinRate = picked.winRate;
    persist();
    refreshStatus();
    return data.enemy;
  }

  function fight(): void {
    if (settling || data.run.status !== 'playing') return;
    const slots = POSITIONS.map((position, index) => {
      const loadout = draft.loadouts[index] ?? blankLoadout();
      return {
        heroId: draft.heroes[index] ?? '',
        skillIds: (draft.skills[index] ?? []).filter((id) => id.length > 0),
        position,
        treasureId: draft.treasures[index] || undefined,
        tuning: {
          freePoints: loadout.freePoints,
          secondaryTroop: loadout.secondaryTroop,
          secondaryTraits: loadout.secondaryTraits,
          treasure: loadout.treasure,
        },
      };
    });
    const error = teamError(slots);
    if (error) {
      showError(error);
      return;
    }
    settling = true;
    try {
      const foughtLevel = data.run.level;
      const choice: TeamChoice = { slots };
      const myTeam = buildMyTeam(data.pool, choice, deps);
      const enemySlots = ensureEnemy();
      if (!enemySlots) throw new Error('卡池至少 3 名武将才能生成敌军');
      const enemyTeam = enemyFromSlots(enemySlots);
      const result = settleLevel(data.run, data.pool, myTeam, enemyTeam, foughtLevel);
      data.run = result.run;
      data.pool = result.pool;
      let reward: ClearReward | null = null;
      if (result.outcome === 'win') {
        reward = rollClearReward(peekRng(), rewardCatalogue, {
          skills: data.pool.skills,
          treasures: data.pool.treasures,
        });
        data.nonce += 1;
        const applied = applyClearReward(data.wallet, data.pool, reward);
        data.wallet = applied.wallet;
        data.pool = applied.pool;
        data.enemy = null;
        data.enemyLevel = null;
      }
      persist();
      showReport(result.report, result.outcome, foughtLevel, reward);
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : '出战失败');
    } finally {
      settling = false;
    }
  }

  function teamError(slots: TeamChoice['slots']): string | null {
    const ids = slots.map((slot) => slot.heroId);
    if (ids.some((id) => !id) || ids.length < 3) return '请凑齐 3 名武将';
    return placementError(ids);
  }

  function showReport(report: BattleReport, outcome: Outcome, foughtLevel: number, reward: ClearReward | null): void {
    dismissGachaLayer();
    mode = 'report';
    markNav();
    refreshStatus();
    renderReport(center(), {
      report,
      outcome,
      elite: isEliteLevel(foughtLevel),
      onNext: () => {
        if (reward) showReward(reward);
        else if (data.run.status !== 'playing') showEnd();
        else renderPool();
      },
    });
  }

  function showReward(reward: ClearReward): void {
    dismissGachaLayer();
    mode = 'reward';
    markNav();
    const bonus = reward.bonus;
    const extra = !bonus
      ? '没有额外掉落'
      : bonus.kind === 'skill'
        ? `战法 · ${skillName(bonus.id)} · ${bonus.grade}`
        : `宝物 · ${treasureName(bonus.id)}`;
    center().innerHTML = `<section id="rg-reward"><h2>通关奖励</h2><p>玉符 +${reward.jade}</p><p>${esc(extra)}</p><button id="rg-next" type="button">继续</button></section>`;
    center().querySelector('#rg-next')!.addEventListener('click', () => {
      if (data.run.status === 'playing') renderPool();
      else showEnd();
    });
  }

  function showEnd(): void {
    dismissGachaLayer();
    mode = 'end';
    markNav();
    refreshStatus();
    const title = data.run.status === 'cleared' ? '通关！' : '全军覆没';
    center().innerHTML = `<section id="rg-end"><h2>${title}</h2><button id="rg-restart" type="button">再来一局</button></section>`;
    center().querySelector('#rg-restart')!.addEventListener('click', restart);
  }

  function restart(): void {
    storage.removeItem(SAVE_KEY);
    data = createFresh(opts.seed ?? (Date.now() % 100000 || 1));
    feedback = '';
    reveal = null;
    draft = emptyDraft();
    poolQuery = '';
    persist();
    refreshStatus();
    refreshSlots();
    renderPool();
  }

  root.querySelector('#rg-nav-skills')!.addEventListener('click', showSkills);
  root.querySelector('#rg-nav-treasures')!.addEventListener('click', showTreasures);
  root.querySelector('#rg-nav-buffs')!.addEventListener('click', showBuffs);
  root.querySelector('#rg-nav-shop')!.addEventListener('click', () => showShop());
  root.querySelector('#rg-nav-gacha')!.addEventListener('click', showGacha);
  root.querySelector('#rg-clear-team')!.addEventListener('click', () => {
    draft.heroes = ['', '', ''];
    draft.skills = [['', ''], ['', ''], ['', '']];
    draft.treasures = ['', '', ''];
    draft.loadouts = [blankLoadout(), blankLoadout(), blankLoadout()];
    refreshSlots();
    if (mode === 'pool') renderPool();
  });
  root.querySelector('#rg-fight')!.addEventListener('click', fight);
  const search = root.querySelector('#rg-pool-q') as HTMLInputElement;
  search.addEventListener('input', () => {
    poolQuery = search.value;
    if (mode === 'pool') renderPool();
  });

  refreshStatus();
  refreshSlots();
  refreshEnemy();
  if (data.run.status !== 'playing') showEnd();
  else {
    renderPool();
    if (data.gacha) showGacha();
  }
}

/** 商店标价。只有 A/S 会进货架。 */
function economyPrice(grade: string): number {
  return grade === 'S' ? priceOf('S') : priceOf('A');
}

if (typeof document !== 'undefined') {
  const pageRoot = document.querySelector('#rg-root');
  if (pageRoot instanceof HTMLElement) mountRogue(pageRoot);
}
