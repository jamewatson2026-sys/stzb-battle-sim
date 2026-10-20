# 诊断报告 · 2026-10-20 · 四战法机制修复

> 报障：用户一次报四条（会话首条消息）—— 马岱【奉令护蜀】层数不生效 / 免疫控制压不住指挥控制 /
> 【乘间击隙】与增伤冲突后整场废掉 / 【一夫当关】减伤固定 50% 不随防御成长。
> 本报告 = 根因、修法、包内数值、验收数据与复现方式。**结论：四条全部修好并取证。**

## 一、用户口径（原话要点，勿再询问）

1. 马岱【奉令护蜀】「队友进行普攻、主动、追击时层数加了，但是却没有实际增伤 / 减伤，下一次普通攻击时也没有正确把
   所有层数消耗，而是叠到五层才能消耗。应该是下一次普通吃**所有层数**的增伤，下一次**受到所有伤害**时吃到所有减伤，
   且**二者分开计算**」。
2. 「免疫怯战效果出错，当疾战释放时获得免疫怯战效果，却仍然受到了战必的怯战影响。免疫效果是免除自己受到的控制效果，
   这个优先级要在**指挥等控制之上**」。同样的现象在凌统（【国士无双】洞察）也出现。
3. 【乘间击隙】「会与始计等增伤冲突，一旦冲突整场无法再叠层和出伤。修正：会和指挥增伤冲突但是**不会影响叠层**，
   满足条件仍旧叠层，三层时出伤并清空层数。且乘间击隙是指挥战法，**不应该与被动、主动型增伤冲突**才对，
   因此关银屏可同时携带击势 + 乘间击隙，三者增伤互不冲突且乘间击隙能正常出伤」。
4. 【一夫当关】「受防御属性影响，其成长率从**包内**拿，并实装到模拟器，目前一夫当关固定 50% 减伤」。

## 二、根因与修法

### ① 奉令护蜀：一条状态一个计数 → 双计数器

- 旧实现：`pending_stacks` 状态只有 `stacks`（一个数），`consumePendingStacks` 在「普攻打出时」与「实际扣兵后」**两处都清空全部层数**
  → 只要挨一下打，攒的增伤层一起被吞掉，实战几乎吃不到增伤。
- 现口径：`src/engine/types.ts` 的 `pending_stacks` 拆成 `{ boostStacks, reduceStacks, maxStacks, perLayerBoost, perLayerReduce }`；
  `src/engine/action.ts`
  - `addPendingStack` 两段各自 +1、各自封顶；
  - `consumePendingBoostStacks`（普攻结算前）只清增伤层、`consumePendingReduceStacks`（`applyDamage` 实际扣兵后）只清减伤层，
    统一走 `consumePendingStacksBy(unit, kind)`，并推出 `status_changed` 明细；
  - `prunePendingStacks` 只在**两段都归零**时移除状态；
  - 读侧 `pendingStacksBoostOf` 仅对 `damageSource === 'basic'` 且非分兵生效，`pendingStacksReduceOf` 对所有伤害生效。

### ② 免疫控制：只能拦「之后施加」→ 施加时回收已生效控制

- 旧实现只在 `inflictStatus` 入口拦之后施加的控制；而一类指挥的预备负面（战必断金 / 措手不及 / 白衣渡江）走
  `triggerPreparedEffectOnAct`（目标行动开始时）按 `ctx.lockedCommands` 顺序施加 —— 战必排在前时先落怯战，之后才挂洞察
  → 已经落下的控制永不解除，于是「免疫已生效却仍被怯战压住」。
- 现口径：新增 `purgeControlsCoveredByImmunity(ctx, target, create)`，在 `inflictStatusCore` 的 `const type = create.type;`
  之后调用 —— 施加 `insight` / `cowardice_immune` / `control_immune` 时，立刻移除持有者身上**已被覆盖**的控制
  （洞察 → 控制类 + 挑衅；免疫怯战 → 怯战；`control_immune` → 声明类型），逐条发 `status_expired`。
  只清控制类，不清 DoT / 增伤 / 减伤 —— 这是「免疫优先级高于指挥控制」的落点。

### ③ 乘间击隙：叠层计数与增伤状态解耦 + 满层那一段按「攻击」结算

- 旧实现拿增伤状态的 `stacks` 当计数器；乘间击隙是**指挥**战法，其 15% 攻击增伤与同域指挥增伤（始计 20%）判「数值取较高」被拒
  → 状态不存在 → 计数器永远读到 0 → 整场既不叠层也不出伤。
- 现口径：`ctx.mainActiveCastCounters`（`CombatContext` 新字段，key `${unitId}:${skillId}`，仿奋疾先登 actLayerCounters）
  每次「主动主战法发动」+1；增伤状态「尽力施加」（可被冲突吃掉，不影响计数）；达 `maxStacks` 时执行 `triggerOutput`、
  清本战法增伤、计数归零。被动 / 主动型增伤本就与指挥增伤不同域（冲突域按 `sourceSkillType` 划分）→ 击势 + 乘间击隙并存。
