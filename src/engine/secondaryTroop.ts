/**
 * 二级兵种（高级兵种）系统 —— 数据与规则表
 *
 * 依据：`docs/兵种转换调研.md`（用户 2026-09-20 审定口径，全部按现版）。
 *  - 每个五星武将有两个二级兵种转换方向（数据源：官方武将表 hero_type_availible 解码，见调研文档 §三）；
 *  - 每个二级兵种 = 1 个**专属特性**（兵种自带、不可更换）+ 2 个**通用特性栏**（可自选）；
 *  - 通用特性**按兵系成池**（现版每系 5 个）：同兵系所有高级兵种共享同一池；
 *  - 官方 2025-06-25 移除的 6 个通用特性（固阵/近战/射马/伪装/乱阵/侧击）**不实现**。
 *
 * 本模块为纯数据 + 纯函数，无 RNG、无引擎状态依赖（可被任意客户端调用）。
 */
import type { Position, TroopType } from './types';

/**
 * 二级兵种。名单与专属特性来自包内 `tb_cfg_hero_type.bin` / `tb_cfg_hero_type_feature.bin`
 * （特性 id = 1000 + 兵种 id + (兵种 id 末位) × 100，末位 1 弓 / 2 步 / 3 骑）。
 * 地图结算（劫粮、征兵、水域、枯竭地、国土）不进战斗。
 */
export type SecondaryTroopType =
  | '长弓兵' | '弩兵' | '死士' | '连弩兵' | '火矢兵' | '无当飞军' | '乡勇弓手'
  | '丹阳兵' | '黄巾长弓' | '解烦兵' | '白波长弓' | '黑山长弓' | '耕战营' | '青囊兵'
  | '重步兵' | '长枪兵' | '禁卫' | '藤甲兵' | '蛮兵' | '飞熊军' | '舷卫'
  | '黄巾兵' | '大戟士' | '白毦兵' | '乡勇步卒' | '白波轻步' | '黑山轻步' | '陷阵营'
  | '黄巾轻步' | '重垣军' | '白衣死士'
  | '重骑兵' | '轻骑兵' | '弓骑兵' | '铁骑兵' | '象兵' | '羽林骑' | '白马义从'
  | '虎豹骑' | '乡勇轻骑' | '黄巾轻骑' | '白波轻骑' | '黑山轻骑' | '西凉铁骑' | '伏龙军' | '木牛流马';

/** 兵系（通用特性池的归属维度） */
export type TroopFamily = '步兵系' | '弓兵系' | '骑兵系';

/**
 * 通用特性名（现版，每兵系 5 个）。
 *
 * 已移除（2025-06-25 官方公告，不再可用，故不在此列）：
 *   步兵 固阵 / 近战；骑兵 乱阵 / 侧击；弓兵 射马 / 伪装。
 */
export type GeneralTrait =
  // 步兵系
  | '守备'
  | '利刃'
  | '列阵'
  | '勇毅'
  | '文韬'
  // 弓兵系
  | '地利'
  | '齐射'
  | '直射'
  | '散射'
  | '迂回'
  // 骑兵系
  | '出奇'
  | '疾行'
  | '难测'
  | '扰后'
  | '挫锐';

/** 每个高级兵种的通用特性栏数量（4 星 / S1 赛季不可进阶 → 只有 1 栏；5 星进阶后 2 栏） */
export const TRAIT_SLOTS_MAX = 2;

/** 兵系 → 通用特性池（现版 5 个） */
export const FAMILY_TRAITS: Record<TroopFamily, GeneralTrait[]> = {
  步兵系: ['守备', '利刃', '列阵', '勇毅', '文韬'],
  弓兵系: ['地利', '齐射', '直射', '散射', '迂回'],
  骑兵系: ['出奇', '疾行', '难测', '扰后', '挫锐'],
};

