import { ECONOMY } from '../../src/rogue/economy';
import type { HeroSlot, PendingPull } from '../../src/rogue/types';
import { getHeroById, TROOP_CHAR } from '../heroes';
import { ownedCardHtml } from './board';
import { esc } from './dom';

export interface PullPreview {
  /** 选这张之后的红度，用来画星 */
  redness: number;
  /** 选这张之后的等级 */
  level?: number;
  /** 新入池，或「2 红 → 4 红：属性点 +20」 */
  text: string;
}

export interface RevealCard {
  heroId: string;
  redness: number;
  level: number;
  text: string;
}

/**
 * 抽卡页三态：待付款、五张横排五选一、爽玩后的全屏单卡。
 * 只有五连，没有单抽。
 * @param view 当前抽卡状态
 */
export function gachaHtml(view: {
  pull: PendingPull | null;
  canPay: boolean;
  feedback: string;
  reveal?: RevealCard | null;
  nameOf: (heroId: string) => string;
  portraitOf: (heroId: string) => string;
  /** 五选一用：点下去之前就能看到升红还是新将 */
  previewOf?: (heroId: string) => PullPreview;
}): string {
  const feedback = `<p id="rg-feedback">${esc(view.feedback)}</p>`;
  const close = `<button type="button" class="rg-screen-close" id="rg-gacha-close">返回</button>`;
  if (view.reveal) {
    return `
      <section class="rg-screen rg-single" id="rg-gacha">
        ${close}
        ${singleCardHtml(view.reveal, view.nameOf)}
        ${costButton(view.canPay)}
        ${feedback}
      </section>`;
  }
  if (!view.pull) {
    return `
      <section class="rg-screen" id="rg-gacha">
        ${close}
        <div class="rg-ready">
          <h2>招募</h2>
          <p>一次 ${ECONOMY.gachaCost} 玉符。五张里选一张入池，再点中间「爽玩」免费再得一张。</p>
        </div>
        ${costButton(view.canPay)}
        ${feedback}
      </section>`;
  }
  const cards = view.pull.shown
    .map((heroId, index) => {
      const preview = view.previewOf?.(heroId) ?? { redness: 0, level: 40, text: '' };
      const on = view.pull?.picked === heroId ? ' on' : '';
      const hint = preview.text ? `<span class="rg-hint">${esc(preview.text)}</span>` : '';
      const slot: HeroSlot = {
        heroId,
        copies: 1,
        redness: preview.redness,
        level: preview.level ?? 40,
        maxTroops: 0,
        troops: 0,
      };
      return `
        <div class="rg-pull-card">
          <button id="rg-card-${index}" class="rg-card hero-card${on}" type="button">${ownedCardHtml(slot)}</button>
          ${hint}
        </div>`;
    })
    .join('');
  return `
    <section class="rg-screen" id="rg-gacha">
      ${close}
      <p class="rg-lead">点一张选入卡池，再点中间「爽玩」。</p>
      <div class="rg-row-wrap">
        <div class="rg-row">${cards}</div>
        <button id="rg-bonus" class="rg-shuang" type="button" aria-label="爽玩，再获得一名武将"><span>爽玩</span></button>
      </div>
      ${feedback}
    </section>`;
}

/**
 * 爽玩之后的单卡：中间一张发光卡，底部只留五连。
 * @param card 刚获得的武将
 * @param nameOf 展示名
 */
function singleCardHtml(card: RevealCard, nameOf: (heroId: string) => string): string {
  const name = nameOf(card.heroId);
  const record = getHeroById(card.heroId);
  const troop = TROOP_CHAR[record?.troopType ?? ''] ?? '';
  const bits = [record?.faction ?? '', name, troop].filter((bit) => bit.length > 0);
  const slot: HeroSlot = {
    heroId: card.heroId,
    copies: 1,
    redness: card.redness,
    level: card.level,
    maxTroops: 0,
    troops: 0,
  };
  return `
    <p class="rg-banner">获得武将 【${esc(bits.join(' · '))}】</p>
    <div class="rg-single-card hero-card">${ownedCardHtml(slot)}</div>
    <p class="rg-reveal-text">${esc(card.text)}</p>`;
}

/**
 * 底部五连按钮。玉符不够时禁用。没有单抽入口。
 * @param canPay 是否付得起一次五连
 */
function costButton(canPay: boolean): string {
  return `<div class="rg-costs"><button id="rg-pull" class="rg-cost" type="button" ${canPay ? '' : 'disabled'}><b>${ECONOMY.gachaCost}</b><span> / 招募5次</span></button></div>`;
}