- **`asAttack`（新增）**：官方写「对敌军群体发动 1 次**攻击**（伤害率 240%）」，而 `isAttackHitForProc` 的攻击白名单只有
  普攻 / 物理主动 / 追击（指挥物理伤害不在内）→ 满层那一段吃不到自己 45% 的 `attackOnly` 增伤。现由 `PhysicalDamageOutput.asAttack: true`
  显式标记，`DamageHitContext.attack` 一路带到 `isAttackHitForProc` 早退为真。

### ④ 一夫当关：补包内成长率 0.375/点

- 数据：skill **200674** → `main_detail 20067401`（effect 122 容器）→ 子技能 **21067401**：effect 522、
  `constant_param 20`、`intel_param 75`、`attri_type 2`（防御）、`init_effect_ratio 50`、`available_round 2`。
- 换算（口径已验证）：满级值 = `constant_param + 0.4 × intel_param` = 20 + 30 = **50%（防御 80 处基准）**；
  成长率 = `intel_param ÷ 200` = **0.375/点**；1 级 25%；前 2 回合；仅前锋位。
- 修法：`src/data/skills.ts` 的 `damage_reduce` 段补 `growthRate: 0.375`（`defenseScaled` 早已存在，缺成长率时恒用基值 0.5）
  → 生效值 = `roundRate(scaledValue(50, 0.375, 生效防御))`（防御 200 → 95%）。

## 三、端到端验收（真实战斗，每场景 40 种子）

命令：`npx tsx scripts/_verify_1029_fixes.mts`（末段 FAIL/PASS 断言，非零退出）

| 场景 | 实测 |
|------|------|
| ① 奉令护蜀 | 叠层 450 次；普攻消耗 320 次（**320/320 都发生在「减伤层仍 > 0」时**，证明确实分开清）；受击消耗 158 次；对同一支敌军总输出 **662488 vs 不带 536798（+23.4%）** |
| ② 免疫怯战（凌统 vs 战必） | 被怯战挡掉的普攻 **66 vs 白板 134**；怯战施加 42 次、免疫**当场清掉 24 次**；凌统普攻命中 398 次 |
| ③ 乘间击隙 + 击势 | 单次攻击里乘间增伤最高合计 **45%**（3 层）；与击势同框 573 次；3 层出伤 240 次共 **685564**；总输出 **2022733 vs 只带击势 1257006（+60.9%）** |
| ④ 一夫当关 | 生效防御 96 / 180 / 240 → 减伤 **56% / 87% / 110%**，与公式逐行一致 |

> ② 的口径说明：国士无双的洞察是 **90% 判定的一类指挥、窗口仅 1~3 回合**，落在「无洞察回合」的怯战按规则照常生效 ——
> 因此验收不是「被控 = 0」，而是 ①免疫确实回收了已生效的控制（24 次）②被控次数显著少于白板（66 < 134 / 2）。

### 追问澄清：「两段都归零才移除状态」≠ 耦合（2026-10-20）

用户追问原话：「两段都归零才移除状态？马岱是增伤和减伤层数分开计算，如叠加三层 奉令护蜀，下一次普攻获得三层增伤，
增伤清空，队友继续叠层时马岱 1 层增伤 4 层减伤。」

- **口径确认**：`prunePendingStacks` 只在 `boostStacks` 与 `reduceStacks` **都 ≤ 0** 时移除状态 —— 那是一个
  「两段都空」的壳子，移除它不影响任何数值；两段计数本身**永不互相消耗**。
- **实测（`npx tsx scripts/_probe_fengling.mts`）**：队友发动 3 次 → 增伤 3 / 减伤 3 → 马岱普攻（吃 3 层增伤，
  伤害事件 `caused` 出现 `奉令护蜀 rate=1.47` = 0.49×3）→ **增伤 0 / 减伤 3** → 队友再发动 1 次 →
  **增伤 1 / 减伤 4** → 马岱受击 → **增伤 1 / 减伤 0**。与用户描述逐字一致。
- **反向序列也已钉死**：3 层 → 受击只清减伤（3/0）→ 队友再发动 1 次 = 4 增伤 / 1 减伤。
- **战报可见性（本次补）**：`collectDamageModifiers` 现在把「叠层待发」按层数归因到 `modifiers.caused` /
  `modifiers.reduce`，战报能显示「奉令护蜀 增伤 147%」，不再是「层数在涨但看不出效果」。

### 单元回归

| 文件 | 例数 | 覆盖 |
|------|------|------|
| `tests/fengling_hushu.test.ts` | 10 | 叠层不含自身 / 5 层封顶 / 每层数值 / 下一次普攻吃全部增伤层且只清增伤 / 受击吃全部减伤层且只清减伤 / 两段归零才移除 / **3 层→普攻→再叠 1 次 = 1 增伤 4 减伤** / **反向 4 增伤 1 减伤** / 战报归因 rate=每层×层数 / 真实战斗同时出现两种消耗 |
| `tests/immunity_priority.test.ts` | 6 | 洞察·免疫怯战·control_immune 三条回收口径 + 「不清混乱」反例 + 已有洞察仍被拦（回归）+ 战必锁在前、国士无双锁在后的时序 + 疾战 output 数据链路 |
| `tests/chengjian_jixi.test.ts` | 4 | 15% → 30% → 3 层出伤并清空 / 满层那一段吃到自身 **45%** 增伤 / 与指挥 20% 冲突被拒但层照叠 3 层照出伤 / 与击势 50% 并存 |
| `tests/yifudangguan.test.ts` | 4 | 数据断言（defenseScaled / 0.375 / duration 2 / 仅前锋 / cover 仍在）/ 防御 80→50%、200→95%、150→76% / 大营位不生效 |