/** 二级兵种静态定义 */
export interface SecondaryTroopDef {
  /** 官方武将表里的代码（`hero_type_availible` 的两位/三位代码） */
  code: string;
  family: TroopFamily;
  /** 专属特性（随兵种、不可更换）；空数组 = 占位待补（武将专属兵种） */
  exclusiveTrait: string[];
  /** 是否为武将专属（转换方向由个别武将独有） */
  exclusive: boolean;
  /**
   * **攻击距离**修正（死士 −1；其余 0）。
   * 官方：死士攻击距离固定 1 → 只影响普攻可达范围（target.ts `attackRangeOf`）。
   */
  rangeMod?: number;
  /**
   * **战法距离**修正（弓骑兵 +1；其余 0）。
   * 官方：弓骑兵「骑射」→ 战法距离 +1（target.ts `skillRangeOf`）。
   */
  skillRangeMod?: number;
  /** 永久四维加减（点数）：死士 攻/防/谋 +18、轻骑兵速度 +15、重步兵速度 −15 */
  statMod?: Partial<Record<'attack' | 'defense' | 'strategy' | 'speed', number>>;
  /** 四维百分比（黄巾兵涣散 −10）。加在点数之后。 */
  statPct?: number;
  /** 前 N 回合优先行动（长弓兵「先发」前 2 回合、白衣死士「奇袭」——均不限攻守）。 */
  priorityRounds?: number;
  /** 造成所有伤害加成 */
  caused?: number;
  /** 受到所有伤害降低 */
  taken?: number;
  /** 受到主动战法伤害降低（重步披甲 12%） */
  takenActive?: number;
  /** 本回合尚未行动时额外减伤（重步披甲「行动前额外 8%」） */
  takenBeforeAct?: number;
  /** 受到追击战法伤害降低 */
  takenPursuit?: number;
  /** 除火攻/燃烧外的减伤（藤甲 30%） */
  takenNonBurn?: number;
  /** 持续性伤害造成加成（丹阳观隙、火矢） */
  dotCaused?: number;
  /** 前 N 回合受到所有伤害降低 */
  takenRounds?: { rounds: number; rate: number };
  /** 控制状态下受到伤害降低，四类不可叠加（铁骑不屈） */
  takenInControl?: number;
}

