// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SKILL_REGISTRY } from '../../src/data/skills';
import { createWallet } from '../../src/rogue/economy';
import { createPool } from '../../src/rogue/pool';
import { createRun } from '../../src/rogue/run';
import { memoryStorage, saveRun } from '../../src/rogue/save';
import { mountRogue } from '../../web/rogue/app';
import { equippableRows, initialSkillIds, shopRows } from '../../web/rogue/catalogue';
import { fitsSoldier, soldierTypeOf } from '../../web/rogue/soldierFit';

describe('肉鸽界面', () => {
  it('开局能看到第 1 关、3 条命和 3000 玉符', () => {
    const root = document.createElement('div');
    mountRogue(root, { storage: memoryStorage(), seed: 7 });
    expect(root.textContent).toContain('第 1 关');
    expect(root.textContent).toContain('命数 3');
    expect(root.textContent).toContain('玉符 3000');
    expect(root.querySelector('#rg-nav-gacha')?.textContent).toBe('招募');
    expect(root.querySelector('.team-head #rg-nav-gacha')).toBeNull();
    expect(root.querySelectorAll('.team-panel.blue .slot')).toHaveLength(3);
  });

  it('五连抽可以五选一，再爽玩，玉符变成 2050', () => {
    const storage = memoryStorage();
    const root = document.createElement('div');
    mountRogue(root, { storage, seed: 7 });
    (root.querySelector('#rg-nav-gacha') as HTMLButtonElement).click();
    (root.querySelector('#rg-pull') as HTMLButtonElement).click();
    expect(root.querySelectorAll('.rg-card')).toHaveLength(5);
    expect(root.textContent).toContain('入池');
    expect(root.querySelector('.stars-gold')).toBeTruthy();
    (root.querySelector('#rg-card-0') as HTMLButtonElement).click();
    expect(root.querySelector('#rg-bonus')).toBeTruthy();
    (root.querySelector('#rg-bonus') as HTMLButtonElement).click();
    expect(root.querySelector('.rg-single')).toBeTruthy();
    expect(root.querySelector('#rg-pull')?.textContent).toContain('招募5次');
    expect(root.textContent).not.toContain('招募1次');
    expect(root.textContent).toContain('玉符 2050');
    const again = document.createElement('div');
    mountRogue(again, { storage });
    const card = again.querySelector('.hero-card');
    expect(card).toBeTruthy();
    expect(card?.getAttribute('title')).toContain('主战法');
    expect(again.querySelector('.stars-gold, .stars-red')).toBeTruthy();
    expect(again.textContent).not.toContain('还没有武将');
  });

  it('商店能按名字买到 A 级战法，玉符不足时按钮禁用', () => {
    const storage = memoryStorage();
    const root = document.createElement('div');
    mountRogue(root, { storage, seed: 7 });
    const row = shopRows().find((item) => item.grade === 'A');
    expect(row).toBeTruthy();
    (root.querySelector('#rg-nav-shop') as HTMLButtonElement).click();
    const input = root.querySelector('#rg-shop-q') as HTMLInputElement;
    input.value = row!.name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const buy = root.querySelector(`[data-skill="${row!.id}"]`) as HTMLButtonElement;
    expect(buy.disabled).toBe(false);
    expect(SKILL_REGISTRY[row!.id]).toBeTruthy();
    buy.click();
    expect(root.textContent).toContain('玉符 2400');
    expect(root.textContent).toContain('已买入');
  });

  it('预置三名武将后能出战并看到战报和败因', () => {
    const storage = memoryStorage();
    saveRun(storage, {
      run: createRun(11, 12, 3),
      pool: createPool({ heroes: ['h479', 'h29', 'h16'], skills: [] }),
      wallet: createWallet(500),
      gacha: null,
      enemy: null,
      enemyLevel: null,
      enemyWinRate: null,
      nonce: 0,
    });
    const root = document.createElement('div');
    mountRogue(root, { storage });
    expect(root.querySelector('.team-panel.red')).toBeTruthy();
    expect(root.querySelector('.team-panel.blue h2')?.textContent).toBe('蓝队');
    expect(root.querySelectorAll('.team-panel.red .slot')).toHaveLength(3);
    expect(root.querySelectorAll('.team-panel.blue .slot')).toHaveLength(3);
    expect(root.querySelector('.team-panel.blue .slot[data-hero-id]')).toBeTruthy();
    (root.querySelector('#rg-fight') as HTMLButtonElement).click();
    expect(root.querySelector('#rg-report')).toBeTruthy();
    expect((root.querySelector('#rg-cause')?.textContent ?? '').length).toBeGreaterThan(0);
    expect(root.textContent).toMatch(/斩首于第|打满/);
    expect(root.textContent).toContain('伤害');
    (root.querySelector('#rg-rounds button[data-round="r1"]') as HTMLButtonElement | null)?.click();
    const focused = root.querySelector('#rg-timeline')?.textContent ?? '';
    expect(focused.length).toBeGreaterThan(0);
    expect(focused).not.toContain('战斗统计');
  });

  it('组队默认只列出当前武将可装备的战法，搜索能看到兵种不符', () => {
    const unfit = equippableRows(initialSkillIds()).find((row) => {
      const soldier = soldierTypeOf(row.name);
      return Boolean(soldier) && !fitsSoldier(soldier, 'archer');
    });
    expect(unfit).toBeTruthy();
    const storage = memoryStorage();
    saveRun(storage, {
      run: createRun(11, 12, 3),
      pool: createPool({ heroes: ['h479', 'h29', 'h16'], skills: initialSkillIds() }),
      wallet: createWallet(500),
      gacha: null,
      enemy: null,
      enemyLevel: null,
      enemyWinRate: null,
      nonce: 0,
    });
    const root = document.createElement('div');
    mountRogue(root, { storage });
    (root.querySelector('#rg-nav-skills') as HTMLButtonElement).click();
    const picks = [...root.querySelectorAll('.rg-skill-pick')];
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(24);
    expect(picks.every((node) => node.textContent?.includes('可装备'))).toBe(true);
    expect(root.querySelector('#rg-focus-note')?.textContent).toContain('弓');
    (root.querySelector('.rg-troop[data-troop="all"]') as HTMLButtonElement).click();
    const input = root.querySelector('#rg-skill-q') as HTMLInputElement;
    input.value = unfit!.name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const hit = root.querySelector(`[data-skill="${unfit!.id}"]`);
    expect(hit?.textContent).toContain('兵种不符');
    expect(root.querySelector('.rg-skill-pick .sslot-icon')).toBeTruthy();
    expect(root.querySelector('.rg-grade[data-grade="S"]')).toBeTruthy();
    expect(root.querySelector('.rg-grade[data-grade="A"]')).toBeTruthy();
    (root.querySelector('.rg-grade[data-grade="S"]') as HTMLButtonElement).click();
    expect(root.querySelector('#rg-skill-list')?.textContent).toContain('没有符合筛选的战法');
  });

  it('武将卡可以拖进左边槽位，再拖回卡池卸下', () => {
    const storage = memoryStorage();
    saveRun(storage, {
      run: createRun(3, 12, 3),
      pool: createPool({ heroes: ['h479'], skills: [] }),
      wallet: createWallet(500),
      gacha: null,
      enemy: null,
      enemyLevel: null,
      enemyWinRate: null,
      nonce: 0,
    });
    const root = document.createElement('div');
    mountRogue(root, { storage });
    (root.querySelector('#rg-clear-team') as HTMLButtonElement).click();
    class DataTransfer {
      private store = new Map<string, string>();
      effectAllowed = 'all';
      dropEffect = 'move';
      /** @param type MIME */
      setData(type: string, value: string): void {
        this.store.set(type, value);
      }
      /** @param type MIME */
      getData(type: string): string {
        return this.store.get(type) ?? '';
      }
    }
    const fire = (target: HTMLElement, type: string, transfer: DataTransfer) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      target.dispatchEvent(event);
    };
    const card = root.querySelector('.hero-card') as HTMLElement;
    const slot = root.querySelector('.team-panel.red .slot') as HTMLElement;
    const data = new DataTransfer();
    fire(card, 'dragstart', data);
    fire(slot, 'dragover', data);
    expect(data.dropEffect).toBe('copy');
    fire(slot, 'drop', data);
    expect(root.querySelector('.slot[data-hero-id="h479"]')).toBeTruthy();
    const back = new DataTransfer();
    const filled = root.querySelector('.slot[data-hero-id="h479"]') as HTMLElement;
    fire(filled, 'dragstart', back);
    fire(root.querySelector('#rg-center') as HTMLElement, 'drop', back);
    expect(root.querySelector('.slot[data-hero-id="h479"]')).toBeNull();
  });

  it('已上阵的武将可以换到另一个站位，包括落在战法槽上', () => {
    const storage = memoryStorage();
    saveRun(storage, {
      run: createRun(3, 12, 3),
      pool: createPool({ heroes: ['h479', 'h29'], skills: [] }),
      wallet: createWallet(500),
      gacha: null,
      enemy: null,
      enemyLevel: null,
      enemyWinRate: null,
      nonce: 0,
    });
    const root = document.createElement('div');
    mountRogue(root, { storage });
    class DataTransfer {
      private store = new Map<string, string>();
      effectAllowed = 'all';
      dropEffect = 'move';
      /** @param type MIME */
      setData(type: string, value: string): void {
        this.store.set(type, value);
      }
      /** @param type MIME */
      getData(type: string): string {
        return this.store.get(type) ?? '';
      }
    }
    const fire = (target: HTMLElement, type: string, transfer: DataTransfer) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      target.dispatchEvent(event);
    };
    const slots = [...root.querySelectorAll<HTMLElement>('.team-panel.red .slot')];
    const from = slots[0]!;
    const ontoSkill = slots[1]!.querySelector('.rg-skill-slot') as HTMLElement;
    const data = new DataTransfer();
    fire(from, 'dragstart', data);
    fire(ontoSkill, 'dragover', data);
    expect(data.dropEffect).toBe('move');
    fire(ontoSkill, 'drop', data);
    const after = root.querySelectorAll('.team-panel.red .slot');
    expect(after[0]?.getAttribute('data-hero-id')).toBe('h29');
    expect(after[1]?.getAttribute('data-hero-id')).toBe('h479');
  });

  it('上阵后是主站卡面，点击打开可配点的详情', () => {
    const storage = memoryStorage();
    saveRun(storage, {
      run: createRun(3, 12, 3),
      pool: createPool({ heroes: ['h479'], skills: [] }),
      wallet: createWallet(500),
      gacha: null,
      enemy: null,
      enemyLevel: null,
      enemyWinRate: null,
      nonce: 0,
    });
    const root = document.createElement('div');
    mountRogue(root, { storage });
    const slot = root.querySelector('.team-panel.red .slot[data-hero-id="h479"]') as HTMLElement;
    expect(slot.querySelector('.slot-skill .sslot-icon')).toBeTruthy();
    expect(slot.querySelector('.sm-troop')?.textContent).toContain('兵');
    expect(slot.textContent).toContain('未佩戴宝物');
    slot.click();
    const modal = document.querySelector('.hero-detail-modal');
    expect(modal?.textContent).toContain('配点');
    expect(modal?.textContent).toContain('兵种');
    expect(modal?.textContent).toContain('战法');
    expect(modal?.textContent).toContain('选择宝物');
    (modal?.querySelector('.m-close') as HTMLElement).click();
  });
});