全量：`npx tsc --noEmit` 干净；`npx vitest run` = **114 文件 / 1014 例全绿**，其中 `tests/golden.test.ts` 通过（四战法均不在 T1~T9 固定测试集，快照未变）。

## 四、复现与验收脚本

```bash
cd "C:/Users/lai15/Desktop/战斗系统"
npx tsx scripts/_verify_1029_fixes.mts     # 四场景端到端（PASS/FAIL）
npx tsx scripts/_probe_cj.mts              # 单场逐事件：乘间击隙叠层 / 出伤 / 清空时序
npx tsx scripts/_probe_cj2.mts             # 单元级：15%→30%→45% 叠层 + 与击势/主动增伤并存
npx tsx scripts/_probe_fengling.mts        # 奉令护蜀三段示例：3 层 → 普攻 → 队友再叠 = 1 增伤 / 4 减伤
npx vitest run tests/fengling_hushu.test.ts tests/immunity_priority.test.ts tests/chengjian_jixi.test.ts tests/yifudangguan.test.ts
```

## 五、已知边界

- 免疫控制只解除**控制类**（混乱 / 暴走 / 怯战 / 犹豫 / 挑衅），不解除灼烧、恐慌等持续伤害。
- ②的剩余被控次数来自「国士无双未判中 / 窗口外的战必」—— 属数据驱动的 90% 判定，不是缺陷。
- 【乘间击隙】满 3 层那一段按官方「攻击」口径结算（吃自身 45%）；若后续确认它应为「指挥伤害」不吃 attackOnly，
  只需去掉 `src/data/skills.ts` 里的 `asAttack: true` 并同步 `tests/chengjian_jixi.test.ts` 一条断言。
- 本次改动会改变相关阵容的伤害数值，历史战报不重算。

## 六、追加（同日）：免疫解除后仍无法普攻 —— 怯战闸门的判定时机

**报障（用户截图 + 一句追问「免疫解除了还无法普攻？」）**，战报逐行：

```
张绣 主动战法判定 →【怯战】当前生效几率 45% → 发动【疾战】
张绣 获得：连击 1 回合 / 张绣 的怯战状态解除 / 张绣 获得：免疫怯战 1 回合
张绣 普通攻击 → 无法普攻：怯战：无法进行普通攻击（两次）
```

**根因**：`actUnit` 在「4. 怯战检查」处（`src/engine/action.ts:3084`，**主动战法段之前**）把怯战算成布尔快照

```ts
const canNormalAttack = !unit.statuses.some((s) => s.type === 'cowardice' && !s.pendingNextAct) && !hasStatus(unit, 'no_attack');
```

而普攻段（同一行动更晚，`action.ts:3168` / 附马腾扬砂的 `action.ts:3213`）沿用这个快照 ——
疾战在本行动内解掉的怯战，快照里仍为 `false`，于是两刀连击全部报「无法普攻」。

**修法**：怯战只封锁普攻，语义上可以在**普攻那一刻**按实时状态判定 → 改成闭包 `canNormalAttackNow()`：

```ts
const canNormalAttackNow = (): boolean =>
  !unit.statuses.some((s) => s.type === 'cowardice' && !s.pendingNextAct) &&
  !hasStatus(unit, 'no_attack');
```

两处调用点（`normalAttack(...)` 与 `consumeStacksForExtraAttack(...)`）改为调用它；
`pendingNextAct`（张昭「下一次行动时进入怯战」）与宝物「艮止」的 `no_attack` 口径原样保留。

**回归**（`tests/immunity_priority.test.ts` 6 → **8 例**）：

1. 战必先挂怯战 → 同型测试主动战法（连击 + 免疫怯战）→ 怯战被 purge、**连击两刀真的打出来**（`attack_hit` = 2）、0 次怯战拦截；
2. 守卫：未解除时仍然 0 刀 + 1 次「怯战：无法进行普通攻击」（闸门没有被放松）。

**反证**：把闸门临时改回快照（`const STALE = canNormalAttackNow()` 传进 `normalAttack`）→ 用例 1 立刻红（命中 0 ≠ 2），
改回实时判定即绿 —— 证明这条用例真的咬住了这个 bug。

**复跑**：`npx tsc --noEmit` = 0；`npm test` = **115 文件 / 1026 例全绿**（golden 未变）；
`npx tsx scripts/_verify_1029_fixes.mts` 四场景仍全 PASS，② 因「不再空转」而进一步下降 ——
凌统被怯战挡掉的普攻 **19 次 vs 白板 56 次**（修复前是 66 vs 134 口径下的空转），普攻命中 440 次，怯战施加 42 次 / 免疫当场清掉 23 次。