/** 二级兵种注册表（code 与中文名双向可查） */
export const SECONDARY_TROOPS: Record<SecondaryTroopType, SecondaryTroopDef> = {
  长弓兵: {
    code: '11', family: '弓兵系', exclusive: false, rangeMod: 1, priorityRounds: 2,
    exclusiveTrait: ['先发：前 2 回合优先行动', '远离：攻击距离 +1'],
  },
  弩兵: {
    code: '21', family: '弓兵系', exclusive: false, caused: 0.08,
    exclusiveTrait: ['弩弓：造成的所有伤害提高 8%'],
  },
  死士: {
    code: '31', family: '弓兵系', exclusive: false, rangeMod: -1,
    statMod: { attack: 18, defense: 18, strategy: 18 },
    exclusiveTrait: ['无畏：攻击、防御、谋略 +18', '短兵：攻击距离 −1'],
  },
  连弩兵: {
    code: '41', family: '弓兵系', exclusive: false,
    exclusiveTrait: ['连射：每回合 30% 再普攻一次，首回合必定'],
  },
  火矢兵: {
    code: '51', family: '弓兵系', exclusive: false, dotCaused: 0.2,
    exclusiveTrait: ['火矢：火攻、燃烧造成的伤害 +20%', '点燃：普攻后额外触发目标身上已有燃烧一次'],
  },
  无当飞军: {
    code: '61', family: '弓兵系', exclusive: false, taken: 0.1,
    exclusiveTrait: ['隐蔽：非建筑领地受到所有伤害 −10%（无地图时默认生效）', '毒矢：普攻后随机动摇/恐慌/妖术 80% 1 回合'],
  },
  乡勇弓手: {
    code: '71', family: '弓兵系', exclusive: false, taken: -0.08,
    exclusiveTrait: ['乌合：克制乡勇轻骑，被其余兵种克制', '轻装：受到所有伤害 +8%'],
  },
  丹阳兵: {
    code: '81', family: '弓兵系', exclusive: false, dotCaused: 0.2,
    takenRounds: { rounds: 2, rate: 0.2 },
    exclusiveTrait: ['果劲：前 2 回合受到所有伤害 −20%', '观隙：造成的持续性伤害 +20%'],
  },
  黄巾长弓: {
    code: '91', family: '弓兵系', exclusive: false,
    exclusiveTrait: ['劫粮：战胜获得征兵资源（战斗外）'],
  },
  解烦兵: {
    code: '101', family: '弓兵系', exclusive: true,
    exclusiveTrait: ['绝援：普攻后 20% 使目标无法恢复兵力，持续 1 回合'],
  },
  白波长弓: {
    code: '111', family: '弓兵系', exclusive: false,
    exclusiveTrait: ['谨慎：前 2 回合受到谋略伤害 −20%', '自愈：非枯竭地驻守战后恢复伤兵（战斗外）'],
  },
  黑山长弓: {
    code: '121', family: '弓兵系', exclusive: false,
    exclusiveTrait: ['竭力：枯竭地造成伤害逐回合叠加（无地图不生效）', '趋利：除攻城外最高属性 +10、最低属性 −20'],
  },
  耕战营: {
    code: '131', family: '弓兵系', exclusive: false, caused: 0.15,
    exclusiveTrait: ['繁盛：非建筑领地造成所有伤害 +15%（无地图时默认生效）', '军屯：征兵消耗降低（战斗外）'],
  },
  青囊兵: {
    code: '141', family: '弓兵系', exclusive: false,
    exclusiveTrait: ['兴仁：受到恢复后下回合受伤 −6%，可叠 3 层', '青囊：每受到 2 次伤害恢复兵力（恢复率 60%）'],
  },
  重步兵: {
    code: '12', family: '步兵系', exclusive: false,
    takenActive: 0.12, takenBeforeAct: 0.08, statMod: { speed: -15 },
    exclusiveTrait: ['披甲：受到主动战法伤害 −12%，行动前额外 −8%', '负重：速度 −15'],
  },
  长枪兵: {
    code: '22', family: '步兵系', exclusive: false, caused: 0.08,
    exclusiveTrait: ['长柄：造成所有伤害 +8%', '弃盾：克制骑兵系，被弓兵系克制'],
  },
  禁卫: {
    code: '32', family: '步兵系', exclusive: false, taken: 0.06, takenPursuit: 0.2,
    exclusiveTrait: ['铁意：受到所有伤害 −6%', '护主：受到追击战法伤害 −20%'],
  },
  藤甲兵: {
    code: '42', family: '步兵系', exclusive: false, takenNonBurn: 0.3,
    exclusiveTrait: ['藤甲：除火攻、燃烧外受到所有伤害 −30%', '惧火：受到火攻、燃烧时暴走 2 回合'],
  },
  蛮兵: {
    code: '52', family: '步兵系', exclusive: false, caused: 0.18,
    exclusiveTrait: ['野战：非建筑领地造成所有伤害 +18%，建筑领地 −8%（无地图时按非建筑）'],
  },
  飞熊军: {
    code: '62', family: '步兵系', exclusive: false,
    exclusiveTrait: ['肉搏：每回合对距离 1 的敌军攻击一次（伤害率 25%）', '异士：兵力低于 50% 时每回合行动前恢复兵力'],
  },
  舷卫: {
    code: '72', family: '步兵系', exclusive: false, taken: 0.06,
    exclusiveTrait: ['铁意：受到所有伤害 −6%', '舷战：水域攻击距离 +1（无水域不生效）'],
  },
  黄巾兵: {
    code: '82', family: '步兵系', exclusive: false, statPct: -10,
    exclusiveTrait: ['豪夺 / 煽动：资源与征兵（战斗外）', '涣散：全属性 −10%'],
  },
  大戟士: {
    code: '92', family: '步兵系', exclusive: false,
    exclusiveTrait: ['铁戟：攻击方攻击 +8%，防守方防御 +8%', '巨盾：克制骑兵及弓兵系，被步兵系克制'],
  },
  白毦兵: {
    code: '102', family: '步兵系', exclusive: true,
    exclusiveTrait: ['巧变：兵力高于 50% 时攻击与策略伤害 +10%，低于 50% 时受到的攻击与策略伤害 −10%'],
  },
  乡勇步卒: {
    code: '112', family: '步兵系', exclusive: false, taken: -0.08,
    exclusiveTrait: ['乌合：克制乡勇弓手，被其余兵种克制', '轻装：受到所有伤害 +8%'],
  },
  白波轻步: {
    code: '122', family: '步兵系', exclusive: false,
    exclusiveTrait: ['救主：我军大营兵力首次低于 80% 时援护大营 2 回合', '自愈：驻守恢复伤兵（战斗外）'],
  },
  黑山轻步: {
    code: '132', family: '步兵系', exclusive: false,
    exclusiveTrait: ['竭力：枯竭地造成伤害逐回合叠加（无地图不生效）', '混战：受到攻击距离 ≤3 的普攻伤害 −20%'],
  },
  陷阵营: {
    code: '142', family: '步兵系', exclusive: false,
    exclusiveTrait: ['陷阵：兵力首次低于 90%、70% 后造成伤害各 +10%', '金戈：进攻方前 4 回合首次攻击伤害 +25%'],
  },
  黄巾轻步: {
    code: '152', family: '步兵系', exclusive: false,
    exclusiveTrait: ['劫粮：战胜获得征兵资源（战斗外）'],
  },
  重垣军: {
    code: '162', family: '步兵系', exclusive: false,
    exclusiveTrait: ['止戈：前 3 回合受伤有 15% 进入规避', '固守：建筑领地防守方受到所有伤害 −15%（无地图不生效）'],
  },
  白衣死士: {
    code: '172', family: '步兵系', exclusive: true, priorityRounds: 2, taken: 0.15,
    exclusiveTrait: ['蛰伏：首次受到的伤害大幅降低', '奇袭：前 2 回合优先行动，受到所有伤害 −15%'],
  },
  重骑兵: {
    code: '13', family: '骑兵系', exclusive: false,
    exclusiveTrait: ['迎击：前 2 回合受到普攻时反击（伤害率 75%）'],
  },
  轻骑兵: {
    code: '23', family: '骑兵系', exclusive: false, statMod: { speed: 15 },
    exclusiveTrait: ['冲阵：前 4 次造成的所有伤害 +18%', '轻装：速度 +15'],
  },
  弓骑兵: {
    code: '33', family: '骑兵系', exclusive: false, skillRangeMod: 1,
    exclusiveTrait: ['骑射：所有战法距离 +1', '善弓：可学习弓兵战法'],
  },
  铁骑兵: {
    code: '43', family: '骑兵系', exclusive: false, takenInControl: 0.25,
    exclusiveTrait: ['不屈：混乱、暴走、怯战、犹豫状态下受到所有伤害 −25%'],
  },
  象兵: {
    code: '53', family: '骑兵系', exclusive: false, taken: 0.1,
    exclusiveTrait: ['野性：不受指挥战法影响，受到所有伤害 −10%'],
  },
  羽林骑: {
    code: '83', family: '骑兵系', exclusive: false,
    exclusiveTrait: ['忠诚：国家占领郡内受到所有伤害 −15%（无地图不生效）', '急行：10 格内行军速度 +50%（战斗外）'],
  },
  白马义从: {
    code: '93', family: '骑兵系', exclusive: false, rangeMod: 1,
    exclusiveTrait: ['策马：攻击距离 +1', '疾射：首回合普攻后对附近敌军造成伤害（伤害率 50%）'],
  },
  虎豹骑: {
    code: '103', family: '骑兵系', exclusive: false,
    exclusiveTrait: ['冲锋：首次普攻使目标混乱 1 回合'],
  },
  乡勇轻骑: {
    code: '113', family: '骑兵系', exclusive: false, taken: -0.08,
    exclusiveTrait: ['乌合：克制乡勇步卒，被其余兵种克制', '轻装：受到所有伤害 +8%'],
  },
  黄巾轻骑: {
    code: '123', family: '骑兵系', exclusive: false,
    exclusiveTrait: ['劫粮：战胜获得征兵资源（战斗外）'],
  },
  白波轻骑: {
    code: '133', family: '骑兵系', exclusive: false,
    exclusiveTrait: ['急速：每有一个指挥战法，速度 +10%', '自愈：驻守恢复伤兵（战斗外）'],
  },
  黑山轻骑: {
    code: '143', family: '骑兵系', exclusive: false,
    exclusiveTrait: ['竭力：枯竭地造成伤害逐回合叠加（无地图不生效）', '势众：普攻目标下一次造成的所有伤害 −30%'],
  },
  西凉铁骑: {
    code: '153', family: '骑兵系', exclusive: true,
    exclusiveTrait: ['横行：攻击无视目标 10% 防御', '马铠：前 3 回合攻击无视兵种相克，受普攻和追击伤害 −20%'],
  },
  伏龙军: {
    code: '163', family: '骑兵系', exclusive: false,
    exclusiveTrait: ['奇正：主动或追击后使敌军单体下次受到策略伤害 +15%', '勃发：每回合开始谋略 +4%，可叠 4 次'],
  },
  木牛流马: {
    code: '173', family: '骑兵系', exclusive: true,
    exclusiveTrait: ['木械：受妖术、恐慌、动摇伤害 −30%，受火攻、燃烧伤害 +15%', '粮援：第 2/4/6/8 回合行动前恢复兵力（恢复率 60%）'],
  },
};

