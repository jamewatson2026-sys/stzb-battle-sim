/**
 * 率土之滨【陈寿特性】数据（17 条）
 *
 * 数据来源：**包内原始产物**（`Desktop\stzb_reverse_v922`）
 *   - 主表 `tb_cfg_hero.bin`（解包产物 `unz/b9b92030.bin`）的 heroid **106001~106017**
 *     —— 陈寿特性在包里以「武将条目」形式存储，带 `name` / `description` / `skill_init`
 *   - 关联技能 `tb_cfg_skill.bin`（`unz/ff79fe9b.bin`）的 **280002~280018**
 *   - 机制文案：`game_functional_intro_data`（`unz/7bb95a06.bin`）、`error_tips`（`unz/91e0236d.bin`）
 *   - 完整资料：`Desktop\stzb_reverse_v922\陈寿特性-包内资料.md`
 *
 * 数值口径（用户 2026-10-16 拍板）：
 *   - 包内只给**区间**（如精进·攻 `4%-10%`），引擎禁 `Math.random`（结果必须可复现）
 *   - ⇒ 区间类做成**滑杆自选**（仿宝物锻造词条 `AFFIXES`），默认取官方「简单显示」值 5%
 *   - 无区间数据的（持重/纵横/敏学）按包内固定值或不结算，见各条 `note`
 *
 * 机制（官方 UI 原文）：赛季特色内容、赛季结束清空；**一名武将仅能使用一种特性**；
 * 更换会覆盖原有特性且不返还；入口为武将详情界面的「特性扩展入口」。
 *
 * ⚠️ 本文件为**手写数据**（17 条，量小且需人工校口径）；改动请同步包内资料文档。
 */

/** 陈寿特性的效果类型 */
export type ChenshouKind =
  /** 四维属性按百分比提升（精进四条） */
  | 'stat_pct'
  /** 四维属性按点数提升（砥砺分配） */
  | 'stat_point'
  /** 造成的伤害提高（昂扬两条，按伤害类型限定） */
  | 'deal_boost'
  /** 受到的伤害降低（审慎两条，按伤害类型限定） */
  | 'take_reduce'
  /** 统率值提升（出师·持重） */
  | 'cost_up'
  /** 统率值降低（出师·争先） */
  | 'cost_down'
  /** 阵营改写（纵横） */
  | 'faction'
  /** 星级提升至五星（敏学） */
  | 'star_up'
  /** 不参与战斗（征募两条 / 长驱 / 拔城） */
  | 'non_combat';

/** 单条陈寿特性定义 */
export interface ChenshouFeatureDef {
  id: string;
  /** 包内 heroid（106001~106017）—— 溯源锚点 */
  heroid: number;
  /** 包内关联技能 id（280002~280018） */
  skillId: number;
  /** 官方全名（`tb_cfg_hero.name`） */
  name: string;
  /** UI 短标签（去掉「陈寿·」前缀） */
  shortName: string;
  /** 官方效果文案（`tb_cfg_hero.description` 中 `$$$` 之后的详述列） */
  desc: string;
  kind: ChenshouKind;
  /** 属性类目标维（stat_pct / stat_point） */
  stat?: 'attack' | 'defense' | 'strategy' | 'speed';
  /** 伤害类限定类型（deal_boost / take_reduce） */
  damageType?: 'physical' | 'strategy';
  /** 数值口径：slider = 玩家在 [min,max] 自选；fixed = 包内固定值；none = 无数值 */
  valueKind: 'slider' | 'fixed' | 'none';
  min?: number;
  max?: number;
  /** 默认值（= 包内「简单显示」列） */
  defaultValue: number;
  unit: 'percent' | 'point' | 'cost' | '';
  /** 是否参与战斗结算（false = 仅在 UI 展示，模拟器量不出） */
  combat: boolean;
  /** 不结算 / 特殊处理的原因（UI tooltip 用） */
  note?: string;
}

