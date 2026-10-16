/**
 * 热门预设 = 随站发布的**固定层**：制作人内置的一批热门队伍，用户删不掉、也改不了，
 * 但能一键上场、设为木桩、以及「另存为我的预设」——另存之后就是用户自己的（落 `web/presetStore.ts`
 * 的存档），随便改。与对手池的固定测试集同款套路（见 `web/opponentPool.ts`）。
 *
 * 数据文件 `web/data/hot_presets.json`（带 `version`，改动后把它往上提，便于复现）：
 *   { "version": "2026-10-16.1", "entries": [ { "id": "hot-xxx", "name": "…", "side": "red",
 *                                              "slots": [ SlotState ×3 ] } ] }
 * 只写**装配战法**（`extraSkillIds`，主战法由武将档案带出）；加点 / 红度 / 等级 / 二级兵种 /
 * 宝物缺省即空（level 缺省 40）。条目 id 必须以 `hot-` 开头，用户预设 id 是 `p_…` 不会撞。
 *
 * 内置层不占用户存档的 50 条上限，也不写 localStorage —— 随站升级就能整体更新。
 * 校验放宽（坏条目静默丢弃，绝不抛）：手改过 JSON 也只会少几条，不会白屏。
 */
import hotJson from './data/hot_presets.json';
import { normalizeName, normalizeSlot, type TeamPreset, type TeamSide } from './presetStore';

/** 内置条目 id 前缀 */
export const HOT_ID_PREFIX = 'hot-';

/** 数据文件里的一条（`slots` 未校验，逐槽过 `normalizeSlot`） */
export interface HotPresetEntry {
  id: string;
  name: string;
  side: TeamSide;
  slots: unknown[];
}

export interface HotPresetFile {
  version: string;
  entries: HotPresetEntry[];
}

const FILE = hotJson as HotPresetFile;

/** 内置层版本号（面板展示 / 复现用） */
export function hotVersion(): string {
  return String(FILE?.version ?? '0');
}

/** 是不是内置条目（面板据此区分「热门预设」与「我的预设」） */
export function isHotId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(HOT_ID_PREFIX);
}

/**
 * 读内置热门预设（每次返回新拷贝，页面上的编辑动不到原件）。
 * 坏条目（id 前缀不对 / 重名 id / 名字为空）直接丢弃。
 * `no` 恒为 0：内置条目不编号（编号是用户存档的单调水位，不该被借用）。
 */
export function loadHotPresets(): TeamPreset[] {
  const out: TeamPreset[] = [];
  for (const raw of Array.isArray(FILE?.entries) ? FILE.entries : []) {
    const id = String(raw?.id ?? '');
    const name = normalizeName(String(raw?.name ?? ''));
    if (!isHotId(id) || !name || out.some((p) => p.id === id)) continue;
    const slotsRaw = Array.isArray(raw?.slots) ? raw.slots : [];
    const slots = [0, 1, 2].map((i) => normalizeSlot(slotsRaw[i]));
    out.push({
      id,
      no: 0,
      name,
      side: raw?.side === 'blue' ? 'blue' : 'red',
      slots,
      createdAt: 0,
      updatedAt: 0,
    });
  }
  return out;
}