/** 全部二级兵种名 */
export const ALL_SECONDARY_TROOPS = Object.keys(SECONDARY_TROOPS) as SecondaryTroopType[];

/** 代码 → 兵种名（`hero_type_availible` 解码用） */
export const CODE_TO_TROOP: Record<string, SecondaryTroopType> = Object.fromEntries(
  ALL_SECONDARY_TROOPS.map((t) => [SECONDARY_TROOPS[t].code, t])
) as Record<string, SecondaryTroopType>;

/** 兵种 → 通用特性池（同兵系共享） */
export function traitsFor(troop: SecondaryTroopType): GeneralTrait[] {
  return FAMILY_TRAITS[SECONDARY_TROOPS[troop].family];
}

/** 兵种是否属于某兵系 */
export function familyOf(troop: SecondaryTroopType): TroopFamily {
  return SECONDARY_TROOPS[troop].family;
}

/** 兵系 → 基础兵种类别（用于「骑兵 / 步兵 / 弓兵」类判定） */
const TROOP_OF_FAMILY: Record<TroopFamily, TroopType> = {
  骑兵系: 'cavalry',
  步兵系: 'infantry',
  弓兵系: 'archer',
};

/**
 * **有效兵系**（`TroopType` 视角）：二级兵种转换后按**该二级兵种的兵系**判定，未转换时取原兵种。
 *
 * 依据 `docs/兵种转换调研.md`：两个转换方向**可以跨兵系**（祝融夫人 群·骑 → 蛮兵，蛮兵属**步兵系**；
 * 郭嘉 骑 → 死士属弓兵系；太史慈 弓 → 弓骑兵属骑兵系），且「蛮兵/藤甲兵仍为步系、象兵为骑系」。
 * 战法文本里的「骑兵 / 步兵 / 弓兵」= 兵**系**，故转换后按新兵系判定
 * （用户 2026-09-22：衡轭的「步兵普攻增伤」必须给蛮兵祝融）。
 */