/** 17 条陈寿特性（heroid 升序 = 官方展示顺序） */
export const CHENSHOU_FEATURES: ChenshouFeatureDef[] = [
  // ── 106001~106003：出师 / 纵横 ────────────────────────────────────────────
  {
    id: 'cs_106001',
    heroid: 106001,
    skillId: 280013,
    name: '陈寿·出师·持重',
    shortName: '出师·持重',
    desc: '令武将的统率值提升0.5，并提升一定的属性，不同武将有所不同',
    kind: 'cost_up',
    valueKind: 'fixed',
    defaultValue: 0.5,
    unit: 'cost',
    combat: true,
    note: '包内只给统率 +0.5；「提升一定的属性，不同武将有所不同」无区间数据 → 只结算统率',
  },
  {
    id: 'cs_106002',
    heroid: 106002,
    skillId: 280012,
    name: '陈寿·出师·争先',
    shortName: '出师·争先',
    desc: '令武将的统率值降低0.5',
    kind: 'cost_down',
    valueKind: 'fixed',
    defaultValue: 0.5,
    unit: 'cost',
    combat: true,
  },
  {
    id: 'cs_106003',
    heroid: 106003,
    skillId: 280011,
    name: '陈寿·纵横',
    shortName: '纵横',
    desc: '令武将改为享受特定阵营的战斗、政策加成',
    kind: 'faction',
    valueKind: 'none',
    defaultValue: 0,
    unit: '',
    combat: true,
    note: '需选定目标阵营；结算时把该武将的阵营改为所选阵营（影响阵营加成计数）',
  },

  // ── 106004 / 106011~106013：精进四条（四维百分比） ─────────────────────
  {
    id: 'cs_106004',
    heroid: 106004,
    skillId: 280006,
    name: '陈寿·精进·攻',
    shortName: '精进·攻',
    desc: '提升武将4%-10%的攻击属性',
    kind: 'stat_pct',
    stat: 'attack',
    valueKind: 'slider',
    min: 4,
    max: 10,
    defaultValue: 5,
    unit: 'percent',
    combat: true,
  },
  {
    id: 'cs_106011',
    heroid: 106011,
    skillId: 280007,
    name: '陈寿·精进·防',
    shortName: '精进·防',
    desc: '提升武将4%-10%的防御属性',
    kind: 'stat_pct',
    stat: 'defense',
    valueKind: 'slider',
    min: 4,
    max: 10,
    defaultValue: 5,
    unit: 'percent',
    combat: true,
  },
  {
    id: 'cs_106012',
    heroid: 106012,
    skillId: 280008,
    name: '陈寿·精进·谋',
    shortName: '精进·谋',
    desc: '提升武将4%-10%的谋略属性',
    kind: 'stat_pct',
    stat: 'strategy',
    valueKind: 'slider',
    min: 4,
    max: 10,
    defaultValue: 5,
    unit: 'percent',
    combat: true,
  },
  {
    id: 'cs_106013',
    heroid: 106013,
    skillId: 280009,
    name: '陈寿·精进·速',
    shortName: '精进·速',
    desc: '提升武将4%-10%的速度属性',
    kind: 'stat_pct',
    stat: 'speed',
    valueKind: 'slider',
    min: 4,
    max: 10,
    defaultValue: 5,
    unit: 'percent',
    combat: true,
  },

  // ── 106005 / 106006：砥砺 / 敏学 ─────────────────────────────────────────
  {
    id: 'cs_106005',
    heroid: 106005,
    skillId: 280014,
    name: '陈寿·砥砺',
    shortName: '砥砺',
    desc: '提升武将总计6-12点属性，随机分配到攻击、防御、谋略、速度',
    kind: 'stat_point',
    valueKind: 'slider',
    min: 6,
    max: 12,
    defaultValue: 9,
    unit: 'point',
    combat: true,
    note: '包内为随机分配 → 引擎禁随机：总量滑杆 + 玩家自行分配到四维（合计 = 总量）',
  },
  {
    id: 'cs_106006',
    heroid: 106006,
    skillId: 280010,
    name: '陈寿·敏学',
    shortName: '敏学',
    desc: '提升武将星级至五星，并随机大幅提升属性，有概率进阶高级兵种',
    kind: 'star_up',
    valueKind: 'none',
    defaultValue: 0,
    unit: '',
    combat: false,
    note: '「随机大幅提升属性」包内无区间 → 不结算数值；只作星级/兵种进阶提示，不参与战斗模拟',
  },

  // ── 106007~106010：昂扬 / 审慎（伤害增减，按伤害类型） ───────────────────
  {
    id: 'cs_106007',
    heroid: 106007,
    skillId: 280002,
    name: '陈寿·昂扬·攻',
    shortName: '昂扬·攻',
    desc: '战斗开始后，武将造成的攻击伤害提升4%-10%',
    kind: 'deal_boost',
    damageType: 'physical',
    valueKind: 'slider',
    min: 4,
    max: 10,
    defaultValue: 5,
    unit: 'percent',
    combat: true,
  },
  {
    id: 'cs_106008',
    heroid: 106008,
    skillId: 280003,
    name: '陈寿·昂扬·谋',
    shortName: '昂扬·谋',
    desc: '战斗开始后，武将造成的策略伤害提升4%-10%',
    kind: 'deal_boost',
    damageType: 'strategy',
    valueKind: 'slider',
    min: 4,
    max: 10,
    defaultValue: 5,
    unit: 'percent',
    combat: true,
  },
  {
    id: 'cs_106009',
    heroid: 106009,
    skillId: 280004,
    name: '陈寿·审慎·攻',
    shortName: '审慎·攻',
    desc: '战斗开始后，武将受到的攻击伤害降低4%-10%',
    kind: 'take_reduce',
    damageType: 'physical',
    valueKind: 'slider',
    min: 4,
    max: 10,
    defaultValue: 5,
    unit: 'percent',
    combat: true,
  },
  {
    id: 'cs_106010',
    heroid: 106010,
    skillId: 280005,
    name: '陈寿·审慎·谋',
    shortName: '审慎·谋',
    desc: '战斗开始后，武将受到的策略伤害降低4%-10%',
    kind: 'take_reduce',
    damageType: 'strategy',
    valueKind: 'slider',
    min: 4,
    max: 10,
    defaultValue: 5,
    unit: 'percent',
    combat: true,
  },

  // ── 106014~106017：征募 / 长驱 / 拔城（非战斗） ─────────────────────────
  {
    id: 'cs_106014',
    heroid: 106014,
    skillId: 280016,
    name: '陈寿·征募·速',
    shortName: '征募·速',
    desc: '自身征兵所需时间降低5%',
    kind: 'non_combat',
    valueKind: 'fixed',
    defaultValue: 5,
    unit: 'percent',
    combat: false,
    note: '内政（征兵时间）——战斗模拟器量不出，仅 UI 展示',
  },
  {
    id: 'cs_106015',
    heroid: 106015,
    skillId: 280015,
    name: '陈寿·征募·俭',
    shortName: '征募·俭',
    desc: '自身征兵资源消耗降低5%',
    kind: 'non_combat',
    valueKind: 'fixed',
    defaultValue: 5,
    unit: 'percent',
    combat: false,
    note: '内政（征兵资源）——战斗模拟器量不出，仅 UI 展示',
  },
  {
    id: 'cs_106016',
    heroid: 106016,
    skillId: 280017,
    name: '陈寿·长驱',
    shortName: '长驱',
    desc: '自身行军速度提升10',
    kind: 'non_combat',
    valueKind: 'fixed',
    defaultValue: 10,
    unit: 'point',
    combat: false,
    note: '大地图行军速度——战斗模拟器量不出，仅 UI 展示',
  },
  {
    id: 'cs_106017',
    heroid: 106017,
    skillId: 280018,
    name: '陈寿·拔城',
    shortName: '拔城',
    desc: '自身的攻城属性提升8',
    kind: 'non_combat',
    valueKind: 'fixed',
    defaultValue: 8,
    unit: 'point',
    combat: false,
    note: '攻城属性——引擎无攻城维（对部队战斗无影响），仅 UI 展示',
  },
];