export function effectiveTroopLine(g: { troopType: TroopType; secondaryTroop?: SecondaryTroopType }): TroopType {
  return g.secondaryTroop ? TROOP_OF_FAMILY[SECONDARY_TROOPS[g.secondaryTroop].family] : g.troopType;
}

/** 攻击距离修正（长弓兵 +1 / 死士 −1 / 其余 0） */
export function rangeModOf(troop: SecondaryTroopType | undefined): number {
  return troop ? SECONDARY_TROOPS[troop].rangeMod ?? 0 : 0;
}

/** 战法距离修正（弓骑兵 +1 / 其余 0） */
export function skillRangeModOf(troop: SecondaryTroopType | undefined): number {
  return troop ? SECONDARY_TROOPS[troop].skillRangeMod ?? 0 : 0;
}

/** 二级兵种永久属性加减（点数）：死士 攻/防/谋 +18、轻骑兵 速度 +15 */
export function statModOf(
  troop: SecondaryTroopType | undefined,
  kind: 'attack' | 'defense' | 'strategy' | 'speed'
): number {
  return troop ? SECONDARY_TROOPS[troop].statMod?.[kind] ?? 0 : 0;
}

/**
 * 高级兵种改写后的「被克制减伤」：
 * 规则（调研 §四.6）：
 *  - **长枪兵**（仅长枪兵自身参战时）：
 *      · 长枪兵打骑兵 → 目标受击 **+30%**（返回 −0.3）
 *      · 长枪兵打弓兵 → 自身伤害 **−30%**（返回 0.3，被弓克制）
 *      · 骑兵打长枪兵 → 骑兵伤害 **−30%**（返回 0.3，枪克骑）
 *      · 弓兵打长枪兵 → 弓兵伤害 **+30%**（返回 −0.3）
 *    —— 注意「对骑兵伤害 +30%」是**长枪兵自己的攻击加成**，不会让别的兵种打骑兵也增伤。
 *  - 其余高级兵种按**基础兵系**相克：骑克步、步克弓、弓克骑；被克制方攻击克制方 → 伤害 −30%
 *    （用户口径：统一 −30%，不采用官方三档）。
 *
 * 返回值语义与 `troopCounterReduce` 一致：**加算进增减伤单一总和**的正数（减伤）；
 * 负数 = 该次伤害提高（如长枪兵打骑/弓打枪）。
 */
export function troopCounterReduceOf(params: {
  attackerTroop: TroopType;
  attackerSecondary?: SecondaryTroopType;
  targetTroop: TroopType;
  targetSecondary?: SecondaryTroopType;
}): number {
  const { attackerTroop, attackerSecondary, targetTroop, targetSecondary } = params;
  // 相克按**有效兵系**：二级兵种转换后取该兵种的兵系（蛮兵 → 步兵系；用户 2026-09-22）
  const atkLine: TroopType = attackerSecondary
    ? TROOP_OF_FAMILY[SECONDARY_TROOPS[attackerSecondary].family]
    : attackerTroop;
  const tgtLine: TroopType = targetSecondary
    ? TROOP_OF_FAMILY[SECONDARY_TROOPS[targetSecondary].family]
    : targetTroop;

  const xiang = xiangyongReduce(attackerSecondary, targetSecondary);
  if (xiang !== null) return xiang;
  const daji = dajiReduce(attackerSecondary, targetSecondary, atkLine, tgtLine);
  if (daji !== null) return daji;

  // —— 长枪兵自身作为攻击方：对骑 +30%、被弓克 −30% ——
  if (attackerSecondary === '长枪兵') {
    if (tgtLine === 'cavalry') return -0.3; // 枪打骑：目标受击 +30%
    if (tgtLine === 'archer') return 0.3; // 枪打弓：自身被克 −30%
    return 0;
  }
  // —— 长枪兵作为受击方：骑打枪 −30%、弓打枪 +30% ——
  if (targetSecondary === '长枪兵') {
    if (atkLine === 'cavalry') return 0.3; // 骑打枪：骑被克 −30%
    if (atkLine === 'archer') return -0.3; // 弓打枪：弓获增伤 +30%
    return 0;
  }

  return COUNTER_OF[tgtLine] === atkLine ? 0.3 : 0;
}

/** 乡勇三角：各克制一种乡勇，并被该种以外的兵种克制。无乡勇参与时返回 null。 */
function xiangyongReduce(atk?: SecondaryTroopType, tgt?: SecondaryTroopType): number | null {
  const kinds: readonly SecondaryTroopType[] = ['乡勇弓手', '乡勇步卒', '乡勇轻骑'];
  const beats: Partial<Record<SecondaryTroopType, SecondaryTroopType>> = {
    乡勇弓手: '乡勇轻骑',
    乡勇步卒: '乡勇弓手',
    乡勇轻骑: '乡勇步卒',
  };
  /** 乡勇只不被自己、以及自己克制的那种克制 */
  const countered = (victim: SecondaryTroopType, other?: SecondaryTroopType) =>
    other !== victim && other !== beats[victim];
  if (tgt && kinds.includes(tgt) && countered(tgt, atk)) return -0.3;
  if (atk && kinds.includes(atk) && countered(atk, tgt)) return 0.3;
  if ((atk && kinds.includes(atk)) || (tgt && kinds.includes(tgt))) return 0;
  return null;
}

/** 大戟士：克制骑、弓，被步克制。双方都不是大戟士时返回 null。 */
function dajiReduce(
  atkTroop: SecondaryTroopType | undefined,
  tgtTroop: SecondaryTroopType | undefined,
  atkLine: TroopType,
  tgtLine: TroopType,
): number | null {
  if (atkTroop !== '大戟士' && tgtTroop !== '大戟士') return null;
  if (atkTroop === '大戟士') {
    if (tgtLine === 'cavalry' || tgtLine === 'archer') return -0.3;
    if (tgtLine === 'infantry') return 0.3;
    return 0;
  }
  if (atkLine === 'cavalry' || atkLine === 'archer') return 0.3;
  if (atkLine === 'infantry') return -0.3;
  return 0;
}

/** 基础相克链：克制对象（骑克步、步克弓、弓克骑） */
const COUNTER_OF: Record<TroopType, TroopType> = {
  cavalry: 'infantry',
  infantry: 'archer',
  archer: 'cavalry',
};

/** 位置权重（与 troopBonus 的排序口径一致：大营 0 / 中军 1 / 前锋 2） */
export const POSITION_ORDER: Record<Position, number> = { 大营: 0, 中军: 1, 前锋: 2 };