/** id → 定义 */
export const CHENSHOU_BY_ID: Record<string, ChenshouFeatureDef> = Object.fromEntries(
  CHENSHOU_FEATURES.map((f) => [f.id, f])
);

/** 参与战斗结算的特性（= 引擎会挂状态的那些） */
export const COMBAT_FEATURES: ChenshouFeatureDef[] = CHENSHOU_FEATURES.filter((f) => f.combat);

/** 玩家对某个特性选定的数值（砥砺额外带四维分配） */
export interface ChenshouLoadout {
  featureId: string;
  /** 主数值（区间类 = 玩家自选；固定类 = 包内值） */
  value: number;
  /** 纵横专用：目标阵营 */
  faction?: string;
  /** 砥砺专用：四维分配（合计应 = value） */
  alloc?: { attack: number; defense: number; strategy: number; speed: number };
}

/** 造一个默认配置 */
export function makeChenshouLoadout(featureId: string): ChenshouLoadout {
  const def = CHENSHOU_BY_ID[featureId];
  const out: ChenshouLoadout = { featureId, value: def?.defaultValue ?? 0 };
  if (def?.kind === 'stat_point') {
    // 默认均分（余数给攻击）—— 用户可再改
    const each = Math.floor(out.value / 4);
    let rest = out.value - each * 4;
    out.alloc = {
      attack: each + (rest-- > 0 ? 1 : 0),
      defense: each + (rest-- > 0 ? 1 : 0),
      strategy: each + (rest-- > 0 ? 1 : 0),
      speed: each + (rest > 0 ? 1 : 0),
    };
  }
  return out;
}

/** 四维分配合计（砥砺校验用） */
export function allocTotal(a: ChenshouLoadout['alloc']): number {
  if (!a) return 0;
  return a.attack + a.defense + a.strategy + a.speed;
}