/**
 * 通用特性「利刃」的攻击加成：每学习 1 个非主动战法 +22 攻击（含自带主战法），上限 3 个 = +66。
 * @param nonActiveSkillCount 非主动战法数量（含主战法）
 */
export function liRenAttackBonus(nonActiveSkillCount: number): number {
  return Math.min(3, Math.max(0, nonActiveSkillCount)) * 22;
}

/**
 * 通用特性「地利」的四维加成（现版，2025-06-12 下调后）。
 * 官方原文：位于前锋时防御 +24；位于中军时防御、谋略 +10；位于大营时攻击、谋略、防御 +6。
 */
export function diLiBonus(pos: Position): Partial<Record<'attack' | 'defense' | 'strategy', number>> {
  if (pos === '前锋') return { defense: 24 };
  if (pos === '中军') return { defense: 10, strategy: 10 };
  return { attack: 6, defense: 6, strategy: 6 };
}

/** 通用特性附加属性（点数）：利刃（攻击）+ 地利（按站位）。其余特性是伤害/减伤型不在此。 */
export function traitStatBonus(
  general: { secondaryTraits?: GeneralTrait[]; position: Position; activeSkillIds: string[]; passiveSkillIds: string[]; commandSkillIds: string[]; pursuitSkillIds: string[]; mainSkillId?: string },
  kind: 'attack' | 'defense' | 'strategy' | 'speed'
): number {
  const traits = general.secondaryTraits;
  if (!traits || traits.length === 0) return 0;
  let bonus = 0;
  if (traits.includes('利刃') && kind === 'attack') {
    // 非主动战法数（含自带主战法）：主动 = activeSkillIds（主战法若为主动需排除，此处按「自带战法」口径）
    const nonActive = general.activeSkillIds.length + general.passiveSkillIds.length + general.commandSkillIds.length + general.pursuitSkillIds.length;
    bonus += liRenAttackBonus(nonActive);
  }
  const diLi = traits.includes('地利') ? diLiBonus(general.position) : {};
  if (kind !== 'speed') bonus += diLi[kind] ?? 0;
  return bonus;
}

/**
 * 战斗期特性上下文（由 action.ts 的伤害管线构造）。
 * `hit` 语义与 DamageHitContext 一致但更窄，避免类型环依赖。
 */
export interface TraitCombatContext {
  /** 施法者（伤害来源）已学通用特性 */
  attackerTraits?: GeneralTrait[];
  /** 施法者二级兵种（专属特性判定） */
  attackerTroop?: SecondaryTroopType;
  /** 受击者已学通用特性 */
  targetTraits?: GeneralTrait[];
  /** 受击者二级兵种 */
  targetTroop?: SecondaryTroopType;
  /** 受击者当前是否处于该状态（混乱/暴走/怯战/犹豫） */
  targetHasStatus: (type: 'confusion' | 'rampage' | 'cowardice' | 'hesitation') => boolean;
  /** 受击者的当前兵力（扰后/挫锐取「兵力最高」用） */
  targetTroops: number;
  /** 当前回合（1 起） */
  round: number;
  /** 受击者站位（扰后） */
  targetPosition: Position;
  /** 施法者到受击者的距离（直射） */
  distance: number;
  /** 防守方视角（守备/以静制动）：施法者处于防守方为 true */
  attackerIsDefender?: boolean;
  /** 受击者处于防守方（守备） */
  targetIsDefender?: boolean;
  /** 伤害类型 */
  damageType?: 'physical' | 'strategy';
  /** 战法类型（undefined = 普攻/分兵等非战法伤害） */
  skillType?: 'passive' | 'command' | 'active' | 'pursuit';
  /** 是否追击战法伤害 */
  isPursuit?: boolean;
  /** 是否燃烧/火攻类伤害（藤甲兵） */
  isBurning?: boolean;
  /** 是否 Dot 伤害（文韬不触发） */
  isDot?: boolean;
  /** 是否普攻或追击伤害（难测） */
  isBasicOrPursuit?: boolean;
  /** 施法者攻击是否为「进行攻击」（列阵只吃主动战法） */
  isActiveSkill?: boolean;
  /** 轻骑兵「前 4 次攻击」是否仍在次数内（由轻骑兵攻击计数器判定） */
  lightCavalryAttackLeft?: boolean;
  /** 受击者本回合是否已经行动（重步兵披甲「行动前额外 −8%」） */
  targetHasActed?: boolean;
}

/** 特性增减伤结算结果：caused = 造成侧加成（1 = 无），reduce = 受击侧减伤（加算） */
export interface TraitModifiers {
  caused: number;
  takeBoost: number;
  reduce: number;
}

/**
 * 计算通用特性 + 二级兵种专属特性带来的增减伤修正（与战法效果**可叠加**、不受冲突规则约束）。
 * 只覆盖「伤害/减伤」型特性；属性型（利刃/地利）见 traitStatBonus，
 * 行动序型（疾行）、规避型（死士/轻骑兵/弓骑兵首次规避）、反击型（重骑兵）见各自主流程。
 */
export function traitCombatModifiers(x: TraitCombatContext): TraitModifiers {
  let caused = 0; // 造成侧加成
  let takeBoost = 0; // 受击者「受到伤害提高」
  let reduce = 0; // 受击者减伤

  const at = x.attackerTraits ?? [];
  const tt = x.targetTraits ?? [];

  // ── 施法者通用特性（造成侧）──
  if (at.includes('列阵') && x.isActiveSkill) caused += 0.1;
  if (at.includes('齐射') && x.round <= 3) caused += 0.15;
  if (at.includes('勇毅')) {
    // 「受到弓兵和步兵的策略伤害降低 15%」= 受击者减伤，见下
  }
  if (at.includes('文韬') && x.damageType === 'strategy' && x.round >= 3 && !x.isDot) caused += 0.15;
  if (at.includes('直射') && !x.isDot) {
    const base = x.skillType === 'command' ? 0 : 0.1;
    if (base > 0) caused += base - 0.02 * Math.max(0, x.distance - 1);
  }
  if (at.includes('扰后') && (x.targetPosition === '中军' || x.targetPosition === '大营')) takeBoost += 0.1;
  if (at.includes('挫锐')) takeBoost += 0.18;
  if (at.includes('散射')) takeBoost += 0; // 分兵（首攻溅射）主流程单独处理

  // ── 施法者二级兵种（包内特性表的造成侧）──
  const atkFx = x.attackerTroop ? SECONDARY_TROOPS[x.attackerTroop] : undefined;
  if (atkFx?.caused) caused += atkFx.caused;
  if (atkFx?.dotCaused && (x.isDot || x.isBurning)) caused += atkFx.dotCaused;
  if (x.attackerTroop === '轻骑兵' && x.lightCavalryAttackLeft === true) caused += 0.18;

  // ── 受击者通用特性（受击侧）──
  if (tt.includes('守备')) reduce += x.targetIsDefender ? 0.16 : 0.06;
  if (tt.includes('迂回')) reduce += 0.08;
  if (tt.includes('出奇') && x.round === 1) reduce += 0.6;
  if (tt.includes('难测') && x.isBasicOrPursuit) reduce += 0.25;
  if (tt.includes('勇毅') && x.damageType === 'strategy') reduce += 0.15;

  // ── 受击者二级兵种（包内特性表）──
  const tfx = x.targetTroop ? SECONDARY_TROOPS[x.targetTroop] : undefined;
  if (tfx?.taken) reduce += tfx.taken;
  if (tfx?.takenActive && x.isActiveSkill) reduce += tfx.takenActive;
  if (tfx?.takenBeforeAct && !x.targetHasActed) reduce += tfx.takenBeforeAct;
  if (tfx?.takenPursuit && x.isPursuit) reduce += tfx.takenPursuit;
  if (tfx?.takenNonBurn && !x.isBurning) reduce += tfx.takenNonBurn;
  if (tfx?.takenRounds && x.round <= tfx.takenRounds.rounds) reduce += tfx.takenRounds.rate;
  if (tfx?.takenInControl) {
    const any = x.targetHasStatus('confusion') || x.targetHasStatus('rampage') || x.targetHasStatus('cowardice') || x.targetHasStatus('hesitation');
    if (any) reduce += tfx.takenInControl;
  }
  if (x.targetTroop === '西凉铁骑' && x.round <= 3 && x.isBasicOrPursuit) reduce += 0.2;
  if (x.targetTroop === '白波长弓' && x.damageType === 'strategy' && x.round <= 2) reduce += 0.2;
  if (x.targetTroop === '木牛流马' && x.isDot && !x.isBurning) reduce += 0.3;
  if (x.targetTroop === '木牛流马' && x.isBurning) reduce -= 0.15;

  return { caused, takeBoost, reduce };
}
